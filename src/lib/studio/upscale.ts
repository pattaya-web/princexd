import { createTask, getTask } from "@/lib/kie";
import { UPSCALE_CREDITS_PER_SEC } from "./config";
import { compressVideo, downloadToMedia, MediaError, probe, publishToKie } from "./media";

/**
 * Upscale 1080p des vidéos du Studio, par l'upscaler vidéo de KIE.
 *
 * Modèle `video/upscale` (kie.ai/video-upscaler, relevé le 2026-11-20) :
 * entrée `video_url` + `resolution` (1080P | 2K | 4K), sortie dans la boîte
 * 1920×1080 (tournée en vertical), même cadence, mêmes images, même durée,
 * audio gardé en AAC. 60 s et 50 Mo max. 1,5 crédit par seconde en 1080p,
 * soit environ 0,10 € pour un reel de 15 s : bien moins cher que de générer
 * directement en 1080p (Seedance 2.5 : 50 crédits/s en 720p, davantage en 1080p).
 *
 * Il passe AVANT l'interpolation 60 i/s : il reçoit la sortie du modèle
 * (24-30 i/s), dont on est sûr qu'il l'accepte.
 */
export const UPSCALE_MODEL = "video/upscale";
const MAX_BYTES = 50 * 1024 * 1024;
const MAX_SEC = 60;
const POLL_MS = 8_000;
const TIMEOUT_MS = 20 * 60_000;

export class UpscaleError extends MediaError {}

/** Vrai si la vidéo est déjà en 1080p ou plus (le petit côté fait au moins 1080 px, à 2 % près). */
export function isHd(width: number, height: number): boolean {
  return Math.min(width, height) >= 1058;
}

/**
 * Passe une vidéo locale en 1080p. Renvoie null si elle y est déjà.
 * Tourne avec la clé KIE du contexte (celle de l'élève pour un job d'élève).
 */
export async function upscaleTo1080p(localPath: string): Promise<{ url: string; path: string; credits: number } | null> {
  const info = await probe(localPath);
  if (isHd(info.width, info.height)) return null;
  if (info.durationSec > MAX_SEC) throw new UpscaleError(`vidéo de ${Math.round(info.durationSec)} s, l'upscale accepte ${MAX_SEC} s maximum.`);
  let src = localPath;
  if (info.bytes > MAX_BYTES) {
    // Rare (un rendu de modèle pèse 2 à 10 Mo) : on recompresse sans changer la définition.
    const small = await compressVideo(localPath, MAX_BYTES, info.durationSec, { width: info.width, height: info.height });
    src = small.path;
  }
  const url = await publishToKie(src, "upscale.mp4");
  const taskId = await createTask(UPSCALE_MODEL, { video_url: url, resolution: "1080P" });
  const t0 = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    let rec;
    try {
      rec = await getTask(taskId);
    } catch {
      // Un sondage raté ne tranche rien : on réessaie au tour suivant.
      if (Date.now() - t0 > TIMEOUT_MS) throw new UpscaleError("l'upscale ne répond plus (20 min).");
      continue;
    }
    if (rec.state === "success") {
      const result = rec.resultUrls[0];
      if (!result) throw new UpscaleError("KIE n'a pas renvoyé de vidéo.");
      const dl = await downloadToMedia(result, { trusted: true });
      return { ...dl, credits: rec.creditsConsumed || Math.round(info.durationSec * UPSCALE_CREDITS_PER_SEC * 100) / 100 };
    }
    if (rec.state === "fail") throw new UpscaleError(rec.failMsg || "échec chez KIE.");
    if (Date.now() - t0 > TIMEOUT_MS) throw new UpscaleError("l'upscale n'a pas fini en 20 min.");
  }
}
