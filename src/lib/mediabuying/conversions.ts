/**
 * Donnees business (leads valides et qualifies, bookings, shows, ventes,
 * CA, cash) qui enrichissent les stats Meta.
 *
 * Meta ne sait pas qu'un lead a reserve un call ni qu'il a achete une offre
 * a 3 000 €. Le CRM interne le sait : chaque lead porte son attribution
 * d'acquisition (first touch, `adId`), ses rendez-vous et ses ventes. Ce
 * provider groupe la vue business des leads (lib/sales/business) par ad et
 * par jour d'acquisition. Les leads de demonstration du compte simule
 * passent par le meme chemin : le cockpit lit exactement ce que le Sales
 * Dashboard lit.
 *
 * Brancher une autre source (export iClosed, Stripe…) revient a ecrire un
 * provider qui rend les memes lignes `DailyConversion`.
 */

import { readDB } from "../db";
import { businessDataset } from "../sales/business";
import type { DailyConversion, DateRange, MetaAd, MetaConnection } from "./types";

export type ConversionSource = "none" | "crm" | "custom";

export interface ConversionContext {
  connection: MetaConnection;
  ads: MetaAd[];
  range: DateRange;
}

export interface ConversionDataProvider {
  readonly source: ConversionSource;
  /** Lignes par ad et par jour sur la periode, ou null si rien n'est branche. */
  fetch(ctx: ConversionContext): Promise<DailyConversion[] | null>;
}

/** Rien de branche : les colonnes business restent a « Non connecté ». */
export class NotConnectedProvider implements ConversionDataProvider {
  readonly source = "none" as const;
  async fetch() {
    return null;
  }
}

/** CRM interne : leads attribues a une ad, leurs rendez-vous et leurs ventes. */
export class InternalCrmProvider implements ConversionDataProvider {
  readonly source = "crm" as const;

  async fetch(ctx: ConversionContext): Promise<DailyConversion[] | null> {
    const adIds = new Set(ctx.ads.map((a) => a.id));
    const ds = businessDataset(readDB());
    const byKey = new Map<string, DailyConversion>();
    let any = false;
    for (const r of ds.rows) {
      if (!r.adId || !adIds.has(r.adId)) continue;
      if (r.acquiredDay < ctx.range.from || r.acquiredDay > ctx.range.to) continue;
      any = true;
      const key = `${r.adId}:${r.acquiredDay}`;
      let row = byKey.get(key);
      if (!row) {
        row = { adId: r.adId, date: r.acquiredDay, validLeads: 0, qualifiedLeads: 0, bookings: 0, shows: 0, sales: 0, revenue: 0, cashCollected: 0 };
        byKey.set(key, row);
      }
      if (r.validLead) row.validLeads++;
      if (r.qualifiedLead) row.qualifiedLeads++;
      if (r.bookingStatus && r.bookingStatus !== "CANCELLED") row.bookings++;
      if (r.bookingStatus === "SHOWED") row.shows++;
      if (r.saleStatus === "WON") {
        row.sales++;
        row.revenue += r.revenue;
        row.cashCollected += r.cashCollected;
      }
    }
    // Aucun lead attribue a ce compte : la source est la mais vide, on le dit.
    if (!any && !ds.rows.some((r) => r.adId)) return null;
    return [...byKey.values()];
  }
}

/**
 * Le CRM interne est la source par defaut ; `META_CONVERSIONS=none` coupe
 * l'enrichissement (colonnes a « Non connecté »).
 */
export function conversionProviderFor(_connection: MetaConnection): ConversionDataProvider {
  void _connection;
  if (process.env.META_CONVERSIONS?.trim().toLowerCase() === "none") return new NotConnectedProvider();
  return new InternalCrmProvider();
}
