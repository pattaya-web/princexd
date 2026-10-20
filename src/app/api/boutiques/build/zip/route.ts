import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { list } from "@/lib/db";
import { refuseUnless } from "@/lib/sales/access";
import { THEME_DIR } from "@/lib/boutique/theme-zip";
import type { ShopBuild } from "@/lib/types";

export const dynamic = "force-dynamic";

/** `?id=<génération>` : le zip du thème prêt (template recoloré, textes réécrits), à importer dans Shopify. */
export async function GET(req: NextRequest) {
  const denied = refuseUnless(req, []);
  if (denied) return denied;
  const id = req.nextUrl.searchParams.get("id") ?? "";
  const build = (list("shopBuilds") as ShopBuild[]).find((b) => b.id === id);
  const file = build?.result?.readyZipFile;
  if (!build || !file || !/^ready-[\w-]+\.zip$/.test(file)) return NextResponse.json({ error: "Aucun thème prêt pour cette génération." }, { status: 404 });
  let buf: Buffer;
  try {
    buf = await fs.readFile(path.join(THEME_DIR, file));
  } catch {
    return NextResponse.json({ error: "Le zip n'est plus sur le disque : relance une génération." }, { status: 404 });
  }
  const brand = (build.result?.brandName || "boutique").replace(/[^\w-]+/g, "-").toLowerCase();
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="theme-${brand}.zip"`,
      "Content-Length": String(buf.length),
      "Cache-Control": "no-store",
    },
  });
}
