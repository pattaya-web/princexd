import type { WorkspaceFile } from "@/lib/types";

/** Mon espace : ce qui sert aussi au navigateur (aucun accès disque ici). */

/** Extension sûre d'un nom de fichier (lettres et chiffres, 8 max), « bin » sinon. */
export function safeExt(name: string): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name.trim());
  return (m?.[1] ?? "bin").toLowerCase();
}

export function fileKind(f: Pick<WorkspaceFile, "mime" | "name">): "image" | "video" | "audio" | "pdf" | "other" {
  const mime = (f.mime ?? "").toLowerCase();
  const ext = safeExt(f.name);
  if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "webp", "gif", "jfif", "heic"].includes(ext)) return "image";
  if (mime.startsWith("video/") || ["mp4", "mov", "m4v", "webm", "mkv", "avi"].includes(ext)) return "video";
  if (mime.startsWith("audio/") || ["mp3", "wav", "m4a", "aac"].includes(ext)) return "audio";
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  return "other";
}
