import { NextRequest, NextResponse } from "next/server";
import { readDB } from "@/lib/db";
import { fetchMediaUrl, InstagramError } from "@/lib/instagram";

export const dynamic = "force-dynamic";

/**
 * Redirige vers le fichier vidéo d'une publication.
 *
 * Les URL CDN Instagram expirent en quelques jours, donc on ne peut pas stocker
 * un lien de téléchargement : on en redemande un frais à chaque clic.
 */
export async function GET(req: NextRequest) {
  const postId = req.nextUrl.searchParams.get("postId");
  if (!postId) return NextResponse.json({ error: "postId manquant" }, { status: 400 });

  const post = readDB().posts.find((p) => p.id === postId);
  if (!post?.igMediaId) {
    return NextResponse.json({ error: "Publication introuvable" }, { status: 404 });
  }

  try {
    const media = await fetchMediaUrl(post.igMediaId);
    if (!media.media_url) {
      return NextResponse.json({ error: "Aucun fichier disponible." }, { status: 404 });
    }

    // Lecture : une redirection suffit, le navigateur streame depuis le CDN.
    if (req.nextUrl.searchParams.get("download") !== "1") {
      return NextResponse.redirect(media.media_url);
    }

    // Telechargement : il faut relayer nous-memes. Une redirection vers un
    // autre domaine ignore l'attribut `download` du lien, le navigateur se
    // contente d'ouvrir la video.
    const upstream = await fetch(media.media_url, { cache: "no-store" });
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json(
        { error: `Téléchargement impossible (HTTP ${upstream.status}).` },
        { status: 502 },
      );
    }

    const safe = (post.title || "reel").replace(/[^\p{L}\p{N} _-]/gu, "").trim().slice(0, 60) || "reel";
    return new NextResponse(upstream.body, {
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "video/mp4",
        "Content-Disposition": `attachment; filename="${safe}.mp4"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const err = e as InstagramError;
    return NextResponse.json({ error: err.message }, { status: err.code === 401 ? 401 : 502 });
  }
}
