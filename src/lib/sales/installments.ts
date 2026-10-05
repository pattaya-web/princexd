import type { DB, SaleInstallment, Session } from "../types";

/**
 * Paiement en plusieurs fois.
 *
 * A la vente, le closer dit « payé en 2 ou 3 fois » : la premiere echeance
 * est le cash encaisse le jour meme, les suivantes se calculent toutes
 * seules, un mois d'ecart chacune, le reste du contrat reparti a parts
 * egales. Les dates restent modifiables ensuite. Le jour venu, l'echeance
 * remonte en alerte sur le CRM, le Sales Dashboard et l'accueil du closer.
 */

const round = (n: number) => Math.round(n * 100) / 100;

/** AAAA-MM-JJ a Paris. */
export function parisToday(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
}

function addMonths(iso: string, months: number): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return parisToday();
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  // Le 31 d'un mois court devient le dernier jour du mois.
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Echeances a venir d'une vente.
 *
 * `installments` = nombre total de paiements, premier compris. Le cash du
 * jour compte pour la premiere echeance s'il est positif ; le reste est
 * reparti sur les suivantes, a un mois d'intervalle a partir de la vente.
 * Les centimes de l'arrondi vont sur la derniere.
 */
export function buildSchedule(contractValue: number, cashCollected: number, installments: number, soldAt: string): SaleInstallment[] {
  const remaining = round(Math.max(0, contractValue - cashCollected));
  const total = Math.max(1, Math.floor(installments || 1));
  const paidNow = cashCollected > 0 ? 1 : 0;
  const future = total - paidNow;
  if (remaining <= 0 || future <= 0) return [];
  const base = Math.floor((remaining / future) * 100) / 100;
  const items: SaleInstallment[] = [];
  for (let k = 1; k <= future; k++) {
    items.push({
      n: paidNow + k,
      dueAt: addMonths(soldAt, k),
      amount: k === future ? round(remaining - base * (future - 1)) : base,
      paidAt: "",
    });
  }
  return items;
}

/** Garde les dates de paiement deja enregistrees quand le plan est recalcule. */
export function mergePaid(next: SaleInstallment[], previous: SaleInstallment[] | undefined): SaleInstallment[] {
  const paid = new Map((previous ?? []).filter((p) => p.paidAt).map((p) => [p.n, p.paidAt]));
  return next.map((it) => ({ ...it, paidAt: paid.get(it.n) ?? "" }));
}

export type InstallmentState = "overdue" | "today" | "soon";

export interface InstallmentAlert {
  saleId: string;
  appointmentId: string;
  leadId: string;
  leadName: string;
  closerId: string;
  closerName: string;
  n: number;
  total: number;
  dueAt: string;
  amount: number;
  currency: string;
  state: InstallmentState;
  /** Jours de retard (negatif = dans n jours). */
  daysLate: number;
}

/**
 * Echeances impayees arrivees a date (ou dans les `horizonDays` prochains
 * jours). L'admin voit tout, un closer ses ventes, un setter rien.
 */
export function installmentAlerts(db: DB, session: Session, horizonDays = 3): InstallmentAlert[] {
  const today = parisToday();
  const horizon = addDays(today, horizonDays);
  const names = new Map(db.team.map((m) => [m.id, m.name]));
  const leads = new Map(db.leads.map((l) => [l.id, l]));
  const out: InstallmentAlert[] = [];
  for (const s of db.sales) {
    if (s.status === "cancelled" || s.status === "refunded") continue;
    if (!session.isAdmin && s.closerId !== session.memberId) continue;
    const total = Math.max(s.installments, (s.schedule ?? []).length + (s.cashCollected > 0 ? 1 : 0));
    for (const it of s.schedule ?? []) {
      if (it.paidAt || it.dueAt > horizon) continue;
      const daysLate = Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${it.dueAt}T12:00:00Z`)) / 86_400_000);
      out.push({
        saleId: s.id,
        appointmentId: s.appointmentId,
        leadId: s.leadId,
        leadName: leads.get(s.leadId)?.name ?? "Client",
        closerId: s.closerId,
        closerName: names.get(s.closerId) ?? "—",
        n: it.n,
        total,
        dueAt: it.dueAt,
        amount: it.amount,
        currency: s.currency,
        state: it.dueAt < today ? "overdue" : it.dueAt === today ? "today" : "soon",
        daysLate,
      });
    }
  }
  return out.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}
