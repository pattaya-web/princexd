import { NextRequest } from "next/server";
import { readSession, requireAdmin } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { listLogs } from "@/lib/sales/repo";

export const dynamic = "force-dynamic";

/**
 * Journal d'audit.
 *
 * Reserve a l'admin : savoir qui a modifie quoi n'a de sens que pour celui qui
 * arbitre. Les lignes ne sont ni modifiables ni supprimables par l'API.
 */
export async function GET(req: NextRequest) {
  return handle(() => {
    requireAdmin(readSession(req));
    const p = req.nextUrl.searchParams;
    return {
      logs: listLogs(
        p.get("entity") ?? undefined,
        p.get("entityId") ?? undefined,
        Math.min(Number(p.get("limit")) || 100, 500),
      ),
    };
  });
}
