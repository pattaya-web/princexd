/**
 * Comptes rendus et indicateurs du Sales OS, calcules sur les vraies donnees.
 *
 * Chaque taux a un denominateur ecrit en clair (`hint`) : on ne melange pas
 * acquisition (leads), rendez-vous, ventes et encaissements. Pur.
 */
import type { DB, Lead, SalesTask } from "../../types";
import { isAttended } from "../constants";
import { netCash } from "../commissions";
import { paymentView } from "../installments";
import { SOURCE_CHANNEL_LABEL } from "../attribution";
import { cashMovements } from "../commissions";
import { addDays, dayOf, endOfDay, ms, startOfDay } from "./time";
import { leadIsFinal, noShowAt, rescheduledAfter, indexDb } from "./engine";

export interface ReportLine {
  key: string;
  label: string;
  value: number;
  /** Montant en devise (affiche avec le symbole). */
  money?: boolean;
}

/** Actions du journal qui valent « prospect contacte ». */
const CONTACT_ACTIONS = new Set(["lead.contacted", "lead.message", "lead.declared", "lead.status", "lead.takeover", "follow-up.updated", "task.done"]);

const inDays = (iso: string | undefined, from: number, to: number) => {
  const t = ms(iso);
  return Number.isFinite(t) && t >= from && t < to;
};

/** Chiffres d'une fenetre [from, to[ (ms). */
export function windowNumbers(db: DB, from: number, to: number, nowMs: number): ReportLine[] {
  const ix = indexDb(db);
  const leads = db.leads.filter((l) => !l.mock);
  const newLeads = leads.filter((l) => inDays(l.lastOptInAt && ms(l.lastOptInAt) > ms(l.createdAt) ? l.lastOptInAt : l.createdAt, from, to)).length;
  const contacted = new Set(db.activityLogs.filter((g) => CONTACT_ACTIONS.has(g.action) && inDays(g.at, from, to)).map((g) => g.entityId));
  // Une tache faite vaut contact pour son lead.
  for (const t of db.salesTasks ?? []) if (t.status === "done" && t.doneBy && inDays(t.doneAt, from, to) && t.kind !== "outcome-missing" && t.kind !== "payment-verify") contacted.add(t.leadId);
  const booked = db.appointments.filter((a) => inDays(a.createdAt, from, to)).length;
  const confirmed = db.appointments.filter((a) => a.confirmation === "confirmed" && inDays(a.confirmationAt, from, to)).length;
  const noShows = db.appointments.filter((a) => (a.history ?? []).some((h) => h.to === "no-show" && inDays(h.at, from, to))).length;
  const recovered = db.appointments.filter((a) => a.status === "no-show" && rescheduledAfter(a, ix) && inDays(rescheduledAfter(a, ix)!.createdAt, from, to)).length;
  const followupsDone = db.followUps.filter((f) => f.status === "done" && inDays(f.completedAt, from, to)).length;
  const sales = db.sales.filter((s) => s.status !== "cancelled" && inDays(s.soldAt, from, to));
  const cash = db.sales.flatMap(cashMovements).filter((m) => inDays(m.at, from, to)).reduce((a, m) => a + m.amount, 0);
  const today = dayOf(nowMs);
  const pending = db.sales.filter((s) => s.status !== "cancelled" && paymentView(s, today).remaining > 0).length;
  const urgent = (db.salesTasks ?? []).filter((t) => t.status === "open" && t.priority === 0 && ms(t.dueAt) < to).length;
  const tasks = (db.salesTasks ?? []).filter((t) => t.status === "done" && t.doneBy && inDays(t.doneAt, from, to));
  return [
    { key: "newLeads", label: "Nouveaux leads", value: newLeads },
    { key: "contacted", label: "Prospects contactés", value: contacted.size },
    { key: "booked", label: "Rendez-vous posés", value: booked },
    { key: "confirmed", label: "Appels confirmés", value: confirmed },
    { key: "noShows", label: "No-shows", value: noShows },
    { key: "recovered", label: "No-shows récupérés", value: recovered },
    { key: "followups", label: "Suivis après appel faits", value: followupsDone },
    { key: "tasksDone", label: "Tâches terminées", value: tasks.length },
    { key: "sales", label: "Ventes", value: sales.length },
    { key: "cash", label: "Encaissé", value: Math.round(cash), money: true },
    { key: "pendingPayments", label: "Paiements en attente", value: pending },
    { key: "urgentLeft", label: "Actions urgentes restantes", value: urgent },
  ];
}

export interface DailyReport {
  day: string;
  lines: ReportLine[];
  validated: { by: string; at: string; comment: string } | null;
}

export function dailyReport(db: DB, day: string, nowMs: number): DailyReport {
  const saved = (db.salesReports ?? []).find((r) => r.day === day);
  const lines = windowNumbers(db, startOfDay(day), endOfDay(day), nowMs);
  return { day, lines, validated: saved ? { by: saved.validatedByName, at: saved.validatedAt, comment: saved.comment } : null };
}

