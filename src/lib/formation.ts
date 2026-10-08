/**
 * Plateforme de formation : aides partagees entre le serveur et les pages.
 *
 * Pures et sans dependance Node, comme `sales/roles.ts` : elles servent dans
 * les routes API comme dans les composants.
 */
import type { CourseModule, CourseObjection, Student } from "./types";

/**
 * Identifiant d'une video YouTube, quel que soit le format du lien colle :
 * watch?v=, youtu.be/, shorts/, embed/, live/, ou l'identifiant seul.
 * Null si le lien n'est pas reconnu, ce qui bloque l'enregistrement.
 */
export function youtubeId(input: string): string | null {
  const s = (input ?? "").trim();
  if (!s) return null;
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
    const clean = (v: string | null | undefined) => (v && /^[\w-]{11}$/.test(v) ? v : null);
    if (host === "youtu.be") return clean(u.pathname.split("/")[1]);
    if (host === "youtube.com" || host === "youtube-nocookie.com") {
      const v = clean(u.searchParams.get("v"));
      if (v) return v;
      const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{11})/);
      if (m) return m[1];
    }
  } catch {
    // Pas une URL : on a deja teste l'identifiant seul.
  }
  return null;
}

/** Lecteur sans cookies de suivi, sans suggestions d'autres chaines a la fin. */
export const youtubeEmbedUrl = (id: string) => `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1`;

export const youtubeThumb = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

/** Tri par ordre de visionnage, les plus anciens d'abord a ordre egal. */
export function sortModules<T extends Pick<CourseModule, "order" | "createdAt">>(modules: T[]): T[] {
  return modules.slice().sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));
}

/** Objections nettoyees : une question non vide, une reponse eventuellement vide, sans doublon d'id. */
export function normalizeObjections(input: unknown, newId: () => string): CourseObjection[] {
  if (!Array.isArray(input)) return [];
  const out: CourseObjection[] = [];
  const seen = new Set<string>();
  for (const raw of input as Record<string, unknown>[]) {
    const question = typeof raw?.question === "string" ? raw.question.trim() : "";
    if (!question) continue;
    const answer = typeof raw?.answer === "string" ? raw.answer.trim() : "";
    let id = typeof raw?.id === "string" && raw.id ? raw.id : newId();
    if (seen.has(id)) id = newId();
    seen.add(id);
    out.push({ id, question, answer });
  }
  return out;
}

/**
 * Identifiant propose a un eleve : la partie locale de son email, sinon son
 * nom en minuscules sans accents. L'admin peut le changer avant d'enregistrer.
 */
export function suggestUsername(student: { name: string; email?: string }): string {
  const local = (student.email ?? "").split("@")[0]?.trim().toLowerCase();
  if (local && /^[a-z0-9._-]{3,}$/.test(local)) return local;
  return student.name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
}

/** Un module avec son identifiant YouTube deja extrait, pret pour le lecteur. */
export type CourseModuleRow = CourseModule & { youtubeId: string | null };

export const toRow = (m: CourseModule): CourseModuleRow => ({ ...m, youtubeId: youtubeId(m.youtubeUrl) });

/** Une ligne de la page « Accès élèves » : la fiche, sans rien de secret. */
export interface StudentAccessRow {
  id: string;
  name: string;
  email: string;
  handle: string;
  contractSigned: boolean;
  contractAt: string;
  username: string;
  /** Identifiant propose quand aucun n'est encore defini. */
  suggestedUsername: string;
  hasPassword: boolean;
  portalAccess: boolean;
  portalLastSeenAt: string;
  /** Modules publies marques « terminé ». */
  completed: number;
}

export function toAccessRow(s: Student, published: Set<string>): StudentAccessRow {
  return {
    id: s.id,
    name: s.name,
    email: s.email ?? "",
    handle: s.handle ?? "",
    contractSigned: Boolean(s.contractSigned),
    contractAt: s.contractAt ?? "",
    username: s.username ?? "",
    suggestedUsername: suggestUsername(s),
    hasPassword: Boolean(s.passwordHash),
    portalAccess: Boolean(s.portalAccess),
    portalLastSeenAt: s.portalLastSeenAt ?? "",
    completed: (s.completedModules ?? []).filter((id) => published.has(id)).length,
  };
}
