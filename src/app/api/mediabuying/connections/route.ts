import { NextRequest } from "next/server";
import { handle } from "@/lib/sales/http";
import { adminSession } from "@/lib/mediabuying/http";
import { createConnection, listConnections } from "@/lib/mediabuying/repo";

export const dynamic = "force-dynamic";

/** Comptes Meta connectes, sans jamais le jeton. */
export async function GET(req: NextRequest) {
  return handle(() => {
    adminSession(req);
    return { rows: listConnections() };
  });
}

/** Ajoute un compte : la connexion est testee avant d'etre enregistree. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const session = adminSession(req);
    const b = (await req.json()) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    return createConnection(session, { name: str(b.name), businessManagerId: str(b.businessManagerId), adAccountId: str(b.adAccountId), accessToken: str(b.accessToken) });
  });
}
