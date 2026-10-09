import { NextRequest } from "next/server";
import { handle } from "@/lib/sales/http";
import { adminSession } from "@/lib/mediabuying/http";
import { auditClientEvent, listAudit } from "@/lib/mediabuying/repo";
import type { AuditEntityType } from "@/lib/mediabuying/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return handle(() => {
    adminSession(req);
    const q = req.nextUrl.searchParams;
    const limit = Math.min(1000, Math.max(1, Number(q.get("limit") ?? 200) || 200));
    return { rows: listAudit(q.get("connectionId"), limit) };
  });
}

/** Evenements du navigateur a journaliser (copie d'un Post ID, export…). */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const session = adminSession(req);
    const b = (await req.json()) as { connectionId?: string; entityType?: AuditEntityType; entityId?: string; entityName?: string; action?: string; summary?: string };
    if (!b.connectionId || !b.action || !b.summary) throw new Error("Évènement incomplet.");
    auditClientEvent(session, b.connectionId, b.entityType ?? "ad", b.entityId ?? "", (b.entityName ?? "").slice(0, 200), b.action.slice(0, 60), b.summary.slice(0, 300));
    return { ok: true };
  });
}
