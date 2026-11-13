/**
 * Ce que voit le cockpit (« Mon espace de travail ») : la file de taches du
 * membre et les poles operationnels. Toutes les vues lisent les memes
 * donnees (leads, rendez-vous, relances, ventes, taches) : il n'y a qu'une
 * source de verite, les poles ne sont que des filtres.
 *
 * Pur : `db` et `nowMs` en parametres. Le cloisonnement est fait ici — un
 * setter ne recoit que ses lignes, le Head of Setting et l'admin tout.
 */
import type { Appointment, DB, Lead, Sale, SalesTask, Session, SettingStatus, TaskPriority } from "../../types";
import { FOLLOWUP_HEAT_LABEL } from "../../types";
import { isAttended } from "../constants";
import { paymentView } from "../installments";
import { saleForSetter, isSetterSession } from "../setter-view";
import { opsSettings, defaultOwnerId, TASK_KIND_LABEL } from "./config";
import { effectivePriority, indexDb, inScope, isOverdue, leadIsFinal, leadName, noShowAt, opsStart, PAYMENT_FOLLOW_LABEL, rescheduledAfter, sourceText, type OpsIndex } from "./engine";
import { addDays, DAY, dayOf, endOfDay, HOUR, ms, startOfDay } from "./time";

/* --------------------------------- Lignes --------------------------------- */

export interface ContactLinks {
  instagram: string;
  phone: string;
  email: string;
}

export interface TaskRow {
  id: string;
  kind: SalesTask["kind"];
  kindLabel: string;
  priority: TaskPriority;
  basePriority: TaskPriority;
  dueAt: string;
  overdue: boolean;
  title: string;
  context: string;
  leadId: string;
  leadName: string;
  initials: string;
  source: string;
  lastExchange: { at: string; text: string } | null;
  appointmentId: string;
  saleId: string;
  followUpId: string;
  ownerId: string;
  ownerName: string;
  updatedAt: string;
  snoozed: boolean;
  notes: { at: string; by: string; text: string }[];
  contact: ContactLinks;
  /** Se traite dans la fiche complete (statuer un call, encaisser, preciser un paiement), pas d'un clic. */
  sheetOnly: boolean;
}

export interface LeadRow {
  id: string;
  name: string;
  initials: string;
  source: string;
  createdAt: string;
  contact: ContactLinks;
  settingStatus: SettingStatus | "";
  settingLabel: string;
  ownerId: string;
  ownerName: string;
  setterName: string;
  lastContactAt: string;
  /** Delai de premiere reponse en minutes (null si pas encore contacte). */
  responseMin: number | null;
  next: { title: string; dueAt: string } | null;
  heat: string;
  tags: string[];
  nurtureUntil: string;
  nurtureReason: string;
  stage: string;
}

export interface ApptRow {
  id: string;
  leadId: string;
  name: string;
  initials: string;
  scheduledAt: string;
  timezone: string;
  source: string;
  ownerName: string;
  setterName: string;
  closerName: string;
  status: Appointment["status"];
  confirmation: string;
  confirmLabel: string;
  confirmTone: "good" | "warn" | "bad" | "info" | "muted";
  lastInteraction: { at: string; text: string } | null;
  next: { title: string; dueAt: string } | null;
  contact: ContactLinks;
  iclosedUrl: string;
}

export interface NoShowRow {
  id: string;
  leadId: string;
  name: string;
  initials: string;
  scheduledAt: string;
  state: string;
  stateLabel: string;
  attempts: number;
  rescheduledTo: string;
  soldAfter: boolean;
  next: { title: string; dueAt: string } | null;
  contact: ContactLinks;
  source: string;
}

export interface FollowRow {
  id: string;
  leadId: string;
  appointmentId: string;
  name: string;
  initials: string;
  dueAt: string;
  overdue: boolean;
  objection: string;
  advice: string;
  heat: string;
  notes: string;
  summary: string;
  lastExchange: string;
  price: number;
  step: number;
  ownerName: string;
  closerName: string;
  contact: ContactLinks;
}

