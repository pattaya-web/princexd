import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { newId, readDB, writeDB } from "@/lib/db";
import { readSession, requireAdmin, requireFormation } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { isPdf, MAX_PDF_BYTES, RESOURCES_DIR, safeFileName, titleFromFileName, toResourceRow, type CourseResourceRow } from "@/lib/formation-resources";
import type { CourseResource } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export interface CourseResourcesPayload {
  resources: CourseResourceRow[];
}

const sorted = (rows: CourseResource[]) => rows.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(toResourceRow);

/**
 * Les annexes PDF de la formation : gerees par l'admin, lues par les eleves
 * dans leur espace Ressources (Scale X) quand elles sont marquees visibles.
 *
 * Cette route est hors middleware (voir middleware.ts) : elle recoit des
 * fichiers, et le middleware Node amputait les corps de requete. Elle verifie
 * donc la session elle-meme, a chaque appel.
 */
export async function GET(req: NextRequest) {
  return handle((): CourseResourcesPayload => {
    const session = requireFormation(readSession(req));
    const all = readDB().courseResources;
    // L'eleve ne voit que les annexes marquees visibles ; l'admin voit tout.
    return { resources: sorted(session.isAdmin ? all : all.filter((r) => r.studentVisible !== false)) };
  });
}

/**
 * Depot d'un ou plusieurs PDF (multipart, champ `file`).
 *
 * Chaque fichier est ecrit en flux sur le disque sous un nom genere, apres
 * verification de l'extension, de la taille et de l'en-tete `%PDF-` : un
 * fichier renomme en .pdf qui n'en est pas un est refuse tout de suite,
 * plutot que de casser a l'ouverture chez l'eleve.
 */
export async function POST(req: NextRequest) {
  return handle(async (): Promise<CourseResourcesPayload & { added: CourseResourceRow[] }> => {
    requireAdmin(readSession(req));
    const form = await req.formData();
    const files = form.getAll("file").filter((f): f is File => f instanceof File);
    if (!files.length) throw new Error("Aucun fichier reçu.");

    await fs.promises.mkdir(RESOURCES_DIR, { recursive: true });
    const db = readDB();
    const added: CourseResource[] = [];
    for (const file of files) {
      const fileName = safeFileName(file.name);
      if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
        throw new Error(`« ${file.name} » n'est pas un PDF. Seuls les PDF sont acceptés.`);
      }
      if (file.size > MAX_PDF_BYTES) throw new Error(`« ${file.name} » dépasse 50 Mo.`);
      const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
      if (!isPdf(head)) throw new Error(`« ${file.name} » n'est pas un PDF lisible.`);

      const stored = `${newId()}.pdf`;
      const target = path.join(RESOURCES_DIR, stored);
      try {
        await pipeline(Readable.fromWeb(file.stream() as never), fs.createWriteStream(target));
      } catch {
        await fs.promises.rm(target, { force: true });
        throw new Error(`Envoi interrompu pour « ${file.name} ». Réessaie.`);
      }
      const now = new Date().toISOString();
      const titleRaw = form.get("title");
      const title = files.length === 1 && typeof titleRaw === "string" && titleRaw.trim() ? titleRaw.trim().slice(0, 120) : titleFromFileName(fileName);
      added.push({ id: newId(), title, fileName, stored, size: file.size, createdAt: now, updatedAt: now });
    }
    db.courseResources.unshift(...added);
    writeDB(db);
    return { resources: sorted(db.courseResources), added: added.map(toResourceRow) };
  });
}
