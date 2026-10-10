/**
 * Vues rapides du CRM : types et libelles, sans dependance serveur.
 * La derivation des lignes vit dans crm.ts.
 */

import type { AppointmentConfirmation, AppointmentStatus, Lead, LeadCallStatus, SourceChannel } from "../types";

export type QuickView = "all" | "todo" | "followup" | "payment" | "closed" | "show" | "noshow" | "reschedule" | "qualified" | "lost";

export const QUICK_VIEWS: { key: QuickView; label: string; hint: string }[] = [
  { key: "all", label: "Tous", hint: "Tous les leads du CRM" },
  { key: "todo", label: "À traiter", hint: "Ce qui demande une action maintenant, par priorité" },
  { key: "followup", label: "À relancer", hint: "Relances en retard, aujourd'hui, demain, plus tard" },
  { key: "payment", label: "Paiement en attente", hint: "Closés dont le cash encaissé est inférieur au contrat" },
  { key: "closed", label: "Closés", hint: "Toutes les ventes" },
  { key: "show", label: "Shows", hint: "Venus au call" },
  { key: "noshow", label: "No-shows", hint: "Pas venus au call" },
  { key: "reschedule", label: "À reprogrammer", hint: "No-show sans relance ni nouveau rendez-vous" },
  { key: "qualified", label: "Qualifiés", hint: "Marqués qualifiés" },
  { key: "lost", label: "Perdus", hint: "Perdus, pas intéressés, leads froids" },
];

export type PaymentStatus = "paid" | "partial" | "pending";
export const PAYMENT_LABEL: Record<PaymentStatus, string> = { paid: "Soldé", partial: "Paiement partiel", pending: "Paiement en attente" };

export type FollowUpBucket = "overdue" | "today" | "tomorrow" | "later";
export const FOLLOWUP_BUCKET_LABEL: Record<FollowUpBucket, string> = { overdue: "En retard", today: "Aujourd'hui", tomorrow: "Demain", later: "Plus tard" };

export interface CrmSale {
  id: string;
  appointmentId: string;
  offer: string;
  contractValue: number;
  cashCollected: number;
  remaining: number;
  paymentStatus: PaymentStatus;
  /** Prochaine echeance impayee (AAAA-MM-JJ) et son montant. */
  nextDueAt: string;
  nextDueAmount: number;
  /** Echeances passees non encaissees. */
  overdueAmount: number;
  soldAt: string;
  /** Dernier encaissement. */
  lastPaidAt: string;
}

export interface CrmFollowUp {
  id: string;
  dueAt: string;
  notes: string;
  step?: 1 | 2;
  lastContactAt: string;
  lastMessage: string;
  bucket: FollowUpBucket;
}

export interface CrmTodo {
  /** 1 = le plus urgent. */
  rank: 1 | 2 | 3 | 4 | 5 | 6;
  reason: string;
}

export const TODO_LABEL: Record<CrmTodo["rank"], string> = {
  1: "Paiement en retard",
  2: "Relance en retard",
  3: "Résultat de call à saisir",
  4: "À reprogrammer",
  5: "No-show à relancer",
  6: "Lead récent sans action",
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
}
