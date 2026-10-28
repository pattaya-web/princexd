import { randomBytes, timingSafeEqual } from "crypto";
import fs from "fs";
import path from "path";
import type { NextRequest } from "next/server";
import { newId, readDB, saveSettings, writeDB } from "./db";
import { hashKey } from "./thumb-cache";
import type { DB, Reel, Swipe, SwipeStage } from "./types";
import { SWIPE_STAGES } from "./types";

/**
 * Tinder des Reels (2026-10-28).
 *
 * Instagram n'expose ni le feed personnalise « Pour toi » ni le like d'un
 * Reel d'autrui dans son API officielle, et bloque le serveur. Le feed est
 * donc capture depuis le navigateur de Mady par l'extension Chrome
 * « Mvdy Reels » (dossier extension/), qui envoie ici chaque Reel vu dans
 * le feed (metadonnees, puis le fichier video et la vignette). Le tool
 * presente ensuite la file en mode Tinder : droite = a produire (un swipe
 * est cree dans la Swipe file), gauche = passe.
 */

const MEDIA_DIR = path.join(process.cwd(), "data", "media");
/** Au-dela, la video n'est pas gardee (les Reels font 2 a 15 Mo). */
export const MAX_VIDEO_BYTES = 120 * 1024 * 1024;
export const MAX_THUMB_BYTES = 4 * 1024 * 1024;
/** Une video d'un Reel passe est effacee apres ce delai (on peut encore annuler avant). */
const SKIPPED_VIDEO_TTL_MS = 2 * 24 * 60 * 60 * 1000;
/** Un Reel passe disparait de la base apres ce delai (il pourra etre recapture). */
const SKIPPED_ROW_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Un Reel jamais juge est garde ce temps-la : au-dela, le feed a tourne. */
const QUEUE_TTL_MS = 21 * 24 * 60 * 60 * 1000;

const cleanUrl = (u: string) => (u || "").split("?")[0].replace(/\/+$/, "");
export const reelUrl = (code: string) => `https://www.instagram.com/reel/${code}/`;
/** Meme nom que lib/video-source : la Swipe file retrouve la video en cache sans rien retelecharger. */
export const reelVideoName = (code: string) => `v${hashKey(cleanUrl(reelUrl(code)))}.mp4`;
export const reelThumbName = (code: string) => `rt${hashKey(code)}.jpg`;

/* ------------------------------- Jeton ------------------------------- */

export function extensionToken(): string {
  const cur = readDB().settings.reelsExtensionToken;
  if (cur) return cur;
  return regenerateExtensionToken();
}

export function regenerateExtensionToken(): string {
  const token = randomBytes(24).toString("hex");
  saveSettings({ reelsExtensionToken: token });
  return token;
}

