/**
 * Qui close, par defaut.
 *
 * Un seul siege iClosed, un seul closer : tant qu'aucun closer n'est recrute,
 * c'est le proprietaire lui-meme (son compte dans l'equipe, voir
 * `salesOwnerMemberId`). Toute creation de rendez-vous, d'issue ou de vente
 * sans closer explicite passe par ici, pour ne jamais produire un call
 * invisible du dashboard.
 */
import type { DB, TeamMember } from "../types";
import { memberRoles } from "./roles";

const active = (m: TeamMember) => m.status !== "inactif";
const isCloser = (m: TeamMember) => active(m) && memberRoles(m).includes("closer");

/** Closer par defaut : reglage iClosed, sinon mon compte, sinon le premier closer actif. Vide si aucun. */
export function defaultCloserId(db: DB): string {
  const s = db.settings;
  const def = db.team.find((m) => m.id === s.salesDefaultCloserId);
  if (def && isCloser(def)) return def.id;
  const me = db.team.find((m) => m.id === s.salesOwnerMemberId);
  if (me && isCloser(me)) return me.id;
  return db.team.find(isCloser)?.id ?? "";
}

/**
 * Bascule unique (2026-10-13) : Salim quitte l'equipe, je deviens le seul closer.
 *
 *  - Salim : acces coupe (compte inactif, identifiants effaces), roles retires.
 *    Sa fiche reste, pour que ses ventes passees, ses commissions et le journal
 *    continuent de porter son nom.
 *  - Mon compte dans l'equipe (cree s'il n'existe pas) : closer, closer par
 *    defaut et compte proprietaire. Plus personne d'autre n'a le role closer.
 *  - Tout ce qui n'est pas termine (rendez-vous a venir, relances en cours,
 *    leads sans vente) passe sous mon nom. Les ventes deja signees gardent
 *    leur closer : c'est de l'histoire, et des commissions.
 *
 * Renvoie un resume lisible, pour le journal.
 */
export function applySoloCloser(db: DB, newId: () => string, now: string): string[] {
  const out: string[] = [];
  const first = (m: TeamMember) => m.name.trim().toLowerCase().split(/\s+/)[0] ?? "";

  const gone = db.team.filter((m) => first(m) === "salim");
  const goneIds = new Set(gone.map((m) => m.id));

  let me = db.team.find((m) => first(m) === "mady") ?? db.team.find((m) => m.id === db.settings.salesOwnerMemberId && !goneIds.has(m.id));
  if (!me) {
    me = {
      id: newId(),
      name: "Mady (moi)",
      role: "closer",
      roles: ["closer"],
      status: "actif",
      commissionPct: 0,
      target: 0,
      contact: "",
      notes: "Mon compte dans l'équipe : closer par défaut tant qu'aucun closer n'est recruté.",
      createdAt: now,
      joinedAt: now,
    };
    db.team.unshift(me);
    out.push("Compte « Mady (moi) » créé dans l'équipe");
  }
  const myRoles = memberRoles(me);
  me.roles = myRoles.includes("closer") ? myRoles : [...myRoles, "closer"];
  if (me.role !== "setter" && me.role !== "closer") me.role = "closer";
  me.status = "actif";

  for (const m of db.team) {
    if (m.id === me.id) continue;
    if (goneIds.has(m.id)) {
      // Plus de role commercial : il disparait du CRM, des listes et des
      // selecteurs ; `memberRoles` retombe sur `role`, donc on le change aussi.
      m.status = "inactif";
      m.roles = [];
      m.role = "assistant";
      delete m.username;
      delete m.passwordHash;
      delete m.accessCode;
      m.notes = `${m.notes ? `${m.notes}\n` : ""}Retiré de l'équipe le ${now.slice(0, 10)} : accès coupé.`;
      out.push(`${m.name} retiré de l'équipe (accès coupé)`);
      continue;
    }
    const roles = memberRoles(m);
    if (roles.includes("closer")) {
      m.roles = roles.filter((r) => r !== "closer");
      if (m.role === "closer") m.role = m.roles.includes("setter") ? "setter" : m.role;
      out.push(`${m.name} n'est plus closer`);
    }
  }

  db.settings.salesDefaultCloserId = me.id;
  db.settings.salesOwnerMemberId = me.id;
  if (db.settings.salesDefaultSetterId && goneIds.has(db.settings.salesDefaultSetterId)) db.settings.salesDefaultSetterId = "";

  const open = new Set(["booked", "confirmed", "rescheduled"]);
  let appts = 0;
  for (const a of db.appointments) {
    if (a.closerId === me.id || !open.has(a.status)) continue;
    a.closerId = me.id;
    a.updatedAt = now;
    appts += 1;
  }
  const soldLeads = new Set(db.sales.filter((s) => s.status !== "cancelled").map((s) => s.leadId));
  let leads = 0;
  for (const l of db.leads) {
    if (l.closerId === me.id || !l.closerId || soldLeads.has(l.id)) continue;
    l.closerId = me.id;
    leads += 1;
  }
  let fus = 0;
  for (const f of db.followUps) {
    if (f.status !== "pending" || f.closerId === me.id) continue;
    f.closerId = me.id;
    fus += 1;
  }
  out.push(`Closer par défaut : ${me.name} · ${appts} rendez-vous à venir, ${leads} leads et ${fus} relances repris`);
  return out;
}

