import { NextRequest } from "next/server";
import { handle } from "@/lib/sales/http";
import { adminSession } from "@/lib/mediabuying/http";
import { deleteConnection, updateConnection } from "@/lib/mediabuying/repo";

export const dynamic = "force-dynamic";

/** Nom, BM, compte, ou nouveau jeton (jamais relu, seulement remplace). */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = adminSession(req);
    const { id } = await ctx.params;
    const b = (await req.json()) as Record<string, unknown>;
    const patch: Record<string, string> = {};
    for (const k of ["name", "businessManagerId", "adAccountId", "accessToken"]) if (typeof b[k] === "string") patch[k] = b[k] as string;
    return updateConnection(session, id, patch);
  });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = adminSession(req);
    const { id } = await ctx.params;
    return deleteConnection(session, id);
  });
}
