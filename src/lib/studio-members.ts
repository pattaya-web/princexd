import { randomInt } from "crypto";
import { readDB, withKieKey } from "@/lib/db";
import { getCredits } from "@/lib/kie";
import { normalizeUsername } from "@/lib/sales/access";
import type { StudioMember } from "@/lib/types";

/**
 * Membres Studio IA : accès au Studio seul, sur leur clé KIE.
 * Vue envoyée au navigateur : jamais le hash ni la clé en clair.
 */
export interface StudioMemberView {
  id: string;
  name: string;
  username: string;
  active: boolean;
  notes: string;
  createdAt: string;
  lastSeenAt: string;
  hasKey: boolean;
  /** Clé masquée (début et fin), vide sans clé. */
  keyMask: string;
  /** Nombre de générations (images, vidéos) et de jobs (Swap, Création) à son nom. */
  creations: number;
}

export const maskKey = (k: string) => (k ? `${k.slice(0, 6)}…${k.slice(-4)}` : "");

export function memberView(m: StudioMember): StudioMemberView {
  const db = readDB();
  const key = (m.kieApiKey ?? "").trim();
  const creations = db.generations.filter((g) => g.ownerId === m.id).length + db.studioJobs.filter((j) => j.ownerId === m.id).length;
  return {
    id: m.id,
    name: m.name,
    username: m.username,
    active: m.active,
    notes: m.notes ?? "",
    createdAt: m.createdAt,
    lastSeenAt: m.lastSeenAt ?? "",
    hasKey: Boolean(key),
    keyMask: maskKey(key),
    creations,
  };
}

/** Mot de passe lisible à dicter ou copier : sans 0/O ni 1/l, 10 caractères. */
export function generatePassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 10; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}

/** Identifiant libre ? Il ne doit ouvrir qu'un seul compte (élève, équipe, admin, VA, Studio). */
export function usernameTaken(username: string, exceptId = ""): boolean {
  const u = normalizeUsername(username);
  const db = readDB();
  return (
    db.studioMembers.some((m) => m.id !== exceptId && normalizeUsername(m.username) === u) ||
    db.students.some((s) => normalizeUsername(s.username ?? "") === u) ||
    db.team.some((m) => normalizeUsername(m.username ?? "") === u) ||
    normalizeUsername(db.settings.ownerUsername ?? "") === u ||
    normalizeUsername(db.settings.vaUsername ?? "") === u
  );
}

export function cleanUsername(raw: string): string {
  const u = normalizeUsername(raw).replace(/\s+/g, ".");
  if (!/^[a-z0-9._-]{3,40}$/.test(u)) throw new Error("Identifiant : 3 à 40 caractères, lettres, chiffres, point ou tiret.");
  return u;
}

/** Vérifie une clé KIE auprès de KIE et rend le solde, ou une erreur claire. */
export async function checkKieKey(key: string): Promise<number> {
  if (key.length < 10) throw new Error("Colle la clé API KIE complète (kie.ai → API Key).");
  try {
    return await withKieKey(key, () => getCredits());
  } catch (e) {
    throw new Error(`KIE refuse cette clé : ${(e as Error).message}. Vérifie-la sur kie.ai → API Key.`);
  }
}
