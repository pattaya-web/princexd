import { sessionHas } from "@/lib/sales/roles";
import { NextRequest } from "next/server";
import { newId, readDB, writeDB } from "@/lib/db";
import { readSession, requireSales } from "@/lib/sales/access";
import { handle, required } from "@/lib/sales/http";
import type { FollowUp } from "@/lib/types";

export const dynamic = "force-dynamic";

export interface FollowUpRow extends FollowUp {
  leadName: string;
  igUsername: string;
  closerName: string;
  scheduledAt: string;
  /** "overdue" | "today" | "upcoming" — calcule cote serveur pour que tous
   *  les ecrans decoupent le temps de la meme facon. */
  bucket: "overdue" | "today" | "upcoming";
}

/**
 * Les relances en attente, rangees par urgence.
 *
 * L'enjeu de cette page est simple : aucun lead chaud ne doit tomber dans un
 * trou. Le tri met donc systematiquement le retard en premier.
 */
export async function GET(req: NextRequest) {
  return handle(() => {
    const session = requireSales(readSession(req));
    const db = readDB();

    const leads = new Map(db.leads.map((l) => [l.id, l]));
    const names = new Map(db.team.map((m) => [m.id, m.name]));
    const appts = new Map(db.appointments.map((a) => [a.id, a]));

    const now = new Date();
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).toISOString();
    const nowIso = now.toISOString();

    const includeDone = req.nextUrl.searchParams.get("all") === "1";

    const rows: FollowUpRow[] = db.followUps
      .filter((f) => {
        if (!includeDone && f.status !== "pending") return false;
        if (session.isAdmin) return true;
        // Le closer voit ses relances ; le setter, celles de ses propres leads.
        // Un setter-closer voit les deux.
        if (sessionHas(session, "closer") && f.closerId === session.memberId) return true;
        return sessionHas(session, "setter") && appts.get(f.appointmentId)?.setterId === session.memberId;
      })
      .map((f) => {
        const lead = leads.get(f.leadId);
        const appt = appts.get(f.appointmentId);
        return {
          ...f,
          leadName: lead?.name ?? "Lead supprimé",
          igUsername: lead?.igUsername ?? "",
          closerName: f.closerId ? (names.get(f.closerId) ?? "—") : "",
          scheduledAt: appt?.scheduledAt ?? "",
          bucket: (f.dueAt < nowIso ? "overdue" : f.dueAt <= todayEnd ? "today" : "upcoming") as
            | "overdue"
            | "today"
            | "upcoming",
        };
      })
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt));

    return {
      rows,
      counts: {
        overdue: rows.filter((r) => r.bucket === "overdue" && r.status === "pending").length,
        today: rows.filter((r) => r.bucket === "today" && r.status === "pending").length,
        upcoming: rows.filter((r) => r.bucket === "upcoming" && r.status === "pending").length,
      },
    };
  });
}

/** Programme une relance a la main, sans passer par un resultat de call. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const session = requireSales(readSession(req));
    const body = (await req.json()) as Record<string, unknown>;
    const db = readDB();

    const appointmentId = required(body.appointmentId, "Le rendez-vous");
    const appt = db.appointments.find((a) => a.id === appointmentId);
    if (!appt) throw new Error("Rendez-vous introuvable.");
    if (!session.isAdmin && appt.closerId !== session.memberId && appt.setterId !== session.memberId) {
      throw new Error("Ce rendez-vous ne vous est pas attribué.");
    }

    const followUp: FollowUp = {
      id: newId(),
      leadId: appt.leadId,
      appointmentId: appt.id,
      closerId: (body.closerId as string) || appt.closerId || "",
      dueAt: required(body.dueAt, "La date de relance"),
      notes: (body.notes as string) || "",
      status: "pending",
      createdBy: session.memberId,
      createdAt: new Date().toISOString(),
      completedAt: "",
    };
    db.followUps.unshift(followUp);
    db.activityLogs.unshift({
      id: newId(),
      at: followUp.createdAt,
      actorId: session.memberId,
      actorName: session.memberName || "Moi",
      action: "follow-up.created",
      entity: "follow-up",
      entityId: followUp.id,
      summary: "Relance programmée manuellement",
    });
    writeDB(db);
    return followUp;
  });
}
