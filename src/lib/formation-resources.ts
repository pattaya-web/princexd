/**
 * Annexes PDF de la formation, cote serveur : ou elles vivent sur le disque,
 * et les garde-fous sur les noms et le contenu.
 *
 * Les fichiers sont ranges dans `data/formation/` (le volume persistant du
 * VPS), sous un nom genere ; le nom d'origine n'est utilise que pour le
 * telechargement. Rien n'est servi sans session admin.
 */
import fs from "fs";
import path from "path";
import type { CourseResource } from "./types";

export const RESOURCES_DIR = path.join(process.cwd(), "data", "formation");
export const MAX_PDF_BYTES = 50 * 1024 * 1024;

/** Chemin complet d'un fichier stocke, ou null si le nom n'a pas le gabarit genere. */
export function resourcePath(stored: string): string | null {
  if (!/^[a-z0-9]{6,40}\.pdf$/.test(stored)) return null;
  const full = path.join(RESOURCES_DIR, stored);
  return full.startsWith(RESOURCES_DIR) ? full : null;
}

export function isPdf(head: Uint8Array): boolean {
  return head.length >= 5 && Buffer.from(head.subarray(0, 5)).toString("latin1") === "%PDF-";
}

/** Nom de fichier presentable : sans chemin, sans caracteres de controle, en .pdf. */
export function safeFileName(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() ?? "";
  const clean = base.replace(/[\u0000-\u001f"]/g, "").trim().slice(0, 150);
  const stem = clean.replace(/\.pdf$/i, "").trim() || "document";
  return `${stem}.pdf`;
}

/** Titre par defaut : le nom du fichier sans extension, tirets et soulignes rendus en espaces. */
export function titleFromFileName(fileName: string): string {
  return fileName.replace(/\.pdf$/i, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim() || "Document";
}

export function cleanTitle(raw: unknown, fallback: string): string {
  const t = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, 120) : "";
  return t || fallback;
}

export interface CourseResourceRow {
  id: string;
  title: string;
  fileName: string;
  size: number;
  createdAt: string;
  updatedAt: string;
  /** Visible dans l'espace Ressources des eleves. */
  studentVisible: boolean;
  /** Telechargement, nom d'origine restitue. */
  downloadUrl: string;
  /** Lecture dans le navigateur. */
  viewUrl: string;
}

export function toResourceRow(r: CourseResource): CourseResourceRow {
  return {
    id: r.id,
    title: r.title,
    fileName: r.fileName,
    size: r.size,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    studentVisible: r.studentVisible !== false,
    downloadUrl: `/api/formation/resources/${r.id}/file`,
    viewUrl: `/api/formation/resources/${r.id}/file?inline=1`,
  };
}

/** Supprime le fichier sur le disque ; un fichier deja absent n'est pas une erreur. */
export async function removeResourceFile(stored: string) {
  const full = resourcePath(stored);
  if (!full) return;
  await fs.promises.rm(full, { force: true });
}
