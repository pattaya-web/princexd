import { NextRequest } from "next/server";
import { handle } from "@/lib/sales/http";
import { adminSession } from "@/lib/mediabuying/http";
import { setBudget } from "@/lib/mediabuying/repo";

export const dynamic = "force-dynamic";

/** Nouveau budget (quotidien ou total) d'une campagne CBO ou d'un ad set ABO. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = adminSession(req);
    const { id } = await ctx.params;
    const b = (await req.json()) as { connectionId?: string; level?: string; amount?: number; type?: string };
    if (!b.connectionId) throw new Error("connectionId manquant.");
    if (b.level !== "campaign" && b.level !== "adset") throw new Error("Le budget se modifie sur une campagne ou un ad set.");
    const type = b.type === "lifetime" ? "lifetime" : "daily";
    return setBudget(session, b.connectionId, b.level, id, Number(b.amount), type);
  });
}
