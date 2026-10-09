import { NextRequest } from "next/server";
import { handle } from "@/lib/sales/http";
import { adminSession, requireParam } from "@/lib/mediabuying/http";
import { syncConnection } from "@/lib/mediabuying/repo";

export const dynamic = "force-dynamic";

/**
 * Synchronisation d'un compte. `force=1` (bouton Synchroniser) ignore le
 * cache d'une minute et va chercher des chiffres frais.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    adminSession(req);
    const id = requireParam(req, "connectionId");
    const force = req.nextUrl.searchParams.get("force") === "1";
    return syncConnection(id, { force });
  });
}
