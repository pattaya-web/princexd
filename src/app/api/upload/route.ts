import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { newId } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

const MEDIA_DIR = path.join(process.cwd(), "data", "media");
const MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2 Go

const SAFE_EXT = new Set([
  ".mp4", ".mov", ".m4v", ".webm", ".avi", ".mkv",
  ".png", ".jpg", ".jpeg", ".jfif", ".jpe", ".webp", ".gif",
  ".mp3", ".wav", ".m4a", ".aac",
]);

/** Extensions qui designent un JPEG sans en porter le nom. */
const JPEG_ALIASES: Record<string, string> = { ".jfif": ".jpg", ".jpe": ".jpg" };

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Aucun fichier reçu" }, { status: 400 });
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Fichier trop lourd (2 Go max)." }, { status: 413 });
  }

  const ext = path.extname(file.name).toLowerCase();
  if (!SAFE_EXT.has(ext)) {
    return NextResponse.json(
      { error: `Extension non autorisée (${ext || "aucune"}). Formats acceptés : vidéo, image, audio.` },
      { status: 415 },
    );
  }

  await fs.mkdir(MEDIA_DIR, { recursive: true });
  // Nom de stockage généré : on ne fait jamais confiance au nom d'origine
  // pour construire un chemin sur le disque.
  // .jfif et .jpe sont des JPEG : seule l'extension change. On la normalise,
  // sinon les services distants refusent le fichier sur son seul suffixe.
  const stored = `${newId()}${JPEG_ALIASES[ext] ?? ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(path.join(MEDIA_DIR, stored), buffer);

  // Les modeles image de KIE vont chercher le fichier sur internet : ils ne
  // peuvent pas lire /api/media, servi en local. On renvoie donc aussi l'URL
  // du serveur medias expose, quand il est configure.
  const publicBase = process.env.MEDIA_PUBLIC_URL?.trim().replace(/\/+$/, "");

  return NextResponse.json({
    name: file.name,
    url: `/api/media/${stored}`,
    publicUrl: publicBase ? `${publicBase}/${stored}` : "",
    stored,
    size: file.size,
  });
}
