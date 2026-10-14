import { leadIsOut, type Lead, type Settings } from "../types";

/**
 * Regle de reprise d'une conversation (2026-10-14).
 *
 * Un lead pris par un setter lui appartient, sauf s'il le laisse dormir : au
 * bout de `salesTakeoverMin` minutes sans la moindre action de sa part
 * (statut, message note, note, pseudo), la conversation redevient visible des
 * autres setters, avec un bouton « Reprendre ». Celui qui reprend devient le
 * setter du lead ; la reprise est tracee dans l'historique et comptee.
 *
 * Ce que le tool ne voit pas (les messages WhatsApp eux-memes), il le deduit
 * de ce que le setter note. D'ou la regle du guide : tout ce qui est fait sur
 * un lead se note dans le tool, sinon c'est comme si rien n'avait ete fait.
 *
 * Le compteur d'inactivite part de la derniere action du setter, ou de la
 * relance / du rappel programme quand il est passe : un rappel prevu a 15 h
 * non honore a 16 h compte une heure de retard. Une relance ou un rappel
 * encore a venir suspendent la regle (le setter a planifie la suite).
 */

export const DEFAULT_TAKEOVER_MIN = 60;
/** Avertissement Telegram envoye ce nombre de minutes avant la reprise possible. */
export const TAKEOVER_WARN_BEFORE_MIN = 15;

export function takeoverDelayMin(settings: Pick<Settings, "salesTakeoverMin">): number {
  const n = settings.salesTakeoverMin;
  if (n === undefined || n === null) return DEFAULT_TAKEOVER_MIN;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

export interface TakeoverState {
  /** Un autre setter peut reprendre maintenant. */
  eligible: boolean;
  /** La regle s'applique a ce lead (conversation vivante, sans suite planifiee) mais le delai n'est pas atteint. */
  pending: boolean;
  /** Minutes sans action (depuis la derniere action, ou la relance / le rappel passe). */
  idleMin: number;
  /** Minutes restantes avant qu'un autre setter puisse reprendre (0 si deja possible). */
  inMin: number;
  /** Point de depart du compteur (ISO). */
  since: string;
}

const NONE: TakeoverState = { eligible: false, pending: false, idleMin: 0, inMin: 0, since: "" };

/** Derniere action connue du setter sur le lead. */
export function lastSetterActionAt(lead: Lead): string {
  return [lead.lastSetterActionAt ?? "", lead.lastCallAt ?? "", lead.claimedAt ?? ""].sort().pop() ?? "";
}

/**
 * Etat de la regle pour un lead.
 *
 * `booked` : un rendez-vous a venir existe (la conversation est aboutie, la
 * regle ne s'applique plus).
 */
export function takeoverState(lead: Lead, settings: Pick<Settings, "salesTakeoverMin">, booked: boolean, nowMs = Date.now()): TakeoverState {
  const delay = takeoverDelayMin(settings);
  if (!delay || !lead.setterId || booked) return NONE;
  if (lead.stage !== "nouveau" && lead.stage !== "contacte" && lead.stage !== "conversation") return NONE;
  if (leadIsOut(lead.callStatus)) return NONE;
  const now = new Date(nowMs).toISOString();
  // Une suite planifiee et encore a venir suspend la regle.
  if (lead.callbackAt && lead.callbackAt > now) return NONE;
  if (lead.followUpAt && lead.followUpAt > now) return NONE;

  const since = [lastSetterActionAt(lead), lead.callbackAt ?? "", lead.followUpAt ?? ""].filter(Boolean).sort().pop() ?? "";
  if (!since) return NONE;
  const idleMin = Math.max(0, Math.floor((nowMs - new Date(since).getTime()) / 60_000));
  const eligible = idleMin >= delay;
  return { eligible, pending: !eligible, idleMin, inMin: eligible ? 0 : delay - idleMin, since };
}

/** « 1 h 05 » / « 45 min », pour les messages. */
export function fmtIdle(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}
