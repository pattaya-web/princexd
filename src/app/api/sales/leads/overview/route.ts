import { NextRequest } from "next/server";
import { readDB } from "@/lib/db";
import { readSession, requireSales } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { setterSafeDB } from "@/lib/sales/setter-view";

import { funnelLabel, funnelsOf } from "@/lib/sales/attribution";
import { leadBusiness, type LeadBusiness } from "@/lib/sales/business";
import { getSystemeioKey, syncSystemeio } from "@/lib/systemeio";
import type { Appointment, Sale, SourceChannel } from "@/lib/types";

export const dynamic = "force-dynamic";

export interface OverviewLeadRow extends LeadBusiness {
  igUsername: string;
  country: string;
  optInAt: string;
  /** Page d'opt-in (Systeme.io), telle quelle. */
  sourceUrl: string;
  /** Chemin de la page, sans domaine ni parametres : /lp-orga. */
  page: string;
  funnelLabel: string;
  utm: { source: string; medium: string; campaign: string; content: string; term: string };
  /** Ce qui a tranche la provenance : utm, clic Meta, page d'opt-in, correction manuelle, rien. */
  via: "utm" | "meta" | "page" | "manual" | "none";
  optInCount: number;
  callStatus: string;
  setterId: string;
}

const pathOf = (url: string) => {
  try {
    return new URL(url).pathname.replace(/\/+$/, "") || "/";
  } catch {
    return url.split("?")[0].slice(0, 60);
  }
};

/**
 * Tous les inscrits Systeme.io avec leur provenance (page, funnel, utm,
 * clic Meta) et ce qu'ils sont devenus (RDV, show, vente). Une synchro
 * Systeme.io au passage, comme la liste a appeler.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const session = requireSales(readSession(req));
    let syncError = "";
    if (getSystemeioKey()) {
      try {
        await syncSystemeio();
      } catch (e) {
        syncError = (e as Error).message;
      }
    } else syncError = "aucune clé API Systeme.io sur ce serveur (Réglages → Systeme.io).";

    const db = setterSafeDB(readDB(), session);
    const funnels = funnelsOf(db);
    const names = new Map(db.team.map((m) => [m.id, m.name]));
    const currency = db.settings.salesCurrency || "EUR";
    const apptsBy = new Map<string, Appointment[]>();
    for (const a of db.appointments) apptsBy.set(a.leadId, [...(apptsBy.get(a.leadId) ?? []), a]);
    const salesBy = new Map<string, Sale[]>();
    for (const s of db.sales) salesBy.set(s.leadId, [...(salesBy.get(s.leadId) ?? []), s]);

    const rows: OverviewLeadRow[] = db.leads
      .filter((l) => !l.mock && (l.systemeioId || l.source === "lp"))
      .map((l) => {
        const base = leadBusiness(l, apptsBy.get(l.id) ?? [], salesBy.get(l.id) ?? [], currency, "Europe/Paris", names);
        const via: OverviewLeadRow["via"] = l.attributionLocked ? "manual" : l.firstTouchUtmSource || l.firstTouchUtmCampaign ? "utm" : l.firstTouchFbclid || l.firstTouchFbc || l.firstTouchAdId || l.firstTouchCampaignId ? "meta" : l.sourceUrl || l.lastOptInUrl ? "page" : "none";
        const url = l.lastOptInUrl || l.sourceUrl || "";
        return {
          ...base,
          igUsername: l.igUsername ?? "",
          country: l.country ?? "",
          optInAt: l.optInAt || l.createdAt,
          sourceUrl: url,
          page: url ? pathOf(url) : "",
          funnelLabel: funnelLabel(base.funnelSource, funnels),
          utm: { source: l.firstTouchUtmSource ?? "", medium: l.firstTouchUtmMedium ?? "", campaign: l.firstTouchUtmCampaign ?? "", content: l.firstTouchUtmContent ?? "", term: l.firstTouchUtmTerm ?? "" },
          via,
          optInCount: l.optInCount ?? 1,
          callStatus: l.callStatus ?? "",
          setterId: l.setterId ?? "",
        };
      })
      .sort((a, b) => b.optInAt.localeCompare(a.optInAt));

    const byChannel: Partial<Record<SourceChannel, number>> = {};
    for (const r of rows) byChannel[r.sourceChannel] = (byChannel[r.sourceChannel] ?? 0) + 1;
    return { rows, byChannel, lastSyncAt: db.settings.systemeioLastSyncAt ?? "", syncError, currency };
  });
}
