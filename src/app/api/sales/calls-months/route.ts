import { NextRequest } from "next/server";
import { readDB } from "@/lib/db";
import { rangeFromQuery } from "@/lib/mediabuying/http";
import { callsReport } from "@/lib/sales/calls-months";
import { defaultCloserId } from "@/lib/sales/closers";
import { readSession, requireAdmin } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import type { BusinessFilters } from "@/lib/sales/business";
import type { SourceChannel } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Les calls du Sales Dashboard : meme periode (`preset`, `from`, `to`) et
 * memes filtres que /api/sales/business, plus `closer` = "all" (defaut),
 * "me", ou l'id d'un closer. Totaux, mois par mois, liste des calls et
 * rendez-vous a venir, d'un seul calcul.
 */
export async function GET(req: NextRequest) {
  return handle(() => {
    requireAdmin(readSession(req));
    const db = readDB();
    const q = req.nextUrl.searchParams;
    const range = rangeFromQuery(req, "Europe/Paris");
    const c = q.get("closer") ?? "all";
    const closerId = c === "all" ? "" : c === "me" ? defaultCloserId(db) : c;
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
    return callsReport(db, { from: range.from, to: range.to, closerId, filters });
  });
}
