import type { Appointment, DB, Lead, Sale, Session } from "../types";
import { sessionHas } from "./roles";

/**
 * Ce qu'un setter voit d'une vente (2026-10-29, complete le 2026-10-30).
 *
 * Le prix reel d'un closing ne regarde pas le setter : Mady annonce au setter
 * le montant qu'elle veut (`Sale.setterAmount`, et `Sale.setterCash` pour
 * l'encaisse), et c'est ce montant-la qui s'affiche dans son espace et qui
 * sert de base a sa commission. Le vrai contrat et le vrai cash restent ceux
 * du Sales Dashboard, jamais touches. Sans montant annonce (ventes d'avant,
 * ou champ laisse vide), le setter voit le vrai montant, comme avant.
 *
 * Depuis le 2026-10-30, un closing n'arrive chez le setter que quand Mady
 * l'envoie (`Sale.setterHold`) : avant, le call reste pour lui un « call
 * fait » sans issue, sans vente, sans note du closer.
 */

/** Vrai si la session est celle d'un setter (pas admin, pas closer). */
export function isSetterSession(session: Pick<Session, "isAdmin" | "role" | "roles">): boolean {
  return !session.isAdmin && sessionHas(session, "setter") && !sessionHas(session, "closer");
}

/** Closing pas encore envoye au setter : invisible pour lui. */
export const isHeldFromSetter = (s: Pick<Sale, "setterHold">): boolean => s.setterHold === true;

/** La vente telle que le setter doit la voir : montant annonce a la place du vrai. */
export function saleForSetter(s: Sale): Sale {
  const a = s.setterAmount;
  if (a === undefined || a === null || !Number.isFinite(a)) return s;
  const shown = Math.max(0, a);
  const c = s.setterCash;
  const announcedCash = c === undefined || c === null || !Number.isFinite(c) ? undefined : Math.min(shown, Math.max(0, c));
  // Pas d'encaisse annonce : s'il y a eu un encaissement, le montant annonce compte comme encaisse.
  const cash = s.status === "cancelled" ? 0 : announcedCash !== undefined ? announcedCash : Math.max(0, s.cashCollected || 0) > 0 ? shown : 0;
  return {
    ...s,
    contractValue: shown,
    // Pas d'echeancier a montrer au setter.
    cashCollected: cash,
    refundAmount: 0,
    collections: [],
    schedule: [],
    paymentExpectedAt: undefined,
  };
}

/** La vente vue par le setter, ou rien si le closing ne lui a pas encore ete envoye. */
export const visibleSaleForSetter = (s: Sale): Sale | null => (isHeldFromSetter(s) ? null : saleForSetter(s));

/** Les ventes vues par le setter : sans les closings en attente, aux montants annonces. */
export const salesForSetter = (sales: Sale[]) => sales.filter((s) => !isHeldFromSetter(s)).map(saleForSetter);

/** Rendez-vous dont le closing est en attente d'envoi au setter. */
function heldAppointmentIds(sales: Sale[]): Set<string> {
  const out = new Set<string>();
  for (const s of sales) if (s.status !== "cancelled" && s.appointmentId && isHeldFromSetter(s)) out.add(s.appointmentId);
  return out;
}

/**
 * Le rendez-vous tel que le setter le voit : un call close dont le closing
 * n'est pas encore envoye reste un « call fait », sans note du closer ni
 * recap (ils pourraient contenir le vrai prix).
 */
export function appointmentForSetter(a: Appointment, sales: Sale[]): Appointment {
  if (a.status !== "closed-won" || !heldAppointmentIds(sales).has(a.id)) return a;
  return { ...a, status: "completed", closerNotes: "", lostReason: "", recap: undefined, history: (a.history ?? []).filter((h) => h.to !== "closed-won") };
}

/** Le lead tel que le setter le voit : « closé » seulement une fois le closing envoye. */
export function leadForSetter(l: Lead, sales: Sale[]): Lead {
  if (l.stage !== "closed-won") return l;
  const latest = sales.filter((s) => s.leadId === l.id && s.status !== "cancelled").sort((x, y) => y.updatedAt.localeCompare(x.updatedAt))[0];
  if (!latest || !isHeldFromSetter(latest)) return l;
  return { ...l, stage: "call-fait", dealValue: 0 };
}

/**
 * La base telle qu'un setter a le droit de la lire : ventes aux montants
 * annonces et sans les closings en attente, rendez-vous et leads masques en
 * consequence. Pour un admin ou un closer, la base telle quelle. A n'utiliser
 * QUE pour lire : la copie n'est pas ecrite.
 */
export function setterSafeDB(db: DB, session: Pick<Session, "isAdmin" | "role" | "roles">): DB {
  if (!isSetterSession(session)) return db;
  const raw = db.sales;
  return {
    ...db,
    sales: salesForSetter(raw),
    appointments: db.appointments.map((a) => appointmentForSetter(a, raw)),
    leads: db.leads.map((l) => leadForSetter(l, raw)),
  };
}
