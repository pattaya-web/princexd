/**
 * Rôles commerciaux d'un membre.
 *
 * Un membre peut être setter ET closer à la fois (Noa pose ses rendez-vous
 * et les close elle-même). `role` reste le rôle principal, conservé pour tout
 * ce qui existait avant ; `roles` porte la liste complète. Ces fonctions sont
 * pures et sans dépendance Node : elles servent côté serveur comme dans les
 * composants.
 */

export type CommercialRole = "setter" | "closer";

export const COMMERCIAL_ROLES: CommercialRole[] = ["setter", "closer"];

interface RoleBearer {
  role: string;
  roles?: CommercialRole[];
}

/** Liste des rôles commerciaux, en repli sur `role` pour les fiches anciennes. */
export function memberRoles(m: RoleBearer): CommercialRole[] {
  if (m.roles?.length) return m.roles;
  return m.role === "setter" || m.role === "closer" ? [m.role] : [];
}

export function hasRole(m: RoleBearer, role: CommercialRole): boolean {
  return memberRoles(m).includes(role);
}

export const isSetterMember = (m: RoleBearer) => hasRole(m, "setter");
export const isCloserMember = (m: RoleBearer) => hasRole(m, "closer");

/** Le membre touche-t-il une commission ? Seuls setters et closers. */
export function isCommercial(m: RoleBearer): boolean {
  return memberRoles(m).length > 0;
}

/**
 * Rôle principal d'une fiche : ce que voient les écrans qui n'affichent
 * qu'un seul badge. Setter passe avant closer, l'ordre de saisie compte.
 */
export function primaryRole(roles: CommercialRole[]): CommercialRole | null {
  if (roles.includes("setter")) return "setter";
  if (roles.includes("closer")) return "closer";
  return null;
}

/**
 * La session porte-t-elle ce rôle ?
 *
 * Tolère une session sans `roles` (jeton émis avant cette évolution) : on
 * retombe alors sur le rôle unique.
 */
export function sessionHas(session: { role: string; roles?: CommercialRole[] }, role: CommercialRole): boolean {
  if (session.roles?.length) return session.roles.includes(role);
  return session.role === role;
}

/** Nettoie une liste de rôles reçue du client : uniquement setter / closer, sans doublon. */
export function normalizeRoles(input: unknown): CommercialRole[] {
  if (!Array.isArray(input)) return [];
  const out: CommercialRole[] = [];
  for (const r of input) {
    if ((r === "setter" || r === "closer") && !out.includes(r)) out.push(r);
  }
  return out;
}

/** Libellé lisible d'une combinaison de rôles. */
export function rolesLabel(roles: CommercialRole[]): string {
  if (roles.includes("setter") && roles.includes("closer")) return "Setter + Closer";
  if (roles.includes("setter")) return "Setter";
  if (roles.includes("closer")) return "Closer";
  return "";
}
