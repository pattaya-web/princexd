import { NextRequest, NextResponse } from "next/server";
import { readDB } from "@/lib/db";
import { DownloadError, isSupportedUrl, resolveDirectUrl } from "@/lib/ytdlp";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Lecture et téléchargement d'un reel de créateur.
 *
 * Meta ne livre pas le fichier vidéo des comptes tiers : c'est yt-dlp qui
 * résout le flux depuis le lien public. La lecture redirige vers le CDN — le
 * navigateur streame directement — tandis que le téléchargement passe par
 * nous, un attribut `download` étant ignoré vers un autre domaine.
 */
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("url") ?? "";
  if (!isSupportedUrl(raw)) {
    return NextResponse.json({ error: "Lien non reconnu." }, { status: 400 });
  }

  try {
    const direct = await resolveDirectUrl(raw);

    if (req.nextUrl.searchParams.get("download") !== "1") {
      return NextResponse.redirect(direct);
    }

    const upstream = await fetch(direct, { cache: "no-store" });
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json(
        { error: `Téléchargement impossible (HTTP ${upstream.status}).` },
        { status: 502 },
      );
    }

    // Nom lisible : on reprend l'auteur connu si le reel est déjà suivi.
    const known = readDB().creatorPosts.find((p) => p.permalink === raw.split("?")[0]);
    const base = (known?.creator || "reel").replace(/[^\p{L}\p{N}_-]/gu, "") || "reel";

    return new NextResponse(upstream.body, {
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "video/mp4",
        "Content-Disposition": `attachment; filename="${base}-${Date.now()}.mp4"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const err = e as DownloadError;
    return NextResponse.json({ error: err.message }, { status: err.code ?? 502 });
  }
}
