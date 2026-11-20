import fs from "fs/promises";
import { newId, readDB, withKieKey, writeDB } from "@/lib/db";
import { keyForOwner } from "@/lib/studio-tenant";
import { AUTO_PRIORITY, MAX_CONCURRENT_GENERATIONS, MAX_VARIANTS, PROVIDER_IDS, PROVIDERS, STALE_STEP_MS } from "./config";
import { providerRejects } from "./select-provider";
import type { ProviderId } from "./types";
import { quote } from "./costs";
import { warmThumb } from "@/lib/thumbs";
import { downloadToMedia, ensureLocal, extractAudioMp3, interpolateFps, isAllowedRemote, localMediaPath, MediaError, muxAudio, probe, retimeVideo, storeBuffer, stripAudio, videoFps } from "./media";
import { lipSyncVideo, LipSyncError } from "./providers/lipsync";
import { buildPrompt, DEFAULT_NEGATIVE_PROMPT } from "./prompts";
import {
  ACTIVE_STATUSES,
  type FpsChoice,
  type StudioJob,
  type UpscaleChoice,
  type StudioJobStatus,
  type TransformRequest,
} from "./types";
import { pollTransformation, readableProviderError, startTransformation, TransformError } from "./video-transform";
import { pollTalkingPhoto, startTalkingPhoto, TalkError } from "./talking-photo";
import { CreationError, pollCreation, startCreation } from "./creation";
import { transformVoice, VoiceError } from "./voice-transform";
import { upscaleTo1080p } from "./upscale";

/**
 * File de jobs du Swap vidéo.
 *
 * Il n'y a pas de worker séparé : comme pour les générations classiques, c'est
 * le sondage du navigateur (GET /api/studio/jobs) qui fait avancer la file, en
 * plus d'un coup de pouce à la création. Les étapes longues (upload, voix,
 * assemblage) tournent en tâche de fond dans le processus Node, protégées par
 * un verrou mémoire pour ne jamais s'exécuter deux fois.
 */

const g = globalThis as unknown as { __studioLocks?: Set<string> };
const locks = (g.__studioLocks ??= new Set<string>());

const now = () => new Date().toISOString();
const TRANSFORMS = new Set(["full", "face", "outfit", "face-outfit", "character"]);
const STYLES = new Set(["natural", "strong", "ugc", "cinematic"]);
const VOICE_MODES = new Set(["keep", "transform", "none"]);
const RESOLUTIONS = new Set(["720p", "1080p"]);
const ASPECTS = new Set(["original", "9:16", "16:9", "1:1"]);
const AMBIENCES = new Set(["raw", "close", "room", "far"]);
const FPS_CHOICES = new Set<FpsChoice>(["", "source", "30", "60"]);
const PROVIDER_IDS_WITH_PRODUCT = new Set(PROVIDER_IDS.filter((id) => PROVIDERS[id].supportsProduct));

export class JobError extends Error {
  code: number;
  constructor(message: string, code = 400) {
    super(message);
    this.code = code;
  }
}

/* ------------------------------ Persistance ------------------------------ */

export function listJobs(): StudioJob[] {
  return readDB().studioJobs;
}

/** Les jobs d'un propriétaire : l'élève ne voit que les siens, l'admin et le monteur ceux du compte (sans propriétaire). */
export function listJobsFor(ownerId: string): StudioJob[] {
  return listJobs().filter((j) => (j.ownerId ?? "") === ownerId);
}

/** Le job appartient-il à ce périmètre ? */
export const ownsJob = (job: StudioJob, ownerId: string) => (job.ownerId ?? "") === ownerId;

export function getJob(id: string): StudioJob | null {
  return readDB().studioJobs.find((j) => j.id === id) ?? null;
}

/** Fusionne un correctif dans la version fraîche du job (la base a pu bouger). */
async function patchJob(id: string, patch: Partial<StudioJob>): Promise<StudioJob | null> {
  const db = readDB();
  const i = db.studioJobs.findIndex((j) => j.id === id);
  if (i === -1) return null;
  db.studioJobs[i] = { ...db.studioJobs[i], ...patch, updatedAt: now() };
  writeDB(db);
  return db.studioJobs[i];
}

export function deleteJob(id: string, ownerId?: string) {
  const db = readDB();
  const before = db.studioJobs.length;
  db.studioJobs = db.studioJobs.filter((j) => j.id !== id || (ownerId !== undefined && !ownsJob(j, ownerId)));
  if (db.studioJobs.length !== before) writeDB(db);
  return before !== db.studioJobs.length;
}

/* ------------------------------ Création ------------------------------ */

function validSource(url: string) {
  return Boolean(localMediaPath(url)) || isAllowedRemote(url);
}

