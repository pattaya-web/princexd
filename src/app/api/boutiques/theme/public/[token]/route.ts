import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getSettings } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Le zip du thème, lu par Shopify au moment d'installer le thème sur la
 * boutique du client. Public (pas de cookie côté Shopify) mais caché derrière
 * un jeton aléatoire régénéré à chaque dépôt.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const z = getSettings().shopThemeZip;
  if (!z || token.replace(/\.zip$/i, "") !== z.token) return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  const file = path.join(process.cwd(), "data", "boutiques", z.file);
  if (!fs.existsSync(file)) return NextResponse.json({ error: "Fichier absent" }, { status: 404 });
  const buf = fs.readFileSync(file);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(buf.length),
      "Content-Disposition": `attachment; filename="${z.name.replace(/"/g, "")}"`,
      "Cache-Control": "no-store",
    },
  });
}
