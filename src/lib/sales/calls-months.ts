import type { Appointment, DB, Sale } from "../types";
import { dayIn } from "../mediabuying/metrics";
import { businessDataset, matches, type BusinessFilters } from "./business";
import { defaultCloserId } from "./closers";

/**
 * Les calls du Sales Dashboard (2026-10-28, refonte « une seule section
 * coherente ») : chaque call est compte a la date ou il a eu lieu, un call
 * = un rendez-vous (un lead no-show puis venu = 2 calls), toute l'equipe
 * par defaut, un closer au choix. Les rendez-vous annules ou deplaces ne
 * sont pas des calls ; les rendez-vous a venir ne sont pas encore des
 * calls (ils ont leur propre liste). Les ventes, le CA et le cash sont ceux
 * des calls de la periode. Les totaux, le detail mois par mois et les listes
 * derriere chaque tuile sortent du meme calcul : ils ne peuvent pas se
 * contredire.
 */

export type CallStatus = "show" | "noshow" | "pending";
export type CallOutcome = "won" | "lost" | "followup" | "";

export interface CallRow {
  appointmentId: string;
  leadId: string;
  leadName: string;
  /** Date et heure du call (ISO). */
  at: string;
  status: CallStatus;
  outcome: CallOutcome;
  closerId: string;
  closerName: string;
  /** Contrat et cash de la vente rattachee (remboursements deduits), 0 sinon. */
  revenue: number;
  cash: number;
  offer: string;
  sourceLabel: string;
}

export interface CallsTotals {
  /** Calls passes : venus + no-show + a statuer. */
  calls: number;
  shows: number;
  noShows: number;
  /** Calls passes dont l'issue n'est pas saisie. */
  pending: number;
  won: number;
  lost: number;
  followUp: number;
  revenue: number;
  cash: number;
  showRate: number | null;
  /** Closes / venus. */
  closeRate: number | null;
  revenuePerShow: number | null;
}

export interface MonthCalls extends CallsTotals {
  /** « AAAA-MM ». */
  month: string;
  /** « Octobre 2026 ». */
  label: string;
}

export interface CallsReport {
  from: string;
  to: string;
  currency: string;
  /** Closer retenu ("" = toute l'equipe). */
  closerId: string;
  /** Mon compte (closer par defaut), pour le choix « Mes calls ». */
  meId: string;
  /** Les closers qui ont des calls, pour le selecteur. */
  closers: { id: string; name: string }[];
  totals: CallsTotals;
  /** Un mois par ligne (les plus recents d'abord), mois vides compris. */
  months: MonthCalls[];
  /** Chaque call de la periode, du plus recent au plus ancien. */
  calls: CallRow[];
  /** Les rendez-vous a venir (apres maintenant), hors periode, du plus proche au plus lointain. */
  upcoming: CallRow[];
  statsSince: string;
}

const TZ = "Europe/Paris";
const SHOWED: Appointment["status"][] = ["completed", "follow-up", "closed-won", "closed-lost"];

