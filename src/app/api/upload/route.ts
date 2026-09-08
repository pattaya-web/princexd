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
  ".png", ".jpg", ".jpeg", ".webp", ".gif",
  ".mp3", ".wav", ".m4a", ".aac",
]);

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
  const stored = `${newId()}${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(path.join(MEDIA_DIR, stored), buffer);

  return NextResponse.json({
    name: file.name,
    url: `/api/media/${stored}`,
    size: file.size,
  });
}
