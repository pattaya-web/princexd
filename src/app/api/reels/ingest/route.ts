import { NextRequest, NextResponse } from "next/server";
import { extensionAuthorized, ingestReels, MAX_VIDEO_BYTES, storeReelMedia, type IngestItem } from "@/lib/reels";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/*
 * Entree de l'extension Chrome « Mvdy Reels » (voir extension/). Pas de
 * cookie de session ici : le jeton de l'extension (Authorization: Bearer)
 * fait foi. Les en-tetes CORS permettent aussi un appel depuis une page.
 */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: CORS });

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/** `{ items: IngestItem[] }` → pour chaque Reel : son id et ce qu'il manque (video, vignette). */
export async function POST(req: NextRequest) {
  if (!extensionAuthorized(req)) return json({ error: "Jeton de l'extension invalide. Recopie-le depuis le tool (Reels → Extension)." }, 401);
  const body = (await req.json().catch(() => null)) as { items?: IngestItem[] } | null;
  if (!body || !Array.isArray(body.items)) return json({ error: "Corps attendu : { items: [...] }." }, 400);
  try {
    return json({ results: ingestReels(body.items) });
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
}

/** `?id=<reel>&kind=video|thumb`, corps = le fichier brut. */
export async function PUT(req: NextRequest) {
  if (!extensionAuthorized(req)) return json({ error: "Jeton de l'extension invalide." }, 401);
  const id = req.nextUrl.searchParams.get("id") ?? "";
  const kind = req.nextUrl.searchParams.get("kind") === "thumb" ? "thumb" : "video";
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_VIDEO_BYTES) return json({ error: "Fichier trop lourd." }, 413);
  try {
    const data = Buffer.from(await req.arrayBuffer());
    if (!data.length) return json({ error: "Fichier vide." }, 400);
    const reel = storeReelMedia(id, kind, data);
    return json({ ok: true, video: reel.video, thumbnail: reel.thumbnail });
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
}
