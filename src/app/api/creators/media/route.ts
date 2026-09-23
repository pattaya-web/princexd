import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { readDB } from "@/lib/db";
import { hashKey } from "@/lib/thumb-cache";
import { DownloadError, downloadVideo, isSupportedUrl } from "@/lib/ytdlp";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MEDIA_DIR = path.join(process.cwd(), "data", "media");

/**
 * Video d'un createur, en cache local.
 *
 * Premiere demande : yt-dlp telecharge le fichier dans data/media. Ensuite
 * la video est servie par /api/media, avec les requetes Range : on peut
 * avancer dans la video, chose impossible avec l'embed Instagram. Et une
 * fois en cache, Instagram peut bien bloquer le serveur, la video reste la.
 *
 *  - ?prepare=1   met en cache et renvoie l'adresse locale (lecteur)
 *  - ?probe=1     dit seulement si le fichier est disponible (bouton)
 *  - ?download=1  envoie le fichier en piece jointe
 *  - sinon        redirige vers le fichier local
 */
const pending = new Map<string, Promise<void>>();

async function ensureCached(url: string): Promise<string> {
  const name = `v${hashKey(url)}.mp4`;
  const target = path.join(MEDIA_DIR, name);
  if (!fs.existsSync(target)) {
    let job = pending.get(url);
    if (!job) {
      job = (async () => {
        await fs.promises.mkdir(MEDIA_DIR, { recursive: true });
        await downloadVideo(url, target);
      })().finally(() => pending.delete(url));
      pending.set(url, job);
    }
    await job;
  }
  return name;
}

export async function GET(req: NextRequest) {
  const raw = (req.nextUrl.searchParams.get("url") ?? "").split("?")[0];
  if (!isSupportedUrl(raw)) {
    return NextResponse.json({ error: "Lien non reconnu." }, { status: 400 });
  }
  const q = req.nextUrl.searchParams;

  try {
    const name = await ensureCached(raw);
    const local = `/api/media/${name}`;

    if (q.get("probe") === "1") return NextResponse.json({ ok: true, src: local });
    if (q.get("prepare") === "1") return NextResponse.json({ ok: true, src: local });

    if (q.get("download") === "1") {
      const known = readDB().creatorPosts.find((p) => p.permalink.split("?")[0] === raw);
      const base = (known?.creator || "reel").replace(/[^\p{L}\p{N}_-]/gu, "") || "reel";
      const fileName = `${base}-${hashKey(raw)}.mp4`;
      return NextResponse.redirect(new URL(`${local}?download=1&name=${encodeURIComponent(fileName)}`, req.url));
    }

    return NextResponse.redirect(new URL(local, req.url));
  } catch (e) {
    const err = e as DownloadError;
    return NextResponse.json({ error: err.message }, { status: err.code ?? 502 });
  }
}