/**
 * `ownerId` : l'élève pour qui le job tourne (Studio IA par élève). Ses jobs
 * s'exécutent avec SA clé KIE et ne sont visibles que de lui. Ce qui passe
 * par les clés du compte (voix ElevenLabs / OpenAI, Genjutsu chez Higgsfield)
 * lui est fermé : la voix d'origine est gardée, Genjutsu refusé.
 */
export function createJobs(req: TransformRequest, ownerId = ""): StudioJob[] {
  if (!req.sourceVideo || !validSource(req.sourceVideo)) throw new JobError("Vidéo source manquante ou invalide.");
  if (!req.referenceImage || !validSource(req.referenceImage)) throw new JobError("Image de référence manquante ou invalide.");
  if (req.provider !== "auto" && !PROVIDER_IDS.includes(req.provider)) throw new JobError("Modèle inconnu.");
  if (ownerId && req.provider === "genjutsu") throw new JobError("Ce modèle n'est pas disponible dans ton Studio : choisis Auto ou un autre modèle.");
  if (!TRANSFORMS.has(req.transform)) throw new JobError("Type de transformation inconnu.");
  if (!STYLES.has(req.style)) throw new JobError("Style inconnu.");
  if (!VOICE_MODES.has(req.voiceMode)) throw new JobError("Mode audio inconnu.");
  if (ownerId && req.voiceMode === "transform") req = { ...req, voiceMode: "keep", voiceId: "", voiceName: "" };
  if (req.voiceMode === "transform" && !req.voiceId?.trim()) throw new JobError("Choisis une voix ElevenLabs.");
  if (!RESOLUTIONS.has(req.resolution)) throw new JobError("Résolution inconnue.");
  if (!ASPECTS.has(req.aspectRatio)) throw new JobError("Format inconnu.");
  const variants = Math.min(MAX_VARIANTS, Math.max(1, Math.round(Number(req.variants) || 1)));

  const referenceImages = [req.referenceImage, ...(Array.isArray(req.referenceImages) ? req.referenceImages : [])]
    .filter((u, k, arr) => u && validSource(u) && arr.indexOf(u) === k)
    .slice(0, 3);
  const productImages = (Array.isArray(req.productImages) ? req.productImages : []).filter(validSource).slice(0, 4);
  const productDescription = (req.productDescription ?? "").trim();
  if (productImages.length && req.provider !== "auto" && !PROVIDER_IDS_WITH_PRODUCT.has(req.provider)) {
    throw new JobError("Ce modèle ne sait pas protéger le produit. Choisis Auto ou Kling 3.0 Omni, ou retire les photos du produit.");
  }

  const prompt = buildPrompt(req.transform, req.style, req.userPrompt ?? "", productImages.length ? { description: productDescription } : null);
  let negativePrompt = (req.negativePrompt ?? "").trim() || DEFAULT_NEGATIVE_PROMPT;
  // Interdire « changing clothes » contredit tout preset qui change la tenue : on retire la clause.
  if (req.transform !== "face") {
    negativePrompt = negativePrompt
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && !/changing clothes|clothes change|different clothes/i.test(s))
      .join(", ");
  }
  const hint = Number(req.sourceDurationSec) || 0;
  const q = quote({ provider: req.provider, transform: req.transform, durationSec: hint || 5, resolution: req.resolution, variants: 1, hasProduct: productImages.length > 0 });

  const batchId = newId();
  const db = readDB();
  const created: StudioJob[] = [];
  for (let i = 0; i < variants; i++) {
    const t = now();
    const job: StudioJob = {
      id: newId(),
      ...(ownerId ? { ownerId } : {}),
      type: "video-transform",
      batchId,
      fps: FPS_CHOICES.has(req.fps ?? "") ? req.fps ?? "" : "",
      upscale: req.upscale === "1080p" ? "1080p" : "",
      provider: q.provider,
      requestedProvider: req.provider,
      transform: req.transform,
      style: req.style,
      sourceVideo: req.sourceVideo,
      sourceVideoName: req.sourceVideoName ?? "",
      sourceDurationSec: hint,
      referenceImage: req.referenceImage,
      referenceImageName: req.referenceImageName ?? "",
      referenceImages,
      remoteReferenceUrls: [],
      referenceSheet: "",
      sceneImage: req.sceneImage && validSource(req.sceneImage) ? req.sceneImage : "",
      remoteSceneImageUrl: "",
      userPrompt: req.userPrompt ?? "",
      prompt,
      negativePrompt,
      voiceMode: req.voiceMode,
      voiceId: req.voiceMode === "transform" ? req.voiceId.trim() : "",
      voiceName: req.voiceMode === "transform" ? req.voiceName ?? "" : "",
      voiceEngine: "",
      voiceAmbience: AMBIENCES.has(req.voiceAmbience ?? "") ? (req.voiceAmbience as StudioJob["voiceAmbience"]) : "room",
      lipSync: Boolean(req.lipSync) && req.voiceMode !== "none",
      lipSyncError: "",
      productImages,
      productDescription,
      remoteProductUrls: [],
      resolution: req.resolution,
      aspectRatio: req.aspectRatio,
      status: "queued",
      progress: 0,
      providerJobId: "",
      providerInput: {},
      remoteSourceUrl: "",
      remoteReferenceUrl: "",
      remoteVideoUrl: "",
      videoOutput: "",
      audioOutput: "",
      finalOutput: "",
      error: "",
      voiceError: "",
      creditsEstimated: q.creditsPerVideo,
      creditsConsumed: 0,
      createdAt: t,
      updatedAt: t,
      startedAt: "",
      completedAt: "",
    };
    db.studioJobs.unshift(job);
    created.push(job);
  }
  writeDB(db);
  return created;
}