const MONTHS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const name = MONTHS_FR[(m || 1) - 1] ?? "";
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${y}`;
}

function emptyTotals(): CallsTotals {
  return { calls: 0, shows: 0, noShows: 0, pending: 0, won: 0, lost: 0, followUp: 0, revenue: 0, cash: 0, showRate: null, closeRate: null, revenuePerShow: null };
}

function finish<T extends CallsTotals>(m: T): T {
  const judged = m.shows + m.noShows;
  m.showRate = judged > 0 ? (m.shows / judged) * 100 : null;
  m.closeRate = m.shows > 0 ? (m.won / m.shows) * 100 : null;
  m.revenuePerShow = m.shows > 0 ? m.revenue / m.shows : null;
  return m;
}

/** La vente rattachee a ce rendez-vous (la plus recente non annulee), sinon null. */
function saleOf(sales: Sale[], appt: Appointment): Sale | null {
  return sales.filter((s) => s.status !== "cancelled" && s.appointmentId === appt.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
}

export function callsReport(db: DB, opts: { from: string; to: string; closerId?: string; filters?: BusinessFilters }, now = new Date()): CallsReport {
  const since = db.settings.salesStatsSince ?? "";
  let from = opts.from;
  if (/^\d{4}-\d{2}-\d{2}$/.test(since) && from < since) from = since;
  const today = dayIn(TZ, now);
  const to = opts.to > today ? today : opts.to;
  const currency = db.settings.salesCurrency || "EUR";
  const nowIso = now.toISOString();
  const meId = defaultCloserId(db);
  const closerId = opts.closerId ?? "";
  // Un call sans closer attribue est celui du closer par defaut.
  const mine = (id: string) => id === closerId || (!id && closerId === meId);
  const names = new Map(db.team.map((m) => [m.id, m.name]));
  const leads = new Map(db.leads.map((l) => [l.id, l]));
  const filters = opts.filters ?? {};
  const filtering = Object.values(filters).some(Boolean);
  // Les filtres (source, funnel, campagne...) sont ceux du lead : on les applique au lead du call.
  const leadRows = filtering ? new Map(businessDataset(db).rows.map((r) => [r.leadId, r])) : null;
  const leadOk = (leadId: string) => {
    if (!leadRows) return true;
    const r = leadRows.get(leadId);
    return r ? matches(r, filters) : false;
  };
  const sourceLabelOf = (leadId: string) => {
    const r = leadRows?.get(leadId);
    return r ? r.funnelSource : "";
  };
  const seenClosers = new Map<string, string>();

  const byMonth = new Map<string, MonthCalls>();
  if (from <= to) {
    let cur = from.slice(0, 7);
    const last = to.slice(0, 7);
    for (let i = 0; i < 240 && cur <= last; i++) {
      byMonth.set(cur, { ...emptyTotals(), month: cur, label: monthLabel(cur) });
      const [y, m] = cur.split("-").map(Number);
      cur = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
    }
  }

  const totals = emptyTotals();
  const calls: CallRow[] = [];
  const upcoming: CallRow[] = [];

  for (const a of db.appointments) {
    // Annule ou deplace : pas un call.
    if (a.status === "cancelled" || a.status === "rescheduled" || !a.scheduledAt) continue;
    const sale = saleOf(db.sales, a);
    const callCloser = sale?.closerId || a.closerId || "";
    if (callCloser && !seenClosers.has(callCloser)) seenClosers.set(callCloser, names.get(callCloser) ?? "Closer inconnu");
    if (closerId && !mine(callCloser)) continue;
    if (!leadOk(a.leadId)) continue;
    const lead = leads.get(a.leadId);
    const won = Boolean(sale) || a.status === "closed-won";
    const row: CallRow = {
      appointmentId: a.id,
      leadId: a.leadId,
      leadName: lead?.name || "Lead inconnu",
      at: a.scheduledAt,
      status: SHOWED.includes(a.status) || won ? "show" : a.status === "no-show" ? "noshow" : "pending",
      outcome: won ? "won" : a.status === "closed-lost" ? "lost" : a.status === "follow-up" ? "followup" : "",
      closerId: callCloser,
      closerName: names.get(callCloser) ?? (callCloser ? "Closer inconnu" : (names.get(meId) ?? "")),
      revenue: sale ? Math.max(0, sale.contractValue - (sale.refundAmount || 0)) : 0,
      cash: sale ? Math.max(0, (sale.cashCollected || 0) - (sale.refundAmount || 0)) : 0,
      offer: sale?.offer ?? "",
      sourceLabel: sourceLabelOf(a.leadId),
    };
    // A venir : apres maintenant, quelle que soit la periode.
    if (a.scheduledAt > nowIso) {
      upcoming.push(row);
      continue;
    }
    const day = dayIn(TZ, new Date(a.scheduledAt));
    if (day < from || day > to) continue;
    const month = byMonth.get(day.slice(0, 7));
    if (!month) continue;
    calls.push(row);
    for (const t of [month, totals]) {
      t.calls++;
      if (row.status === "show") t.shows++;
      if (row.status === "noshow") t.noShows++;
      if (row.status === "pending") t.pending++;
      if (row.outcome === "won") t.won++;
      if (row.outcome === "lost") t.lost++;
      if (row.outcome === "followup") t.followUp++;
      t.revenue += row.revenue;
      t.cash += row.cash;
    }
  }

  calls.sort((a, b) => b.at.localeCompare(a.at));
  upcoming.sort((a, b) => a.at.localeCompare(b.at));

  return {
    from,
    to,
    currency,
    closerId,
    meId,
    closers: [...seenClosers].map(([id, name]) => ({ id, name })).sort((a, b) => (a.id === meId ? -1 : b.id === meId ? 1 : a.name.localeCompare(b.name))),
    totals: finish(totals),
    months: [...byMonth.values()].map(finish).reverse(),
    calls,
    upcoming,
    statsSince: since,
  };
}
