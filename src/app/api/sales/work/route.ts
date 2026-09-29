import { NextRequest } from "next/server";
import { newId, readDB, writeDB } from "@/lib/db";
import { Forbidden, readSession, requireSales } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { inRange, rangeFromParams } from "@/lib/sales/period";
import type { WorkSession } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Pointage.
 *
 * Un membre demarre sa session en arrivant, la termine en partant ; l'admin
 * lit les heures travaillees par personne sur la periode, et peut fermer une
 * session oubliee. Une session oubliee est plafonnee a MAX_HOURS dans les
 * totaux : un « Terminer » oublie un vendredi soir ne vaut pas 60 heures.
 */
const MAX_HOURS = 14;

export interface WorkRow extends WorkSession {
  memberName: string;
  /** Duree retenue, en heures (plafonnee), a l'instant de la lecture. */
  hours: number;
}

export interface WorkTotal {
  memberId: string;
  memberName: string;
  hours: number;
  sessions: number;
  /** Session en cours, s'il y en a une. */
  openSince: string;
}

const hoursOf = (s: WorkSession, now: number) => {
  const end = s.endedAt ? new Date(s.endedAt).getTime() : now;
  const h = Math.max(0, (end - new Date(s.startedAt).getTime()) / 3_600_000);
  return Math.min(h, MAX_HOURS);
};

const round = (h: number) => Math.round(h * 100) / 100;

export async function GET(req: NextRequest) {
  return handle(() => {
    const session = requireSales(readSession(req));
    const db = readDB();
    // Base chargee en memoire avant l'ajout de la collection : on la cree.
    db.workSessions ??= [];
    const names = new Map(db.team.map((m) => [m.id, m.name]));
    const range = rangeFromParams(req.nextUrl.searchParams);
    const filterMember = req.nextUrl.searchParams.get("memberId") ?? "";
    const now = Date.now();

    const visible = db.workSessions.filter((s) =>
      session.isAdmin ? !filterMember || s.memberId === filterMember : s.memberId === session.memberId,
    );

    const rows: WorkRow[] = visible
      .filter((s) => inRange(s.startedAt, range) || !s.endedAt)
      .map((s) => ({ ...s, memberName: names.get(s.memberId) ?? "—", hours: round(hoursOf(s, now)) }))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));

    const byMember = new Map<string, WorkTotal>();
    for (const s of visible) {
      const t = byMember.get(s.memberId) ?? { memberId: s.memberId, memberName: names.get(s.memberId) ?? "—", hours: 0, sessions: 0, openSince: "" };
      if (inRange(s.startedAt, range)) {
        t.hours = round(t.hours + hoursOf(s, now));
        t.sessions += 1;
      }
      if (!s.endedAt) t.openSince = s.startedAt;
      byMember.set(s.memberId, t);
    }

    // Aujourd'hui (heure de Paris), pour le compteur de l'accueil du membre.
    const todayKey = new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" }).format(new Date());
    const todayHours = round(
      visible
        .filter((s) => s.memberId === session.memberId)
        .filter((s) => new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" }).format(new Date(s.startedAt)) === todayKey)
        .reduce((a, s) => a + hoursOf(s, now), 0),
    );

    const open = visible.find((s) => s.memberId === session.memberId && !s.endedAt) ?? null;

    return { rows, totals: [...byMember.values()].sort((a, b) => b.hours - a.hours), open, todayHours };
  });
}

/** start : demarre ma session ; stop : termine la mienne, ou celle d'un membre (admin). */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const session = requireSales(readSession(req));
    const body = (await req.json().catch(() => ({}))) as { action?: "start" | "stop"; note?: string; memberId?: string };
    const db = readDB();
    db.workSessions ??= [];
    const now = new Date().toISOString();

    if (body.action === "start") {
      if (!session.memberId) throw new Error("Le pointage est réservé aux membres de l'équipe.");
      if (db.workSessions.some((s) => s.memberId === session.memberId && !s.endedAt)) {
        throw new Error("Une session est déjà en cours.");
      }
      const ws: WorkSession = {
        id: newId(),
        memberId: session.memberId,
        startedAt: now,
        endedAt: "",
        note: String(body.note ?? "").trim(),
        endedBy: "",
        createdAt: now,
      };
      db.workSessions.unshift(ws);
      db.activityLogs.unshift({
        id: newId(),
        at: now,
        actorId: session.memberId,
        actorName: session.memberName,
        action: "work.start",
        entity: "member",
        entityId: session.memberId,
        summary: `${session.memberName} a démarré sa session`,
      });
      writeDB(db);
      return { session: ws };
    }

    if (body.action === "stop") {
      const target = session.isAdmin && body.memberId ? body.memberId : session.memberId;
      if (!target) throw new Error("Aucune session à terminer.");
      if (target !== session.memberId && !session.isAdmin) throw new Forbidden();
      const ws = db.workSessions.find((s) => s.memberId === target && !s.endedAt);
      if (!ws) throw new Error("Aucune session en cours.");
      ws.endedAt = now;
      ws.endedBy = session.memberId || "owner";
      if (body.note?.trim()) ws.note = [ws.note, body.note.trim()].filter(Boolean).join(" · ");
      const hours = round(hoursOf(ws, Date.now()));
      db.activityLogs.unshift({
        id: newId(),
        at: now,
        actorId: session.memberId,
        actorName: session.memberName || "Moi",
        action: "work.stop",
        entity: "member",
        entityId: target,
        summary: `${db.team.find((m) => m.id === target)?.name ?? "Un membre"} a terminé sa session (${hours} h)${target !== session.memberId ? ", clôturée par l'admin" : ""}`,
      });
      writeDB(db);
      return { session: ws, hours };
    }

    throw new Error("Action inconnue.");
  });
}
