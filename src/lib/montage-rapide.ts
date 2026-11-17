import fs from "fs/promises";
import os from "os";
import path from "path";
import { localMediaPath, MediaError, probe, runFf, storeBuffer } from "@/lib/studio/media";

/**
 * Montage rapide (2026-11-18) : un mini éditeur façon CapCut, côté serveur.
 *
 * La page fait tout le travail visuel : couper, placer les textes, choisir la
 * musique et les volumes. Chaque texte est rendu par le navigateur en PNG
 * transparent à la taille exacte de la vidéo (même police, même rendu que
 * l'aperçu), donc le serveur n'a besoin d'aucune police : ffmpeg superpose
 * les images sur la plage de temps demandée, mixe le son, et ré-encode en
 * H.264 quasi sans perte (CRF 17) à la résolution et la cadence d'origine.
 */

export interface TextLayer {
  /** PNG transparent, même dimensions que la vidéo. */
  url: string;
  /** Plage d'affichage, en secondes sur la vidéo d'origine. */
  start: number;
  end: number;
}

export interface EditSpec {
  videoUrl: string;
  /** Plage gardée, en secondes sur la vidéo d'origine. */
  start: number;
  end: number;
  texts: TextLayer[];
  musicUrl?: string;
  /** Point de départ dans le fichier audio, en secondes. */
  musicStart?: number;
  /** 1 = inchangé, 0 = muet, 1.5 = plus fort. */
  musicVolume: number;
  videoVolume: number;
}

export interface EditResult {
  url: string;
  bytes: number;
  durationSec: number;
  width: number;
  height: number;
}

const num = (v: unknown, fallback = 0) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const sec = (v: number) => v.toFixed(3);

function mediaFile(url: string, what: string): string {
  const full = typeof url === "string" ? localMediaPath(url) : null;
  if (!full) throw new MediaError(`${what} : dépose d'abord le fichier sur le site.`, 400);
  return full;
}

/** Lit et borne la demande reçue de la page. */
export function parseSpec(raw: unknown): EditSpec {
  const b = (raw ?? {}) as Record<string, unknown>;
  const texts = Array.isArray(b.texts) ? b.texts : [];
  return {
    videoUrl: String(b.videoUrl ?? ""),
    start: Math.max(0, num(b.start)),
    end: Math.max(0, num(b.end)),
    texts: texts
      .map((t) => {
        const x = (t ?? {}) as Record<string, unknown>;
        return { url: String(x.url ?? ""), start: Math.max(0, num(x.start)), end: Math.max(0, num(x.end)) };
      })
      .filter((t) => t.url && t.end > t.start)
      .slice(0, 30),
    musicUrl: b.musicUrl ? String(b.musicUrl) : undefined,
    musicStart: Math.max(0, num(b.musicStart)),
    musicVolume: clamp(num(b.musicVolume, 1), 0, 3),
    videoVolume: clamp(num(b.videoVolume, 1), 0, 3),
  };
}

export async function exportEdit(spec: EditSpec, setStep: (s: string) => void): Promise<EditResult> {
  const video = mediaFile(spec.videoUrl, "La vidéo");
  const textFiles = spec.texts.map((t) => mediaFile(t.url, "Un texte"));
  const music = spec.musicUrl ? mediaFile(spec.musicUrl, "La musique") : null;

  setStep("Lecture de la vidéo…");
  const info = await probe(video);
  const start = clamp(spec.start, 0, Math.max(0, info.durationSec - 0.1));
  const end = spec.end > start ? Math.min(spec.end, info.durationSec || spec.end) : info.durationSec;
  const dur = end - start;
  if (!(dur > 0.05)) throw new MediaError("La partie gardée est vide : avance la fin après le début.", 400);

  const args = ["-hide_banner", "-loglevel", "error", "-y", "-ss", sec(start), "-t", sec(dur), "-i", video];
  for (const f of textFiles) args.push("-i", f);
  const musicIdx = 1 + textFiles.length;
  if (music) args.push("-ss", sec(spec.musicStart ?? 0), "-i", music);

  const filters: string[] = [];
  // Vidéo : les textes superposés l'un après l'autre, chacun sur sa plage (temps de la sortie, qui part de 0).
  let cur = "0:v";
  spec.texts.forEach((t, i) => {
    const from = Math.max(0, t.start - start);
    const to = Math.max(from, t.end - start);
    const out = `v${i}`;
    filters.push(`[${cur}][${i + 1}:v]overlay=0:0:format=auto:enable='between(t,${sec(from)},${sec(to)})'[${out}]`);
    cur = out;
  });
  filters.push(`[${cur}]format=yuv420p[vout]`);

  // Son : volume de la vidéo, musique coupée à la longueur de la vidéo, mélange.
  let audio: string | null = null;
  const vv = spec.videoVolume;
  const mv = spec.musicVolume;
  if (music && info.hasAudio) {
    filters.push(`[0:a]volume=${vv.toFixed(3)}[a0]`, `[${musicIdx}:a]volume=${mv.toFixed(3)}[a1]`, `[a0][a1]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]`);
    audio = "[aout]";
  } else if (music) {
    filters.push(`[${musicIdx}:a]volume=${mv.toFixed(3)},atrim=0:${sec(dur)},asetpts=PTS-STARTPTS[aout]`);
    audio = "[aout]";
  } else if (info.hasAudio) {
    filters.push(`[0:a]volume=${vv.toFixed(3)}[aout]`);
    audio = "[aout]";
  }

  args.push("-filter_complex", filters.join(";"), "-map", "[vout]");
  if (audio) args.push("-map", audio, "-c:a", "aac", "-b:a", "192k");
  else args.push("-an");
  args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "17", "-movflags", "+faststart", "-shortest");

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "princexd-montage-"));
  const out = path.join(dir, "montage.mp4");
  args.push(out);
  try {
    setStep(spec.texts.length || music ? "Montage et export en cours…" : "Découpe et export en cours…");
    await runFf("ffmpeg", args, 30 * 60_000);
    const buf = await fs.readFile(out);
    const stored = await storeBuffer(buf, ".mp4");
    const done = await probe(stored.path).catch(() => info);
    return { url: stored.url, bytes: buf.length, durationSec: done.durationSec || dur, width: done.width || info.width, height: done.height || info.height };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
