import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { Readable } from "stream";
import { readDB } from "@/lib/db";
import { readSession } from "@/lib/sales/access";
import { resourcePath } from "@/lib/formation-resources";

export const dynamic = "force-dynamic";

/**
 * Le PDF lui-meme, sous son nom d'origine.
 *
 * Par defaut en telechargement (c'est le geste attendu : prendre le fichier
 * pour l'envoyer a l'eleve) ; `?inline=1` l'ouvre dans le navigateur.
 * Reserve a l'admin : la route est hors middleware, la session est relue ici.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = readSession(req);
  if (!session.isAdmin) return NextResponse.json({ error: "Accès refusé." }, { status: 403 });

  const { id } = await ctx.params;
  const row = readDB().courseResources.find((r) => r.id === id);
  const full = row ? resourcePath(row.stored) : null;
  if (!row || !full || !fs.existsSync(full)) {
    return NextResponse.json({ error: "Fichier introuvable." }, { status: 404 });
  }

  const inline = req.nextUrl.searchParams.get("inline") === "1";
  const name = row.fileName.replace(/[\r\n"]/g, "");
  const ascii = name.replace(/[^\x20-\x7e]/g, "_");
  const stat = fs.statSync(full);
  // Flux web natif : un flux Node passe tel quel laisse une exception
  // « ReadableStream is already closed » quand le client a fini de lire.
  return new NextResponse(Readable.toWeb(fs.createReadStream(full)) as ReadableStream, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(stat.size),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
