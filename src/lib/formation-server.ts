/**
 * Plateforme de formation, cote serveur : validation des modules et des
 * acces eleves. Separe de `formation.ts`, qui reste importable par les pages.
 */
import { newId, readDB } from "./db";
import { normalizeUsername } from "./sales/access";
import { required } from "./sales/http";
import { normalizeObjections, youtubeId } from "./formation";
import type { CourseModule } from "./types";

/** Lecture et validation des champs d'un module, a la creation comme a la modification. */
export function readModuleFields(
  raw: Record<string, unknown>,
  existing?: CourseModule,
): Omit<CourseModule, "id" | "order" | "createdAt" | "updatedAt"> {
  const title = required(raw.title ?? existing?.title, "Le titre");
  const youtubeUrl = typeof raw.youtubeUrl === "string" ? raw.youtubeUrl.trim() : (existing?.youtubeUrl ?? "");
  if (!youtubeId(youtubeUrl)) {
    throw new Error("Lien YouTube non reconnu. Colle le lien de la vidéo (youtube.com/watch?v=… ou youtu.be/…).");
  }
  return {
    title,
    summary: typeof raw.summary === "string" ? raw.summary.trim() : (existing?.summary ?? ""),
    youtubeUrl,
    annex: typeof raw.annex === "string" ? raw.annex.replace(/\r\n/g, "\n").trim() : (existing?.annex ?? ""),
    objections: raw.objections !== undefined ? normalizeObjections(raw.objections, newId) : (existing?.objections ?? []),
    published: typeof raw.published === "boolean" ? raw.published : (existing?.published ?? false),
  };
}

/**
 * Identifiant d'eleve valide et libre.
 *
 * Unique parmi les eleves ET l'equipe : la connexion teste l'equipe en
 * premier, un doublon rendrait l'eleve impossible a connecter.
 */
export function checkStudentUsername(username: string, studentId: string): string {
  const u = normalizeUsername(username);
  if (!u) throw new Error("L'identifiant est obligatoire.");
  if (!/^[a-z0-9._@-]{3,64}$/.test(u)) {
    throw new Error("Identifiant invalide : 3 caractères minimum, lettres, chiffres, point, tiret ou @.");
  }
  const db = readDB();
  if (db.students.some((s) => s.id !== studentId && normalizeUsername(s.username ?? "") === u)) {
    throw new Error("Cet identifiant est déjà pris par un autre élève.");
  }
  if (db.team.some((m) => normalizeUsername(m.username ?? "") === u)) {
    throw new Error("Cet identifiant est déjà utilisé par un membre de l'équipe.");
  }
  if (normalizeUsername(db.settings.vaUsername ?? "") === u || normalizeUsername(process.env.VA_USERNAME ?? "") === u) {
    throw new Error("Cet identifiant est celui de la VA outreach.");
  }
  return u;
}
