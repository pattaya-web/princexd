import { NextRequest } from "next/server";
import { readDB } from "@/lib/db";
import { readSession, requireSales } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { runOps } from "@/lib/sales/ops/run";
import { buildWorkspace } from "@/lib/sales/ops/views";
import { appointmentAction, completeTask, leadAction, noteTask, paymentFollowAction, snoozeTask, type LeadActionInput } from "@/lib/sales/ops/actions";

export const dynamic = "force-dynamic";

/**
 * Cockpit du Sales OS (« Mon espace de travail »).
 *
 * GET : realigne la file de taches (le travail du jour est a jour a
 * l'ouverture, sans attendre le scheduler), puis renvoie la file et les
 * poles du membre. `?owner=<id>|all|admin` : vue d'un autre membre, pour le
 * Head of Setting et l'admin seulement (ignore pour un setter).
 */
export async function GET(req: NextRequest) {
  return handle(() => {
    const session = requireSales(readSession(req));
    runOps();
    const owner = req.nextUrl.searchParams.get("owner") ?? "";
    return buildWorkspace(readDB(), session, Date.now(), owner);
  });
}

/** Actions rapides : une seule route, un champ `type`. Les droits sont verifies dans lib/sales/ops/actions. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const session = requireSales(readSession(req));
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : "");
    switch (body.type) {
      case "task.done":
        return completeTask(session, { taskId: str("taskId"), expectedUpdatedAt: str("expectedUpdatedAt") || undefined, outcome: str("outcome"), note: str("note"), channel: str("channel"), at: str("at") });
      case "task.snooze":
        return snoozeTask(session, { taskId: str("taskId"), until: str("until"), note: str("note"), expectedUpdatedAt: str("expectedUpdatedAt") || undefined });
      case "task.note":
        return noteTask(session, { taskId: str("taskId"), text: str("text") });
      case "lead":
        return leadAction(session, body as unknown as LeadActionInput);
      case "appointment":
        return appointmentAction(session, { appointmentId: str("appointmentId"), op: str("op") as "confirm", confirmation: str("confirmation"), at: str("at"), state: str("state") });
      case "payment":
        return paymentFollowAction(session, { saleId: str("saleId"), state: str("state"), note: str("note") });
      default:
        throw new Error("Action inconnue.");
    }
  });
}