export interface WeeklyReport {
  from: string;
  to: string;
  lines: (ReportLine & { previous: number })[];
}

/** Les 7 derniers jours (aujourd'hui inclus) contre les 7 precedents. */
export function weeklyReport(db: DB, nowMs: number): WeeklyReport {
  const today = dayOf(nowMs);
  const from = addDays(today, -6);
  const cur = windowNumbers(db, startOfDay(from), endOfDay(today), nowMs);
  const prev = windowNumbers(db, startOfDay(addDays(from, -7)), startOfDay(from), nowMs);
  return { from, to: today, lines: cur.map((l) => ({ ...l, previous: prev.find((p) => p.key === l.key)?.value ?? 0 })) };
}

/* ------------------------------ Pilotage admin ----------------------------- */

export interface Rate {
  key: string;
  label: string;
  num: number;
  den: number;
  pct: number | null;
  hint: string;
}

export interface OpsKpis {
  range: { from: string; to: string; days: number };
  leads: { today: number; d7: number; d30: number; inRange: number; bySource: { label: string; count: number }[] };
  appointments: { booked: number; confirmed: number; held: number; noShows: number; recovered: number };
  sales: { count: number; cash: number; pendingCount: number; pendingAmount: number; pipelineValue: number; hotNotClosed: number };
  rates: Rate[];
  medianFirstResponseMin: number | null;
  team: { id: string; name: string; done: number; onTime: number; onTimePct: number | null; overdue: number; owned: number }[];
}

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

function arrivedAt(l: Lead) {
  return l.lastOptInAt && ms(l.lastOptInAt) > ms(l.createdAt) ? l.lastOptInAt : l.createdAt;
}

/**
 * Indicateurs strategiques sur `days` jours (aujourd'hui inclus). Chaque
 * cohorte est definie une fois : leads arrives sur la periode, calls PREVUS
 * sur la periode (passes), ventes conclues sur la periode, cash ENCAISSE sur
 * la periode.
 */
