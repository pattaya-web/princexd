import type { NextRequest } from "next/server";
import { readDB, withKieKey } from "@/lib/db";
import { KieError } from "@/lib/kie";
import { Forbidden, readSession } from "@/lib/sales/access";
import type { DB, Generation, Session, Student, StudioMember } from "@/lib/types";

/**
 * Studio IA par élève.
 *
 * Un élève à qui l'admin a ouvert le Studio y travaille avec sa propre clé
 * KIE (ses crédits) et ne voit que ses générations ; l'admin et le monteur
 * gardent le Studio commun (clé du compte, générations sans propriétaire).
 * Les fichiers de l'élève partent directement sur le stockage KIE avec sa
 * clé : rien n'est posé sur le disque du serveur.
 */
export interface StudioScope {
  session: Session;
  student: Student | null;
  /** Membre Studio IA (accès Studio seul), null sinon. */
  member: StudioMember | null;
  /** Vide pour l'admin et le monteur, l'id de l'élève ou du membre Studio sinon. */
  ownerId: string;
  /** Clé KIE à utiliser pour cette requête (vide = clé du compte). */
  key: string | null;
}

export function studioScope(req: NextRequest): StudioScope {
  const session = readSession(req);
  if (session.role === "student") {
    const student = readDB().students.find((s) => s.id === session.memberId);
    if (!student) throw new Forbidden("Accès refusé.");
    // Le Studio est ouvert à tout élève (choix de Mady, 2026-10-27) : seule sa clé KIE conditionne l'usage.
    const key = (student.kieApiKey ?? "").trim();
    if (!key) throw new KieError("Ajoute d'abord ta clé API KIE dans Scale X → Studio IA → Ma clé.", 401);
    return { session, student, member: null, ownerId: student.id, key };
  }
  // Membre Studio IA : même cloisonnement que l'élève, sur sa clé KIE.
  if (session.role === "studio") {
    const member = readDB().studioMembers.find((m) => m.id === session.memberId);
    if (!member) throw new Forbidden("Accès refusé.");
    const key = (member.kieApiKey ?? "").trim();
    if (!key) throw new KieError("Ajoute d'abord ta clé API KIE (bandeau « Ma clé KIE » en haut du Studio).", 401);
    return { session, student: null, member, ownerId: member.id, key };
  }
  if (session.isAdmin || session.role === "editor") return { session, student: null, member: null, ownerId: "", key: null };
  throw new Forbidden("Accès refusé.");
}

/** Exécute `fn` avec la clé KIE du demandeur (celle de l'élève, ou celle du compte). */
export function withScope<T>(scope: StudioScope, fn: () => Promise<T> | T): Promise<T> {
  return scope.key === null ? Promise.resolve(fn()) : withKieKey(scope.key, fn);
}

/** Les générations que ce demandeur a le droit de voir. */
export function ownGenerations(db: Pick<DB, "generations">, ownerId: string): Generation[] {
  return db.generations.filter((g) => (g.ownerId ?? "") === ownerId);
}

/** Clé de l'élève (ou du membre Studio) propriétaire d'une génération, pour la sonder chez KIE à sa place. */
export function keyForOwner(db: Pick<DB, "students" | "studioMembers">, ownerId: string | undefined): string | null {
  if (!ownerId) return null;
  const owner = db.students.find((s) => s.id === ownerId) ?? (db.studioMembers ?? []).find((m) => m.id === ownerId);
  return (owner?.kieApiKey ?? "").trim() || null;
}

/** Réponse HTTP d'une erreur de périmètre ou de clé, à utiliser dans les routes hors `handle()`. */
export function scopeError(e: unknown): { error: string; status: number } {
  if (e instanceof Forbidden) return { error: e.message, status: e.status };
  if (e instanceof KieError) return { error: e.message, status: e.code === 401 ? 401 : 502 };
  return { error: e instanceof Error ? e.message : "Erreur inattendue.", status: 400 };
}
