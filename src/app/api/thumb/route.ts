import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import { ensureRemoteThumb } from "@/lib/thumbs";

export const dynamic = "force-dynamic";

/**
 * Vignette JPEG d'un media distant : /api/thumb?url=https://cdn.../image.png
 * Hotes de confiance seulement (ceux des fournisseurs IA), 404 sinon ou en
 * cas d'echec : le composant retombe alors sur le media d'origine.
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url") ?? "";
  if (!/^https:\/\//.test(url)) return NextResponse.json({ error: "URL invalide" }, { status: 400 });
  const thumb = await ensureRemoteThumb(url);
  if (!thumb) return NextResponse.json({ error: "Pas de vignette" }, { status: 404 });
  const stat = fs.statSync(thumb);
  return new NextResponse(fs.createReadStream(thumb) as unknown as ReadableStream, {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(stat.size),
      // Un resultat de fournisseur ne change jamais sous la meme URL.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