export function opsKpis(db: DB, nowMs: number, days = 30, filters: { source?: string; owner?: string } = {}): OpsKpis {
  const ix = indexDb(db);
  const today = dayOf(nowMs);
  const fromDay = addDays(today, -(days - 1));
  const from = startOfDay(fromDay);
  const to = endOfDay(today);
  const leadOk = (l: Lead | undefined) => Boolean(l) && !l!.mock && (!filters.source || (l!.sourceChannel ?? "UNKNOWN") === filters.source) && (!filters.owner || l!.ownerId === filters.owner);
  const leads = db.leads.filter(leadOk);
  const count = (d: number) => leads.filter((l) => ms(arrivedAt(l)) >= startOfDay(addDays(today, -(d - 1)))).length;
  const inRange = leads.filter((l) => inDays(arrivedAt(l), from, to));
  const bySourceMap = new Map<string, number>();
  for (const l of inRange) {
    const k = l.sourceChannel ? SOURCE_CHANNEL_LABEL[l.sourceChannel] : l.source === "lp" ? "Landing page" : "Inconnue";
    bySourceMap.set(k, (bySourceMap.get(k) ?? 0) + 1);
  }

  const apptOk = (leadId: string) => leadOk(ix.leadById.get(leadId));
  const booked = db.appointments.filter((a) => apptOk(a.leadId) && inDays(a.createdAt, from, to));
  const scheduledPast = db.appointments.filter((a) => apptOk(a.leadId) && a.status !== "cancelled" && inDays(a.scheduledAt, from, Math.min(to, nowMs)));
  const held = scheduledPast.filter((a) => isAttended(a.status));
  const noShows = scheduledPast.filter((a) => a.status === "no-show");
  const recovered = noShows.filter((a) => rescheduledAfter(a, ix));
  const confirmedOfScheduled = scheduledPast.filter((a) => a.confirmation === "confirmed");

  const sales = db.sales.filter((s) => s.status !== "cancelled" && apptOk(s.leadId) && inDays(s.soldAt, from, to));
  const cash = db.sales.filter((s) => apptOk(s.leadId)).flatMap(cashMovements).filter((m) => inDays(m.at, from, to)).reduce((a, m) => a + m.amount, 0);
  const open = db.sales.filter((s) => s.status !== "cancelled" && apptOk(s.leadId)).map((s) => paymentView(s, today)).filter((v) => v.remaining > 0);
  const price = db.settings.salesOffers?.[0]?.price || 3000;
  const upcoming = db.appointments.filter((a) => apptOk(a.leadId) && ["booked", "confirmed", "rescheduled"].includes(a.status) && ms(a.scheduledAt) > nowMs).length;
  const pendingFus = db.followUps.filter((f) => f.status === "pending" && apptOk(f.leadId));
  const hot = pendingFus.filter((f) => f.heat === "hot").length;
  const salesWithCash = sales.filter((s) => netCash(s) > 0).length;

  // Lead → RDV : leads arrives sur la periode qui ont au moins un rendez-vous.
  const leadsWithAppt = inRange.filter((l) => (ix.apptsByLead.get(l.id) ?? []).some((a) => a.status !== "cancelled")).length;
  // Premiere reponse : leads arrives sur la periode, contactes avant tout rendez-vous.
  const responses = inRange
    .filter((l) => l.firstContactAt)
    .map((l) => (ms(l.firstContactAt) - ms(arrivedAt(l))) / 60_000)
    .filter((n) => Number.isFinite(n) && n >= 0)
    .sort((a, b) => a - b);
  const median = responses.length ? Math.round(responses[Math.floor(responses.length / 2)]) : null;

  const rates: Rate[] = [
    { key: "lead-appt", label: "Lead → RDV", num: leadsWithAppt, den: inRange.length, pct: pct(leadsWithAppt, inRange.length), hint: "Leads arrivés sur la période ayant au moins un rendez-vous ÷ leads arrivés sur la période." },
    { key: "show", label: "RDV prévu → réalisé", num: held.length, den: held.length + noShows.length, pct: pct(held.length, held.length + noShows.length), hint: "Calls prévus sur la période (passés, hors annulés et hors calls sans résultat) qui ont eu lieu ÷ calls honorés + no-shows." },
    { key: "confirm", label: "RDV confirmés", num: confirmedOfScheduled.length, den: scheduledPast.length, pct: pct(confirmedOfScheduled.length, scheduledPast.length), hint: "Calls prévus sur la période confirmés explicitement par le prospect ÷ calls prévus sur la période." },
    { key: "recover", label: "No-show → reprogrammé", num: recovered.length, den: noShows.length, pct: pct(recovered.length, noShows.length), hint: "No-shows de la période ayant un nouveau rendez-vous ÷ no-shows de la période." },
    { key: "close", label: "Appel réalisé → vente", num: sales.length, den: held.length, pct: pct(sales.length, held.length), hint: "Ventes conclues sur la période ÷ calls réalisés sur la période (cohortes proches, pas identiques)." },
    { key: "cash", label: "Vente → encaissement", num: salesWithCash, den: sales.length, pct: pct(salesWithCash, sales.length), hint: "Ventes de la période avec au moins un encaissement ÷ ventes de la période." },
  ];

  // Execution de l'equipe : taches faites dans les delais (avant la fin du jour d'echeance).
  const names = new Map(db.team.map((m) => [m.id, m.name]));
  const doneInRange = (db.salesTasks ?? []).filter((t) => t.status === "done" && t.doneBy && inDays(t.doneAt, from, to));
  const byOwner = new Map<string, SalesTask[]>();
  for (const t of doneInRange) byOwner.set(t.ownerId, [...(byOwner.get(t.ownerId) ?? []), t]);
  const openTasks = (db.salesTasks ?? []).filter((t) => t.status === "open");
  const ownerIds = new Set([...byOwner.keys(), ...db.team.filter((m) => m.salesHead && m.status !== "inactif").map((m) => m.id)]);
  const team = [...ownerIds]
    .filter(Boolean)
    .map((id) => {
      const done = byOwner.get(id) ?? [];
      const onTime = done.filter((t) => ms(t.doneAt) < endOfDay(dayOf(t.dueAt))).length;
      return {
        id,
        name: names.get(id) ?? "—",
        done: done.length,
        onTime,
        onTimePct: pct(onTime, done.length),
        overdue: openTasks.filter((t) => t.ownerId === id && dayOf(t.dueAt) < today).length,
        owned: db.leads.filter((l) => l.ownerId === id && !leadIsFinal(l) && l.stage !== "closed-won").length,
      };
    });

  return {
    range: { from: fromDay, to: today, days },
    leads: { today: count(1), d7: count(7), d30: count(30), inRange: inRange.length, bySource: [...bySourceMap.entries()].map(([label, c]) => ({ label, count: c })).sort((a, b) => b.count - a.count) },
    appointments: { booked: booked.length, confirmed: confirmedOfScheduled.length, held: held.length, noShows: noShows.length, recovered: recovered.length },
    sales: {
      count: sales.length,
      cash: Math.round(cash),
      pendingCount: open.length,
      pendingAmount: Math.round(open.reduce((a, v) => a + v.remaining, 0)),
      pipelineValue: Math.round((upcoming + pendingFus.length) * price + open.reduce((a, v) => a + v.remaining, 0)),
      hotNotClosed: hot,
    },
    rates,
    medianFirstResponseMin: median,
    team,
  };
}

export { noShowAt };
