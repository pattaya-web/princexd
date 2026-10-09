import { NextRequest } from "next/server";
import { handle } from "@/lib/sales/http";
import { adminSession } from "@/lib/mediabuying/http";
import { publishDraft } from "@/lib/mediabuying/repo";

export const dynamic = "force-dynamic";

/** Cree la campagne chez Meta, en pause. Confirmation faite cote interface. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = adminSession(req);
    const { id } = await ctx.params;
    const b = (await req.json()) as { connectionId?: string };
    if (!b.connectionId) throw new Error("connectionId manquant.");
    return publishDraft(session, b.connectionId, id);
  });
}