export interface PaymentRow {
  saleId: string;
  leadId: string;
  name: string;
  initials: string;
  offer: string;
  contractValue: number;
  cashCollected: number;
  remaining: number;
  stateLabel: string;
  tone: "good" | "warn" | "bad" | "info" | "muted";
  follow: string;
  followNote: string;
  expectedAt: string;
  lastReminderAt: string;
  next: { title: string; dueAt: string } | null;
  ownerName: string;
  closerName: string;
  contact: ContactLinks;
}

export interface AnomalyRow {
  leadId: string;
  name: string;
  reason: string;
  since: string;
  ownerName: string;
}

export interface WorkspaceKpis {
  newLeads: number;
  conversations: number;
  toConfirm: number;
  apptsToday: number;
  noShows: number;
  followupsToday: number;
  payments: number;
  overdue: number;
}

export interface OwnerLoad {
  id: string;
  name: string;
  open: number;
  dueToday: number;
  overdue: number;
  doneToday: number;
}

export interface WorkspacePayload {
  now: string;
  today: string;
  me: { id: string; name: string; isHead: boolean; isAdmin: boolean };
  /** Membre dont on regarde la file (« all » = toute l'equipe). */
  viewing: string;
  owners: OwnerLoad[];
  kpis: WorkspaceKpis;
  tasks: TaskRow[];
  upcoming: TaskRow[];
  doneToday: number;
  poles: {
    newLeads: LeadRow[];
    conversations: LeadRow[];
    appointments: ApptRow[];
    noShows: NoShowRow[];
    noShowStats: { total: number; recovered: number; sold: number; rate: number };
    followups: FollowRow[];
    payments: PaymentRow[];
    nurturing: LeadRow[];
    reactivation: LeadRow[];
    anomalies: AnomalyRow[];
  };
  objections: { key: string; label: string; followUpDays: number; askDate: boolean }[];
  currency: string;
  members: { id: string; name: string }[];
}

export const SETTING_LABEL: Record<SettingStatus, string> = {
  "to-contact": "À contacter",
  contacted: "Premier contact fait",
  conversation: "En conversation",
  "awaiting-reply": "En attente de réponse",
  qualified: "Qualifié",
  "not-qualified": "Non qualifié",
  proposed: "Rendez-vous proposé",
  nurturing: "Nurturing",
  lost: "Perdu",
  dnc: "Ne plus contacter",
};

const NOSHOW_LABEL: Record<string, string> = {
  "to-recover": "À récupérer",
  contacted: "Relance effectuée",
  awaiting: "En attente de réponse",
  rescheduled: "Reprogrammé",
  lost: "Perdu",
  dnc: "Ne plus contacter",
};

