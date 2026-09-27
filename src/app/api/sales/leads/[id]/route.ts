import { NextRequest } from "next/server";
import { newId, readDB, writeDB } from "@/lib/db";
import { canSee, Forbidden, readSession, requireSales } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";

export const dynamic = "force-dynamic";

type Action = "attempt" | "reached" | "lost" | "note" | "assign";

/**
 * Suivi d'un appel depuis la liste « À appeler ».
 *  - attempt : tente, pas de reponse (compteur + rappel demain) ;
 *  - reached : joint, conversation en cours ;
 *  - lost    : pas interesse / faux numero ;
 *  - note    : remplace la note libre ;
 *  - assign  : admin, change de setter.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = requireSales(readSession(req));
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as { action?: Action; note?: string; setterId?: string; reason?: string };

    const db = readDB();
    const lead = db.leads.find((l) => l.id === id);
    if (!lead) throw new Error("Lead introuvable.");
    if (!canSee(session, { setterId: lead.setterId })) throw new Forbidden();

    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 3600_000).toISOString().slice(0, 10);
    let summary = "";

    switch (body.action) {
      case "attempt":
        lead.callAttempts = (lead.callAttempts ?? 0) + 1;
        lead.lastCallAt = now.toISOString();
        if (lead.stage === "nouveau") lead.stage = "contacte";
        lead.nextAction = "Rappeler le prospect";
        lead.nextActionAt = tomorrow;
        summary = `${session.memberName || "Moi"} a appelé ${lead.name} sans réponse (essai ${lead.callAttempts})`;
        break;
      case "reached":
        lead.callAttempts = (lead.callAttempts ?? 0) + 1;
        lead.lastCallAt = now.toISOString();
        lead.stage = "conversation";
        lead.nextAction = "Fixer le rendez-vous";
        lead.nextActionAt = now.toISOString().slice(0, 10);
        summary = `${session.memberName || "Moi"} a joint ${lead.name}`;
        break;
      case "lost":
        lead.stage = "closed-lost";
        lead.nextAction = "";
        lead.nextActionAt = "";
        if (body.reason?.trim()) lead.notes = `${lead.notes ? `${lead.notes}\n` : ""}Perdu : ${body.reason.trim()}`;
        summary = `${session.memberName || "Moi"} a classé ${lead.name} comme perdu${body.reason ? ` (${body.reason})` : ""}`;
        break;
      case "note":
        lead.notes = (body.note ?? "").trim();
        break;
      case "assign":
        if (!session.isAdmin) throw new Forbidden("Seul l'admin réattribue un lead.");
        if (!body.setterId || !db.team.some((m) => m.id === body.setterId)) throw new Error("Setter inconnu.");
        lead.setterId = body.setterId;
        lead.ownerName = db.team.find((m) => m.id === body.setterId)?.name ?? "";
        summary = `${lead.name} attribué à ${lead.ownerName}`;
        break;
      default:
        throw new Error("Action inconnue.");
    }

    if (summary) {
      db.activityLogs.unshift({
        id: newId(),
        at: now.toISOString(),
        actorId: session.memberId,
        actorName: session.memberName || "Moi",
        action: `lead.${body.action}`,
        entity: "lead",
        entityId: lead.id,
        summary,
      });
    }
    writeDB(db);
    return { lead };
  });
}