/* ------------------------------ Étapes ------------------------------ */

function fail(id: string, error: string, extra: Partial<StudioJob> = {}) {
  return patchJob(id, { status: "failed", error, completedAt: now(), ...extra });
}

/**
 * Exécute une étape avec la clé KIE du propriétaire du job : celle de l'élève
 * (ses crédits) quand le job lui appartient, celle du compte sinon. Toutes
 * les étapes (envoi des fichiers, génération, sondage, synchro labiale)
 * passent par `getApiKey()`, donc par ce contexte.
 */
async function withJobKey<T>(job: StudioJob, fn: () => Promise<T>): Promise<T | undefined> {
  if (!job.ownerId) return fn();
  const key = keyForOwner(readDB(), job.ownerId);
  if (!key) {
    await fail(job.id, "Ta clé KIE est introuvable : ajoute-la dans Scale X → Studio IA → Ma clé, puis réessaie.");
    return undefined;
  }
  return withKieKey(key, fn);
}

async function runStart(job: StudioJob) {
  await withJobKey(job, () => runStartInner(job));
}

async function runStartInner(job: StudioJob) {
  if (locks.has(job.id)) return;
  locks.add(job.id);
  try {
    await patchJob(job.id, { status: "uploading", startedAt: job.startedAt || now(), error: "" });
    const fresh = getJob(job.id);
    if (!fresh) return;
    if (fresh.type === "talking-photo") {
      const out = await startTalkingPhoto(fresh, async (p) => { await patchJob(job.id, p); });
      await patchJob(job.id, { ...out, status: "generating_video", progress: 0 });
      return;
    }
    if (fresh.type === "creation") {
      const out = await startCreation(fresh, async (p) => { await patchJob(job.id, p); });
      await patchJob(job.id, { ...out, status: "generating_video", progress: 0 });
      return;
    }
    const out = await startTransformation(fresh, async (p) => { await patchJob(job.id, p); });
    await patchJob(job.id, { ...out, status: "generating_video", progress: 0 });
  } catch (e) {
    const err = e as Error & { code?: number };
    const msg =
      err instanceof TransformError || err instanceof MediaError || err instanceof TalkError || err instanceof CreationError ? err.message
      : readableProviderError(getJob(job.id)?.provider ?? job.provider, err.message);
    await fail(job.id, msg);
  } finally {
    locks.delete(job.id);
  }
}

/**
 * Après la vidéo : rapatriement, voix, assemblage.
 *
 * Une voix qui échoue ne fait pas échouer le job : la vidéo est livrée avec
 * son audio d'origine et `voiceError` explique ce qui s'est passé, avec un
 * bouton « Réessayer la voix » côté interface.
 */
async function runFinish(job: StudioJob) {
  await withJobKey(job, () => runFinishInner(job));
}

