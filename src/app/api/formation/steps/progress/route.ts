import { NextRequest } from "next/server";
import { readDB, writeDB } from "@/lib/db";
import { Forbidden, readSession } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { stepItems } from "@/lib/formation-steps";

export const dynamic = "force-dynamic";

/**
 * L'élève coche (ou décoche) une étape : étape commune (`stepId`) ou étape
 * assignée par le coach (`taskId`). En aperçu admin, rien n'est écrit.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const session = readSession(req);
    if (session.role !== "student") throw new Forbidden("Seul un élève peut cocher une étape.");
    const { stepId, taskId, done } = (await req.json().catch(() => ({}))) as { stepId?: string; taskId?: string; done?: boolean };
    const db = readDB();
    const student = db.students.find((s) => s.id === session.memberId);
    if (!student) throw new Forbidden();
    if (session.impersonated) return { ...stepItems(db, student), preview: true };

    const now = new Date().toISOString();
    if (stepId) {
      if (!db.courseSteps.some((s) => s.id === stepId && s.published)) throw new Error("Étape introuvable.");
      const cur = student.completedSteps ?? [];
      student.completedSteps = done === false ? cur.filter((x) => x !== stepId) : cur.includes(stepId) ? cur : [...cur, stepId];
    } else if (taskId) {
      const task = (student.tasks ?? []).find((t) => t.id === taskId);
      if (!task) throw new Error("Étape introuvable.");
      task.done = done !== false;
      task.doneAt = task.done ? now : "";
    } else {
      throw new Error("Étape manquante.");
    }
    student.portalLastSeenAt = now;
    writeDB(db);
    return { ...stepItems(db, student), preview: false };
  });
}
