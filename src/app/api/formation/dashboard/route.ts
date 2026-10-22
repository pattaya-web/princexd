import { NextRequest } from "next/server";
import { readDB, writeDB } from "@/lib/db";
import { readSession, requireFormation } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { sortModules } from "@/lib/formation";
import { toResourceRow, type CourseResourceRow } from "@/lib/formation-resources";
import { ensureCourseSteps, portalSettings, stepItems, type StepItem } from "@/lib/formation-steps";
import { onboardingSettings } from "@/lib/onboarding";
import type { StudentPortalSettings } from "@/lib/types";

export const dynamic = "force-dynamic";

export interface DashboardPayload {
  student: { id: string; name: string; firstName: string } | null;
  isAdmin: boolean;
  preview: boolean;
  /** « Bonjour » avant 18 h à Paris, « Bonsoir » ensuite. */
  greeting: string;
  /** Date du jour, déjà formatée (« jeudi 22 octobre 2026 »). */
  today: string;
  formation: {
    total: number;
    done: number;
    percent: number;
    /** Module à reprendre : le premier non terminé. */
    resume: { id: string; title: string; summary: string; index: number } | null;
  };
  steps: {
    total: number;
    done: number;
    /** Les prochaines à faire : étapes assignées d'abord, puis la marche à suivre. */
    next: StepItem[];
    tasksPending: number;
  };
  resources: { total: number; latest: CourseResourceRow[] };
  portal: StudentPortalSettings;
  formUrl: string;
}

/** Tout ce que montre le tableau de bord Scale X, en une requête. */
export async function GET(req: NextRequest) {
  return handle((): DashboardPayload => {
    const session = requireFormation(readSession(req));
    const db = readDB();
    if (ensureCourseSteps(db)) writeDB(db);
    const student = session.role === "student" ? db.students.find((s) => s.id === session.memberId) : undefined;

    const modules = sortModules(db.courseModules).filter((m) => m.published);
    const completed = new Set(student?.completedModules ?? []);
    const doneModules = modules.filter((m) => completed.has(m.id)).length;
    const resumeIdx = modules.findIndex((m) => !completed.has(m.id));
    const resumeModule = resumeIdx >= 0 ? modules[resumeIdx] : null;

    const { steps, tasks } = stepItems(db, student);
    const pendingTasks = tasks.filter((t) => !t.done);
    const next = [...pendingTasks, ...steps.filter((s) => !s.done)].slice(0, 4);

    const visible = db.courseResources.filter((r) => r.studentVisible !== false).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const hour = Number(new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", hour12: false }).format(new Date())) % 24;
    const today = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());

    if (student && !session.impersonated) {
      student.portalLastSeenAt = new Date().toISOString();
      writeDB(db);
    }

    return {
      student: student ? { id: student.id, name: student.name, firstName: student.name.trim().split(/\s+/)[0] ?? student.name } : null,
      isAdmin: session.isAdmin,
      preview: Boolean(session.impersonated),
      greeting: hour >= 18 || hour < 5 ? "Bonsoir" : "Bonjour",
      today,
      formation: {
        total: modules.length,
        done: doneModules,
        percent: modules.length ? Math.round((doneModules / modules.length) * 100) : 0,
        resume: resumeModule ? { id: resumeModule.id, title: resumeModule.title, summary: resumeModule.summary, index: resumeIdx } : null,
      },
      steps: {
        total: steps.length + tasks.length,
        done: steps.filter((s) => s.done).length + tasks.filter((t) => t.done).length,
        next,
        tasksPending: pendingTasks.length,
      },
      resources: { total: visible.length, latest: visible.slice(0, 3).map(toResourceRow) },
      portal: portalSettings(db.settings),
      formUrl: onboardingSettings(db.settings).formUrl,
    };
  });
}
