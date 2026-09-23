/**
 * Calcul des indicateurs commerciaux.
 *
 * Fonctions pures, appelees cote serveur uniquement : le navigateur recoit des
 * chiffres deja agreges, jamais la base entiere. C'est ce qui permet au
 * dashboard de rester rapide quand il y aura des milliers de rendez-vous.
 *
 * Convention de periode, valable partout dans le module :
 *
 *  - un rendez-vous appartient a la periode de sa DATE DE RENDEZ-VOUS
 *    (`scheduledAt`), pas de sa date de creation ;
 *  - une vente appartient a la periode de sa DATE DE VENTE (`soldAt`).
 *
 * Sans cette regle, le taux de presence serait faux : des rendez-vous pris
 * aujourd'hui pour la semaine prochaine gonfleraient le denominateur alors
 * qu'ils n'ont pas encore pu avoir lieu.
 */
import type { Appointment, Sale, TeamMember } from "../types";
import { isAttended, isDead } from "./constants";
import { netCash, netContract } from "./commissions";
import { inRange, type Range } from "./period";
import { hasRole } from "./roles";

export interface SalesKpis {
  appointments: number;
  confirmed: number;
  attended: number;
  noShows: number;
  cancelled: number;
  showRate: number;
  sales: number;
  /** Ventes / calls honores. */
  closeRate: number;
  /** Ventes / rendez-vous poses : la conversion de bout en bout. */
  apptToSaleRate: number;
  contractValue: number;
  cashCollected: number;
  avgDealSize: number;
  revenuePerAppointment: number;
  revenuePerCall: number;
  followUpsPending: number;
}

const rate = (num: number, den: number) => (den > 0 ? (num / den) * 100 : 0);
const money = (n: number) => Math.round(n * 100) / 100;

/** Rendez-vous de la periode, hors annulations. */
export function appointmentsInRange(appointments: Appointment[], range: Range): Appointment[] {
  return appointments.filter((a) => inRange(a.scheduledAt, range));
}

export function computeKpis(
  appointments: Appointment[],
  sales: Sale[],
  range: Range,
  followUpsPending = 0,
): SalesKpis {
  const all = appointmentsInRange(appointments, range);
  // Les annulations sortent du denominateur : un rendez-vous annule en amont
  // n'a jamais eu l'occasion d'etre honore, le compter penaliserait le setter.
  const live = all.filter((a) => !isDead(a.status));
  const attended = live.filter((a) => isAttended(a.status));
  const noShows = live.filter((a) => a.status === "no-show");
  const periodSales = sales.filter((s) => inRange(s.soldAt, range));

  const contractValue = money(periodSales.reduce((a, s) => a + netContract(s), 0));
  const cashCollected = money(periodSales.reduce((a, s) => a + netCash(s), 0));

  return {
    appointments: live.length,
    confirmed: live.filter((a) => a.status === "confirmed").length,
    attended: attended.length,
    noShows: noShows.length,
    cancelled: all.length - live.length,
    showRate: rate(attended.length, live.length),
    sales: periodSales.length,
    closeRate: rate(periodSales.length, attended.length),
    apptToSaleRate: rate(periodSales.length, live.length),
    contractValue,
    cashCollected,
    avgDealSize: periodSales.length ? money(contractValue / periodSales.length) : 0,
    revenuePerAppointment: live.length ? money(contractValue / live.length) : 0,
    revenuePerCall: attended.length ? money(contractValue / attended.length) : 0,
    followUpsPending,
  };
}

/* -------------------------------- Funnel -------------------------------- */

export interface FunnelStep {
  key: string;
  label: string;
  value: number;
  /** Conversion depuis l'etape precedente, en pourcentage. */
  fromPrevious: number;
  /** Conversion depuis la premiere etape. */
  fromStart: number;
}

/**
 * Entonnoir de l'acquisition Instagram jusqu'au cash.
 *
 * `leadCount` vient des leads du CRM sur la periode : c'est le haut du
 * funnel, en amont de toute prise de rendez-vous.
 */
export function computeFunnel(
  appointments: Appointment[],
  sales: Sale[],
  range: Range,
  leadCount: number,
): FunnelStep[] {
  const all = appointmentsInRange(appointments, range);
  const live = all.filter((a) => !isDead(a.status));
  const confirmed = live.filter((a) => a.status !== "booked");
  const attended = live.filter((a) => isAttended(a.status));
  const periodSales = sales.filter((s) => inRange(s.soldAt, range));

  const raw: { key: string; label: string; value: number }[] = [
    { key: "leads", label: "Leads Instagram", value: leadCount },
    { key: "booked", label: "Rendez-vous posés", value: live.length },
    { key: "confirmed", label: "Confirmés", value: confirmed.length },
    { key: "attended", label: "Calls honorés", value: attended.length },
    { key: "sales", label: "Ventes", value: periodSales.length },
  ];

  const start = raw[0].value || raw[1].value;

  return raw.map((step, i) => ({
    ...step,
    fromPrevious: i === 0 ? 100 : rate(step.value, raw[i - 1].value),
    fromStart: rate(step.value, start),
  }));
}

