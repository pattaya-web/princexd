import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { newId, readDB, writeDB } from "@/lib/db";
import { readSession, requireAdmin } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { RESOURCES_DIR } from "@/lib/formation-resources";
import { themePath } from "@/lib/formation-theme";
import type { StudentThemeFile } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Le thème Shopify de Mady pour les élèves : un seul zip, déposé par
 * l'admin, rangé dans data/formation/ (volume persistant) sous un nom
 * généré. Route hors middleware (elle reçoit un fichier) : la session est
 * relue ici. Le téléchargement est dans ./file.
 */

const MAX_ZIP_BYTES = 200 * 1024 * 1024;

const isZip = (head: Uint8Array) => head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;

function safeZipName(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() ?? "";
  const clean = base.replace(/[\u0000-\u001f"]/g, "").trim().slice(0, 150);
  const stem = clean.replace(/\.zip$/i, "").trim() || "theme";
  return `${stem}.zip`;
}

async function removeOld(theme: StudentThemeFile | undefined) {
  const full = theme ? themePath(theme.stored) : null;
  if (full) await fs.promises.rm(full, { force: true });
}

/** Dépôt du zip (multipart, champ `file`) : remplace le précédent. */
export async function POST(req: NextRequest) {
  return handle(async (): Promise<{ theme: StudentThemeFile }> => {
    requireAdmin(readSession(req));
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Aucun fichier reçu.");
    if (!/\.zip$/i.test(file.name)) throw new Error(`« ${file.name} » n'est pas un zip. Exporte ton thème depuis Shopify (Boutique en ligne > Thèmes > … > Télécharger le fichier du thème).`);
    if (file.size > MAX_ZIP_BYTES) throw new Error(`« ${file.name} » dépasse 200 Mo.`);
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    if (!isZip(head)) throw new Error(`« ${file.name} » n'est pas un zip lisible.`);

    await fs.promises.mkdir(RESOURCES_DIR, { recursive: true });
    const stored = `theme-${newId()}.zip`;
    const target = path.join(RESOURCES_DIR, stored);
    try {
      await pipeline(Readable.fromWeb(file.stream() as never), fs.createWriteStream(target));
    } catch {
      await fs.promises.rm(target, { force: true });
      throw new Error("Envoi interrompu. Réessaie.");
    }
    const db = readDB();
    await removeOld(db.settings.studentTheme);
    db.settings.studentTheme = { stored, fileName: safeZipName(file.name), size: file.size, uploadedAt: new Date().toISOString() };
    writeDB(db);
    return { theme: db.settings.studentTheme };
  });
}

/** Retire le thème (les élèves ne voient plus de bouton de téléchargement). */
export async function DELETE(req: NextRequest) {
  return handle(async (): Promise<{ ok: true }> => {
    requireAdmin(readSession(req));
    const db = readDB();
    await removeOld(db.settings.studentTheme);
    delete db.settings.studentTheme;
    writeDB(db);
    return { ok: true };
  });
}
