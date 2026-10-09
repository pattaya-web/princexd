import { NextRequest } from "next/server";
import { readDB } from "@/lib/db";
import { readSession, requireAdmin } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { rangeFromQuery } from "@/lib/mediabuying/http";
import { aggregateBusiness, leadsForGroup, type BusinessFilters, type GroupBy } from "@/lib/sales/business";
import type { SourceChannel } from "@/lib/types";

export const dynamic = "force-dynamic";

const GROUPS: GroupBy[] = ["none", "source", "funnel", "campaign", "adset", "ad"];

/**
 * Sales Dashboard : tout le business, toutes sources confondues, filtre et
 * groupe cote serveur. `?detail=<cle de ligne>` rend les leads derriere une
 * ligne (ou `detail=all` pour les totaux).
 */
export async function GET(req: NextRequest) {
  return handle(() => {
    requireAdmin(readSession(req));
    const q = req.nextUrl.searchParams;
    const range = rangeFromQuery(req, "Europe/Paris");
    const filters: BusinessFilters = {
      source: (q.get("source") ?? "") as SourceChannel | "",
      funnel: q.get("funnel") ?? "",
      campaignId: q.get("campaignId") ?? "",
      adsetId: q.get("adsetId") ?? "",
      adId: q.get("adId") ?? "",
      crmStage: (q.get("crmStage") ?? "") as BusinessFilters["crmStage"],
      bookingStatus: (q.get("bookingStatus") ?? "") as BusinessFilters["bookingStatus"],
      saleStatus: (q.get("saleStatus") ?? "") as BusinessFilters["saleStatus"],
    };
    const groupBy = (GROUPS.includes(q.get("groupBy") as GroupBy) ? q.get("groupBy") : "source") as GroupBy;
    const detail = q.get("detail");
    const db = readDB();
    if (detail) return { leads: leadsForGroup(db, { range, filters, groupBy, key: detail }) };
    return aggregateBusiness(db, { range, filters, groupBy });
  });
}
