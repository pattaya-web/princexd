import { NextRequest, NextResponse } from "next/server";
import { readDB } from "@/lib/db";
import { readSession, requireAdmin } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { rangeFromQuery } from "@/lib/mediabuying/http";
import { aggregateBusiness, applyStatsSince, businessCsv, leadsForGroup, remainingSales, type BusinessFilters, type GroupBy } from "@/lib/sales/business";
import type { SourceChannel } from "@/lib/types";

export const dynamic = "force-dynamic";

const GROUPS: GroupBy[] = ["none", "source", "funnel", "campaign", "adset", "ad"];

function filtersFrom(q: URLSearchParams): BusinessFilters {
  return {
    source: (q.get("source") ?? "") as SourceChannel | "",
    funnel: q.get("funnel") ?? "",
    campaignId: q.get("campaignId") ?? "",
    adsetId: q.get("adsetId") ?? "",
    adId: q.get("adId") ?? "",
    crmStage: (q.get("crmStage") ?? "") as BusinessFilters["crmStage"],
    bookingStatus: (q.get("bookingStatus") ?? "") as BusinessFilters["bookingStatus"],
    saleStatus: (q.get("saleStatus") ?? "") as BusinessFilters["saleStatus"],
  };
}

/**
 * Sales Dashboard : tout le business, toutes sources confondues, filtre et
 * groupe cote serveur. `?detail=<cle de ligne>` rend les leads derriere une
 * ligne (ou `detail=all` pour les totaux).
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  /* Export CSV : meme periode, memes filtres, fichier a telecharger. */
  if (q.get("export") === "csv") {
    try {
      requireAdmin(readSession(req));
      const db = readDB();
      const range = applyStatsSince(db, rangeFromQuery(req, "Europe/Paris"));
      const csv = businessCsv(db, { range, filters: filtersFrom(q) });
      return new Response(`\ufeff${csv}`, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="sales-${range.from}_${range.to}.csv"`,
        },
      });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
  }
  return handle(() => {
    requireAdmin(readSession(req));
    const db = readDB();
    // Rien avant la date de depart des chiffres (reglage « compter depuis le »).
    const range = applyStatsSince(db, rangeFromQuery(req, "Europe/Paris"));
    const filters = filtersFrom(q);
    const groupBy = (GROUPS.includes(q.get("groupBy") as GroupBy) ? q.get("groupBy") : "source") as GroupBy;
    const detail = q.get("detail");
    // La tuile « Reste à encaisser » : toutes les ventes pas soldees, hors periode.
    if (detail === "remaining") return { sales: remainingSales(db) };
    if (detail) return { leads: leadsForGroup(db, { range, filters, groupBy, key: detail }) };
    return aggregateBusiness(db, { range, filters, groupBy });
  });
}
