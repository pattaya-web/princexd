import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { readDB } from "@/lib/db";
import { fetchMediaUrl, findCreatorMedia } from "@/lib/instagram";
import { hashKey } from "@/lib/thumb-cache";
import { DownloadError, downloadVideo, isSupportedUrl } from "@/lib/ytdlp";

/**
 * Fichier video d'une publication Instagram, en cache local.
 *
 * Deux voies, dans cet ordre :
 *  1. l'API officielle de Meta : `media_url` de mes propres publications, ou
 *     de celles d'un createur suivi (Business Discovery). Le lien CDN obtenu
 *     est frais, et le serveur peut le telecharger sans session ;
 *  2. yt-dlp, qui marche sur un PC mais qu'Instagram bloque depuis un VPS.
 *
 * Avant, seule la voie 2 existait : sur le site en ligne, tout telechargement
 * ou transcription d'un reel de createur finissait en « erreur 502 ».
 */
const run = promisify(execFile);
const MEDIA_DIR = path.join(process.cwd(), "data", "media");
const MAX_BYTES = 500 * 1024 * 1024;

const clean = (u: string) => (u || "").split("?")[0].replace(/\/+$/, "");

/** URL CDN fraiche du fichier video, par l'API officielle. null si on ne sait pas. */
export async function officialVideoUrl(permalink: string): Promise<string | null> {
  const link = clean(permalink);
  if (!/instagram\.com\//i.test(link)) return null;
  const db = readDB();

  // Ma propre publication : l'API me la donne directement.
  const mine = db.posts.find((p) => clean(p.url) === link);
  if (mine?.igMediaId) {
    try {
      const m = await fetchMediaUrl(mine.igMediaId);
      if (m.media_url && (m.media_type ?? "VIDEO") === "VIDEO") return m.media_url;
    } catch {
      // On tente la voie createur.
    }
  }

  // Publication d'un createur connu : on la retrouve dans son flux.
  const handle =
    db.creatorPosts.find((p) => clean(p.permalink) === link)?.creator ||
    db.saved.find((s) => clean(s.permalink) === link)?.author ||
    "";
  if (handle) {
    try {
      const hit = await findCreatorMedia(handle, link, 12);
      if (hit?.media.media_url && hit.media.media_type === "VIDEO") return hit.media.media_url;
    } catch {
      // Quota ou compte non professionnel : yt-dlp prendra le relais.
    }
  }
  return null;
}

/** Telecharge un fichier video par HTTP dans `target`, en flux, avec plafond. */
async function downloadFromUrl(url: string, target: string): Promise<void> {
  const tmp = `${target}.part`;
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(240_000) });
  if (!res.ok || !res.body) throw new DownloadError(`Fichier vidéo indisponible (HTTP ${res.status}).`);
  const type = res.headers.get("content-type") ?? "";
  if (!type.startsWith("video/") && !type.includes("octet-stream")) throw new DownloadError("Le lien ne pointe pas vers une vidéo.");
  const out = fs.createWriteStream(tmp);
  let size = 0;
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.length;
      if (size > MAX_BYTES) throw new DownloadError("Vidéo trop lourde (500 Mo max).");
      if (!out.write(chunk)) await new Promise<void>((r) => out.once("drain", () => r()));
    }
    await new Promise<void>((resolve, reject) => out.end((e: unknown) => (e ? reject(e) : resolve())));
    if (!size) throw new DownloadError("Téléchargement vide.");
    await fs.promises.rename(tmp, target);
  } catch (e) {
    out.destroy();
    await fs.promises.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}

const pending = new Map<string, Promise<void>>();
/* Un echec n'est pas retente pendant 10 min : chaque tentative coute du temps pour le meme resultat. */
const failed = new Map<string, { at: number; message: string }>();
const FAIL_TTL_MS = 10 * 60 * 1000;

/** Nom du fichier local (dans data/media) d'une publication, telecharge si besoin. */
export async function ensureCreatorVideo(rawUrl: string): Promise<string> {
  const url = clean(rawUrl);
  if (!isSupportedUrl(url)) throw new DownloadError("Lien non reconnu.", 400);
  const name = `v${hashKey(url)}.mp4`;
  const target = path.join(MEDIA_DIR, name);
  if (fs.existsSync(target)) return name;

  const recent = failed.get(url);
  if (recent && Date.now() - recent.at < FAIL_TTL_MS) throw new DownloadError(recent.message);

  let job = pending.get(url);
  if (!job) {
    job = (async () => {
      await fs.promises.mkdir(MEDIA_DIR, { recursive: true });
      try {
        const official = await officialVideoUrl(url);
        if (official) {
          try {
            await downloadFromUrl(official, target);
            failed.delete(url);
            return;
          } catch {
            // Le CDN a refuse : on tente yt-dlp.
          }
        }
        await downloadVideo(url, target);
        failed.delete(url);
      } catch (e) {
        const message =
          (e as Error).message?.includes("429") || /login|cookies|rate-limit/i.test((e as Error).message ?? "")
            ? "Instagram bloque le serveur pour cette vidéo. Ajoute le créateur dans Content (suivi) pour passer par l'API officielle."
            : (e as Error).message;
        failed.set(url, { at: Date.now(), message });
        throw new DownloadError(message, (e as DownloadError).code ?? 502);
      }
    })().finally(() => pending.delete(url));
    pending.set(url, job);
  }
  await job;
  return name;
}

/** Fichier local (nom) si deja en cache, sans rien telecharger. */
export function cachedVideoName(rawUrl: string): string | null {
  const name = `v${hashKey(clean(rawUrl))}.mp4`;
  return fs.existsSync(path.join(MEDIA_DIR, name)) ? name : null;
}

/**
 * Piste audio d'un fichier video local, en mp3 leger (64 kb/s) : sous les
 * 25 Mo d'OpenAI meme pour une video de 40 minutes.
 */
export async function extractAudio(localName: string): Promise<{ data: Buffer; filename: string }> {
  const src = path.join(MEDIA_DIR, localName);
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "princexd-audio-"));
  const out = path.join(dir, "audio.mp3");
  try {
    await run(
      "ffmpeg",
      ["-hide_banner", "-loglevel", "error", "-y", "-i", src, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", out],
      { timeout: 180_000, maxBuffer: 4 * 1024 * 1024 },
    );
    const data = await fs.promises.readFile(out);
    if (!data.length) throw new DownloadError("Piste audio vide.");
    return { data, filename: "audio.mp3" };
  } catch (e) {
    if (e instanceof DownloadError) throw e;
    throw new DownloadError(`Extraction audio impossible : ${((e as Error).message ?? "").slice(0, 160)}`);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
