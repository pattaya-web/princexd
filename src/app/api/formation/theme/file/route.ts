import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { Readable } from "stream";
import { readDB } from "@/lib/db";
import { readSession } from "@/lib/sales/access";
import { currentTheme } from "@/lib/formation-theme";

export const dynamic = "force-dynamic";

/** Le zip du thème de Mady (déposé par l'admin, sinon celui livré avec le dépôt), en téléchargement. Admin ou élève connecté. */
export async function GET(req: NextRequest) {
  const session = readSession(req);
  if (!session.isAdmin && session.role !== "student") return NextResponse.json({ error: "Accès refusé." }, { status: 403 });
  const theme = currentTheme(readDB().settings);
  if (!theme) return NextResponse.json({ error: "Pas de thème disponible." }, { status: 404 });
  const full = theme.full;

  const name = theme.fileName.replace(/[\r\n"]/g, "");
  const ascii = name.replace(/[^\x20-\x7e]/g, "_");
  const stat = fs.statSync(full);
  // Flux web natif : un flux Node passé tel quel laisse une exception quand le client a fini de lire.
  return new NextResponse(Readable.toWeb(fs.createReadStream(full)) as ReadableStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(stat.size),
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
