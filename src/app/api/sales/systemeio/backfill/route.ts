import { NextRequest } from "next/server";
import { readSession, requireAdmin } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { backfillSystemeio } from "@/lib/systemeio";

export const dynamic = "force-dynamic";

/** Import complet de l'historique Systeme.io (admin). Les anciens inscrits arrivent en leads froids. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const session = requireAdmin(readSession(req));
    const r = await backfillSystemeio(30, `Import complet Systeme.io (${session.memberName || "admin"})`);
    return { examined: r.examined, created: r.created, updated: r.updated, known: r.known, skipped: r.skipped };
  });
}
