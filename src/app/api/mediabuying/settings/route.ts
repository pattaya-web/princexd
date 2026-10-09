import { NextRequest } from "next/server";
import { handle } from "@/lib/sales/http";
import { adminSession, requireParam } from "@/lib/mediabuying/http";
import { getSettings, patchSettings } from "@/lib/mediabuying/repo";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return handle(() => {
    adminSession(req);
    return getSettings(requireParam(req, "connectionId"));
  });
}

export async function PATCH(req: NextRequest) {
  return handle(async () => {
    const session = adminSession(req);
    const b = (await req.json()) as Record<string, unknown>;
    const connectionId = typeof b.connectionId === "string" ? b.connectionId : "";
    if (!connectionId) throw new Error("connectionId manquant.");
    return patchSettings(session, connectionId, b);
  });
}
