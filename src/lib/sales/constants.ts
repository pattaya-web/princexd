/**
 * Vocabulaire du module commercial.
 *
 * Une seule source pour les listes d'options et leur regroupement, afin que
 * les formulaires, les filtres et les calculs parlent tous des memes valeurs.
 * Ce fichier est pur : il est importe aussi bien cote serveur que navigateur.
 */
import type {
  AppointmentSource,
  AppointmentStatus,
  CommissionType,
  LostReason,
  PaymentType,
  SaleStatus,
} from "../types";

export const APPOINTMENT_STATUSES: AppointmentStatus[] = [
  "booked",
  "confirmed",
  "rescheduled",
  "completed",
  "no-show",
  "cancelled",
  "follow-up",
  "closed-won",
  "closed-lost",
];

export const APPOINTMENT_SOURCES: AppointmentSource[] = [
  "instagram-dm",
  "instagram-story",
  "instagram-reel",
  "inbound",
  "outbound",
  "referral",
  "other",
];

export const LOST_REASONS: LostReason[] = [
  "too-expensive",
  "no-money",
  "need-to-think",
  "need-partner-approval",
  "not-qualified",
  "not-interested",
  "timing",
  "competitor",
  "other",
];

export const PAYMENT_TYPES: PaymentType[] = ["paid-in-full", "installments", "deposit", "other"];

export const SALE_STATUSES: SaleStatus[] = ["active", "partially-refunded", "refunded", "cancelled"];

export const COMMISSION_TYPES: CommissionType[] = [
  "per-appointment",
  "per-show",
  "pct-revenue",
  "pct-cash",
  "fixed-plus-pct",
  "custom",
];

/**
 * Statuts prouvant que le prospect s'est presente au call.
 *
 * Un call peut avoir ete honore puis reclasse en closed-won ou en follow-up :
 * ces statuts comptent donc tous comme un show. C'est la definition utilisee
 * partout pour le show rate, sans exception.
 */
export const ATTENDED_STATUSES: AppointmentStatus[] = [
  "completed",
  "follow-up",
  "closed-won",
  "closed-lost",
];

/** Un rendez-vous annule ne compte ni au numerateur ni au denominateur. */
export const DEAD_STATUSES: AppointmentStatus[] = ["cancelled"];

/** Statuts terminaux : le rendez-vous ne bougera plus. */
export const FINAL_STATUSES: AppointmentStatus[] = ["closed-won", "closed-lost", "cancelled", "no-show"];

export const isAttended = (s: AppointmentStatus) => ATTENDED_STATUSES.includes(s);
export const isDead = (s: AppointmentStatus) => DEAD_STATUSES.includes(s);

/** Couleur du badge de statut, alignee sur les variables du design system. */
export function statusTone(status: AppointmentStatus): "" | "accent" | "good" | "warn" | "danger" {
  switch (status) {
    case "closed-won":
      return "good";
    case "completed":
    case "confirmed":
      return "accent";
    case "follow-up":
    case "rescheduled":
      return "warn";
    case "no-show":
    case "closed-lost":
    case "cancelled":
      return "danger";
    default:
      return "";
  }
}

export function saleTone(status: SaleStatus): "" | "good" | "warn" | "danger" {
  switch (status) {
    case "active":
      return "good";
    case "partially-refunded":
      return "warn";
    case "refunded":
    case "cancelled":
      return "danger";
    default:
      return "";
  }
}

/**
 * Transitions autorisees depuis chaque statut.
 *
 * Empeche les incoherences du type "no-show" -> "closed-won" sans repasser par
 * un vrai call : le closer doit reprogrammer, ce qui laisse une trace.
 */
export const NEXT_STATUSES: Record<AppointmentStatus, AppointmentStatus[]> = {
  booked: ["confirmed", "rescheduled", "completed", "no-show", "cancelled"],
  confirmed: ["completed", "no-show", "rescheduled", "cancelled"],
  rescheduled: ["confirmed", "completed", "no-show", "cancelled"],
  completed: ["closed-won", "closed-lost", "follow-up"],
  "follow-up": ["closed-won", "closed-lost", "completed", "rescheduled"],
  "no-show": ["rescheduled", "cancelled"],
  cancelled: ["rescheduled"],
  "closed-won": ["closed-lost"],
  "closed-lost": ["follow-up", "closed-won"],
};

/** Resultats proposes au closer a la fin d'un call. */
export const CALL_OUTCOMES: AppointmentStatus[] = [
  "closed-won",
  "closed-lost",
  "follow-up",
  "no-show",
  "rescheduled",
];
