import type { DB, Sale, SaleInstallment, Session } from "../types";

/**
 * Paiement en plusieurs fois, contrat envoye, paiement a preciser : tout ce
 * qui dit OU EN EST L'ARGENT d'une vente vit ici, et nulle part ailleurs.
 *
 * A la vente, le closer dit « payé en 2 ou 3 fois » : la premiere echeance
 * est le cash encaisse le jour meme, les suivantes se calculent toutes
 * seules, un mois d'ecart chacune, le reste du contrat reparti a parts
 * egales. Rien encaisse (« contrat envoyé ») : la premiere echeance tombe a
 * la date a laquelle le paiement est attendu (J+3 par defaut), les suivantes
 * un mois plus tard chacune. Les dates restent modifiables ensuite.
 *
 * Une echeance A VENIR n'est pas une alerte : elle est « à jour ». Elle le
 * devient le jour J (a encaisser), puis passe en retard le lendemain si rien
 * n'est entre. C'est la regle unique du CRM, du dashboard et de la cloche.
 */

const round = (n: number) => Math.round(n * 100) / 100;

/** AAAA-MM-JJ a Paris. */
export function parisToday(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
}

/** Jour AAAA-MM-JJ d'un instant ISO, a Paris. */
export function parisDayOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return parisToday();
  return d.toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
}

