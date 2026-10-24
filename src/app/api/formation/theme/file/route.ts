import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { Readable } from "stream";
import { readDB } from "@/lib/db";
import { readSession } from "@/lib/sales/access";
import { themePath } from "@/lib/formation-theme";

export const dynamic = "force-dynamic";

/** Le zip du thème de Mady, sous son nom d'origine, en téléchargement. Admin ou élève connecté. */
export async function GET(req: NextRequest) {
  const session = readSession(req);
  if (!session.isAdmin && session.role !== "student") return NextResponse.json({ error: "Accès refusé." }, { status: 403 });
  const theme = readDB().settings.studentTheme;
  const full = theme ? themePath(theme.stored) : null;
  if (!theme || !full || !fs.existsSync(full)) return NextResponse.json({ error: "Pas de thème déposé." }, { status: 404 });

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
