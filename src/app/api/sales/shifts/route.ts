import { NextRequest } from "next/server";
import { newId, readDB, writeDB } from "@/lib/db";
import { Forbidden, readSession, requireAdmin, requireSales } from "@/lib/sales/access";
import { handle, num, required } from "@/lib/sales/http";
import type { Shift } from "@/lib/types";

export const dynamic = "force-dynamic";

export interface ShiftRow extends Shift {
  memberName: string;
  /** Rendez-vous poses pendant le creneau : le rendement reel de l'heure. */
  booked: number;
}

/**
 * Creneaux de travail.
 *
 * Un membre ne voit que les siens. C'est ce qui permet a un setter d'ouvrir sa
 * page le matin et de savoir quand il bosse et ce qu'on attend de lui, sans
 * demander a personne.
 */
export async function GET(req: NextRequest) {
  return handle(() => {
    const session = requireSales(readSession(req));
    const db = readDB();
    const names = new Map(db.team.map((m) => [m.id, m.name]));

    const filterMember = req.nextUrl.searchParams.get("memberId") ?? "";
    const mine = db.shifts.filter((s) => {
      if (!session.isAdmin) return s.memberId === session.memberId;
      return !filterMember || s.memberId === filterMember;
    });

    const rows: ShiftRow[] = mine
      .map((s) => ({
        ...s,
        memberName: names.get(s.memberId) ?? "—",
        // Rendez-vous crees par ce membre dans la fenetre du creneau.
        booked: db.appointments.filter(
          (a) => a.setterId === s.memberId && a.createdAt >= s.startAt && a.createdAt <= s.endAt,
        ).length,
      }))
      .sort((a, b) => a.startAt.localeCompare(b.startAt));

    return { rows };
  });
}

/** Propose un creneau. Reserve a l'admin : c'est lui qui fixe le planning. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const session = requireAdmin(readSession(req));
    const body = (await req.json()) as Record<string, unknown>;
    const db = readDB();

    const memberId = required(body.memberId, "Le membre");
    if (!db.team.some((m) => m.id === memberId)) throw new Error("Membre introuvable.");

    const startAt = required(body.startAt, "Le début du créneau");
    const endAt = required(body.endAt, "La fin du créneau");
    // Un creneau qui finit avant de commencer produirait des durees negatives
    // dans tous les totaux d'heures.
    if (endAt <= startAt) throw new Error("La fin du créneau doit être après son début.");

    const shift: Shift = {
      id: newId(),
      memberId,
      startAt,
      endAt,
      status: "proposed",
      goal: Math.max(0, num(body.goal)),
      note: String(body.note ?? ""),
      createdBy: session.memberId,
      createdAt: new Date().toISOString(),
      respondedAt: "",
    };

    db.shifts.unshift(shift);
    db.activityLogs.unshift({
      id: newId(),
      at: shift.createdAt,
      actorId: session.memberId,
      actorName: session.memberName || "Moi",
      action: "shift.proposed",
      entity: "member",
      entityId: memberId,
      summary: `Créneau proposé à ${db.team.find((m) => m.id === memberId)?.name ?? "un membre"}`,
    });
    writeDB(db);
    return shift;
  });
}

/**
 * Reponse a un creneau.
 *
 * Le membre accepte ou decline le sien ; l'admin peut trancher n'importe
 * lequel, typiquement pour marquer un creneau comme tenu.
 */
export async function PATCH(req: NextRequest) {
  return handle(async () => {
    const session = requireSales(readSession(req));
    const body = (await req.json()) as Record<string, unknown>;
    const db = readDB();

    const id = required(body.id, "Le créneau");
    const shift = db.shifts.find((s) => s.id === id);
    if (!shift) throw new Error("Créneau introuvable.");
    if (!session.isAdmin && shift.memberId !== session.memberId) {
      throw new Forbidden("Ce créneau ne vous est pas attribué.");
    }

    const status = body.status as Shift["status"];
    if (!["proposed", "accepted", "declined", "done"].includes(status)) {
      throw new Error("Statut de créneau invalide.");
    }
    // Marquer un creneau comme tenu est un constat, pas une reponse : seul
    // l'admin le fait.
    if (status === "done" && !session.isAdmin) throw new Forbidden("Action réservée à l'administrateur.");

    shift.status = status;
    shift.respondedAt = new Date().toISOString();
    writeDB(db);
    return shift;
  });
}
