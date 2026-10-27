/**
 * Liens UTM traques (Sales → Liens UTM).
 *
 * Un lien = une destination + cinq parametres utm. Le rattachement d'un
 * lead a un lien est EXACT : ses parametres de first touch (lus sur la page
 * d'opt-in Systeme.io) ou ceux d'une reservation iClosed doivent etre les
 * memes, source, medium, campaign, content et term compris. Pas d'heuristique :
 * un lead compte pour un lien, ou pour aucun. Module pur : serveur et navigateur.
 */

import type { Appointment, DB, Lead, Sale, UtmLink } from "../types";
import { leadBusiness, type LeadBusiness } from "./business";
import { utmKey, type UtmParams } from "./utm-url";

export * from "./utm-url";

const norm = (v?: string) => (v ?? "").trim().toLowerCase();

/** Les parametres utm d'un rendez-vous (`Appointment.utm`, cles normalisees par lib/sales/sources). */
function utmOfAppointment(a: Appointment): Partial<UtmParams> | null {
  const u = a.utm;
  if (!u) return null;
  const get = (...keys: string[]) => {
    for (const k of keys) if (u[k]) return u[k];
    return "";
  };
  const p = { source: get("source", "utm_source"), medium: get("medium", "utm_medium"), campaign: get("campaign", "utm_campaign"), content: get("content", "utm_content"), term: get("term", "utm_term") };
  return p.source || p.campaign ? p : null;
}

export type UtmHit = { via: "opt-in" | "reservation"; at: string };

/** Ce lead est-il venu par ce lien ? Par sa page d'opt-in, ou par une reservation iClosed faite avec. */
export function matchLeadToLink(lead: Lead, appts: Appointment[], link: UtmLink): UtmHit | null {
  const key = utmKey(link);
  if (norm(lead.firstTouchUtmSource) || norm(lead.firstTouchUtmCampaign)) {
    const k = utmKey({ source: lead.firstTouchUtmSource, medium: lead.firstTouchUtmMedium, campaign: lead.firstTouchUtmCampaign, content: lead.firstTouchUtmContent, term: lead.firstTouchUtmTerm });
    if (k === key) return { via: "opt-in", at: lead.firstTouchAt || lead.optInAt || lead.createdAt };
  }
  for (const a of appts) {
    const p = utmOfAppointment(a);
    if (p && utmKey(p) === key) return { via: "reservation", at: a.createdAt };
  }
  return null;
}

export interface UtmLeadRow extends LeadBusiness {
  /** Comment le lead a ete rattache au lien, et quand. */
  hit: UtmHit;
}

export interface UtmLinkStats {
  leads: number;
  bookings: number;
  shows: number;
  sales: number;
  revenue: number;
  cashCollected: number;
  /** Premier et dernier lead venus par ce lien. */
  firstLeadAt: string;
  lastLeadAt: string;
  /** Leads par jour (YYYY-MM-DD → n), pour « quel jour ce lien a ramene qui ». */
  byDay: Record<string, number>;
}

export interface UtmLinkRow extends UtmLink {
  stats: UtmLinkStats;
  rows: UtmLeadRow[];
}

/** Chaque lien avec ses leads et ses chiffres (RDV, shows, ventes, CA). */
export function utmLinkRows(db: DB, links: UtmLink[] = db.utmLinks ?? []): UtmLinkRow[] {
  const apptsBy = new Map<string, Appointment[]>();
  for (const a of db.appointments) apptsBy.set(a.leadId, [...(apptsBy.get(a.leadId) ?? []), a]);
  const salesBy = new Map<string, Sale[]>();
  for (const s of db.sales) salesBy.set(s.leadId, [...(salesBy.get(s.leadId) ?? []), s]);
  const names = new Map(db.team.map((m) => [m.id, m.name]));
  const currency = db.settings.salesCurrency || "EUR";

  return links.map((link) => {
    const rows: UtmLeadRow[] = [];
    for (const lead of db.leads) {
      if (lead.mock) continue;
      const appts = apptsBy.get(lead.id) ?? [];
      const hit = matchLeadToLink(lead, appts, link);
      if (!hit) continue;
      rows.push({ ...leadBusiness(lead, appts, salesBy.get(lead.id) ?? [], currency, "Europe/Paris", names), hit });
    }
    rows.sort((a, b) => b.hit.at.localeCompare(a.hit.at));
    const byDay: Record<string, number> = {};
    for (const r of rows) {
      const d = r.hit.at.slice(0, 10);
      byDay[d] = (byDay[d] ?? 0) + 1;
    }
    const stats: UtmLinkStats = {
      leads: rows.length,
      bookings: rows.filter((r) => r.bookingStatus && r.bookingStatus !== "CANCELLED").length,
      shows: rows.filter((r) => r.showStatus === "SHOWED").length,
      sales: rows.filter((r) => r.saleStatus === "WON").length,
      revenue: rows.reduce((n, r) => n + (r.saleStatus === "WON" ? r.revenue : 0), 0),
      cashCollected: rows.reduce((n, r) => n + r.cashCollected, 0),
      firstLeadAt: rows.length ? rows[rows.length - 1].hit.at : "",
      lastLeadAt: rows.length ? rows[0].hit.at : "",
      byDay,
    };
    return { ...link, stats, rows };
  });
}