export const initials = (name: string) =>
  name
    .replace(/^@/, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "?";

export const contactOf = (l: Lead): ContactLinks => ({
  instagram: l.igUsername ? `https://ig.me/m/${encodeURIComponent(l.igUsername)}` : "",
  phone: l.phone ?? "",
  email: l.email ?? "",
});

/** Etat de confirmation d'un rendez-vous, tel que l'equipe doit le lire. */
export function confirmationView(a: Appointment, nowMs: number): { label: string; tone: ApptRow["confirmTone"] } {
  const at = ms(a.scheduledAt);
  if (a.status === "cancelled") return { label: "Annulé", tone: "muted" };
  if (a.status === "no-show") return { label: "No-show", tone: "bad" };
  if (isAttended(a.status)) return { label: "Terminé", tone: "good" };
  if (at < nowMs) return { label: "Call passé · résultat à renseigner", tone: "warn" };
  if (a.confirmation === "confirmed" || a.status === "confirmed") return { label: "Confirmé par le prospect", tone: "good" };
  if (a.confirmation === "awaiting") return { label: "Confirmation envoyée · pas encore de réponse", tone: "info" };
  if (a.confirmation === "no-answer") return { label: "Sans réponse", tone: "bad" };
  if (at - nowMs < 48 * HOUR) return { label: "Confirmation à faire", tone: "warn" };
  return { label: a.status === "rescheduled" ? "Reprogrammé" : "Réservé", tone: "info" };
}

/* ------------------------------ Construction ------------------------------ */

/**
 * Derniere interaction connue par entite (lead, rendez-vous, relance), en un
 * passage sur le journal (deja trie du plus recent au plus ancien).
 */
const NOT_EXCHANGES = new Set(["lead.assigned", "lead.transferred", "task.snoozed", "report.validated", "lead.updated"]);

function lastLogIndex(db: DB): Map<string, { at: string; summary: string }> {
  const out = new Map<string, { at: string; summary: string }>();
  // L'attribution automatique et les reports de tache ne sont pas des echanges avec le prospect.
  for (const l of db.activityLogs) if (!out.has(l.entityId) && !NOT_EXCHANGES.has(l.action)) out.set(l.entityId, { at: l.at, summary: l.summary });
  return out;
}

export function buildWorkspace(db: DB, session: Session, nowMs: number, viewing = ""): WorkspacePayload {
  const cfg = opsSettings(db);
  const ix = indexDb(db);
  const names = new Map(db.team.map((m) => [m.id, m.name]));
  const nameOf = (id?: string) => (id ? (names.get(id) ?? "—") : "Admin");
  const isManager = session.isAdmin || Boolean(session.salesHead);
  const adminIds = new Set(["", db.settings.salesOwnerMemberId ?? ""]);
  const today = dayOf(nowMs);
  const endToday = endOfDay(today);
  const start = opsStart(cfg, nowMs);
  const logs = lastLogIndex(db);
  const realAmounts = !isSetterSession(session);
  const currency = db.settings.salesCurrency || "EUR";

  // Qui regarde quoi : un setter, sa file ; le Head of Setting, la sienne par defaut ; l'admin, toute l'equipe.
  let who = session.isAdmin ? "all" : session.memberId;
  if (isManager && viewing) who = viewing;
  const ownsTask = (t: SalesTask) => (who === "all" ? true : who === "admin" ? adminIds.has(t.ownerId) : t.ownerId === who);
  const seesLead = (l: Lead) => isManager || l.ownerId === session.memberId || l.setterId === session.memberId;

  const tasksByLead = new Map<string, SalesTask[]>();
  for (const t of db.salesTasks ?? []) if (t.status === "open") tasksByLead.set(t.leadId, [...(tasksByLead.get(t.leadId) ?? []), t]);
  const nextOf = (leadId: string) => {
    const t = (tasksByLead.get(leadId) ?? []).sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0];
    return t ? { title: t.title, dueAt: t.dueAt } : null;
  };
  const lastExchangeOf = (lead: Lead): { at: string; text: string } | null => {
    const ids = [lead.id, ...(ix.apptsByLead.get(lead.id) ?? []).map((a) => a.id), ...(ix.fusByLead.get(lead.id) ?? []).map((f) => f.id)];
    let best: { at: string; text: string } | null = null;
    for (const id of ids) {
      const l = logs.get(id);
      if (l && (!best || l.at > best.at)) best = { at: l.at, text: l.summary };
    }
    if (lead.lastContactAt && (!best || lead.lastContactAt > best.at)) best = { at: lead.lastContactAt, text: "Contact effectué" };
    return best;
  };

  const money = (n: number) => `${Math.round(n).toLocaleString("fr-FR")} ${currency === "EUR" ? "€" : currency}`;
  const maskedPaymentContext = (saleId?: string) => {
    const raw = db.sales.find((x) => x.id === saleId);
    if (!raw) return "Paiement à suivre.";
    const s = saleForSetter(raw);
    const rest = Math.max(0, s.contractValue - s.cashCollected);
    const f = raw.paymentFollow;
    return `${raw.offer || "Accompagnement"} : ${money(s.contractValue)} convenus, reste ${money(rest)}.${raw.paymentExpectedAt ? ` Attendu le ${raw.paymentExpectedAt.split("-").reverse().join("/")}.` : ""}${f ? ` Suivi : ${PAYMENT_FOLLOW_LABEL[f.state]}${f.promisedFor ? ` pour le ${f.promisedFor.split("-").reverse().join("/")}` : ""}${f.note ? ` (${f.note})` : ""}.` : ""}`;
  };

  /* --- File de taches --- */
  const toRow = (t: SalesTask): TaskRow => {
    const lead = ix.leadById.get(t.leadId);
    const nm = lead ? leadName(lead) : t.title;
    return {
      id: t.id,
      kind: t.kind,
      kindLabel: TASK_KIND_LABEL[t.kind],
      priority: effectivePriority(t, nowMs),
      basePriority: t.priority,
      dueAt: t.dueAt,
      overdue: isOverdue(t, nowMs),
      title: t.title,
      // Montants annonces seulement : le contexte stocke porte les vrais montants.
      context: !realAmounts && (t.kind === "payment" || t.kind === "payment-verify") ? maskedPaymentContext(t.saleId) : t.context,
      leadId: t.leadId,
      leadName: nm,
      initials: initials(nm),
      source: lead ? sourceText(lead, db) : "",
      lastExchange: lead ? lastExchangeOf(lead) : null,
      appointmentId: t.appointmentId ?? "",
      saleId: t.saleId ?? "",
      followUpId: t.followUpId ?? "",
      ownerId: t.ownerId,
      ownerName: nameOf(t.ownerId),
      updatedAt: t.updatedAt,
      snoozed: Boolean(t.snoozed),
      notes: t.notes ?? [],
      contact: lead ? contactOf(lead) : { instagram: "", phone: "", email: "" },
      sheetOnly: t.kind === "outcome-missing" || t.kind === "payment-verify" || (t.kind === "payment" && Boolean(db.sales.find((s) => s.id === t.saleId)?.paymentUnspecified)),
    };
  };
  const open = (db.salesTasks ?? []).filter((t) => t.status === "open" && ownsTask(t));
  const due = open.filter((t) => ms(t.dueAt) < endToday);
  const tasks = due.map(toRow).sort((a, b) => a.priority - b.priority || a.dueAt.localeCompare(b.dueAt));
  const upcoming = open
    .filter((t) => ms(t.dueAt) >= endToday)
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
    .slice(0, 20)
    .map(toRow);
  const doneToday = (db.salesTasks ?? []).filter((t) => t.status === "done" && t.doneBy && ownsTask(t) && dayOf(t.doneAt ?? "") === today).length;

  /* --- Charge par membre (Head of Setting et admin) --- */
  const owners: OwnerLoad[] = [];
  if (isManager) {
    const ids = new Set((db.salesTasks ?? []).filter((t) => t.status === "open" || dayOf(t.doneAt ?? "") === today).map((t) => t.ownerId));
    for (const m of db.team) if (m.status !== "inactif" && (m.salesHead || m.roles?.includes("setter") || m.role === "setter")) ids.add(m.id);
    for (const id of ids) {
      const mine = (db.salesTasks ?? []).filter((t) => t.ownerId === id);
      const op = mine.filter((t) => t.status === "open");
      owners.push({
        id: id || "admin",
        name: adminIds.has(id) ? "Admin (Mady)" : nameOf(id),
        open: op.length,
        dueToday: op.filter((t) => ms(t.dueAt) < endToday).length,
        overdue: op.filter((t) => isOverdue(t, nowMs)).length,
        doneToday: mine.filter((t) => t.status === "done" && t.doneBy && dayOf(t.doneAt ?? "") === today).length,
      });
    }
    owners.sort((a, b) => b.open - a.open);
  }

  /* --- Poles --- */
  const visibleLeads = db.leads.filter((l) => !l.mock && seesLead(l) && (who === "all" || who === "admin" || !isManager || l.ownerId === who || l.setterId === who));
  const leadRow = (l: Lead): LeadRow => {
    const nm = leadName(l);
    const first = ms(l.firstContactAt);
    const arrived = ms(l.lastOptInAt || l.optInAt || l.createdAt);
    return {
      id: l.id,
      name: nm,
      initials: initials(nm),
      source: sourceText(l, db),
      createdAt: l.lastOptInAt || l.optInAt || l.createdAt,
      contact: contactOf(l),
      settingStatus: l.settingStatus ?? "",
      settingLabel: l.settingStatus ? SETTING_LABEL[l.settingStatus] : "À contacter",
      ownerId: l.ownerId ?? "",
      ownerName: l.ownerId ? nameOf(l.ownerId) : "Non attribué",
      setterName: l.setterId ? nameOf(l.setterId) : "",
      lastContactAt: l.lastContactAt ?? "",
      responseMin: Number.isFinite(first) && Number.isFinite(arrived) ? Math.max(0, Math.round((first - arrived) / 60_000)) : null,
      next: nextOf(l.id),
      heat: l.heat ? FOLLOWUP_HEAT_LABEL[l.heat] : "",
      tags: l.tags ?? [],
      nurtureUntil: l.nurtureUntil ?? "",
      nurtureReason: l.nurtureReason ?? "",
      stage: l.stage,
    };
  };
  const hasLiveAppt = (l: Lead) => (ix.apptsByLead.get(l.id) ?? []).some((a) => ["booked", "confirmed", "rescheduled"].includes(a.status) && ms(a.scheduledAt) > nowMs - 2 * HOUR);
  const anyAppt = (l: Lead) => (ix.apptsByLead.get(l.id) ?? []).some((a) => a.status !== "cancelled");

  const newLeads = visibleLeads
    .filter((l) => !leadIsFinal(l) && l.stage !== "closed-won" && inScope(l, ix, start, today) && !anyAppt(l) && (ms(l.lastOptInAt || l.createdAt) > nowMs - 7 * DAY || !l.lastContactAt) && (!l.settingStatus || l.settingStatus === "to-contact" || ms(l.lastOptInAt || l.createdAt) > nowMs - 2 * DAY))
    .sort((a, b) => (b.lastOptInAt || b.createdAt).localeCompare(a.lastOptInAt || a.createdAt))
    .slice(0, 200)
    .map(leadRow);

  const CONV: SettingStatus[] = ["contacted", "conversation", "awaiting-reply", "qualified", "proposed"];
  const conversations = visibleLeads
    .filter((l) => l.settingStatus && CONV.includes(l.settingStatus) && !leadIsFinal(l) && !hasLiveAppt(l) && l.stage !== "closed-won")
    .sort((a, b) => (b.lastContactAt ?? "").localeCompare(a.lastContactAt ?? ""))
    .slice(0, 200)
    .map(leadRow);

  const apptRow = (a: Appointment): ApptRow => {
    const l = ix.leadById.get(a.leadId)!;
    const nm = leadName(l);
    const c = confirmationView(a, nowMs);
    const last = logs.get(a.id);
    return {
      id: a.id,
      leadId: l.id,
      name: nm,
      initials: initials(nm),
      scheduledAt: a.scheduledAt,
      timezone: l.timezone || a.timezone || "Europe/Paris",
      source: sourceText(l, db),
      ownerName: l.ownerId ? nameOf(l.ownerId) : "Non attribué",
      setterName: a.setterId ? nameOf(a.setterId) : "",
      closerName: a.closerId ? nameOf(a.closerId) : "",
      status: a.status,
      confirmation: a.confirmation ?? "",
      confirmLabel: c.label,
      confirmTone: c.tone,
      lastInteraction: last ? { at: last.at, text: last.summary } : null,
      next: nextOf(l.id),
      contact: contactOf(l),
      iclosedUrl: a.iclosedUrl,
    };
  };
  const visibleLeadIds = new Set(visibleLeads.map((l) => l.id));
  const appointments = db.appointments
    .filter((a) => visibleLeadIds.has(a.leadId) && a.status !== "cancelled")
    .filter((a) => {
      const at = ms(a.scheduledAt);
      const live = ["booked", "confirmed", "rescheduled"].includes(a.status);
      return (at >= startOfDay(today) && at < nowMs + 14 * DAY) || (live && at < nowMs && dayOf(at) >= start);
    })
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
    .map(apptRow);

  const noShowAppts = db.appointments.filter((a) => a.status === "no-show" && visibleLeadIds.has(a.leadId) && dayOf(a.scheduledAt) >= addDays(start, -30));
  const noShows: NoShowRow[] = noShowAppts
    .map((a) => {
      const l = ix.leadById.get(a.leadId)!;
      const nm = leadName(l);
      const later = rescheduledAfter(a, ix);
      const state = later ? "rescheduled" : l.doNotContact ? "dnc" : (a.noShow?.state ?? "to-recover");
      const soldAfter = (ix.salesByLead.get(l.id) ?? []).some((s) => s.status !== "cancelled" && ms(s.soldAt) > noShowAt(a));
      return {
        id: a.id,
        leadId: l.id,
        name: nm,
        initials: initials(nm),
        scheduledAt: a.scheduledAt,
        state,
        stateLabel: NOSHOW_LABEL[state] ?? state,
        attempts: a.noShow?.attempts ?? 0,
        rescheduledTo: later?.scheduledAt ?? "",
        soldAfter,
        next: nextOf(l.id),
        contact: contactOf(l),
        source: sourceText(l, db),
      };
    })
    .sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt));
  const recovered = noShows.filter((n) => n.state === "rescheduled").length;
  const noShowStats = { total: noShows.length, recovered, sold: noShows.filter((n) => n.soldAfter).length, rate: noShows.length ? Math.round((recovered / noShows.length) * 100) : 0 };

  const objections = new Map(cfg.objections.map((o) => [o.key, o]));
  const defaultPrice = db.settings.salesOffers?.[0]?.price ?? 0;
  const followups: FollowRow[] = db.followUps
    .filter((f) => f.status === "pending" && visibleLeadIds.has(f.leadId))
    .map((f) => {
      const l = ix.leadById.get(f.leadId)!;
      const nm = leadName(l);
      const appt = db.appointments.find((a) => a.id === f.appointmentId);
      const obj = f.objection ? objections.get(f.objection) : undefined;
      const lastMsg = [...(f.log ?? [])].reverse().find((e) => e.kind === "contact" || e.kind === "note");
      const sale = (ix.salesByLead.get(l.id) ?? []).find((s) => s.status !== "cancelled");
      return {
        id: f.id,
        leadId: l.id,
        appointmentId: f.appointmentId,
        name: nm,
        initials: initials(nm),
        dueAt: f.dueAt,
        overdue: dayOf(f.dueAt) < today,
        objection: obj?.label ?? (appt?.recap?.notClosedReason || appt?.lostReason || ""),
        advice: obj?.advice ?? "",
        heat: f.heat ? `${FOLLOWUP_HEAT_LABEL[f.heat]}` : "",
        notes: f.notes,
        summary: [appt?.recap?.leadInfo, appt?.fathomSummary ? appt.fathomSummary.slice(0, 400) : "", appt?.closerNotes].filter(Boolean).join("\n").slice(0, 700),
        lastExchange: lastMsg ? lastMsg.note : "",
        price: sale ? (realAmounts ? sale.contractValue : saleForSetter(sale).contractValue) : defaultPrice,
        step: f.step ?? 0,
        ownerName: f.ownerId ? nameOf(f.ownerId) : l.ownerId ? nameOf(l.ownerId) : "—",
        closerName: f.closerId ? nameOf(f.closerId) : "",
        contact: contactOf(l),
      };
    })
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));

  const payments: PaymentRow[] = db.sales
    .filter((s) => s.status !== "cancelled" && visibleLeadIds.has(s.leadId))
    .map((raw) => ({ raw, s: realAmounts ? raw : saleForSetter(raw) }))
    .filter(({ raw }) => paymentView(raw, today).remaining > 0 || (raw.paymentFollow && raw.paymentFollow.state !== "abandoned" && paymentView(raw, today).remaining > 0))
    .map(({ raw, s }) => {
      const l = ix.leadById.get(raw.leadId)!;
      const nm = leadName(l);
      const v = paymentView(raw, today);
      const shown = realAmounts ? v : { ...v, contractValue: s.contractValue, cashCollected: s.cashCollected, remaining: Math.max(0, s.contractValue - s.cashCollected) };
      const st = paymentStatus(raw, v);
      return {
        saleId: raw.id,
        leadId: l.id,
        name: nm,
        initials: initials(nm),
        offer: raw.offer,
        contractValue: shown.contractValue,
        cashCollected: shown.cashCollected,
        remaining: shown.remaining,
        stateLabel: st.label,
        tone: st.tone,
        follow: raw.paymentFollow?.state ?? "",
        followNote: raw.paymentFollow?.note ?? "",
        expectedAt: v.nextDueAt || raw.paymentExpectedAt || "",
        lastReminderAt: raw.paymentFollow?.lastReminderAt ?? "",
        next: nextOf(l.id),
        ownerName: l.ownerId ? nameOf(l.ownerId) : "—",
        closerName: raw.closerId ? nameOf(raw.closerId) : "",
        contact: contactOf(l),
      };
    })
    .sort((a, b) => (a.expectedAt || "9").localeCompare(b.expectedAt || "9"));

  const nurturing = visibleLeads
    .filter((l) => l.settingStatus === "nurturing" && !l.doNotContact)
    .sort((a, b) => (a.nurtureUntil ?? "").localeCompare(b.nurtureUntil ?? ""))
    .map(leadRow);

  // Anciens prospects hors perimetre : a reactiver plutot que de generer de nouveaux leads.
  const reactivation = isManager
    ? db.leads
        .filter((l) => !l.mock && !leadIsFinal(l) && l.stage !== "closed-won" && !inScope(l, ix, start, today) && (l.phone || l.igUsername))
        .sort((a, b) => (b.lastOptInAt || b.createdAt).localeCompare(a.lastOptInAt || a.createdAt))
        .slice(0, 150)
        .map(leadRow)
    : [];

  const anomalies = computeAnomalies(db, nowMs, ix, cfg.staleDays, cfg.anomalyWindowDays).filter((a) => visibleLeadIds.has(a.leadId)).map((a) => ({ ...a, ownerName: a.ownerName }));

  /* --- Indicateurs du haut --- */
  const dueKind = (kinds: SalesTask["kind"][], untilEndOfDay = true) => open.filter((t) => kinds.includes(t.kind) && (!untilEndOfDay || ms(t.dueAt) < endToday)).length;
  const apptsToday = appointments.filter((a) => dayOf(a.scheduledAt) === today).length;
  const toConfirm = appointments.filter((a) => ["booked", "rescheduled"].includes(a.status) && a.confirmation !== "confirmed" && ms(a.scheduledAt) > nowMs && ms(a.scheduledAt) < nowMs + 48 * HOUR).length;
  const kpis: WorkspaceKpis = {
    newLeads: dueKind(["first-contact"]),
    conversations: dueKind(["setting-nudge", "planned", "callback", "nurture", "admin-task"]),
    toConfirm,
    apptsToday,
    noShows: dueKind(["no-show"], false),
    followupsToday: dueKind(["followup"]),
    payments: dueKind(["payment", "payment-verify"], false),
    overdue: open.filter((t) => isOverdue(t, nowMs)).length,
  };

  return {
    now: new Date(nowMs).toISOString(),
    today,
    me: { id: session.memberId, name: session.memberName, isHead: Boolean(session.salesHead), isAdmin: session.isAdmin },
    viewing: who,
    owners,
    kpis,
    tasks,
    upcoming,
    doneToday,
    poles: { newLeads, conversations, appointments, noShows, noShowStats, followups, payments, nurturing, reactivation, anomalies },
    objections: cfg.objections.map((o) => ({ key: o.key, label: o.label, followUpDays: o.followUpDays, askDate: Boolean(o.askDate) })),
    currency,
    members: db.team.filter((m) => m.status !== "inactif" && (m.salesHead || (m.roles ?? []).length > 0 || m.role === "setter" || m.role === "closer")).map((m) => ({ id: m.id, name: m.name })),
  };
}

