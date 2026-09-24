import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { MAX_UPLOAD_BYTES } from "./openai";

const run = promisify(execFile);
const MEDIA_DIR = path.join(process.cwd(), "data", "media");

export class MediaAudioError extends Error {
  code: number;
  constructor(message: string, code = 400) {
    super(message);
    this.code = code;
  }
}

/** Traduit une URL /api/media/xxx en chemin sur le disque, ou null. */
export function localMediaPath(url: string): string | null {
  const m = url.match(/^\/api\/media\/([A-Za-z0-9]+\.[A-Za-z0-9]+)$/);
  if (!m) return null;
  const full = path.join(MEDIA_DIR, m[1]);
  return full.startsWith(MEDIA_DIR) ? full : null;
}

/**
 * Piste audio seule d'une video, en m4a mono 48 kbit/s.
 *
 * Une pub de 60 s en 1080p pese vite 40 a 80 Mo, au-dessus des 25 Mo
 * qu'accepte OpenAI. Son audio seul tient dans 1 Mo : on ne transcrit jamais
 * les pixels. ffmpeg est present en local et dans l'image Docker.
 */
export async function extractAudio(source: string): Promise<Buffer> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "princexd-audio-"));
  const target = path.join(dir, "audio.m4a");
  try {
    await run(
      "ffmpeg",
      ["-hide_banner", "-loglevel", "error", "-y", "-i", source, "-vn", "-ac", "1", "-b:a", "48k", "-c:a", "aac", target],
      { timeout: 180_000, maxBuffer: 4 * 1024 * 1024 },
    );
    return await fs.readFile(target);
  } catch (e) {
    const err = e as { code?: unknown; message?: string; stderr?: string };
    if (err.code === "ENOENT") {
      throw new MediaAudioError(
        "ffmpeg introuvable sur le serveur : impossible d'extraire l'audio d'une vidéo trop lourde.",
        500,
      );
    }
    throw new MediaAudioError(
      `Extraction audio impossible : ${(err.stderr ?? err.message ?? "").toString().slice(0, 200)}`,
      500,
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Conteneurs qu'OpenAI lit tels quels ; les autres (mkv, avi) passent par ffmpeg. */
const DIRECT = new Set([".mp4", ".mov", ".m4a", ".mp3", ".wav", ".webm"]);

/**
 * Prepare un media depose pour la transcription : le fichier tel quel s'il
 * tient sous la limite, sinon sa piste audio seule.
 */
export async function readForTranscription(
  url: string,
): Promise<{ data: ArrayBuffer; filename: string; sizeMb: number }> {
  const full = localMediaPath(url);
  if (!full) {
    throw new MediaAudioError(
      "Seuls les fichiers déposés dans le drive peuvent être transcrits. Pour un lien, enregistre d'abord la vidéo puis dépose-la.",
    );
  }
  let size: number;
  try {
    size = (await fs.stat(full)).size;
  } catch {
    throw new MediaAudioError("Fichier introuvable sur le serveur.", 404);
  }

  const ext = path.extname(full).toLowerCase();
  if (size <= MAX_UPLOAD_BYTES && DIRECT.has(ext)) {
    const buf = await fs.readFile(full);
    return { data: toArrayBuffer(buf), filename: path.basename(full), sizeMb: round(size) };
  }

  const audio = await extractAudio(full);
  if (audio.byteLength > MAX_UPLOAD_BYTES) {
    throw new MediaAudioError(
      `Piste audio de ${round(audio.byteLength)} Mo : encore au-dessus de la limite OpenAI de 25 Mo. Découpe la vidéo.`,
      413,
    );
  }
  return { data: toArrayBuffer(audio), filename: "audio.m4a", sizeMb: round(audio.byteLength) };
}

function round(bytes: number) {
  return Number((bytes / 1024 / 1024).toFixed(2));
}

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}
