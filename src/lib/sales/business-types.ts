/**
 * Types et libelles du Sales Dashboard, sans dependance serveur : importables
 * par les pages (le moteur d'agregation, lui, vit dans business.ts).
 */

import type { Lead, SourceChannel } from "../types";

export type BookingStatus = "SCHEDULED" | "CANCELLED" | "NO_SHOW" | "SHOWED";
export type ShowStatus = "PENDING" | "SHOWED" | "NO_SHOW";
export type SaleStatusView = "PENDING" | "WON" | "LOST" | "FOLLOW_UP";
export type PipelineStage = "NEW_LEAD" | "CONTACTED" | "REPLIED" | "QUALIFIED" | "BOOKED" | "SHOWED" | "CLOSED_WON" | "CLOSED_LOST";

export const PIPELINE_STAGES: { key: PipelineStage; label: string }[] = [
  { key: "NEW_LEAD", label: "New lead" },
  { key: "CONTACTED", label: "Contacted" },
  { key: "REPLIED", label: "Replied" },
  { key: "QUALIFIED", label: "Qualified" },
  { key: "BOOKED", label: "Booked" },
  { key: "SHOWED", label: "Showed" },
  { key: "CLOSED_WON", label: "Closed won" },
  { key: "CLOSED_LOST", label: "Closed lost" },
];

export const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = { SCHEDULED: "Planifié", CANCELLED: "Annulé", NO_SHOW: "No-show", SHOWED: "Showed" };
export const SALE_STATUS_LABEL: Record<SaleStatusView, string> = { PENDING: "En attente", WON: "Gagné", LOST: "Perdu", FOLLOW_UP: "Follow-up" };

export interface LeadBusiness {
  leadId: string;
  name: string;
  handle: string;
  email: string;
  phone: string;
  mock: boolean;
  crmStage: Lead["stage"];
  /** « AAAA-MM-JJ » d'acquisition (first touch), fuseau de l'equipe. */
  acquiredDay: string;
  acquiredAt: string;
  sourceChannel: SourceChannel;
  funnelSource: string;
  campaignId: string;
  adsetId: string;
  adId: string;
  campaignName: string;
  adsetName: string;
  adName: string;
  lastTouchSourceChannel: SourceChannel | "";
  validLead: boolean;
  qualifiedLead: boolean;
  bookingProvider: "ICLOSED" | "MANUAL" | "";
  bookingId: string;
  bookingStatus: BookingStatus | null;
  bookingCreatedAt: string;
  appointmentAt: string;
  showStatus: ShowStatus | null;
  saleStatus: SaleStatusView;
  revenue: number;
  cashCollected: number;
  currency: string;
  pipelineStage: PipelineStage;
}


/** Une echeance de paiement, en retard ou a venir, lisible depuis le dashboard. */
export interface DueInstallment {
  saleId: string;
  appointmentId: string;
  leadId: string;
  leadName: string;
  /** AAAA-MM-JJ. */
  dueAt: string;
  amount: number;
  /** Numero de l'echeance dans le plan et nombre total. */
  n: number;
  of: number;
  overdue: boolean;
}

/** Tresorerie des ventes reelles : ce qui est encaisse, ce qui reste, et quand. */
export interface Cashflow {
  /** Cash encaisse sur la periode (ventes + encaissements dates dans la periode). */
  cashInRange: number;
  /** Cash encaisse depuis le 1er du mois. */
  cashMonth: number;
  /** Reste a encaisser sur toutes les ventes actives. */
  remainingTotal: number;
  /** Ventes actives avec un reste a encaisser. */
  pendingSales: number;
  overdue: DueInstallment[];
  /** Echeances des 30 prochains jours. */
  upcoming: DueInstallment[];
  upcomingTotal: number;
  overdueTotal: number;
}
