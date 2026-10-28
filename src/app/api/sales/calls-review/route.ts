import { NextRequest } from "next/server";
import { readDB } from "@/lib/db";
import { getFathomKey } from "@/lib/fathom";
import { analyzeCall, buildClosingScript, currentScript, listReviewCalls, type ClosingScript, type ReviewCall } from "@/lib/fathom-review";
import { readSession, requireAdmin } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";

export const dynamic = "force-dynamic";

export interface CallsReviewPayload {
  /** Une cle Fathom est posee (sinon rien a analyser). */
  configured: boolean;
  calls: ReviewCall[];
  script: ClosingScript | null;
}

/** Les calls enregistres par Fathom avec leur analyse, et le script de closing en cours. */
export async function GET(req: NextRequest) {
  return handle((): CallsReviewPayload => {
    requireAdmin(readSession(req));
    return { configured: Boolean(getFathomKey()), calls: listReviewCalls(readDB()), script: currentScript() };
  });
}

/**
 * `action: "analyze"` + appointmentId : analyse (ou re-analyse) un call.
 * `action: "script"` : redige le script de closing a partir des calls analyses.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    requireAdmin(readSession(req));
    const b = (await req.json().catch(() => ({}))) as { action?: string; appointmentId?: string };
    if (b.action === "analyze") return analyzeCall(String(b.appointmentId ?? ""));
    if (b.action === "script") return buildClosingScript();
    throw new Error("Action inconnue.");
  });
}
