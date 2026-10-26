/**
 * Vues rapides du CRM : types et libelles, sans dependance serveur.
 * La derivation des lignes vit dans crm.ts.
 */

import type { AppointmentConfirmation, AppointmentStatus, FollowUpHeat, Lead, LeadCallStatus, SourceChannel } from "../types";
import type { PaymentState } from "./installments";

export type QuickView = "todo" | "upcoming" | "followup" | "payment" | "closed" | "noshow" | "lost" | "all";

export const QUICK_VIEWS: { key: QuickView; label: string; hint: string }[] = [
  { key: "todo", label: "À traiter", hint: "Ce qui demande une action maintenant, par priorité" },
  { key: "upcoming", label: "Calls à venir", hint: "Rendez-vous pas encore passés : à confirmer, puis à statuer après le call" },
  { key: "followup", label: "À relancer", hint: "Relances en retard, aujourd'hui, demain, plus tard" },
  { key: "payment", label: "Paiements", hint: "Ventes pas soldées : en retard, à encaisser, contrat envoyé, en plusieurs fois" },
  { key: "closed", label: "Closés", hint: "Toutes les ventes" },
  { key: "noshow", label: "No-shows", hint: "Pas venus au call, à relancer ou reprogrammer" },
  { key: "lost", label: "Perdus", hint: "Perdus, pas intéressés, leads froids, ventes annulées" },
  { key: "all", label: "Tous", hint: "Tous les leads du CRM" },
];

export type FollowUpBucket = "overdue" | "today" | "tomorrow" | "later";
export const FOLLOWUP_BUCKET_LABEL: Record<FollowUpBucket, string> = { overdue: "En retard", today: "Aujourd'hui", tomorrow: "Demain", later: "Plus tard" };

export interface CrmSale {
  id: string;
  appointmentId: string;
  offer: string;
  contractValue: number;
  cashCollected: number;
  remaining: number;
  /** Etat du paiement, calcule par installments.ts : la meme regle partout. */
  paymentState: PaymentState;
  /** Phrase prete a afficher (« 2e échéance 1 500 € le 05/11 (dans 24 j) »). */
  paymentSummary: string;
  times: number;
  paidCount: number;
  /** Prochaine echeance impayee (AAAA-MM-JJ) et son montant. */
  nextDueAt: string;
  nextDueAmount: number;
  nextDueN: number;
  daysToNext: number | null;
  /** Echeances passees non encaissees. */
  overdueAmount: number;
  soldAt: string;
  /** Dernier encaissement. */
  lastPaidAt: string;
  status: "active" | "partially-refunded" | "refunded" | "cancelled";
}

export interface CrmFollowUp {
  id: string;
  dueAt: string;
  notes: string;
  step?: 1 | 2;
  heat?: FollowUpHeat;
  lastContactAt: string;
  lastMessage: string;
  bucket: FollowUpBucket;
}

export type TodoKind = "payment-overdue" | "followup-overdue" | "outcome" | "payment-due" | "payment-unspecified" | "noshow" | "unconfirmed";

export interface CrmTodo {
  kind: TodoKind;
  /** 1 = le plus urgent. */
  rank: number;
  reason: string;
}

export const TODO_LABEL: Record<TodoKind, string> = {
  "payment-overdue": "Paiement en retard",
  "followup-overdue": "Relance en retard",
  outcome: "Call passé · à statuer",
  "payment-due": "Échéance à encaisser",
  "payment-unspecified": "Paiement à préciser",
  noshow: "No-show · à relancer",
  unconfirmed: "Call demain · à confirmer",
};

/** Une ligne du CRM : un lead, avec tout ce qui en derive. Rien n'est recopie en base. */
export interface CrmRow {
  leadId: string;
  name: string;
  handle: string;
  email: string;
  phone: string;
  country: string;
  sourceChannel: SourceChannel;
  funnelSource: string;
  campaignId: string;
  adsetId: string;
  adId: string;
  campaignName: string;
  adsetName: string;
  adName: string;
  /** UTM lisibles du lien de campagne (campagne · contenu · terme), vide sans UTM. */
  utm: string;
  setterId: string;
  setterName: string;
  closerId: string;
  closerName: string;
  stage: Lead["stage"];
  callStatus: LeadCallStatus | "";
  /** Dernier rendez-vous non annule. */
  appointmentId: string;
  appointmentAt: string;
  appointmentStatus: AppointmentStatus | "";
  confirmation: AppointmentConfirmation | "";
  qualified: boolean;
  showStatus: "SHOWED" | "NO_SHOW" | "PENDING" | "";
  saleStatus: "WON" | "LOST" | "FOLLOW_UP" | "PENDING";
  sale: CrmSale | null;
  followUp: CrmFollowUp | null;
  /** Derniere relance cloturee (faite). */
  lastFollowUpAt: string;
  lastActionAt: string;
  lastActionSummary: string;
  createdAt: string;
  todo: CrmTodo | null;
  /** Statut lisible, en un mot, et sa tonalite : ce que la ligne affiche en premier. */
  headline: string;
  tone: "good" | "warn" | "bad" | "info" | "muted" | "accent";
  views: QuickView[];
}

export interface CrmOptions {
  sources: { key: SourceChannel; label: string }[];
  funnels: { key: string; label: string }[];
  campaigns: { id: string; name: string }[];
  adsets: { id: string; name: string; campaignId: string }[];
  ads: { id: string; name: string; adsetId: string }[];
  closers: { id: string; name: string }[];
  setters: { id: string; name: string }[];
}

export interface CrmPayload {
  rows: CrmRow[];
  counts: Record<QuickView, number>;
  options: CrmOptions;
  currency: string;
  today: string;
}
