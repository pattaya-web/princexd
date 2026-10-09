import { NextRequest } from "next/server";
import { handle } from "@/lib/sales/http";
import { adminSession, rangeFromQuery, requireParam } from "@/lib/mediabuying/http";
import { buildOverview, getConnection, getSnapshot, syncConnection } from "@/lib/mediabuying/repo";

export const dynamic = "force-dynamic";

/**
 * Tout le cockpit en une reponse. Si le compte n'a jamais ete synchronise,
 * la premiere synchro est faite ici, en attendant (il n'y a rien d'autre a
 * montrer) ; ensuite les donnees viennent du snapshot.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    adminSession(req);
    const id = requireParam(req, "connectionId");
    const c = getConnection(id);
    if (!getSnapshot(id)) await syncConnection(id, { force: true });
    return buildOverview(id, rangeFromQuery(req, c.timezone || "Europe/Paris"));
  });
}
