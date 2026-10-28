import type { Appointment, DB, Sale } from "../types";
import { dayIn } from "../mediabuying/metrics";

/**
 * Calls par mois (Sales Dashboard) : combien de calls Mady a faits chaque
 * mois, combien ont close, et combien ca a genere. Ici, un call est compte
 * au mois ou il a eu lieu (date du rendez-vous), pas au mois d'arrivee du
 * lead comme dans le reste du dashboard : c'est la question « ce mois-ci,
 * j'ai pris combien de calls, pour combien de ventes ».
 */

export interface MonthCalls {
  /** « AAAA-MM ». */
  month: string;
  /** « Octobre 2026 ». */
  label: string;
  /** Calls passes (venus + pas venus), rendez-vous annules exclus. */
  calls: number;
  shows: number;
  noShows: number;
  /** Calls passes dont l'issue n'est pas encore saisie. */
  pending: number;
  won: number;
  lost: number;
  /** Suite a donner (follow-up) : ni close ni perdu. */
  followUp: number;
  /** Valeur des contrats signes sur ces calls, remboursements deduits. */
  revenue: number;
  /** Cash encaisse sur ces ventes a ce jour. */
  cash: number;
  showRate: number | null;
  /** Closes / shows. */
  closeRate: number | null;
  /** CA / show : ce que vaut un call ou le lead est venu. */
  revenuePerShow: number | null;
}

export interface CallsMonthsReport {
  from: string;
  to: string;
  currency: string;
  months: MonthCalls[];
  totals: MonthCalls;
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

function empty(month: string, label: string): MonthCalls {
  return { month, label, calls: 0, shows: 0, noShows: 0, pending: 0, won: 0, lost: 0, followUp: 0, revenue: 0, cash: 0, showRate: null, closeRate: null, revenuePerShow: null };
}

function finish(m: MonthCalls): MonthCalls {
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

/**
 * Le rapport : un mois par ligne entre `from` et `to` (jours « AAAA-MM-JJ »
 * inclus), les mois sans call compris pour que la serie reste lisible, et
 * les totaux. Les rendez-vous a venir ne sont jamais comptes.
 */
export function callsByMonth(db: DB, opts: { from: string; to: string }, now = new Date()): CallsMonthsReport {
  const since = db.settings.salesStatsSince ?? "";
  let from = opts.from;
  if (/^\d{4}-\d{2}-\d{2}$/.test(since) && from < since) from = since;
  const today = dayIn(TZ, now);
  const to = opts.to > today ? today : opts.to;
  const currency = db.settings.salesCurrency || "EUR";
  const nowIso = now.toISOString();

  const byMonth = new Map<string, MonthCalls>();
  // Tous les mois de la plage, vides, dans l'ordre.
  if (from <= to) {
    let cur = from.slice(0, 7);
    const last = to.slice(0, 7);
    for (let i = 0; i < 240 && cur <= last; i++) {
      byMonth.set(cur, empty(cur, monthLabel(cur)));
      const [y, m] = cur.split("-").map(Number);
      const next = new Date(Date.UTC(y, m, 1));
      cur = next.toISOString().slice(0, 7);
    }
  }

  const totals = empty("total", "Total");
  for (const a of db.appointments) {
    // Annule ou deplace : pas un call. A venir : pas encore un call.
    if (a.status === "cancelled" || a.status === "rescheduled" || !a.scheduledAt || a.scheduledAt > nowIso) continue;
    const day = dayIn(TZ, new Date(a.scheduledAt));
    if (day < from || day > to) continue;
    const row = byMonth.get(day.slice(0, 7));
    if (!row) continue;
    const sale = saleOf(db.sales, a);
    const won = Boolean(sale) || a.status === "closed-won";
    const showed = SHOWED.includes(a.status) || won;
    const noShow = a.status === "no-show";
    const lost = !won && a.status === "closed-lost";
    const followUp = !won && !lost && a.status === "follow-up";
    const pending = !showed && !noShow;
    const revenue = sale ? Math.max(0, sale.contractValue - (sale.refundAmount || 0)) : 0;
    const cash = sale ? Math.max(0, (sale.cashCollected || 0) - (sale.refundAmount || 0)) : 0;
    for (const r of [row, totals]) {
      r.calls++;
      if (showed) r.shows++;
      if (noShow) r.noShows++;
      if (pending) r.pending++;
      if (won) r.won++;
      if (lost) r.lost++;
      if (followUp) r.followUp++;
      r.revenue += revenue;
      r.cash += cash;
    }
  }

  return {
    from,
    to,
    currency,
    months: [...byMonth.values()].map(finish).reverse(),
    totals: finish(totals),
    statsSince: since,
  };
}
