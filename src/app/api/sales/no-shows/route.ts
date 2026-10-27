import { NextRequest } from "next/server";
import { newId, readDB, writeDB } from "@/lib/db";
import { canSee, Forbidden, readSession, requireSales } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { sessionHas } from "@/lib/sales/roles";

export const dynamic = "force-dynamic";

export interface NoShowRow {
  appointmentId: string;
  leadId: string;
  name: string;
  igUsername: string;
  phone: string;
  /** Le call manque. */
  missedAt: string;
  /** Derniere relance notee apres le call manque (statut d'appel du lead), vide sinon. */
  lastFollowUpAt: string;
  lastFollowUpStatus: string;
  /** Qui a fait la derniere relance (le setter du lead). */
  lastFollowUpBy: string;
  /** Un nouveau rendez-vous (R2) a ete pose apres le no-show. */
  rebookedAt: string;
  setterName: string;
}

const WINDOW_MS = 90 * 86_400_000;

/**
 * Les no-shows a relancer : TOUS les calls manques des 90 derniers jours
 * (ceux de Mady compris), tant qu'un nouveau rendez-vous n'est pas pose.
 * Regle du 2026-10-27 : le setter les voit tous, les contacte, et celui
 * qu'il relance devient son lead ; le R2 lui est attribue. Un no-show qui
 * a reserve un R2 sort de la liste. Un closer ne voit que les siens.
 */
export async function GET(req: NextRequest) {
  return handle(() => {
    const session = requireSales(readSession(req));
    const db = readDB();
    const names = new Map(db.team.map((m) => [m.id, m.name]));
    const since = new Date(Date.now() - WINDOW_MS).toISOString();
    const mine = (a: { setterId: string; closerId: string }) => (session.isAdmin || sessionHas(session, "setter") ? true : canSee(session, a));
    const rows: NoShowRow[] = db.appointments
      .filter((a) => a.status === "no-show" && a.scheduledAt >= since && mine(a))
      .map((a) => {
        const lead = db.leads.find((l) => l.id === a.leadId);
        const later = db.appointments
          .filter((b) => b.leadId === a.leadId && b.id !== a.id && b.status !== "cancelled" && b.scheduledAt > a.scheduledAt)
          .sort((x, y) => x.scheduledAt.localeCompare(y.scheduledAt))[0];
        const followed = lead?.lastCallAt && lead.lastCallAt > a.scheduledAt;
        return {
          appointmentId: a.id,
          leadId: a.leadId,
          name: lead?.name ?? "—",
          igUsername: lead?.igUsername ?? "",
          phone: lead?.phone ?? "",
          missedAt: a.scheduledAt,
          lastFollowUpAt: followed ? lead!.lastCallAt! : "",
          lastFollowUpStatus: followed ? (lead!.callStatus ?? "") : "",
          lastFollowUpBy: followed ? (names.get(lead!.setterId ?? "") ?? lead!.ownerName ?? "") : "",
          rebookedAt: later?.scheduledAt ?? "",
          setterName: names.get(a.setterId) ?? "",
        };
      })
      .filter((r) => !r.rebookedAt)
      .sort((a, b) => b.missedAt.localeCompare(a.missedAt));
    return { rows };
  });
}

/**
 * « Relancé » : le setter vient d'ecrire ou d'appeler ce no-show. Le lead
 * devient le sien (il le travaille), avec un statut « message envoye » et
 * la marque « lien envoye » : quand le prospect reprend un rendez-vous, le
 * R2 lui est attribue.
 */
export async function PATCH(req: NextRequest) {
  return handle(async () => {
    const session = requireSales(readSession(req));
    const b = (await req.json().catch(() => ({}))) as { appointmentId?: string };
    const db = readDB();
    const appt = db.appointments.find((a) => a.id === b.appointmentId);
    if (!appt) throw new Error("Rendez-vous introuvable.");
    const lead = db.leads.find((l) => l.id === appt.leadId);
    if (!lead) throw new Error("Lead introuvable.");
    if (!session.isAdmin && !sessionHas(session, "setter")) throw new Forbidden();
    const now = new Date().toISOString();
    const who = session.memberName || "Mady";
    if (!session.isAdmin) {
      lead.setterId = session.memberId;
      lead.ownerName = session.memberName;
      lead.ownerRole = "setter";
      lead.claimedAt = lead.claimedAt || now;
      lead.declaredAt = now;
      lead.declaredVia = lead.declaredVia || "whatsapp";
      lead.declaredWhy = lead.declaredWhy || "Relance après no-show";
    }
    lead.callStatus = "message-sent";
    lead.lastCallAt = now;
    lead.lastSetterActionAt = now;
    lead.callAttempts = (lead.callAttempts ?? 0) + 1;
    db.activityLogs.unshift({ id: newId(), at: now, actorId: session.memberId, actorName: who, action: "lead.message", entity: "lead", entityId: lead.id, summary: `${lead.name} relancé après son no-show du ${appt.scheduledAt.slice(0, 10)} par ${who}` });
    writeDB(db);
    return { ok: true };
  });
}