async function runFinishInner(job: StudioJob) {
  if (locks.has(job.id)) return;
  locks.add(job.id);
  try {
    let current = getJob(job.id);
    if (!current) return;

    if (!current.videoOutput) {
      // L'URL vient de l'API du fournisseur : hors liste KIE pour Higgsfield.
      const dl = await downloadToMedia(current.remoteVideoUrl, { trusted: true });
      current = (await patchJob(job.id, { videoOutput: dl.url })) ?? current;
    }

    // Photo qui parle et Création : la video rendue contient deja la voix, rien a assembler.
    if (current.type === "talking-photo" || current.type === "creation") {
      const delivered = await deliverFinished(current, current.videoOutput);
      await patchJob(job.id, { status: "completed", progress: 100, completedAt: now(), error: "", ...delivered });
      warmThumb(delivered.finalOutput);
      return;
    }
    let videoPath = localMediaPath(current.videoOutput);
    if (!videoPath) throw new MediaError("Vidéo générée introuvable sur le serveur.");

    /*
     * Recalage temporel : la video generee doit durer exactement comme la
     * source, sinon la voix (d'origine ou transformee, toutes deux calees sur
     * la source) derive par rapport aux levres.
     */
    if (current.voiceMode !== "none" && current.sourceDurationSec > 0 && !current.retimed) {
      const gen = await probe(videoPath);
      const ratio = current.sourceDurationSec / (gen.durationSec || current.sourceDurationSec);
      if (Math.abs(gen.durationSec - current.sourceDurationSec) > 0.06 && ratio > 0.7 && ratio < 1.4) {
        const fixed = await retimeVideo(videoPath, current.sourceDurationSec);
        current = (await patchJob(job.id, { videoOutput: fixed.url, retimed: true })) ?? current;
        videoPath = fixed.path;
      } else {
        current = (await patchJob(job.id, { retimed: true })) ?? current;
      }
    }

    let audioPath: string | null = null;
    if (current.voiceMode === "transform") {
      current = (await patchJob(job.id, { status: "processing_voice", voiceError: "" })) ?? current;
      try {
        const v = await transformVoice(current);
        audioPath = v.audioPath;
        current = (await patchJob(job.id, { audioOutput: v.audioOutput, voiceEngine: v.engine })) ?? current;
      } catch (e) {
        const msg = e instanceof VoiceError || e instanceof MediaError ? e.message : `Impossible de transformer la voix : ${(e as Error).message}`;
        current = (await patchJob(job.id, { voiceError: msg, audioOutput: "" })) ?? current;
      }
    }

    current = (await patchJob(job.id, { status: "merging" })) ?? current;
    let finalOutput = current.videoOutput;
    let finalPath = videoPath;
    let muxedAudioPath: string | null = audioPath;
    if (current.voiceMode === "none") {
      const muted = await stripAudio(videoPath);
      finalOutput = muted.url;
      finalPath = muted.path;
    } else {
      if (!muxedAudioPath) {
        // Voix conservée (ou transformation ratée) : on repose l'audio d'origine,
        // exactement synchrone puisque le mouvement est celui de la source.
        const src = await ensureLocal(current.sourceVideo);
        const info = await probe(src.path);
        if (info.hasAudio) {
          const original = await storeBuffer(await extractAudioMp3(src.path), ".mp3");
          muxedAudioPath = original.path;
        }
      }
      if (muxedAudioPath) {
        const muxed = await muxAudio(videoPath, muxedAudioPath);
        finalOutput = muxed.url;
        finalPath = muxed.path;
      }
    }

    /*
     * Synchro labiale IA, en option : la video finale et sa piste repartent
     * chez KIE, qui refait la bouche sur la voix. Un echec garde la video.
     */
    const mouthKept = Boolean((PROVIDERS as Record<string, { preservesMouth?: boolean } | undefined>)[current.provider]?.preservesMouth);
    if (current.lipSync && current.voiceMode !== "none" && muxedAudioPath && !mouthKept) {
      current = (await patchJob(job.id, { status: "syncing_lips", lipSyncError: "", finalOutput })) ?? current;
      try {
        const synced = await lipSyncVideo(finalPath, muxedAudioPath);
        // La piste traitee (ambiance, niveau) prime sur celle renvoyee par le modele.
        const remuxed = await muxAudio(synced.path, muxedAudioPath);
        finalOutput = remuxed.url;
        if (synced.creditsConsumed) {
          current = (await patchJob(job.id, { creditsConsumed: (current.creditsConsumed || 0) + synced.creditsConsumed })) ?? current;
        }
      } catch (e) {
        const err = e as LipSyncError | MediaError;
        await patchJob(job.id, { lipSyncError: err.message });
      }
    }

    // En dernier : la synchro labiale rend en 720p / 25 i/s, la finition (1080p, 60 i/s) passe après elle.
    const delivered = await deliverFinished(current, finalOutput);
    await patchJob(job.id, { status: "completed", progress: 100, completedAt: now(), error: "", ...delivered });
    warmThumb(delivered.finalOutput);
  } catch (e) {
    const err = e as Error;
    await fail(job.id, err instanceof MediaError ? err.message : `Assemblage impossible : ${err.message}`);
  } finally {
    locks.delete(job.id);
  }
}

/* ------------------------------ Finition ------------------------------ */

/*
 * Finition de la vidéo livrée, dans cet ordre :
 *  1. upscale 1080p chez KIE, si demandé et si la vidéo est en dessous ;
 *  2. interpolation 30 / 60 i/s sur le serveur (ffmpeg, gratuit).
 * On repart toujours de la vidéo d'avant finition (fpsBaseOutput) et le son
 * n'est jamais retouché. Une étape ratée n'empêche ni l'autre ni la livraison.
 */

