import { NextRequest } from "next/server";
import { newId, readDB, writeDB } from "@/lib/db";
import { Forbidden, readSession, requireAdmin, requireSales } from "@/lib/sales/access";
import { handle, required } from "@/lib/sales/http";
import { memberRoles } from "@/lib/sales/roles";
import { escTelegram, notifyTelegram } from "@/lib/telegram";
import { parisDay } from "@/lib/format";
import type { SetterTask } from "@/lib/types";

export const dynamic = "force-dynamic";

export interface SetterTaskRow extends SetterTask {
  setterName: string;
  /** Vrai quand la date est passee et la relance pas faite. */
  overdue: boolean;
  today: boolean;
}

function rows(db: ReturnType<typeof readDB>, filter: (t: SetterTask) => boolean): SetterTaskRow[] {
  const names = new Map(db.team.map((m) => [m.id, m.name]));
  const today = parisDay(0);
  return (db.setterTasks ?? [])
    .filter(filter)
    .map((t) => ({ ...t, setterName: names.get(t.setterId) ?? "", overdue: t.status === "open" && t.dueOn < today, today: t.dueOn === today }))
    .sort((a, b) => (a.status === b.status ? a.dueOn.localeCompare(b.dueOn) || a.createdAt.localeCompare(b.createdAt) : a.status === "open" ? -1 : 1));
}

/** Les relances : toutes pour l'admin, les siennes pour un setter. `?done=1` inclut celles deja faites (30 derniers jours). */
export async function GET(req: NextRequest) {
  return handle(() => {
    const session = requireSales(readSession(req));
    const db = readDB();
    const withDone = req.nextUrl.searchParams.get("done") === "1";
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    return {
      rows: rows(db, (t) => (session.isAdmin || t.setterId === session.memberId) && (t.status === "open" || (withDone && t.doneAt >= since))),
      today: parisDay(0),
    };
  });
}

/**
 * Une relance : l'admin l'envoie a un setter ; un setter se la pose a
 * lui-meme (« @pseudo, relance le 4 novembre, il attend son salaire »), le
 * pseudo Instagram est alors obligatoire.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const session = requireSales(readSession(req));
    const b = (await req.json().catch(() => ({}))) as Partial<SetterTask>;
    const db = readDB();
    db.setterTasks ??= [];
    const self = !session.isAdmin;
    const setterId = self ? session.memberId : b.setterId;
    const setter = db.team.find((m) => m.id === setterId && m.status !== "inactif" && memberRoles(m).includes("setter"));
    if (!setter) throw new Error(self ? "Seul un setter se pose des relances." : "Choisis le setter à qui envoyer la relance.");
    if (self && !String(b.igUsername ?? "").trim()) throw new Error("Le pseudo Instagram du prospect est obligatoire.");
    const lead = b.leadId ? db.leads.find((l) => l.id === b.leadId) : undefined;
    const dueOn = /^\d{4}-\d{2}-\d{2}$/.test(String(b.dueOn ?? "")) ? String(b.dueOn) : parisDay(0);
    const now = new Date().toISOString();
    const task: SetterTask = {
      id: newId(),
      setterId: setter.id,
      leadId: lead?.id ?? "",
      name: (String(b.name ?? "").trim() || lead?.name || (b.igUsername ? "@" + String(b.igUsername).trim().replace(/^@+/, "") : "")).slice(0, 80),
      phone: (String(b.phone ?? "").trim() || lead?.phone || "").slice(0, 40),
      igUsername: (String(b.igUsername ?? "").trim().replace(/^@+/, "") || lead?.igUsername || "").slice(0, 40),
      kind: b.kind === "message" ? "message" : "call",
      dueOn,
      note: required(b.note, "Le contexte (ce que tu lui as dit, pourquoi relancer)").slice(0, 2000),
      status: "open",
      createdBy: self ? session.memberName || setter.name : session.memberName || "Mady",
      createdAt: now,
      doneAt: "",
    };
    if (!task.name) throw new Error("Le nom du prospect est obligatoire.");
    db.setterTasks.unshift(task);
    db.activityLogs.unshift({ id: newId(), at: now, actorId: session.memberId, actorName: task.createdBy, action: "lead.assign", entity: "lead", entityId: task.leadId, summary: self ? `${setter.name} se note une relance : ${task.name} le ${dueOn}` : `Relance envoyée à ${setter.name} : ${task.name} (${task.kind === "call" ? "à rappeler" : "à écrire"} le ${dueOn})` });
    writeDB(db);
    if (!self) notifyTelegram(setter, `📌 <b>Relance de ${escTelegram(task.createdBy)}</b> : ${escTelegram(task.name)}${task.phone ? ` · ${escTelegram(task.phone)}` : ""}\n${task.kind === "call" ? "À rappeler" : "À écrire"} le ${dueOn}.\n${escTelegram(task.note)}`);
    return { task: rows(db, (t) => t.id === task.id)[0] };
  });
}

/** Le setter (ou l'admin) marque la relance faite, ou la rouvre. */
export async function PATCH(req: NextRequest) {
  return handle(async () => {
    const session = requireSales(readSession(req));
    const b = (await req.json().catch(() => ({}))) as { id?: string; done?: boolean; dueOn?: string };
    const db = readDB();
    const task = (db.setterTasks ?? []).find((t) => t.id === b.id);
    if (!task) throw new Error("Relance introuvable.");
    if (!session.isAdmin && task.setterId !== session.memberId) throw new Forbidden();
    if (typeof b.done === "boolean") {
      task.status = b.done ? "done" : "open";
      task.doneAt = b.done ? new Date().toISOString() : "";
    }
    if (typeof b.dueOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.dueOn)) task.dueOn = b.dueOn;
    writeDB(db);
    return { task: rows(db, (t) => t.id === task.id)[0] };
  });
}

export async function DELETE(req: NextRequest) {
  return handle(async () => {
    requireAdmin(readSession(req));
    const b = (await req.json().catch(() => ({}))) as { id?: string };
    const db = readDB();
    const before = (db.setterTasks ?? []).length;
    db.setterTasks = (db.setterTasks ?? []).filter((t) => t.id !== b.id);
    if (db.setterTasks.length === before) throw new Error("Relance introuvable.");
    writeDB(db);
    return { ok: true };
  });
}
