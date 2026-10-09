import { NextRequest } from "next/server";
import { handle } from "@/lib/sales/http";
import { adminSession } from "@/lib/mediabuying/http";
import { setAdData, setCampaignData } from "@/lib/mediabuying/repo";
import { PHASES, type Phase, type WinnerStatus } from "@/lib/mediabuying/types";

export const dynamic = "force-dynamic";

const WINNERS: WinnerStatus[] = ["", "testing", "potential-winner", "winner", "loser"];

/**
 * Donnees internes : phase et objectif d'une campagne, winner et note
 * d'une ad. Rien ici ne touche a Meta.
 */
export async function PATCH(req: NextRequest) {
  return handle(async () => {
    const session = adminSession(req);
    const b = (await req.json()) as Record<string, unknown>;
    const connectionId = typeof b.connectionId === "string" ? b.connectionId : "";
    if (!connectionId) throw new Error("connectionId manquant.");
    if (typeof b.campaignId === "string") {
      const patch: { phase?: Phase; leadGoal?: number | null; internalNotes?: string } = {};
      if (typeof b.phase === "string" && ([...PHASES, "unclassified"] as string[]).includes(b.phase)) patch.phase = b.phase as Phase;
      if (b.leadGoal === null || typeof b.leadGoal === "number") patch.leadGoal = b.leadGoal as number | null;
      if (typeof b.internalNotes === "string") patch.internalNotes = b.internalNotes;
      return setCampaignData(session, connectionId, b.campaignId, patch);
    }
    if (typeof b.adId === "string") {
      const patch: { winnerStatus?: WinnerStatus; notes?: string } = {};
      if (typeof b.winnerStatus === "string" && WINNERS.includes(b.winnerStatus as WinnerStatus)) patch.winnerStatus = b.winnerStatus as WinnerStatus;
      if (typeof b.notes === "string") patch.notes = b.notes;
      return setAdData(session, connectionId, b.adId, patch);
    }
    throw new Error("campaignId ou adId attendu.");
  });
}
