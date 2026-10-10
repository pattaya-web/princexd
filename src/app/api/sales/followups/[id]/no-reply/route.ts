import { NextRequest } from "next/server";
import { readSession, requireSales } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { followUpNoReply } from "@/lib/sales/repo";

export const dynamic = "force-dynamic";

/**
 * « Pas de réponse » sur une relance : la suivante est programmee (J+3), ou
 * le lead passe froid si c'etait la derniere.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = requireSales(readSession(req));
    const { id } = await ctx.params;
    return followUpNoReply(session, id);
  });
}
