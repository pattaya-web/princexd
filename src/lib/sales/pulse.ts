import type { DB, Lead, TeamMember } from "../types";
import { leadIsOut } from "../types";
import { memberRoles } from "./roles";
import { takeoverState, TAKEOVER_WARN_BEFORE_MIN } from "./takeover";

/**
 * Le « pouls » d'un setter : les chiffres qu'on lui rappelle toutes les
 * heures sur Telegram. Memes regles que la liste « Leads a appeler », en
 * version compacte : ce qui est a faire maintenant, ce qui dort, ce qui
 * risque de lui etre repris.
 */
export interface SetterPulse {
  memberId: string;
  name: string;
  /** Rappels et relances arrivees a echeance, ou leads sans suite programmee. */
  due: number;
  /** Prospects joints, rendez-vous a fixer. */
  talking: number;
  /** Leads frais dans le pool commun (a personne). */
  pool: number;
  /** Mes leads actifs sans la moindre note. */
  noNotes: number;
  /** Mes conversations qui dorment : un autre setter pourra les reprendre bientot. */
  atRisk: { name: string; idleMin: number; inMin: number }[];
  /** Conversations des autres setters deja reprenables. */
  takeable: number;
}

const cold = (l: Lead) => l.source === "lp" || Boolean(l.systemeioId);
const inList = (l: Lead) => l.stage === "nouveau" || l.stage === "contacte" || l.stage === "conversation";

/** Leads avec un rendez-vous a venir (ou du jour) : hors liste. */
export function bookedLeadIds(db: DB, nowMs = Date.now()): Set<string> {
  const dayAgo = new Date(nowMs - 24 * 3600_000).toISOString();
  const out = new Set<string>();
  for (const a of db.appointments) {
    if (a.status !== "booked" && a.status !== "confirmed" && a.status !== "rescheduled") continue;
    if (a.scheduledAt < dayAgo) continue;
    out.add(a.leadId);
  }
  return out;
}

export function setterPulse(db: DB, member: TeamMember, nowMs = Date.now()): SetterPulse {
  const now = new Date(nowMs).toISOString();
  const booked = bookedLeadIds(db, nowMs);
  const active = db.leads.filter((l) => cold(l) && inList(l) && !leadIsOut(l.callStatus) && !booked.has(l.id));
  const mine = active.filter((l) => l.setterId === member.id);

  const isDue = (l: Lead) => {
    switch (l.callStatus) {
      case "callback":
        return Boolean(l.callbackAt && l.callbackAt <= now);
      case "reached":
        return false;
      case "no-answer":
      case "message-sent":
        return l.followUpAt ? l.followUpAt <= now : true;
      default:
        return (l.callAttempts ?? 0) > 0 || l.stage === "contacte";
    }
  };

  const atRisk: SetterPulse["atRisk"] = [];
  for (const l of mine) {
    const t = takeoverState(l, db.settings, false, nowMs);
    if (t.pending && t.inMin <= TAKEOVER_WARN_BEFORE_MIN) atRisk.push({ name: l.name, idleMin: t.idleMin, inMin: t.inMin });
    else if (t.eligible) atRisk.push({ name: l.name, idleMin: t.idleMin, inMin: 0 });
  }
  atRisk.sort((a, b) => a.inMin - b.inMin);

  const takeable = active.filter((l) => l.setterId && l.setterId !== member.id && takeoverState(l, db.settings, false, nowMs).eligible).length;

  return {
    memberId: member.id,
    name: member.name,
    due: mine.filter(isDue).length,
    talking: mine.filter((l) => l.callStatus === "reached" || (!l.callStatus && l.stage === "conversation")).length,
    pool: active.filter((l) => !l.setterId).length,
    noNotes: mine.filter((l) => !(l.notes ?? "").trim()).length,
    atRisk,
    takeable,
  };
}

/** Les setters actifs de l'equipe. */
export function activeSetters(db: DB): TeamMember[] {
  return db.team.filter((m) => m.status !== "inactif" && memberRoles(m).includes("setter"));
}
