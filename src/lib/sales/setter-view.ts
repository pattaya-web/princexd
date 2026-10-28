import type { Sale, Session } from "../types";
import { sessionHas } from "./roles";

/**
 * Ce qu'un setter voit d'une vente (2026-10-29).
 *
 * Le prix reel d'un closing ne regarde pas le setter : Mady annonce au setter
 * le montant qu'elle veut (`Sale.setterAmount`), et c'est ce montant-la qui
 * s'affiche dans son espace et qui sert de base a sa commission. Le vrai
 * contrat et le vrai cash restent ceux du Sales Dashboard, jamais touches.
 * Sans montant annonce (ventes d'avant, ou champ laisse vide), le setter
 * voit le vrai montant, comme avant.
 */

/** Vrai si la session est celle d'un setter (pas admin, pas closer). */
export function isSetterSession(session: Pick<Session, "isAdmin" | "role" | "roles">): boolean {
  return !session.isAdmin && sessionHas(session, "setter") && !sessionHas(session, "closer");
}

/** La vente telle que le setter doit la voir : montant annonce a la place du vrai. */
export function saleForSetter(s: Sale): Sale {
  const a = s.setterAmount;
  if (a === undefined || a === null || !Number.isFinite(a)) return s;
  const shown = Math.max(0, a);
  const cash = s.status === "cancelled" ? 0 : Math.min(shown, Math.max(0, s.cashCollected || 0) > 0 ? shown : 0);
  return {
    ...s,
    contractValue: shown,
    // Pas d'echeancier a montrer au setter : s'il y a eu un encaissement, le montant annonce compte comme encaisse.
    cashCollected: cash,
    refundAmount: 0,
    collections: [],
    schedule: [],
    paymentExpectedAt: undefined,
  };
}

export const salesForSetter = (sales: Sale[]) => sales.map(saleForSetter);
