import { NextRequest } from "next/server";
import { readSession, requireSales } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { completeFollowUp } from "@/lib/sales/repo";

export const dynamic = "force-dynamic";

/** Cloture d'une relance : faite ou abandonnee. La ligne reste en base. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = requireSales(readSession(req));
    const { id } = await ctx.params;
    const { status } = (await req.json()) as { status?: string };
    if (status !== "done" && status !== "cancelled") {
      throw new Error("Statut de relance invalide.");
    }
    return completeFollowUp(session, id, status);
  });
}