/**
 * Seconde bascule unique (2026-10-25) : Salim disparait de partout.
 *
 * La premiere bascule avait garde sa fiche et ses ventes signees a son nom.
 * Le proprietaire a tranche : ces closes sont les siens. Tout ce qui portait
 * l'identifiant de Salim (ventes, rendez-vous, leads, relances, eleves,
 * reglages, journal) passe sous le compte « Mady (moi) », et sa fiche est
 * retiree de l'equipe. Les resumes du journal gardent leur texte : c'est de
 * l'histoire, pas une attribution.
 *
 * Renvoie un resume lisible, pour le journal.
 */
export function purgeSalim(db: DB, now: string): string[] {
  const first = (m: TeamMember) => m.name.trim().toLowerCase().split(/\s+/)[0] ?? "";
  const gone = db.team.filter((m) => first(m) === "salim");
  if (!gone.length) return [];
  const goneIds = new Set(gone.map((m) => m.id));
  const me = db.team.find((m) => m.id === db.settings.salesOwnerMemberId && !goneIds.has(m.id)) ?? db.team.find((m) => first(m) === "mady" && !goneIds.has(m.id));
  if (!me) return [];

  /* Chaque reference a Salim, ou qu'elle soit, devient une reference a moi. */
  const counts = new Map<string, number>();
  const bump = (k: string) => counts.set(k, (counts.get(k) ?? 0) + 1);
  const walk = (node: unknown, where: string): unknown => {
    if (typeof node === "string") {
      if (goneIds.has(node)) {
        bump(where);
        return me.id;
      }
      return node;
    }
    if (Array.isArray(node)) return node.map((x) => walk(x, where));
    if (node && typeof node === "object") {
      const o = node as Record<string, unknown>;
      for (const k of Object.keys(o)) o[k] = walk(o[k], where);
      return o;
    }
    return node;
  };
  const dbo = db as unknown as Record<string, unknown>;
  for (const key of Object.keys(dbo)) {
    if (key === "team") continue;
    dbo[key] = walk(dbo[key], key);
  }
  // Le journal : l'acteur devient moi, le texte reste.
  for (const l of db.activityLogs) if (l.actorId === me.id && /^salim$/i.test(l.actorName ?? "")) l.actorName = me.name;
  for (const a of db.appointments) {
    for (const h of a.history ?? []) if (h.actorId === me.id && /^salim$/i.test(h.actorName ?? "")) h.actorName = me.name;
    if (a.closerId === me.id || a.setterId === me.id) a.updatedAt = now;
  }
  for (const s of db.sales) if (s.closerId === me.id || s.setterId === me.id) s.updatedAt = now;

  db.team = db.team.filter((m) => !goneIds.has(m.id));
  db.settings.salesDefaultCloserId = me.id;
  db.settings.salesOwnerMemberId = me.id;

  const sales = db.sales.filter((s) => s.closerId === me.id).length;
  const detail = [...counts.entries()].map(([k, n]) => `${k} ${n}`).join(", ");
  return [`${gone.map((m) => m.name).join(", ")} supprimé de l'équipe`, `tout passe sous ${me.name} (${detail || "aucune référence"}) · ${sales} ventes à mon nom`];
}
