import { NextRequest } from "next/server";
import { readDB, writeDB } from "@/lib/db";
import { Forbidden, readSession, requireFormation } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { CHECKLIST_IDS, checklistProgress, studentChecklist } from "@/lib/formation-checklist";

export const dynamic = "force-dynamic";

export interface ChecklistPayload {
  checked: string[];
  student: { id: string; name: string } | null;
  isAdmin: boolean;
  preview: boolean;
  readyAt: string;
}

/** Checklist avant de lancer : les points cochés par l'élève connecté. */
export async function GET(req: NextRequest) {
  return handle((): ChecklistPayload => {
    const session = requireFormation(readSession(req));
    const db = readDB();
    const student = session.role === "student" ? db.students.find((s) => s.id === session.memberId) : undefined;
    return {
      checked: studentChecklist(student),
      student: student ? { id: student.id, name: student.name } : null,
      isAdmin: session.isAdmin,
      preview: Boolean(session.impersonated),
      readyAt: student?.launchReadyAt ?? "",
    };
  });
}

/** L'élève coche (ou décoche) un point. En aperçu admin, rien n'est écrit. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const session = readSession(req);
    if (session.role !== "student") throw new Forbidden("Seul un élève peut cocher sa checklist.");
    const { id, done } = (await req.json().catch(() => ({}))) as { id?: string; done?: boolean };
    if (!id || !CHECKLIST_IDS.has(id)) throw new Error("Point de checklist introuvable.");
    const db = readDB();
    const student = db.students.find((s) => s.id === session.memberId);
    if (!student) throw new Forbidden();
    if (session.impersonated) return { checked: studentChecklist(student), readyAt: student.launchReadyAt ?? "", preview: true };

    const cur = studentChecklist(student);
    const next = done === false ? cur.filter((x) => x !== id) : cur.includes(id) ? cur : [...cur, id];
    student.launchChecklist = next;
    const now = new Date().toISOString();
    const ready = checklistProgress(next).ready;
    student.launchReadyAt = ready ? student.launchReadyAt || now : "";
    student.portalLastSeenAt = now;
    writeDB(db);
    return { checked: next, readyAt: student.launchReadyAt, preview: false };
  });
}
