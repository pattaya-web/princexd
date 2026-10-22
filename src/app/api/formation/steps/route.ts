import { NextRequest } from "next/server";
import { newId, readDB, writeDB } from "@/lib/db";
import { readSession, requireAdmin, requireFormation } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { sortModules } from "@/lib/formation";
import { ensureCourseSteps, portalSettings, readStepFields, sortSteps, stepItems, type StepItem } from "@/lib/formation-steps";
import { onboardingSettings } from "@/lib/onboarding";
import type { CourseStep, StudentPortalSettings } from "@/lib/types";

export const dynamic = "force-dynamic";

export interface StepsPayload {
  /** La marche à suivre (publiée pour l'élève ; tout pour l'admin, brouillons compris). */
  steps: StepItem[];
  /** Étapes assignées à l'élève connecté par le coach. */
  tasks: StepItem[];
  student: { id: string; name: string } | null;
  isAdmin: boolean;
  preview: boolean;
  portal: StudentPortalSettings;
  formUrl: string;
  /** Modules publiés, pour relier une étape à un module (admin). */
  modules: { id: string; title: string }[];
  /** Les étapes brutes, pour l'édition (admin seulement). */
  raw: CourseStep[];
}

export async function GET(req: NextRequest) {
  return handle((): StepsPayload => {
    const session = requireFormation(readSession(req));
    const db = readDB();
    if (ensureCourseSteps(db)) writeDB(db);
    const student = session.role === "student" ? db.students.find((s) => s.id === session.memberId) : undefined;
    const { steps, tasks } = stepItems(db, student, { includeDrafts: session.isAdmin });
    return {
      steps,
      tasks,
      student: student ? { id: student.id, name: student.name } : null,
      isAdmin: session.isAdmin,
      preview: Boolean(session.impersonated),
      portal: portalSettings(db.settings),
      formUrl: onboardingSettings(db.settings).formUrl,
      modules: session.isAdmin ? sortModules(db.courseModules).map((m) => ({ id: m.id, title: m.title })) : [],
      raw: session.isAdmin ? sortSteps(db.courseSteps) : [],
    };
  });
}

/** Nouvelle étape, en fin de parcours (admin). */
export async function POST(req: NextRequest) {
  return handle(async () => {
    requireAdmin(readSession(req));
    const raw = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const db = readDB();
    ensureCourseSteps(db);
    const now = new Date().toISOString();
    const order = db.courseSteps.reduce((max, s) => Math.max(max, s.order), -1) + 1;
    const step: CourseStep = { id: newId(), order, createdAt: now, updatedAt: now, ...readStepFields(raw) };
    db.courseSteps.push(step);
    writeDB(db);
    return step;
  });
}

/** Réordonner : la liste complète des identifiants dans le nouvel ordre (admin). */
export async function PATCH(req: NextRequest) {
  return handle(async () => {
    requireAdmin(readSession(req));
    const { order } = (await req.json().catch(() => ({}))) as { order?: unknown };
    if (!Array.isArray(order) || !order.every((x) => typeof x === "string")) throw new Error("Ordre invalide.");
    const db = readDB();
    const rank = new Map((order as string[]).map((id, i) => [id, i]));
    const rest = sortSteps(db.courseSteps).filter((s) => !rank.has(s.id));
    rest.forEach((s, i) => rank.set(s.id, order.length + i));
    for (const s of db.courseSteps) s.order = rank.get(s.id) ?? s.order;
    writeDB(db);
    return { steps: sortSteps(db.courseSteps) };
  });
}