/** Statut de paiement lisible (pole Paiements). Un « j'ai payé » n'est jamais un encaissement. */
export function paymentStatus(s: Sale, v: ReturnType<typeof paymentView>): { label: string; tone: PaymentRow["tone"] } {
  if (s.status === "refunded") return { label: "Remboursé", tone: "muted" };
  if (v.remaining <= 0) return { label: "Paiement confirmé", tone: "good" };
  const f = s.paymentFollow?.state;
  if (f === "failed") return { label: "Paiement échoué", tone: "bad" };
  if (f === "awaiting-verification") return { label: "En attente de vérification", tone: "warn" };
  if (f === "abandoned") return { label: "Paiement abandonné", tone: "muted" };
  if (v.state === "overdue") return { label: "En retard", tone: "bad" };
  if (v.cashCollected > 0) return { label: `Paiement partiel${f === "link-sent" ? " · lien envoyé" : ""}`, tone: "warn" };
  if (f === "link-sent") return { label: "Lien de paiement envoyé", tone: "info" };
  return { label: f === "promised" ? "Paiement promis" : "Paiement promis (à la signature)", tone: "info" };
}

/* -------------------------------- Anomalies ------------------------------- */

/**
 * Leads actifs mal suivis : sans responsable, sans prochaine action, sans
 * activite depuis trop longtemps, call passe sans resultat. Limite aux leads
 * du perimetre touches dans la fenetre reglee, pour que la liste reste
 * actionnable.
 */