/* ----------------------------- Classements ------------------------------ */

export interface SetterRow {
  memberId: string;
  name: string;
  status: TeamMember["status"];
  appointments: number;
  qualified: number;
  shows: number;
  noShows: number;
  showRate: number;
  sales: number;
  /** Conversion rendez-vous -> vente : la vraie mesure de la qualite d'un setter. */
  setterToSale: number;
  revenue: number;
  cash: number;
}

export interface CloserRow {
  memberId: string;
  name: string;
  status: TeamMember["status"];
  assigned: number;
  completed: number;
  noShows: number;
  sales: number;
  closeRate: number;
  revenue: number;
  cash: number;
  avgDealSize: number;
  revenuePerCall: number;
}

export function setterLeaderboard(
  members: TeamMember[],
  appointments: Appointment[],
  sales: Sale[],
  range: Range,
): SetterRow[] {
  const live = appointmentsInRange(appointments, range).filter((a) => !isDead(a.status));
  const periodSales = sales.filter((s) => inRange(s.soldAt, range));

  return members
    .filter((m) => hasRole(m, "setter"))
    .map((m) => {
      const mine = live.filter((a) => a.setterId === m.id);
      const shows = mine.filter((a) => isAttended(a.status));
      const mineSales = periodSales.filter((s) => s.setterId === m.id);
      return {
        memberId: m.id,
        name: m.name,
        status: m.status,
        appointments: mine.length,
        qualified: mine.filter((a) => a.qualified).length,
        shows: shows.length,
        noShows: mine.filter((a) => a.status === "no-show").length,
        showRate: rate(shows.length, mine.length),
        sales: mineSales.length,
        setterToSale: rate(mineSales.length, mine.length),
        revenue: money(mineSales.reduce((a, s) => a + netContract(s), 0)),
        cash: money(mineSales.reduce((a, s) => a + netCash(s), 0)),
      };
    })
    .sort((a, b) => b.revenue - a.revenue || b.appointments - a.appointments);
}

export function closerLeaderboard(
  members: TeamMember[],
  appointments: Appointment[],
  sales: Sale[],
  range: Range,
): CloserRow[] {
  const live = appointmentsInRange(appointments, range).filter((a) => !isDead(a.status));
  const periodSales = sales.filter((s) => inRange(s.soldAt, range));

  return members
    .filter((m) => hasRole(m, "closer"))
    .map((m) => {
      const mine = live.filter((a) => a.closerId === m.id);
      const completed = mine.filter((a) => isAttended(a.status));
      const mineSales = periodSales.filter((s) => s.closerId === m.id);
      const revenue = money(mineSales.reduce((a, s) => a + netContract(s), 0));
      return {
        memberId: m.id,
        name: m.name,
        status: m.status,
        assigned: mine.length,
        completed: completed.length,
        noShows: mine.filter((a) => a.status === "no-show").length,
        sales: mineSales.length,
        closeRate: rate(mineSales.length, completed.length),
        revenue,
        cash: money(mineSales.reduce((a, s) => a + netCash(s), 0)),
        avgDealSize: mineSales.length ? money(revenue / mineSales.length) : 0,
        revenuePerCall: completed.length ? money(revenue / completed.length) : 0,
      };
    })
    .sort((a, b) => b.revenue - a.revenue || b.sales - a.sales);
}

/* --------------------------- Serie temporelle ---------------------------- */

export interface DayPoint {
  date: string;
  appointments: number;
  shows: number;
  sales: number;
  cash: number;
}

/** Performance jour par jour, pour les graphiques de fiche membre. */
export function dailySeries(
  appointments: Appointment[],
  sales: Sale[],
  range: Range,
): DayPoint[] {
  const byDay = new Map<string, DayPoint>();

  const touch = (date: string) => {
    let point = byDay.get(date);
    if (!point) {
      point = { date, appointments: 0, shows: 0, sales: 0, cash: 0 };
      byDay.set(date, point);
    }
    return point;
  };

  for (const a of appointmentsInRange(appointments, range)) {
    if (isDead(a.status)) continue;
    const point = touch(a.scheduledAt.slice(0, 10));
    point.appointments += 1;
    if (isAttended(a.status)) point.shows += 1;
  }

  for (const s of sales) {
    if (!inRange(s.soldAt, range)) continue;
    const point = touch(s.soldAt.slice(0, 10));
    point.sales += 1;
    point.cash += netCash(s);
  }

  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/* ---------------------------- Objections --------------------------------- */

/** Repartition des raisons de perte, pour savoir sur quoi travailler. */
export function lostReasons(appointments: Appointment[], range: Range) {
  const counts = new Map<string, number>();
  for (const a of appointmentsInRange(appointments, range)) {
    if (a.status !== "closed-lost" || !a.lostReason) continue;
    counts.set(a.lostReason, (counts.get(a.lostReason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);
}
