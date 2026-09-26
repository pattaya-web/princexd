import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { isAllowedRemote } from "@/lib/studio/media";

/**
 * Vignettes des medias locaux.
 *
 * Une galerie de 40 videos avec `preload="metadata"` ouvrait 40 lectures
 * partielles de mp4 au chargement : avec 300 ms d'aller-retour, la page
 * restait vide plusieurs secondes et les scripts attendaient derriere. On
 * sert a la place une image fixe (480 px de large, JPEG) generee une fois
 * par ffmpeg et gardee sur le disque a cote des medias. Le nom d'un media ne
 * change jamais, la vignette est donc immuable elle aussi.
 *
 * Generation paresseuse a la premiere demande, deux a la fois pour ne pas
 * saturer le serveur quand une galerie entiere s'affiche d'un coup, et une
 * seule generation par fichier meme si dix requetes arrivent ensemble.
 */

const run = promisify(execFile);

export const MEDIA_DIR = path.join(process.cwd(), "data", "media");
const THUMB_DIR = path.join(MEDIA_DIR, ".thumbs");

const VIDEO = new Set([".mp4", ".mov", ".m4v", ".webm", ".avi", ".mkv"]);
const IMAGE = new Set([".png", ".jpg", ".jpeg", ".jfif", ".jpe", ".webp", ".gif"]);

const MAX_PARALLEL = 2;
let running = 0;
const waiting: (() => void)[] = [];
const inflight = new Map<string, Promise<string | null>>();

function acquire(): Promise<void> {
  if (running < MAX_PARALLEL) {
    running++;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiting.push(() => { running++; resolve(); }));
}

function release() {
  running--;
  const next = waiting.shift();
  if (next) next();
}

export function thumbKind(file: string): "video" | "image" | null {
  const ext = path.extname(file).toLowerCase();
  if (VIDEO.has(ext)) return "video";
  if (IMAGE.has(ext)) return "image";
  return null;
}

async function generate(src: string, out: string, kind: "video" | "image"): Promise<boolean> {
  const tmp = `${out}.${process.pid}.${Date.now()}.tmp.jpg`;
  const base = ["-hide_banner", "-loglevel", "error", "-y"];
  const attempts: string[][] =
    kind === "video"
      ? [
          // Une demi-seconde apres le debut : evite l'image noire des fondus d'ouverture.
          [...base, "-ss", "0.5", "-i", src, "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "5", tmp],
          // Clip plus court que 0,5 s : premiere image.
          [...base, "-i", src, "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "5", tmp],
        ]
      : [[...base, "-i", src, "-frames:v", "1", "-vf", "scale='min(480,iw)':-2", "-q:v", "5", tmp]];
  for (const args of attempts) {
    try {
      await run("ffmpeg", args, { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
      if (fs.existsSync(tmp) && fs.statSync(tmp).size > 0) {
        fs.renameSync(tmp, out);
        return true;
      }
    } catch {
      // On tente la variante suivante.
    }
    try { fs.unlinkSync(tmp); } catch { /* deja absent */ }
  }
  return false;
}

/**
 * Chemin de la vignette JPEG d'un media local, generee si besoin.
 * `null` quand le fichier n'est ni image ni video, ou que ffmpeg n'y arrive pas.
 */
export async function ensureThumb(file: string): Promise<string | null> {
  const kind = thumbKind(file);
  if (!kind) return null;
  const src = path.join(MEDIA_DIR, file);
  if (!src.startsWith(MEDIA_DIR) || !fs.existsSync(src)) return null;
  const out = path.join(THUMB_DIR, `${file}.jpg`);
  if (fs.existsSync(out)) return out;

  const pending = inflight.get(file);
  if (pending) return pending;

  const job = (async () => {
    await acquire();
    try {
      if (fs.existsSync(out)) return out;
      fs.mkdirSync(THUMB_DIR, { recursive: true });
      return (await generate(src, out, kind)) ? out : null;
    } finally {
      release();
      inflight.delete(file);
    }
  })();
  inflight.set(file, job);
  return job;
}

/**
 * Vignette d'un media distant (CDN d'un fournisseur, hote de confiance
 * seulement). ffmpeg lit l'URL directement et ne rapatrie que les octets
 * necessaires a la premiere image : un PNG de 3 Mo ou un mp4 de 40 Mo
 * deviennent un JPEG de 30 Ko, garde sur disque sous le hachage de l'URL.
 */
export async function ensureRemoteThumb(url: string): Promise<string | null> {
  if (!isAllowedRemote(url)) return null;
  let pathname = "";
  try { pathname = new URL(url).pathname; } catch { return null; }
  const kind = thumbKind(pathname) ?? "image";
  const key = `remote-${createHash("sha1").update(url).digest("hex")}`;
  const out = path.join(THUMB_DIR, `${key}.jpg`);
  if (fs.existsSync(out)) return out;

  const pending = inflight.get(key);
  if (pending) return pending;

  const job = (async () => {
    await acquire();
    try {
      if (fs.existsSync(out)) return out;
      fs.mkdirSync(THUMB_DIR, { recursive: true });
      return (await generate(url, out, kind)) ? out : null;
    } finally {
      release();
      inflight.delete(key);
    }
  })();
  inflight.set(key, job);
  return job;
}