interface FinishWish {
  fps: number;
  upscale: UpscaleChoice;
}
type FinishPatch = Pick<StudioJob, "finalOutput" | "fpsBaseOutput" | "fpsApplied" | "upscaleApplied" | "fpsError"> & { credits: number };

/** Cadence voulue : 30 ou 60, ou 0 (cadence du modèle). « source » lit la vidéo d'origine. */
async function targetFps(job: StudioJob): Promise<number> {
  if (job.fps === "30") return 30;
  if (job.fps === "60") return 60;
  if (job.fps !== "source" || !job.sourceVideo) return 0;
  const src = await ensureLocal(job.sourceVideo);
  const f = await videoFps(src.path);
  // Un reel à 29,97 ou 30 i/s → 30 ; 50 ou 60 → 60 ; 24 / 25 : comme le modèle, rien à faire.
  return f >= 45 ? 60 : f >= 27 ? 30 : 0;
}

/*
 * Ordre rapide quand il faut les deux : interpolation en 720p (3 fois moins de
 * calcul qu'en 1080p sur les 2 cœurs du serveur), puis upscale KIE, qui garde
 * la cadence et les images. Si KIE refuse l'entrée à 60 i/s, ordre de repli :
 * upscale de la vidéo du modèle, puis interpolation en 1080p (plus lent).
 */
async function applyFinish(baseUrl: string, wish: FinishWish): Promise<FinishPatch> {
  const untouched: FinishPatch = { finalOutput: baseUrl, fpsBaseOutput: "", fpsApplied: 0, upscaleApplied: "", fpsError: "", credits: 0 };
  if (!wish.fps && !wish.upscale) return untouched;
  const basePath = localMediaPath(baseUrl);
  if (!basePath) return { ...untouched, fpsError: "Finition impossible : vidéo introuvable sur le serveur." };

  let credits = 0;
  const errors: string[] = [];
  const drop = (p: string | null) => (p && p !== basePath ? fs.rm(p, { force: true }).catch(() => {}) : Promise.resolve());
  const done = (url: string, fpsApplied: number, upscaleApplied: string): FinishPatch => ({
    finalOutput: url,
    fpsBaseOutput: url !== baseUrl ? baseUrl : "",
    fpsApplied,
    upscaleApplied,
    fpsError: errors.join(" · "),
    credits,
  });

  // Cadence : déjà atteinte ? (ex. source retimée à 30 i/s)
  let needFps = 0;
  let measuredFps = 0;
  if (wish.fps) {
    try {
      measuredFps = await videoFps(basePath);
      needFps = measuredFps >= wish.fps - 0.5 ? 0 : wish.fps;
    } catch (e) {
      errors.push(`cadence illisible : ${(e as Error).message}`);
    }
  }
  const fpsLabel = needFps || (wish.fps ? Math.round(measuredFps) : 0);

  const upscale = async (p: string) => {
    const up = await upscaleTo1080p(p);
    if (up) credits += up.credits;
    return up;
  };
  const interpolate = (p: string) => interpolateFps(p, needFps === 60 ? 60 : 30);

  // Une seule étape.
  if (!needFps) {
    if (wish.upscale !== "1080p") return done(baseUrl, fpsLabel, "");
    try {
      const up = await upscale(basePath);
      return done(up ? up.url : baseUrl, fpsLabel, "1080p");
    } catch (e) {
      errors.push(`1080p impossible : ${(e as Error).message}`);
      return done(baseUrl, fpsLabel, "");
    }
  }
  if (wish.upscale !== "1080p") {
    try {
      const out = await interpolate(basePath);
      return done(out.url, needFps, "");
    } catch (e) {
      errors.push(`${needFps} i/s impossible : ${(e as Error).message}`);
      return done(baseUrl, 0, "");
    }
  }

  // Les deux : 720p interpolé d'abord, puis upscale.
  let smooth: { url: string; path: string } | null = null;
  try {
    smooth = await interpolate(basePath);
  } catch (e) {
    errors.push(`${needFps} i/s impossible : ${(e as Error).message}`);
  }
  if (smooth) {
    try {
      const up = await upscale(smooth.path);
      if (up) await drop(smooth.path);
      return done(up ? up.url : smooth.url, needFps, "1080p");
    } catch (fast) {
      // Repli : upscale de la vidéo du modèle (24-30 i/s), puis interpolation en 1080p.
      try {
        const up = await upscale(basePath);
        if (!up) return done(smooth.url, needFps, "1080p");
        try {
          const out = await interpolate(up.path);
          await drop(up.path);
          await drop(smooth.path);
          return done(out.url, needFps, "1080p");
        } catch (e) {
          errors.push(`${needFps} i/s en 1080p impossible : ${(e as Error).message}`);
          await drop(smooth.path);
          return done(up.url, 0, "1080p");
        }
      } catch (e) {
        errors.push(`1080p impossible : ${(e as Error).message || (fast as Error).message}`);
        return done(smooth.url, needFps, "");
      }
    }
  }
  // Interpolation ratée : au moins le 1080p.
  try {
    const up = await upscale(basePath);
    return done(up ? up.url : baseUrl, 0, "1080p");
  } catch (e) {
    errors.push(`1080p impossible : ${(e as Error).message}`);
    return done(baseUrl, 0, "");
  }
}

