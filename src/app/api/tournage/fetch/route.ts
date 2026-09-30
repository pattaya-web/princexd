import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { newId } from "@/lib/db";

export const dynamic = "force-dynamic";

const MEDIA_DIR = path.join(process.cwd(), "data", "media");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Photo d'un produit AliExpress, rapatriee chez nous pour le kit tournage.
 *
 * Deux entrees :
 *  - le lien d'une image (ae01.alicdn.com/… ou n'importe quelle image https) :
 *    on la telecharge et on la garde dans data/media ;
 *  - le lien d'une page produit : on tente d'y lire la photo principale.
 *    AliExpress sert une coquille anti-robot aux serveurs, donc ca echoue
 *    souvent ; le message explique alors comment copier l'adresse de l'image.
 */
async function saveImage(url: string, hint: string): Promise<{ url: string; name: string }> {
  const res = await fetch(url, { headers: { "user-agent": UA, referer: "https://www.aliexpress.com/" }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Image indisponible (HTTP ${res.status}).`);
  const type = res.headers.get("content-type") ?? "";
  if (!type.startsWith("image/")) throw new Error("Ce lien n'est pas une image.");
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length || buf.length > MAX_BYTES) throw new Error("Image vide ou trop lourde.");
  const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
  const name = `${newId()}.${ext}`;
  await fs.mkdir(MEDIA_DIR, { recursive: true });
  await fs.writeFile(path.join(MEDIA_DIR, name), buf);
  return { url: `/api/media/${name}`, name: `${hint || "produit"}.${ext}` };
}

export async function POST(req: NextRequest) {
  const { url } = (await req.json().catch(() => ({}))) as { url?: string };
  const raw = (url ?? "").trim();
  let target: URL;
  try {
    target = new URL(raw);
    if (target.protocol !== "https:") throw new Error();
  } catch {
    return NextResponse.json({ error: "Colle un lien https valide." }, { status: 400 });
  }

  try {
    const isImage = /\.(jpe?g|png|webp|avif)(\?|$)/i.test(target.pathname) || /alicdn\.com$/i.test(target.hostname);
    if (isImage) {
      const saved = await saveImage(target.toString(), "produit-aliexpress");
      return NextResponse.json({ ...saved, source: "image" });
    }

    if (!/aliexpress\.(com|fr|us)$/i.test(target.hostname.replace(/^(www|fr|m)\./, ""))) {
      return NextResponse.json({ error: "Colle un lien AliExpress, ou directement l'adresse de la photo." }, { status: 400 });
    }

    const page = await fetch(target.toString(), {
      headers: { "user-agent": UA, "accept-language": "fr-FR,fr;q=0.9", accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    const html = await page.text();
    const og = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
    const first = html.match(/https:\/\/ae0\d\.alicdn\.com\/kf\/[A-Za-z0-9_\-/.]+?\.(?:jpg|jpeg|png|webp)/)?.[0];
    const title = html.match(/<meta property="og:title" content="([^"]+)"/)?.[1] ?? html.match(/<title>([^<]{3,})<\/title>/)?.[1] ?? "";
    const img = og || first;
    if (!img) {
      return NextResponse.json(
        {
          error:
            "AliExpress ne laisse pas le serveur lire la page. Sur la page du produit : clic droit sur la grande photo → « Copier l'adresse de l'image », et colle-la ici. Ou copie l'image et fais Ctrl+V sur cette page.",
        },
        { status: 422 },
      );
    }
    const saved = await saveImage(img.replace(/_\d+x\d+[^/]*\.(jpg|png|webp)$/i, ".$1"), "produit-aliexpress");
    return NextResponse.json({ ...saved, title: title.slice(0, 120), source: "page" });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "Récupération impossible." }, { status: 502 });
  }
}
