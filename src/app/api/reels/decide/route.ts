import { NextRequest } from "next/server";
import { decideReel, requeueRecentSkips } from "@/lib/reels";
import { readSession, requireAdmin } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import type { ReelDecision, SwipeStage } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Le geste du Tinder : `{ id, decision: "keep" | "skip" | "" }`.
 * « keep » cree le swipe tout de suite, sans formulaire ; `stage` et `note`
 * sont facultatifs et peuvent venir apres (PATCH /api/reels).
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    requireAdmin(readSession(req));
    const b = (await req.json().catch(() => ({}))) as { id?: string; decision?: ReelDecision; stage?: SwipeStage | ""; note?: string; action?: string };
    // « Remettre les passés d'aujourd'hui dans la file » : pas d'id, une action.
    if (b.action === "requeue-recent") return { requeued: requeueRecentSkips() };
    const decision: ReelDecision = b.decision === "keep" ? "keep" : b.decision === "skip" ? "skip" : "";
    return decideReel(String(b.id ?? ""), decision, { stage: b.stage, note: b.note });
  });
}
