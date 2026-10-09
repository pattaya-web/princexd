import { NextRequest } from "next/server";
import { handle } from "@/lib/sales/http";
import { adminSession } from "@/lib/mediabuying/http";
import { disconnectConnection } from "@/lib/mediabuying/repo";

export const dynamic = "force-dynamic";

/** Efface le jeton ; phases, notes et journal restent. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = adminSession(req);
    const { id } = await ctx.params;
    return disconnectConnection(session, id);
  });
}
