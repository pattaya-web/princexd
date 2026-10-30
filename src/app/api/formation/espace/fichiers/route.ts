import { NextRequest, NextResponse } from "next/server";
import { createWriteStream } from "fs";
import fs from "fs/promises";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { newId, readDB, writeDB } from "@/lib/db";
import { Forbidden } from "@/lib/sales/access";
import { espaceScope, getWorkspace, MAX_FILE_BYTES, MEDIA_DIR, safeExt } from "@/lib/formation-espace";
import { warmThumb } from "@/lib/thumbs";
import type { WorkspaceFile } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Dépôt de fichiers dans le drive de l'élève (multipart : un ou plusieurs
 * champs `file`, un champ `folder`). Hors middleware, comme /api/upload : le
 * middleware amputait le début des fichiers. La session est donc vérifiée ici,
 * par `espaceScope` (l'élève pour son espace, l'admin pour celui qu'il regarde).
 */
export async function POST(req: NextRequest) {
  let scope;
  try {
    scope = espaceScope(req, req.nextUrl.searchParams.get("student"));
  } catch (e) {
    const status = e instanceof Forbidden ? e.status : 400;
    return NextResponse.json({ error: e instanceof Error ? e.message : "Accès refusé." }, { status });
  }

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.startsWith("multipart/form-data")) {
    return NextResponse.json({ error: "Envoi attendu en multipart/form-data." }, { status: 400 });
  }
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Envoi illisible (fichier trop lourd ou interrompu)." }, { status: 400 });
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (!files.length) return NextResponse.json({ error: "Aucun fichier reçu." }, { status: 400 });

  const db = readDB();
  const w = getWorkspace(db, scope.student.id);
  const folderId = String(form.get("folder") ?? "");
  const folder = w.folders.find((f) => f.id === folderId) ?? w.folders[0];
  if (!folder) return NextResponse.json({ error: "Crée d'abord un dossier." }, { status: 400 });

  await fs.mkdir(MEDIA_DIR, { recursive: true });
  const added: WorkspaceFile[] = [];
  const refused: string[] = [];
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) {
      refused.push(`${file.name} (plus de 90 Mo)`);
      continue;
    }
    const stored = `esp${newId()}.${safeExt(file.name)}`;
    const target = path.join(MEDIA_DIR, stored);
    try {
      await pipeline(Readable.fromWeb(file.stream() as never), createWriteStream(target));
    } catch {
      await fs.rm(target, { force: true });
      refused.push(`${file.name} (envoi interrompu)`);
      continue;
    }
    added.push({
      id: newId(),
      folderId: folder.id,
      name: file.name.slice(0, 120) || stored,
      stored,
      size: file.size,
      mime: file.type || "",
      note: "",
      by: scope.isAdmin ? "admin" : "student",
      createdAt: new Date().toISOString(),
    });
    // Vignette préparée tout de suite : la grille s'affiche sans attendre ffmpeg.
    warmThumb(`/api/media/${stored}`);
  }
  if (added.length) {
    // Relecture : un autre envoi a pu écrire entre-temps.
    const db2 = readDB();
    const w2 = getWorkspace(db2, scope.student.id);
    w2.files.unshift(...added);
    w2.updatedAt = new Date().toISOString();
    writeDB(db2);
  }
  if (!added.length) {
    return NextResponse.json({ error: `Rien n'a été déposé : ${refused.join(", ")}.` }, { status: 413 });
  }
  return NextResponse.json({ files: added, refused });
}
