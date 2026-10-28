import { NextRequest } from "next/server";
import { readDB } from "@/lib/db";
import { getFathomKey } from "@/lib/fathom";
import { analyzeCall, buildCallInsights, buildClosingScript, currentInsights, currentScript, listReviewCalls, reviewStats, type CallInsights, type ClosingScript, type ReviewCall, type ReviewStats } from "@/lib/fathom-review";
import { readSession, requireAdmin } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";

export const dynamic = "force-dynamic";

export interface CallsReviewPayload {
  /** Une cle Fathom est posee (sinon rien a analyser). */
  configured: boolean;
  currency: string;
  calls: ReviewCall[];
  script: ClosingScript | null;
  insights: CallInsights | null;
  stats: ReviewStats;
}

/** Les calls enregistres avec leur analyse, le script, les enseignements et la synthese. `?light=1` : sans la liste. */
export async function GET(req: NextRequest) {
  return handle((): CallsReviewPayload => {
    requireAdmin(readSession(req));
    const db = readDB();
    const light = req.nextUrl.searchParams.get("light") === "1";
    return {
      configured: Boolean(getFathomKey()),
      currency: db.settings.salesCurrency || "EUR",
      calls: light ? [] : listReviewCalls(db),
      script: currentScript(),
      insights: currentInsights(),
      stats: reviewStats(db),
    };
  });
}

/**
 * `action: "analyze"` + appointmentId : analyse (ou re-analyse) un call.
 * `action: "script"` : redige le script de closing. `action: "insights"` : les enseignements.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    requireAdmin(readSession(req));
    const b = (await req.json().catch(() => ({}))) as { action?: string; appointmentId?: string };
    if (b.action === "analyze") return analyzeCall(String(b.appointmentId ?? ""));
    if (b.action === "script") return buildClosingScript();
    if (b.action === "insights") return buildCallInsights();
    throw new Error("Action inconnue.");
  });
}
