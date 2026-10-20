import { NextRequest, NextResponse } from "next/server";
import { list } from "@/lib/db";
import { refuseUnless } from "@/lib/sales/access";
import { adminFor, ShopifyError } from "@/lib/boutique/shopify";
import type { ClientShop } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_BYTES = 60 * 1024 * 1024;

const MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  avif: "image/avif",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

/**
 * Dépose un fichier dans Contenu → Fichiers de la boutique cliente, nom
 * conservé. Corps brut = le fichier ; `x-file-name` = son nom ; `x-shop-id`
 * = la boutique. Un fichier par appel, le navigateur enchaîne.
 */
export async function POST(req: NextRequest) {
  const denied = refuseUnless(req, []);
  if (denied) return denied;
  const shopId = req.headers.get("x-shop-id") ?? "";
  const shop = (list("shops") as ClientShop[]).find((s) => s.id === shopId);
  if (!shop) return NextResponse.json({ error: "Boutique cliente introuvable." }, { status: 400 });
  const name = decodeURIComponent(req.headers.get("x-file-name") ?? "").trim();
  if (!name) return NextResponse.json({ error: "Nom de fichier manquant." }, { status: 400 });
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const mime = MIME[ext];
  if (!mime) return NextResponse.json({ error: `Format non pris : ${ext || "sans extension"} (jpg, png, webp, gif, svg, avif, mp4, mov, webm).` }, { status: 400 });
  const buf = new Uint8Array(await req.arrayBuffer());
  if (!buf.byteLength) return NextResponse.json({ error: "Fichier vide." }, { status: 400 });
  if (buf.byteLength > MAX_BYTES) return NextResponse.json({ error: "Fichier trop lourd (60 Mo max)." }, { status: 413 });

  try {
    const admin = await adminFor(shop);
    const r = await admin.uploadFile(name, buf, mime);
    return NextResponse.json({ ok: true, name, id: r.id, status: r.status });
  } catch (e) {
    const err = e as ShopifyError;
    const msg = /access denied|scope|write_files/i.test(err.message)
      ? `${err.message} L'app du client doit avoir les accès read_files + write_files : Dev Dashboard → Versions → nouvelle version avec ces scopes → Release, puis réinstaller l'app.`
      : err.message;
    return NextResponse.json({ error: msg }, { status: err.status && err.status >= 400 ? err.status : 502 });
  }
}
