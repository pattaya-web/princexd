/**
 * Providers de booking et de ventes.
 *
 * Le Sales Dashboard ne sait pas d'ou viennent les bookings ni les ventes :
 * il lit les rendez-vous et les ventes de la base. Ces interfaces sont la
 * porte d'entree pour les alimenter depuis l'exterieur (iClosed aujourd'hui
 * via l'import existant, Stripe ou Systeme.io demain) sans toucher aux
 * dashboards. Le rattachement a un lead suit toujours la meme priorite :
 * identifiant de suivi interne, puis email, puis telephone normalise.
 */

import { readDB } from "../db";
import { fetchUpcoming, getIclosedKey, type IclosedCall } from "../iclosed";
import type { Appointment, DB, Lead, Sale } from "../types";
import { mockBusinessData } from "./mock-leads";

/* ------------------------------ Matching ------------------------------ */

/** Telephone reduit a ses chiffres, indicatif francais normalise. */
export function normalizePhone(raw: string | undefined): string {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("0033")) return `33${digits.slice(4)}`;
  if (digits.length === 10 && digits.startsWith("0")) return `33${digits.slice(1)}`;
  return digits;
}

export interface BookingCandidate {
  trackingId?: string;
  email?: string;
  phone?: string;
}

/**
 * Le lead auquel rattacher un booking :
 *  1. identifiant de suivi interne (lead id passe dans le lien de reservation) ;
 *  2. email ;
 *  3. telephone normalise.
 */
export function matchBookingToLead(leads: Lead[], b: BookingCandidate): Lead | null {
  if (b.trackingId) {
    const hit = leads.find((l) => l.id === b.trackingId || l.systemeioId === b.trackingId);
    if (hit) return hit;
  }
  const email = (b.email ?? "").trim().toLowerCase();
  if (email) {
    const hit = leads.find((l) => (l.email ?? "").trim().toLowerCase() === email);
    if (hit) return hit;
  }
  const phone = normalizePhone(b.phone);
  if (phone) {
    const hit = leads.find((l) => normalizePhone(l.phone) === phone);
    if (hit) return hit;
  }
  return null;
}

/* --------------------------- Booking provider ------------------------- */

export interface Booking {
  provider: "ICLOSED" | "MOCK" | "MANUAL";
  id: string;
  leadId: string;
  scheduledAt: string;
  status: Appointment["status"];
  createdAt: string;
}

export interface BookingProvider {
  readonly kind: "mock" | "iclosed";
  getBookings(range?: { from: string; to: string }): Promise<Booking[]>;
  getBooking(id: string): Promise<Booking | null>;
  /** Rapatrie les bookings dans la base (rendez-vous + leads) ; rend le nombre importe. */
  syncBookings(): Promise<{ imported: number; skipped: string }>;
  matchBookingToLead(db: DB, b: BookingCandidate): Lead | null;
}

const toBooking = (a: Appointment, provider: Booking["provider"]): Booking => ({ provider, id: a.iclosedEventId || a.id, leadId: a.leadId, scheduledAt: a.scheduledAt, status: a.status, createdAt: a.createdAt });

/** Bookings du jeu de demonstration (jamais ecrits en base). */
export class MockBookingProvider implements BookingProvider {
  readonly kind = "mock" as const;
  async getBookings(range?: { from: string; to: string }) {
    const db = readDB();
    return mockBusinessData(db.metaConnections)
      .appointments.filter((a) => !range || (a.scheduledAt.slice(0, 10) >= range.from && a.scheduledAt.slice(0, 10) <= range.to))
      .map((a) => toBooking(a, "MOCK"));
  }
  async getBooking(id: string) {
    return (await this.getBookings()).find((b) => b.id === id) ?? null;
  }
  async syncBookings() {
    return { imported: 0, skipped: "Les bookings de démonstration vivent en mémoire : rien à importer." };
  }
  matchBookingToLead(db: DB, b: BookingCandidate) {
    return matchBookingToLead([...db.leads, ...mockBusinessData(db.metaConnections).leads], b);
  }
}

/**
 * iClosed : lit l'API publique (cle dans Réglages ou ICLOSED_API_KEY). Les
 * rendez-vous deja importes par la synchro existante (/api/sales/iclosed/sync)
 * sont rendus tels quels ; `syncBookings` s'appuie sur ce meme import.
 */
export class IClosedBookingProvider implements BookingProvider {
  readonly kind = "iclosed" as const;
  async getBookings(range?: { from: string; to: string }) {
    const db = readDB();
    return db.appointments
      .filter((a) => a.iclosedEventId && (!range || (a.scheduledAt.slice(0, 10) >= range.from && a.scheduledAt.slice(0, 10) <= range.to)))
      .map((a) => toBooking(a, "ICLOSED"));
  }
  async getBooking(id: string) {
    const a = readDB().appointments.find((x) => x.iclosedEventId === id || x.id === id);
    return a ? toBooking(a, "ICLOSED") : null;
  }
  async syncBookings() {
    if (!getIclosedKey()) return { imported: 0, skipped: "Aucune clé iClosed." };
    // L'import complet (creation des rendez-vous et des leads, attribution) est
    // celui de /api/sales/iclosed/sync : on compte ici ce qui serait nouveau.
    const calls: IclosedCall[] = await fetchUpcoming();
    const known = new Set(readDB().appointments.map((a) => a.iclosedEventId));
    const fresh = calls.filter((c) => !known.has(String(c.id)));
    return { imported: 0, skipped: fresh.length ? `${fresh.length} booking(s) à importer via la synchro iClosed.` : "À jour." };
  }
  matchBookingToLead(db: DB, b: BookingCandidate) {
    return matchBookingToLead(db.leads, b);
  }
}

export function bookingProvider(): BookingProvider {
  return getIclosedKey() ? new IClosedBookingProvider() : new MockBookingProvider();
}

/* ---------------------------- Sales provider -------------------------- */

export interface SaleRecord {
  provider: "MANUAL" | "MOCK" | "STRIPE" | "SYSTEMEIO";
  id: string;
  leadId: string;
  revenue: number;
  cashCollected: number;
  currency: string;
  soldAt: string;
}

export interface SalesProvider {
  readonly kind: "manual" | "stripe" | "systemeio";
  listSales(range?: { from: string; to: string }): Promise<SaleRecord[]>;
}

const toRecord = (s: Sale, provider: SaleRecord["provider"]): SaleRecord => ({
  provider,
  id: s.id,
  leadId: s.leadId,
  revenue: Math.max(0, s.contractValue - (s.refundAmount || 0)),
  cashCollected: Math.max(0, (s.cashCollected || 0) - (s.refundAmount || 0)),
  currency: s.currency,
  soldAt: s.soldAt,
});

/**
 * Ventes saisies a la main : celles du recap de call (closé → montant, cash
 * encaissé, paiement en N fois). C'est la source actuelle ; Stripe ou
 * Systeme.io viendront s'y ajouter en rendant les memes `SaleRecord`.
 */
export class ManualSalesProvider implements SalesProvider {
  readonly kind = "manual" as const;
  async listSales(range?: { from: string; to: string }) {
    const db = readDB();
    const mock = mockBusinessData(db.metaConnections).sales.map((s) => toRecord(s, "MOCK"));
    const real = db.sales.filter((s) => s.status !== "cancelled").map((s) => toRecord(s, "MANUAL"));
    return [...real, ...mock].filter((s) => !range || (s.soldAt.slice(0, 10) >= range.from && s.soldAt.slice(0, 10) <= range.to));
  }
}

export function salesProvider(): SalesProvider {
  return new ManualSalesProvider();
}
