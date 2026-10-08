import { NextRequest } from "next/server";
import { readDB, writeDB } from "@/lib/db";
import { Forbidden, readSession } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";

export const dynamic = "force-dynamic";

/**
 * L'eleve coche (ou decoche) un module « terminé ».
 *
 * En apercu, l'admin voit le bouton mais rien n'est ecrit : la progression
 * reste celle de l'eleve. L'admin hors apercu n'a pas de progression.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const session = readSession(req);
    if (session.role !== "student") throw new Forbidden("Seul un élève peut marquer un module terminé.");
    const { moduleId, done } = (await req.json().catch(() => ({}))) as { moduleId?: string; done?: boolean };
    if (!moduleId) throw new Error("moduleId manquant.");
    const db = readDB();
    const student = db.students.find((s) => s.id === session.memberId);
    if (!student) throw new Forbidden();
    if (!db.courseModules.some((m) => m.id === moduleId && m.published)) throw new Error("Module introuvable.");
    if (session.impersonated) {
      return { completed: student.completedModules ?? [], preview: true };
    }
    const current = student.completedModules ?? [];
    student.completedModules = done === false ? current.filter((x) => x !== moduleId) : current.includes(moduleId) ? current : [...current, moduleId];
    student.portalLastSeenAt = new Date().toISOString();
    writeDB(db);
    return { completed: student.completedModules, preview: false };
  });
}