/** Vrai si la requete porte le jeton de l'extension (Authorization: Bearer). */
export function extensionAuthorized(req: NextRequest): boolean {
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const expected = readDB().settings.reelsExtensionToken ?? "";
  if (!got || !expected || got.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

/* ------------------------------ Ingestion ----------------------------- */

export interface IngestItem {
  code: string;
  username?: string;
  fullName?: string;
  caption?: string;
  likes?: number | null;
  comments?: number | null;
  plays?: number | null;
  durationSec?: number | null;
  takenAt?: number | null;
}

export interface IngestResult {
  code: string;
  id: string;
  /** Deja connu (vu, garde ou passe). */
  known: boolean;
  needVideo: boolean;
  needThumb: boolean;
}

const CODE = /^[A-Za-z0-9_-]{5,40}$/;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Enregistre les Reels vus (sans doublon, par code). Renvoie pour chacun ce
 * qu'il manque encore (video, vignette) pour que l'extension l'envoie.
 */
export function ingestReels(items: IngestItem[]): IngestResult[] {
  const db = readDB();
  cleanup(db);
  const byCode = new Map(db.reels.map((r) => [r.code, r]));
  const now = new Date().toISOString();
  const out: IngestResult[] = [];
  let changed = false;
  for (const it of items.slice(0, 100)) {
    const code = String(it.code ?? "").trim();
    if (!CODE.test(code)) continue;
    let reel = byCode.get(code);
    if (reel) {
      // Deja la : on rafraichit juste les compteurs si on en a de plus recents.
      if (num(it.likes) !== null) reel.likes = num(it.likes);
      if (num(it.plays) !== null) reel.plays = num(it.plays);
      if (num(it.comments) !== null) reel.comments = num(it.comments);
      changed = true;
      out.push({ code, id: reel.id, known: true, needVideo: !reel.video && !reel.decision, needThumb: !reel.thumbnail });
      continue;
    }
    const takenAt = num(it.takenAt);
    reel = {
      id: newId(),
      code,
      url: reelUrl(code),
      author: String(it.username ?? "").replace(/^@/, "").slice(0, 80),
      authorName: String(it.fullName ?? "").slice(0, 120),
      caption: String(it.caption ?? "").slice(0, 4000),
      likes: num(it.likes),
      comments: num(it.comments),
      plays: num(it.plays),
      durationSec: num(it.durationSec),
      takenAt: takenAt ? new Date(takenAt * 1000).toISOString() : "",
      video: "",
      thumbnail: "",
      decision: "",
      capturedAt: now,
      createdAt: now,
    };
    db.reels.unshift(reel);
    byCode.set(code, reel);
    changed = true;
    out.push({ code, id: reel.id, known: false, needVideo: true, needThumb: true });
  }
  if (changed) writeDB(db);
  return out;
}

/** Ecrit le fichier recu (video ou vignette) et le rattache au Reel. */
export function storeReelMedia(id: string, kind: "video" | "thumb", data: Buffer): Reel {
  const db = readDB();
  const reel = db.reels.find((r) => r.id === id);
  if (!reel) throw new Error("Reel introuvable.");
  if (kind === "video") {
    if (data.length > MAX_VIDEO_BYTES) throw new Error("Vidéo trop lourde.");
    const tag = data.subarray(4, 8).toString("latin1");
    if (!["ftyp", "moov", "mdat", "free", "wide", "skip"].includes(tag)) throw new Error("Ce n'est pas un fichier MP4.");
  } else {
    if (data.length > MAX_THUMB_BYTES) throw new Error("Vignette trop lourde.");
    const hex = data.subarray(0, 4).toString("hex");
    if (!hex.startsWith("ffd8ff") && hex !== "89504e47" && data.subarray(0, 4).toString("latin1") !== "RIFF") throw new Error("Ce n'est pas une image.");
  }
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  const name = kind === "video" ? reelVideoName(reel.code) : reelThumbName(reel.code);
  fs.writeFileSync(path.join(MEDIA_DIR, name), data);
  if (kind === "video") {
    reel.video = `/api/media/${name}`;
    reel.videoBytes = data.length;
  } else {
    reel.thumbnail = `/api/media/${name}`;
    // Le swipe cree avant l'arrivee de la vignette la recupere.
    const swipe = reel.swipeId ? db.swipes.find((s) => s.id === reel.swipeId) : null;
    if (swipe && !swipe.thumbnail) swipe.thumbnail = reel.thumbnail;
  }
  writeDB(db);
  return reel;
}

/* ------------------------------- Decision ----------------------------- */

const canon = (u: string) => u.trim().replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();

/**
 * Droite (« keep ») : le Reel entre dans la Swipe file (un swipe « a
 * analyser », statut de production « Swipe file »), sans doublon si son
 * adresse y est deja. Gauche (« skip ») : passe. "" : on annule le choix ;
 * un swipe cree par ce choix et jamais travaille est retire.
 */
export function decideReel(id: string, decision: Reel["decision"], opts: { stage?: SwipeStage | ""; note?: string } = {}): { reel: Reel; swipe: Swipe | null } {
  const db = readDB();
  const reel = db.reels.find((r) => r.id === id);
  if (!reel) throw new Error("Reel introuvable.");
  const now = new Date().toISOString();

  if (decision === "keep") {
    let swipe = db.swipes.find((s) => canon(s.url) === canon(reel.url)) ?? null;
    let created = false;
    if (!swipe) {
      swipe = {
        id: newId(),
        url: reel.url,
        platform: "instagram",
        author: reel.author ? `@${reel.author}` : "",
        title: reel.authorName || (reel.author ? `@${reel.author}` : "Reel Instagram"),
        caption: reel.caption,
        thumbnail: reel.thumbnail,
        transcriptInput: "",
        screenTextInput: "",
        tags: "reel-tinder",
        analysis: null,
        status: "a-analyser",
        etapeManuelle: "",
        prodStatus: "source",
        prodDates: { source: now },
        transcriptSource: "",
        transcriptNeeded: false,
        notes: "",
        createdAt: now,
      };
      db.swipes.unshift(swipe);
      created = true;
    }
    if (opts.stage !== undefined) swipe.etapeManuelle = opts.stage && SWIPE_STAGES.includes(opts.stage) ? opts.stage : "";
    if (opts.note !== undefined) swipe.notes = String(opts.note).slice(0, 4000);
    reel.decision = "keep";
    reel.decidedAt = now;
    reel.swipeId = swipe.id;
    reel.swipeCreated = created || reel.swipeCreated;
    writeDB(db);
    return { reel, swipe };
  }

  if (decision === "skip") {
    reel.decision = "skip";
    reel.decidedAt = now;
    writeDB(db);
    return { reel, swipe: null };
  }

  // Annulation.
  if (reel.decision === "keep" && reel.swipeId && reel.swipeCreated) {
    const i = db.swipes.findIndex((s) => s.id === reel.swipeId);
    const s = i >= 0 ? db.swipes[i] : null;
    if (s && (s.prodStatus ?? "source") === "source" && !s.script && !s.analysis) db.swipes.splice(i, 1);
  }
  reel.decision = "";
  delete reel.decidedAt;
  delete reel.swipeId;
  delete reel.swipeCreated;
  writeDB(db);
  return { reel, swipe: null };
}

/** Remet dans la file les Reels passes dans les dernieres 24 h (un ← de trop, ca arrive). */
export function requeueRecentSkips(): number {
  const db = readDB();
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  let n = 0;
  for (const r of db.reels) {
    if (r.decision !== "skip" || !r.decidedAt || Date.parse(r.decidedAt) <= dayAgo) continue;
    r.decision = "";
    delete r.decidedAt;
    n++;
  }
  if (n) writeDB(db);
  return n;
}

/** Classement / note d'un Reel garde : ecrits sur son swipe. */
export function annotateReel(id: string, patch: { stage?: SwipeStage | ""; note?: string }): { reel: Reel; swipe: Swipe | null } {
  const db = readDB();
  const reel = db.reels.find((r) => r.id === id);
  if (!reel) throw new Error("Reel introuvable.");
  const swipe = reel.swipeId ? (db.swipes.find((s) => s.id === reel.swipeId) ?? null) : null;
  if (!swipe) throw new Error("Ce Reel n'est pas dans la Swipe file.");
  if (patch.stage !== undefined) swipe.etapeManuelle = patch.stage && SWIPE_STAGES.includes(patch.stage) ? patch.stage : "";
  if (patch.note !== undefined) swipe.notes = String(patch.note).slice(0, 4000);
  writeDB(db);
  return { reel, swipe };
}

/* -------------------------------- Menage ------------------------------ */

function unlinkQuiet(local: string) {
  const name = local.replace(/^\/api\/media\//, "");
  if (!name) return;
  try {
    fs.unlinkSync(path.join(MEDIA_DIR, name));
  } catch {
    // deja parti
  }
}

/**
 * Fait de la place : videos des Reels passes depuis plus de 2 jours, Reels
 * passes depuis 30 jours, Reels jamais juges depuis 3 semaines. Les Reels
 * gardes ne sont jamais touches (leur video sert a la Swipe file).
 */
export function cleanup(db: DB) {
  const now = Date.now();
  const keep: Reel[] = [];
  for (const r of db.reels) {
    const decidedAge = r.decidedAt ? now - Date.parse(r.decidedAt) : 0;
    const capturedAge = now - Date.parse(r.capturedAt || r.createdAt);
    if (r.decision === "keep") {
      keep.push(r);
      continue;
    }
    const dead = (r.decision === "skip" && decidedAge > SKIPPED_ROW_TTL_MS) || (!r.decision && capturedAge > QUEUE_TTL_MS);
    if (dead) {
      if (r.video) unlinkQuiet(r.video);
      if (r.thumbnail) unlinkQuiet(r.thumbnail);
      continue;
    }
    if (r.decision === "skip" && r.video && decidedAge > SKIPPED_VIDEO_TTL_MS) {
      unlinkQuiet(r.video);
      r.video = "";
      r.videoBytes = 0;
    }
    keep.push(r);
  }
  db.reels = keep;
}

/* -------------------------------- Lecture ----------------------------- */

export interface ReelStats {
  queue: number;
  kept: number;
  skipped: number;
  keptToday: number;
  /** Passes dans les dernieres 24 h : on peut les remettre dans la file (leur video est encore la). */
  skippedRecent: number;
  lastCaptureAt: string;
  /** Octets occupes par les videos encore sur le disque. */
  bytes: number;
}

export function reelStats(db: DB): ReelStats {
  const today = new Date().toISOString().slice(0, 10);
  let queue = 0;
  let kept = 0;
  let skipped = 0;
  let keptToday = 0;
  let skippedRecent = 0;
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  let bytes = 0;
  let last = "";
  for (const r of db.reels) {
    if (!r.decision) queue++;
    else if (r.decision === "keep") {
      kept++;
      if ((r.decidedAt ?? "").slice(0, 10) === today) keptToday++;
    } else {
      skipped++;
      if (r.decidedAt && Date.parse(r.decidedAt) > dayAgo) skippedRecent++;
    }
    if (r.video) bytes += r.videoBytes ?? 0;
    if (r.capturedAt > last) last = r.capturedAt;
  }
  return { queue, kept, skipped, keptToday, skippedRecent, lastCaptureAt: last, bytes };
}

/** La file a juger : les plus recents d'abord (le feed du jour). */
export function reelQueue(db: DB, limit = 150): Reel[] {
  return db.reels.filter((r) => !r.decision).sort((a, b) => b.capturedAt.localeCompare(a.capturedAt)).slice(0, limit);
}

export interface KeptReel {
  reel: Reel;
  swipe: Pick<Swipe, "id" | "prodStatus" | "etapeManuelle" | "notes" | "shootAt" | "publishAt" | "publishedUrl"> & { hasScript: boolean; hasAnalysis: boolean; stageAuto: SwipeStage | "" } | null;
}

export function keptReels(db: DB): KeptReel[] {
  const swipes = new Map(db.swipes.map((s) => [s.id, s]));
  return db.reels
    .filter((r) => r.decision === "keep")
    .sort((a, b) => (b.decidedAt ?? "").localeCompare(a.decidedAt ?? ""))
    .map((reel) => {
      const s = reel.swipeId ? swipes.get(reel.swipeId) : undefined;
      return {
        reel,
        swipe: s
          ? { id: s.id, prodStatus: s.prodStatus, etapeManuelle: s.etapeManuelle, notes: s.notes, shootAt: s.shootAt, publishAt: s.publishAt, publishedUrl: s.publishedUrl, hasScript: Boolean(s.script?.hook), hasAnalysis: Boolean(s.analysis), stageAuto: s.analysis?.etape ?? "" }
          : null,
      };
    });
}
