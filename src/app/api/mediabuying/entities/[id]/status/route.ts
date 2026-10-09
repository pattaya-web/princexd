import { NextRequest } from "next/server";
import { handle } from "@/lib/sales/http";
import { adminSession } from "@/lib/mediabuying/http";
import { setStatus } from "@/lib/mediabuying/repo";
import type { EntityLevel } from "@/lib/mediabuying/types";

export const dynamic = "force-dynamic";

/** Pause / reactivation d'une campagne, d'un ad set ou d'une ad. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = adminSession(req);
    const { id } = await ctx.params;
    const b = (await req.json()) as { connectionId?: string; level?: EntityLevel; status?: string };
    if (!b.connectionId) throw new Error("connectionId manquant.");
    if (b.level !== "campaign" && b.level !== "adset" && b.level !== "ad") throw new Error("Niveau invalide.");
    if (b.status !== "ACTIVE" && b.status !== "PAUSED") throw new Error("Statut invalide.");
    return setStatus(session, b.connectionId, b.level, id, b.status);
  });
}