/** La vidéo livrée d'un job qui se termine, finie comme demandé (crédits de l'upscale ajoutés). */
async function deliverFinished(job: StudioJob, baseUrl: string) {
  let fps = 0;
  let readError = "";
  try {
    fps = await targetFps(job);
  } catch (e) {
    readError = `Cadence de la vidéo d'origine illisible : ${(e as Error).message}`;
  }
  const { credits, ...patch } = await applyFinish(baseUrl, { fps, upscale: job.upscale === "1080p" ? "1080p" : "" });
  if (readError) patch.fpsError = [readError, patch.fpsError].filter(Boolean).join(" · ");
  return { ...patch, creditsConsumed: (getJob(job.id)?.creditsConsumed ?? job.creditsConsumed ?? 0) + credits };
}

const gf = globalThis as unknown as { __studioFps?: Set<string> };
const fpsRunning = (gf.__studioFps ??= new Set<string>());

/** Clé KIE d'un job : celle de l'élève pour un job d'élève, celle du compte sinon (null : introuvable). */
function ownerKey(job: StudioJob): string | null | undefined {
  if (!job.ownerId) return undefined;
  return keyForOwner(readDB(), job.ownerId) || null;
}

async function runFinishAfter(job: StudioJob) {
  if (fpsRunning.has(job.id)) return;
  fpsRunning.add(job.id);
  try {
    const wish: FinishWish = { fps: job.fpsPending ?? 0, upscale: job.upscalePending === "1080p" ? "1080p" : "" };
    const base = job.fpsBaseOutput || job.finalOutput;
    const key = ownerKey(job);
    const run = () => applyFinish(base, wish);
    let result: FinishPatch;
    if (key === null && wish.upscale) {
      result = { ...(await applyFinish(base, { ...wish, upscale: "" })), fpsError: "1080p impossible : ta clé KIE est introuvable." };
    } else {
      result = key ? await withKieKey(key, run) : await run();
    }
    const { credits, ...patch } = result;
    await patchJob(job.id, { ...patch, fpsPending: undefined, upscalePending: undefined, creditsConsumed: (getJob(job.id)?.creditsConsumed ?? 0) + credits });
    warmThumb(patch.finalOutput);
  } finally {
    fpsRunning.delete(job.id);
  }
}

/**
 * Finition d'une vidéo déjà livrée : 1080p et / ou 30 / 60 i/s, ou retour à
 * la vidéo d'origine (tout à zéro). On repart toujours de la vidéo d'avant
 * finition. La carte reste « terminée » et lisible pendant le calcul.
 */
export async function setJobFinish(id: string, wish: FinishWish, ownerId?: string): Promise<StudioJob> {
  const job = getJob(id);
  if (!job || (ownerId !== undefined && !ownsJob(job, ownerId))) throw new JobError("Job introuvable.", 404);
  if (![0, 30, 60].includes(wish.fps)) throw new JobError("Cadence inconnue : 30 ou 60 images par seconde.");
  if (job.status !== "completed" || !job.finalOutput) throw new JobError("La vidéo n'est pas encore prête.");
  if (fpsRunning.has(id) || locks.has(id)) throw new JobError("Cette vidéo est déjà en cours de traitement.", 409);
  if (wish.upscale && ownerKey(job) === null) throw new JobError("Ta clé KIE est introuvable : ajoute-la avant de passer en 1080p.");
  const updated = await patchJob(id, {
    fpsPending: wish.fps,
    upscalePending: wish.upscale,
    fpsError: "",
    fps: wish.fps ? (String(wish.fps) as FpsChoice) : "",
    upscale: wish.upscale,
  });
  if (updated) void runFinishAfter(updated);
  return updated as StudioJob;
}

async function pollOne(job: StudioJob) {
  await withJobKey(job, () => pollOneInner(job));
}

