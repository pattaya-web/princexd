import { NextRequest } from "next/server";
import { newId, readDB, writeDB } from "@/lib/db";
import { readSession, requireAdmin, requireFormation } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { sortModules, toRow, type CourseModuleRow } from "@/lib/formation";
import { readModuleFields } from "@/lib/formation-server";
import type { CourseModule } from "@/lib/types";

export const dynamic = "force-dynamic";

export interface FormationPayload {
  modules: CourseModuleRow[];
  /** Modules marques « terminé » par l'eleve connecte (vide pour l'admin). */
  completed: string[];
  student: { id: string; name: string } | null;
  isAdmin: boolean;
  /** Vrai quand un admin regarde dans la peau d'un eleve : rien n'est ecrit. */
  preview: boolean;
}

/**
 * Les modules de la formation.
 *
 * L'eleve ne recoit que les modules publies, dans l'ordre ; l'admin recoit
 * tout, brouillons compris, pour les gerer et les prévisualiser.
 */
export async function GET(req: NextRequest) {
  return handle((): FormationPayload => {
    const session = requireFormation(readSession(req));
    const db = readDB();
    const all = sortModules(db.courseModules);
    const modules = (session.isAdmin ? all : all.filter((m) => m.published)).map(toRow);
    const student = session.role === "student" ? db.students.find((s) => s.id === session.memberId) : undefined;
    return {
      modules,
      completed: student?.completedModules ?? [],
      student: student ? { id: student.id, name: student.name } : null,
      isAdmin: session.isAdmin,
      preview: Boolean(session.impersonated),
    };
  });
}

/** Nouveau module, place a la fin de la formation. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    requireAdmin(readSession(req));
    const raw = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const db = readDB();
    const now = new Date().toISOString();
    const order = db.courseModules.reduce((max, m) => Math.max(max, m.order), -1) + 1;
    const row: CourseModule = { id: newId(), order, createdAt: now, updatedAt: now, ...readModuleFields(raw) };
    db.courseModules.push(row);
    writeDB(db);
    return toRow(row);
  });
}

/**
 * Reordonner : la liste complete des identifiants dans le nouvel ordre. Un
 * module absent de la liste garde sa place relative apres les autres.
 */
export async function PATCH(req: NextRequest) {
  return handle(async () => {
    requireAdmin(readSession(req));
    const { order } = (await req.json().catch(() => ({}))) as { order?: unknown };
    if (!Array.isArray(order) || !order.every((x) => typeof x === "string")) {
      throw new Error("Ordre invalide.");
    }
    const db = readDB();
    const rank = new Map((order as string[]).map((id, i) => [id, i]));
    const rest = sortModules(db.courseModules).filter((m) => !rank.has(m.id));
    rest.forEach((m, i) => rank.set(m.id, order.length + i));
    for (const m of db.courseModules) m.order = rank.get(m.id) ?? m.order;
    writeDB(db);
    return { modules: sortModules(db.courseModules).map(toRow) };
  });
}