export function addMonths(day: string, months: number): string {
  const d = new Date(`${day.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return parisToday();
  const dom = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  // Le 31 d'un mois court devient le dernier jour du mois.
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(dom, last));
  return d.toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return parisToday();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Jours entre deux AAAA-MM-JJ (positif si `a` est apres `b`). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000);
}

/** Delai par defaut, en jours, entre « contrat envoyé » et le paiement attendu. */
export const DEFAULT_EXPECTED_DAYS = 3;

/**
 * Echeances a venir d'une vente.
 *
 * `installments` = nombre total de paiements, premier compris. Le cash du
 * jour compte pour la premiere echeance s'il est positif ; le reste est
 * reparti sur les suivantes, a un mois d'intervalle a partir de la vente.
 * Rien encaisse : la premiere echeance tombe a `firstDueAt` (paiement
 * attendu), puis un mois d'ecart. Les centimes de l'arrondi vont sur la
 * derniere.
 */
export function buildSchedule(contractValue: number, cashCollected: number, installments: number, soldAt: string, firstDueAt = ""): SaleInstallment[] {
  const remaining = round(Math.max(0, contractValue - cashCollected));
  const total = Math.max(1, Math.floor(installments || 1));
  const paidNow = cashCollected > 0 ? 1 : 0;
  const future = total - paidNow;
  if (remaining <= 0 || future <= 0) return [];
  const soldDay = parisDayOf(soldAt);
  const base = Math.floor((remaining / future) * 100) / 100;
  const items: SaleInstallment[] = [];
  for (let k = 1; k <= future; k++) {
    let dueAt: string;
    if (paidNow) dueAt = addMonths(soldDay, k);
    else {
      const first = /^\d{4}-\d{2}-\d{2}$/.test(firstDueAt) ? firstDueAt : addDays(soldDay, DEFAULT_EXPECTED_DAYS);
      dueAt = k === 1 ? first : addMonths(first, k - 1);
    }
    items.push({
      n: paidNow + k,
      dueAt,
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

/* ------------------------------ Etat du paiement ------------------------- */

/**
 * Ou en est l'argent d'une vente, en un mot :
 *  - paid        : contrat solde ;
 *  - unspecified : vente iClosed, facon de payer a preciser ;
 *  - overdue     : une echeance (ou le paiement attendu) est passee sans encaissement ;
 *  - due         : une echeance tombe aujourd'hui ou dans les `horizonDays` prochains jours ;
 *  - awaiting    : contrat envoye, rien encaisse, paiement attendu a une date a venir ;
 *  - scheduled   : paye en plusieurs fois, a jour, prochaine echeance plus tard ;
 *  - open        : reste du sans aucune echeance (a planifier).
 */
export type PaymentState = "paid" | "unspecified" | "overdue" | "due" | "awaiting" | "scheduled" | "open";

export const PAYMENT_STATE_LABEL: Record<PaymentState, string> = {
  paid: "Soldé",
  unspecified: "Paiement à préciser",
  overdue: "Paiement en retard",
  due: "Échéance à encaisser",
  awaiting: "Contrat envoyé · paiement attendu",
  scheduled: "En plusieurs fois · à jour",
  open: "Reste dû · sans échéance",
};

/** Alerte (rouge / orange) ou simple information. */
export const PAYMENT_STATE_TONE: Record<PaymentState, "good" | "warn" | "bad" | "info" | "muted"> = {
  paid: "good",
  unspecified: "warn",
  overdue: "bad",
  due: "warn",
  awaiting: "info",
  scheduled: "info",
  open: "warn",
};

export interface PaymentView {
  state: PaymentState;
  /** Montants nets de remboursement. */
  contractValue: number;
  cashCollected: number;
  remaining: number;
  /** Nombre total de paiements prevus (premier compris). */
  times: number;
  /** Echeances deja encaissees (cash du jour compris). */
  paidCount: number;
  /** Prochaine echeance impayee, s'il y en a une. */
  nextDueAt: string;
  nextDueAmount: number;
  nextDueN: number;
  /** Jours avant la prochaine echeance (negatif = retard). */
  daysToNext: number | null;
  /** Echeances passees non encaissees. */
  overdueAmount: number;
  overdueCount: number;
  /** Dernier encaissement. */
  lastPaidAt: string;
  /** Phrase prete a afficher : « 2e échéance 1 500 € le 05/11 (dans 24 j) ». */
  summary: string;
}

const fmtDay = (day: string) => day.slice(0, 10).split("-").reverse().slice(0, 2).join("/");
const money = (n: number, currency: string) => `${Math.round(n).toLocaleString("fr-FR")} ${currency === "EUR" ? "€" : currency}`;

/**
 * Derive l'etat du paiement d'une vente. `horizonDays` : a combien de jours
 * de l'echeance on commence a dire « à encaisser » (3 par defaut : le temps
 * d'envoyer un rappel au client avant la date).
 */
export function paymentView(s: Sale, today = parisToday(), horizonDays = 3): PaymentView {
  const refund = s.refundAmount || 0;
  const contractValue = Math.max(0, s.contractValue - refund);
  const cashCollected = Math.max(0, (s.cashCollected || 0) - refund);
  const remaining = round(Math.max(0, contractValue - cashCollected));
  const plan = s.schedule ?? [];
  const unpaid = plan.filter((i) => !i.paidAt && i.amount > 0).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const next = unpaid[0];
  const overdueList = unpaid.filter((i) => i.dueAt < today);
  const overdueAmount = round(overdueList.reduce((n, i) => n + i.amount, 0));
  const paidCount = plan.filter((i) => i.paidAt).length + (cashCollected > 0 && !plan.some((i) => i.n === 1) ? 1 : 0);
  const times = Math.max(s.installments || 0, plan.length + (cashCollected > 0 && !plan.some((i) => i.n === 1) ? 1 : 0), 1);
  const lastPaidAt = [...(s.collections ?? []).map((c) => c.at), ...plan.filter((i) => i.paidAt).map((i) => i.paidAt)].sort().pop() ?? (cashCollected > 0 ? s.soldAt : "");
  const cur = s.currency || "EUR";

  let state: PaymentState;
  if (remaining <= 0.005) state = "paid";
  else if (s.paymentUnspecified) state = "unspecified";
  else if (next) {
    const days = daysBetween(next.dueAt, today);
    if (days < 0) state = "overdue";
    else if (days <= horizonDays) state = "due";
    else state = cashCollected > 0 ? "scheduled" : "awaiting";
  } else if (cashCollected <= 0 && s.paymentExpectedAt) {
    state = s.paymentExpectedAt < today ? "overdue" : "awaiting";
  } else state = "open";

  const nextDueAt = next?.dueAt ?? (cashCollected <= 0 ? (s.paymentExpectedAt ?? "") : "");
  const nextDueAmount = next?.amount ?? (nextDueAt ? remaining : 0);
  const nextDueN = next?.n ?? (nextDueAt ? 1 : 0);
  const daysToNext = nextDueAt ? daysBetween(nextDueAt, today) : null;

  let summary: string;
  const ord = (n: number) => (n === 1 ? "1re" : `${n}e`);
  const when = (d: number) => (d === 0 ? "aujourd'hui" : d > 0 ? `dans ${d} j` : `retard de ${-d} j`);
  switch (state) {
    case "paid":
      summary = times > 1 ? `Soldé · payé en ${times} fois` : "Soldé";
      break;
    case "unspecified":
      summary = `${money(contractValue, cur)} remontés par iClosed · précise comment il paie`;
      break;
    case "overdue":
      summary = cashCollected <= 0 ? `Paiement non reçu · ${money(nextDueAmount, cur)} attendus le ${fmtDay(nextDueAt)} (${when(daysToNext ?? 0)}) · relance, ou annule la vente` : `${ord(nextDueN)} échéance ${money(nextDueAmount, cur)} · ${when(daysToNext ?? 0)}${overdueList.length > 1 ? ` · ${overdueList.length} échéances en retard` : ""}`;
      break;
    case "due":
      summary = cashCollected <= 0 ? `1er paiement ${money(nextDueAmount, cur)} attendu ${when(daysToNext ?? 0)} (${fmtDay(nextDueAt)})` : `${ord(nextDueN)} échéance ${money(nextDueAmount, cur)} · ${when(daysToNext ?? 0)} (${fmtDay(nextDueAt)})`;
      break;
    case "awaiting":
      summary = `Contrat ${money(contractValue, cur)}${times > 1 ? ` en ${times} fois` : ""} · 1er paiement attendu le ${fmtDay(nextDueAt)} (${when(daysToNext ?? 0)})`;
      break;
    case "scheduled":
      summary = `En ${times} fois · ${paidCount}/${times} encaissé${paidCount > 1 ? "s" : ""} · ${ord(nextDueN)} échéance ${money(nextDueAmount, cur)} le ${fmtDay(nextDueAt)} (${when(daysToNext ?? 0)})`;
      break;
    default:
      summary = `Reste ${money(remaining, cur)} à encaisser · aucune échéance posée`;
  }

  return { state, contractValue, cashCollected, remaining, times, paidCount, nextDueAt, nextDueAmount, nextDueN, daysToNext, overdueAmount, overdueCount: overdueList.length, lastPaidAt, summary };
}

/* -------------------------------- Alertes -------------------------------- */

export type InstallmentState = "overdue" | "today" | "soon" | "unspecified";

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
  /** Contrat envoye, rien encaisse : c'est le premier paiement qu'on attend. */
  awaitingFirst: boolean;
}

/**
 * Ce qu'il y a a encaisser : echeances arrivees a date (ou dans les
 * `horizonDays` prochains jours), paiements attendus apres envoi du contrat,
 * ventes iClosed dont le paiement reste a preciser. L'admin voit tout, un
 * closer ses ventes, un setter rien.
 */
export function installmentAlerts(db: DB, session: Session, horizonDays = 3): InstallmentAlert[] {
  const today = parisToday();
  const names = new Map(db.team.map((m) => [m.id, m.name]));
  const leads = new Map(db.leads.map((l) => [l.id, l]));
  const out: InstallmentAlert[] = [];
  for (const s of db.sales) {
    if (s.status === "cancelled" || s.status === "refunded") continue;
    if (!session.isAdmin && s.closerId !== session.memberId) continue;
    const v = paymentView(s, today, horizonDays);
    if (v.state === "paid" || v.state === "scheduled" || v.state === "open") continue;
    const base = {
      saleId: s.id,
      appointmentId: s.appointmentId,
      leadId: s.leadId,
      leadName: leads.get(s.leadId)?.name ?? "Client",
      closerId: s.closerId,
      closerName: names.get(s.closerId) ?? "—",
      total: v.times,
      currency: s.currency,
    };
    if (v.state === "unspecified") {
      out.push({ ...base, n: 1, dueAt: parisDayOf(s.soldAt), amount: v.remaining, state: "unspecified", daysLate: daysBetween(today, parisDayOf(s.soldAt)), awaitingFirst: true });
      continue;
    }
    if (v.state === "awaiting") continue; // date a venir : rien a faire aujourd'hui
    // overdue / due : toutes les echeances impayees deja a l'horizon.
    const plan = (s.schedule ?? []).filter((i) => !i.paidAt && i.amount > 0 && daysBetween(i.dueAt, today) <= horizonDays);
    if (!plan.length && v.nextDueAt) plan.push({ n: v.nextDueN, dueAt: v.nextDueAt, amount: v.nextDueAmount, paidAt: "" });
    for (const it of plan) {
      const daysLate = daysBetween(today, it.dueAt);
      out.push({ ...base, n: it.n, dueAt: it.dueAt, amount: it.amount, state: daysLate > 0 ? "overdue" : daysLate === 0 ? "today" : "soon", daysLate, awaitingFirst: v.cashCollected <= 0 });
    }
  }
  return out.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}