async function pollOneInner(job: StudioJob) {
  if (!job.providerJobId) return;
  let r;
  try {
    r = job.type === "talking-photo" ? await pollTalkingPhoto(job) : job.type === "creation" ? await pollCreation(job) : await pollTransformation(job);
  } catch {
    // Un sondage qui rate ne change rien : on réessaiera au prochain tour.
    return;
  }
  if (r.state === "success" && r.resultUrl) {
    const updated = await patchJob(job.id, {
      remoteVideoUrl: r.resultUrl,
      creditsConsumed: r.creditsConsumed || job.creditsConsumed,
      progress: 100,
      status: job.type !== "video-transform" ? "merging" : job.voiceMode === "transform" ? "processing_voice" : "merging",
    });
    if (updated) void runFinish(updated);
  } else if (r.state === "fail") {
    if (await fallbackAfterFailure(job, r.error)) return;
    await fail(job.id, readableProviderError(job.provider, r.error), { creditsConsumed: r.creditsConsumed || job.creditsConsumed });
  } else if (r.progress !== job.progress) {
    await patchJob(job.id, { progress: r.progress });
  }
}

/**
 * Repli automatique.
 *
 * Quand un modele echoue sans raison (« Generation failed » chez Higgsfield,
 * vu deux fois de suite sur la meme video le 2026-10-05 alors que les entrees
 * etaient bonnes), on ne laisse pas une carte rouge : le job repart sur le
 * modele suivant de la liste Auto qui accepte la video. Une seule fois, et
 * jamais sur un refus explicite (moderation, duree, format), qui se
 * reproduirait ailleurs.
 */
const GENERIC_FAILURE = /^(generation failed|failed|internal error|unknown error)\.?$/i;
/*
 * Le filtre de securite de Higgsfield bloque le RESULTAT (pas les fichiers) :
 * un personnage en debardeur suffit. Les modeles KIE ont un autre filtre, le
 * meme rendu passe souvent chez eux. On replie donc aussi dans ce cas.
 */
const MODERATION = /content safety|modération|moderation|nsfw|safety check/i;

async function fallbackAfterFailure(job: StudioJob, rawError: string): Promise<boolean> {
  if (job.type !== "video-transform" || job.fallbackFrom) return false;
  const raw = (rawError || "").trim();
  const generic = GENERIC_FAILURE.test(raw);
  const moderated = MODERATION.test(raw);
  if (!generic && !moderated) return false;
  if (!(job.provider in PROVIDERS)) return false;
  const from = job.provider as ProviderId;
  const hasProduct = (job.productImages ?? []).length > 0;
  const input = { transform: job.transform, durationSec: job.sourceDurationSec || undefined, hasProduct };
  const order = AUTO_PRIORITY[job.transform] ?? AUTO_PRIORITY.full;
  const next = order.find((id) => id !== from && (!hasProduct || PROVIDERS[id].supportsProduct) && !providerRejects(id, input));
  if (!next) return false;
  await patchJob(job.id, {
    status: "queued",
    provider: next,
    fallbackFrom: from,
    fallbackNote: moderated
      ? `${PROVIDERS[from].label} a refusé le résultat (modération) : relancé automatiquement sur ${PROVIDERS[next].label}.`
      : `${PROVIDERS[from].label} a échoué sans raison : relancé automatiquement sur ${PROVIDERS[next].label}.`,
    progress: 0,
    retimed: false,
    remoteSourceUrl: "",
    remoteProductUrls: [],
    remoteReferenceUrls: [],
    remoteSceneUrl: "",
    remoteSceneImageUrl: "",
    providerJobId: "",
    providerInput: {},
    remoteVideoUrl: "",
    error: "",
    completedAt: "",
  });
  return true;
}

/* ------------------------------ Boucle ------------------------------ */

const isStale = (j: StudioJob) => Date.now() - new Date(j.updatedAt).getTime() > STALE_STEP_MS;

/**
 * Un tour de file : lance ce qui attend, sonde ce qui tourne, relance ce qui
 * a été interrompu par un redémarrage. Ne bloque jamais sur une étape longue.
 */
export async function tick(): Promise<StudioJob[]> {
  const jobs = listJobs();

  // Conversion de cadence interrompue par un redémarrage : la mémoire est vide, on la relance.
  for (const j of jobs) {
    if (j.status === "completed" && typeof j.fpsPending === "number" && !fpsRunning.has(j.id)) void runFinishAfter(j);
  }

  // Reprise après redémarrage : une étape sans verrou depuis trop longtemps.
  for (const j of jobs) {
    if (locks.has(j.id) || !isStale(j)) continue;
    if (j.status === "uploading" || (j.status === "generating_video" && !j.providerJobId)) {
      void runStart(j);
    } else if ((j.status === "processing_voice" || j.status === "merging") && j.remoteVideoUrl) {
      void runFinish(j);
    }
  }

  const generating = jobs.filter((j) => j.status === "generating_video" && j.providerJobId && !locks.has(j.id));
  await Promise.allSettled(generating.slice(0, 12).map(pollOne));

  const busy = listJobs().filter((j) => j.status === "uploading" || j.status === "generating_video").length;
  const slots = Math.max(0, MAX_CONCURRENT_GENERATIONS - busy);
  const queued = listJobs()
    .filter((j) => j.status === "queued" && !locks.has(j.id))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(0, slots);
  for (const j of queued) void runStart(j);

  return listJobs();
}

