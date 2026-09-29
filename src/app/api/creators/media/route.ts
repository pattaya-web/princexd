import { NextRequest, NextResponse } from "next/server";
import { readDB } from "@/lib/db";
import { hashKey } from "@/lib/thumb-cache";
import { cachedVideoName, ensureCreatorVideo } from "@/lib/video-source";
import { DownloadError, isSupportedUrl } from "@/lib/ytdlp";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Video d'un createur, en cache local (voir lib/video-source : API officielle
 * d'abord, yt-dlp ensuite). Une fois en cache, la video est servie par
 * /api/media avec les requetes Range : on peut avancer dedans, et Instagram
 * peut bien bloquer le serveur, elle reste la.
 *
 *  - ?cached=1    deja en cache ? reponse immediate
 *  - ?prepare=1   met en cache et renvoie l'adresse locale (lecteur)
 *  - ?probe=1     dit seulement si le fichier est disponible (bouton)
 *  - ?download=1  envoie le fichier en piece jointe
 *  - sinon        redirige vers le fichier local
 */
export async function GET(req: NextRequest) {
  const raw = (req.nextUrl.searchParams.get("url") ?? "").split("?")[0];
  if (!isSupportedUrl(raw)) {
    return NextResponse.json({ error: "Lien non reconnu." }, { status: 400 });
  }
  const q = req.nextUrl.searchParams;

  if (q.get("cached") === "1") {
    const name = cachedVideoName(raw);
    return NextResponse.json(name ? { ok: true, src: `/api/media/${name}` } : { ok: false });
  }

  try {
    const name = await ensureCreatorVideo(raw);
    const local = `/api/media/${name}`;

    if (q.get("probe") === "1") return NextResponse.json({ ok: true, src: local });
    if (q.get("prepare") === "1") return NextResponse.json({ ok: true, src: local });

    if (q.get("download") === "1") {
      const db = readDB();
      const known = db.creatorPosts.find((p) => p.permalink.split("?")[0] === raw) ?? db.saved.find((s) => s.permalink.split("?")[0] === raw);
      const author = (known && ("creator" in known ? known.creator : known.author)) || "reel";
      const base = author.replace(/[^\p{L}\p{N}_-]/gu, "") || "reel";
      const fileName = `${base}-${hashKey(raw)}.mp4`;
      return redirectTo(`${local}?download=1&name=${encodeURIComponent(fileName)}`);
    }

    return redirectTo(local);
  } catch (e) {
    const err = e as DownloadError;
    return NextResponse.json({ error: err.message }, { status: err.code ?? 502 });
  }
}

/**
 * Redirection relative : derriere le proxy du VPS, `req.url` vaut
 * http://0.0.0.0:3000/... (l'adresse d'ecoute du conteneur), donc une
 * URL absolue construite dessus envoie le navigateur dans le vide.
 * Une en-tete Location relative est resolue sur le domaine public.
 */
function redirectTo(path: string) {
  return new NextResponse(null, { status: 307, headers: { Location: path } });
}