export function computeAnomalies(db: DB, nowMs: number, ix: OpsIndex = indexDb(db), staleDays = 5, windowDays = 30): AnomalyRow[] {
  const cfg = opsSettings(db);
  const start = opsStart(cfg, nowMs);
  const today = dayOf(nowMs);
  const names = new Map(db.team.map((m) => [m.id, m.name]));
  const head = defaultOwnerId(db, cfg);
  const openByLead = new Map<string, SalesTask[]>();
  for (const t of db.salesTasks ?? []) if (t.status === "open") openByLead.set(t.leadId, [...(openByLead.get(t.leadId) ?? []), t]);
  const out: AnomalyRow[] = [];
  const windowStart = nowMs - windowDays * DAY;

  for (const l of db.leads) {
    if (l.mock || leadIsFinal(l)) continue;
    if (!inScope(l, ix, start, today)) continue;
    const appts = ix.apptsByLead.get(l.id) ?? [];
    const fus = ix.fusByLead.get(l.id) ?? [];
    const sales = (ix.salesByLead.get(l.id) ?? []).filter((s) => s.status !== "cancelled");
    const lastTouch = Math.max(ms(l.createdAt) || 0, ms(l.lastOptInAt) || 0, ms(l.lastContactAt) || 0, ms(l.lastSetterActionAt) || 0, ...appts.map((a) => ms(a.updatedAt) || 0), ...fus.map((f) => ms(f.completedAt) || ms(f.createdAt) || 0));
    if (lastTouch < windowStart) continue;
    const ownerName = l.ownerId ? (names.get(l.ownerId) ?? "—") : "Non attribué";
    const name = leadName(l);
    const paid = sales.length > 0 && sales.every((s) => paymentView(s, today).remaining <= 0);
    if (paid) continue;

    if (!l.ownerId && head) {
      out.push({ leadId: l.id, name, reason: "Sans responsable", since: l.createdAt, ownerName });
      continue;
    }
    const tasks = openByLead.get(l.id) ?? [];
    const liveAppt = appts.some((a) => ["booked", "confirmed", "rescheduled"].includes(a.status) && ms(a.scheduledAt) > nowMs);
    const pendingFu = fus.some((f) => f.status === "pending");
    const nurture = l.settingStatus === "nurturing" && Boolean(l.nurtureUntil);
    const noShowWaiting = appts.some((a) => a.status === "no-show" && (a.noShow?.state === "awaiting" || a.noShow?.state === "contacted") && nowMs - (ms(a.noShow?.lastAttemptAt) || 0) < 7 * DAY);
    const passedNoOutcome = appts.find((a) => ["booked", "confirmed", "rescheduled"].includes(a.status) && ms(a.scheduledAt) + 24 * HOUR < nowMs);
    if (passedNoOutcome) {
      out.push({ leadId: l.id, name, reason: "Call passé depuis plus de 24 h sans résultat", since: passedNoOutcome.scheduledAt, ownerName });
      continue;
    }
    if (!tasks.length && !liveAppt && !pendingFu && !nurture && !noShowWaiting) {
      out.push({ leadId: l.id, name, reason: "Aucune prochaine action", since: new Date(lastTouch).toISOString(), ownerName });
      continue;
    }
    const stuck = tasks.find((t) => nowMs - ms(t.dueAt) > 48 * HOUR);
    if (stuck) {
      out.push({ leadId: l.id, name, reason: `Tâche en retard de plus de 48 h : ${stuck.title}`, since: stuck.dueAt, ownerName });
      continue;
    }
    if (!liveAppt && nowMs - lastTouch > staleDays * DAY && !nurture) {
      out.push({ leadId: l.id, name, reason: `Aucune activité depuis ${Math.round((nowMs - lastTouch) / DAY)} jours`, since: new Date(lastTouch).toISOString(), ownerName });
    }
  }
  return out.sort((a, b) => a.since.localeCompare(b.since));
}

/* ------------------------------ Helpers export ---------------------------- */

export { PAYMENT_FOLLOW_LABEL };