/** Appelé par le callback KIE quand une tâche se termine : on sonde tout de suite. */
export async function onProviderCallback(providerJobId: string): Promise<boolean> {
  const job = listJobs().find((j) => j.providerJobId === providerJobId);
  if (!job) return false;
  if (job.status === "generating_video" && !locks.has(job.id)) await pollOne(job);
  return true;
}

/* ------------------------------ Réessayer ------------------------------ */

export async function retryJob(
  id: string,
  scope: "all" | "voice",
  voice?: { voiceId: string; voiceName: string; voiceAmbience?: StudioJob["voiceAmbience"]; lipSync?: boolean; voiceMode?: "keep" | "transform" },
  ownerId?: string,
): Promise<StudioJob> {
  const job = getJob(id);
  if (!job || (ownerId !== undefined && !ownsJob(job, ownerId))) throw new JobError("Job introuvable.", 404);
  if (locks.has(id)) throw new JobError("Ce job est déjà en cours de traitement.", 409);
  // Studio d'un élève : pas de voix transformée (clés ElevenLabs / OpenAI du compte).
  if (job.ownerId && (voice?.voiceId || voice?.voiceMode === "transform" || (scope === "voice" && job.voiceMode === "transform"))) {
    throw new JobError("La voix transformée n'est pas disponible dans ton Studio.");
  }

  if (scope === "voice") {
    if (!job.videoOutput && !job.remoteVideoUrl) throw new JobError("Pas encore de vidéo générée : relance la génération.");
    // Un job muet ou avec la voix d'origine peut recevoir une voix apres coup : la video est deja la.
    if (job.voiceMode !== "transform" && !voice?.voiceId && voice?.voiceMode !== "keep") {
      throw new JobError("Choisis une voix pour l'ajouter à cette vidéo.");
    }
    // On peut changer de voix au passage : la video, elle, ne bouge pas.
    const updated = await patchJob(id, {
      status: "processing_voice",
      voiceError: "",
      audioOutput: "",
      voiceEngine: "",
      error: "",
      completedAt: "",
      ...(voice?.voiceMode === "keep" ? { voiceMode: "keep" as const, voiceId: "", voiceName: "", voiceEngine: "" as const } : {}),
      ...(voice?.voiceId ? { voiceId: voice.voiceId, voiceName: voice.voiceName, voiceMode: "transform" as const } : {}),
      ...(voice?.voiceAmbience && AMBIENCES.has(voice.voiceAmbience) ? { voiceAmbience: voice.voiceAmbience } : {}),
      ...(voice && typeof voice.lipSync === "boolean" ? { lipSync: voice.lipSync } : {}),
      lipSyncError: "",
    });
    if (updated) void runFinish(updated);
    return updated as StudioJob;
  }

  /*
   * La vidéo est déjà générée (et payée) mais le rapatriement ou l'assemblage
   * a raté : on reprend là, sans relancer le fournisseur.
   */
  if (job.remoteVideoUrl && !job.finalOutput) {
    const resumed = await patchJob(id, {
      status: job.voiceMode === "transform" ? "processing_voice" : "merging",
      error: "",
      voiceError: "",
      audioOutput: "",
      completedAt: "",
    });
    if (resumed) void runFinish(resumed);
    return resumed as StudioJob;
  }

  const updated = await patchJob(id, {
    status: "queued",
    progress: 0,
    retimed: false,
    lipSyncError: "",
    // Le fichier public peut ne plus convenir (autre modèle, autre limite) : on le renvoie.
    remoteSourceUrl: "",
    remoteProductUrls: [],
    remoteReferenceUrls: [],
    remoteSceneUrl: "",
    remoteSceneImageUrl: "",
    providerJobId: "",
    providerInput: {},
    remoteVideoUrl: "",
    videoOutput: "",
    audioOutput: "",
    finalOutput: "",
    fpsBaseOutput: "",
    fpsApplied: 0,
    upscaleApplied: "",
    fpsError: "",
    error: "",
    voiceError: "",
    completedAt: "",
  });
  void tick();
  return updated as StudioJob;
}

export function countByStatus(jobs: StudioJob[]) {
  const c = { queued: 0, running: 0, completed: 0, failed: 0 };
  for (const j of jobs) {
    if (j.status === "queued") c.queued++;
    else if (ACTIVE_STATUSES.includes(j.status)) c.running++;
    else if (j.status === "completed") c.completed++;
    else c.failed++;
  }
  return c;
}

export const isActive = (s: StudioJobStatus) => ACTIVE_STATUSES.includes(s);
