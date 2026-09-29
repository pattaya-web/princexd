import { NextRequest } from "next/server";
import { newId, readDB, writeDB } from "@/lib/db";
import { canSee, Forbidden, readSession, requireSales } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { sessionHas } from "@/lib/sales/roles";
import type { LeadCallStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

type Action = "status" | "reopen" | "attempt" | "reached" | "lost" | "note" | "assign";

const STATUSES: LeadCallStatus[] = ["no-answer", "message-sent", "callback", "reached", "not-interested"];

const STATUS_LABEL: Record<LeadCallStatus, string> = {
  "no-answer": "ne répond pas",
  "message-sent": "message envoyé",
  callback: "à rappeler",
  reached: "joint",
  "not-interested": "pas intéressé",
};

/**
 * Suivi d'un appel depuis la liste « À appeler ».
 *  - status  : pose un statut d'appel (ne repond pas, message envoye, a
 *              rappeler + date, joint, pas interesse) ;
 *  - attempt / reached / lost : anciennes actions, gardees pour les clients
 *              deja ouverts, traduites vers un statut ;
 *  - note    : remplace la note libre ;
 *  - assign  : admin, change de setter.
 *
 * Un lead encore sans setter (arrive avant la creation des comptes, ou pool
 * commun) est pris par le setter qui agit dessus : c'est lui qui l'a appele,
 * c'est a lui qu'il revient.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = requireSales(readSession(req));
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as {
      action?: Action;
      status?: LeadCallStatus;
      callbackAt?: string;
      note?: string;
      setterId?: string;
      reason?: string;
    };

    const db = readDB();
    const lead = db.leads.find((l) => l.id === id);
    if (!lead) throw new Error("Lead introuvable.");
    const unassigned = !lead.setterId;
    if (!unassigned && !canSee(session, { setterId: lead.setterId })) throw new Forbidden();
    if (unassigned && !session.isAdmin && !sessionHas(session, "setter")) throw new Forbidden();

    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const tomorrow = new Date(now.getTime() + 24 * 3600_000).toISOString().slice(0, 10);
    const who = session.memberName || "Moi";
    let summary = "";

    // Reprise d'un lead du pool par le setter qui agit.
    const claim = () => {
      if (unassigned && !session.isAdmin && body.action !== "assign") {
        lead.setterId = session.memberId;
        lead.ownerName = session.memberName;
        lead.ownerRole = "setter";
      }
    };

    const setStatus = (status: LeadCallStatus, callbackAt = "") => {
      // Un « pas interesse » qui recoit un autre statut revient dans la liste.
      if (lead.stage === "closed-lost" && status !== "not-interested") lead.stage = "contacte";
      lead.callStatus = status;
      lead.lastCallAt = now.toISOString();
      lead.callbackAt = status === "callback" ? callbackAt : "";
      switch (status) {
        case "no-answer":
          lead.callAttempts = (lead.callAttempts ?? 0) + 1;
          if (lead.stage === "nouveau") lead.stage = "contacte";
          lead.nextAction = "Rappeler le prospect";
          lead.nextActionAt = tomorrow;
          break;
        case "message-sent":
          if (lead.stage === "nouveau") lead.stage = "contacte";
          lead.nextAction = "Attendre sa réponse, relancer";
          lead.nextActionAt = tomorrow;
          break;
        case "callback":
          lead.stage = "conversation";
          lead.nextAction = "Rappeler le prospect";
          lead.nextActionAt = callbackAt.slice(0, 10) || today;
          break;
        case "reached":
          lead.callAttempts = (lead.callAttempts ?? 0) + 1;
          lead.stage = "conversation";
          lead.nextAction = "Fixer le rendez-vous";
          lead.nextActionAt = today;
          break;
        case "not-interested":
          lead.stage = "closed-lost";
          lead.nextAction = "";
          lead.nextActionAt = "";
          break;
      }
    };

    switch (body.action) {
      case "status": {
        const status = body.status;
        if (!status || !STATUSES.includes(status)) throw new Error("Statut inconnu.");
        let callbackAt = "";
        if (status === "callback") {
          const d = new Date(body.callbackAt ?? "");
          if (Number.isNaN(d.getTime())) throw new Error("Indique la date et l'heure du rappel.");
          callbackAt = d.toISOString();
        }
        claim();
        setStatus(status, callbackAt);
        if (body.note?.trim()) lead.notes = `${lead.notes ? `${lead.notes}\n` : ""}${body.note.trim()}`;
        summary =
          status === "callback"
            ? `${who} : ${lead.name} demande à être rappelé le ${callbackAt.slice(0, 16).replace("T", " à ")}`
            : `${who} : ${lead.name} — ${STATUS_LABEL[status]}${status === "no-answer" ? ` (essai ${lead.callAttempts})` : ""}`;
        break;
      }
      case "reopen":
        // Un « pas interesse » qui revient : il repasse dans les leads a retenter.
        claim();
        lead.callStatus = undefined;
        lead.callbackAt = "";
        lead.stage = "contacte";
        lead.nextAction = "Rappeler le prospect";
        lead.nextActionAt = today;
        summary = `${who} a remis ${lead.name} dans la liste à appeler`;
        break;
      case "attempt":
        claim();
        setStatus("no-answer");
        summary = `${who} a appelé ${lead.name} sans réponse (essai ${lead.callAttempts})`;
        break;
      case "reached":
        claim();
        setStatus("reached");
        summary = `${who} a joint ${lead.name}`;
        break;
      case "lost":
        claim();
        setStatus("not-interested");
        if (body.reason?.trim()) lead.notes = `${lead.notes ? `${lead.notes}\n` : ""}Perdu : ${body.reason.trim()}`;
        summary = `${who} a classé ${lead.name} comme perdu${body.reason ? ` (${body.reason})` : ""}`;
        break;
      case "note":
        lead.notes = (body.note ?? "").trim();
        break;
      case "assign":
        if (!session.isAdmin) throw new Forbidden("Seul l'admin réattribue un lead.");
        if (!body.setterId || !db.team.some((m) => m.id === body.setterId)) throw new Error("Setter inconnu.");
        lead.setterId = body.setterId;
        lead.ownerName = db.team.find((m) => m.id === body.setterId)?.name ?? "";
        lead.ownerRole = "setter";
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
        actorName: who,
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
