import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
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

class TooBig extends Error {}

function storedName(original: string): { stored: string; error?: NextResponse } {
  const ext = path.extname(original).toLowerCase();
  if (!SAFE_EXT.has(ext)) {
    return {
      stored: "",
      error: NextResponse.json(
        { error: `Extension non autorisée (${ext || "aucune"}). Formats acceptés : vidéo, image, audio.` },
        { status: 415 },
      ),
    };
  }
  // Nom de stockage généré : on ne fait jamais confiance au nom d'origine
  // pour construire un chemin sur le disque.
  // .jfif et .jpe sont des JPEG : seule l'extension change. On la normalise,
  // sinon les services distants refusent le fichier sur son seul suffixe.
  return { stored: `${newId()}${JPEG_ALIASES[ext] ?? ext}` };
}

function respond(name: string, stored: string, size: number) {
  // Les modeles image de KIE vont chercher le fichier sur internet : ils ne
  // peuvent pas lire /api/media, servi en local. On renvoie donc aussi l'URL
  // du serveur medias expose, quand il est configure.
  const publicBase = process.env.MEDIA_PUBLIC_URL?.trim().replace(/\/+$/, "");
  return NextResponse.json({
    name,
    url: `/api/media/${stored}`,
    publicUrl: publicBase ? `${publicBase}/${stored}` : "",
    stored,
    size,
  });
}

/**
 * Deux facons d'envoyer un fichier :
 *
 *  - multipart/form-data (champ `file`) : l'historique, utilise par le Studio.
 *    Le fichier passe par la memoire, ce qui convient a des images.
 *  - corps brut avec `?name=` : pour les rushs video. Le flux est ecrit sur
 *    disque au fur et a mesure : un rush de 1 Go ne coute pas 1 Go de RAM
 *    au serveur, et l'envoi peut afficher sa progression cote navigateur.
 */
export async function POST(req: NextRequest) {
  await fs.mkdir(MEDIA_DIR, { recursive: true });
  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.startsWith("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Aucun fichier reçu" }, { status: 400 });
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Fichier trop lourd (2 Go max)." }, { status: 413 });
    }
    const { stored, error } = storedName(file.name);
    if (error) return error;
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(path.join(MEDIA_DIR, stored), buffer);
    return respond(file.name, stored, file.size);
  }

  const name = req.nextUrl.searchParams.get("name")?.trim() ?? "";
  if (!name) return NextResponse.json({ error: "Nom de fichier manquant (?name=)" }, { status: 400 });
  if (!req.body) return NextResponse.json({ error: "Aucun fichier reçu" }, { status: 400 });
  const { stored, error } = storedName(name);
  if (error) return error;

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) {
    return NextResponse.json({ error: "Fichier trop lourd (2 Go max)." }, { status: 413 });
  }

  const target = path.join(MEDIA_DIR, stored);
  let size = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      size += chunk.length;
      if (size > MAX_BYTES) cb(new TooBig());
      else cb(null, chunk);
    },
  });

  try {
    await pipeline(Readable.fromWeb(req.body as never), meter, createWriteStream(target));
  } catch (e) {
    await fs.rm(target, { force: true });
    if (e instanceof TooBig) return NextResponse.json({ error: "Fichier trop lourd (2 Go max)." }, { status: 413 });
    return NextResponse.json({ error: "Envoi interrompu." }, { status: 400 });
  }

  return respond(name, stored, size);
}
