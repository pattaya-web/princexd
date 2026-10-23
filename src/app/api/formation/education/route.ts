import { NextRequest } from "next/server";
import { readDB, writeDB } from "@/lib/db";
import { readSession, requireFormation } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { LESSONS, lessonProgress, type Lesson } from "@/lib/formation-education";
import { sortModules } from "@/lib/formation";

export const dynamic = "force-dynamic";

export interface EducationPayload {
  student: { id: string; name: string; firstName: string } | null;
  isAdmin: boolean;
  preview: boolean;
  lessons: Lesson[];
  completed: string[];
  progress: { total: number; done: number; percent: number };
  /** Modules vidéo publiés (plus tard) : nombre, pour afficher le lien. */
  videoModules: number;
}

function studentOf(req: NextRequest) {
  const session = requireFormation(readSession(req));
  const db = readDB();
  const student = session.role === "student" ? db.students.find((s) => s.id === session.memberId) : undefined;
  return { session, db, student };
}

/** Les guides PDF et l'avancement de l'élève connecté. */
export async function GET(req: NextRequest) {
  return handle((): EducationPayload => {
    const { session, db, student } = studentOf(req);
    const p = lessonProgress(student?.completedLessons);
    return {
      student: student ? { id: student.id, name: student.name, firstName: student.name.trim().split(/\s+/)[0] ?? student.name } : null,
      isAdmin: session.isAdmin,
      preview: Boolean(session.impersonated),
      lessons: LESSONS,
      completed: student?.completedLessons ?? [],
      progress: { total: p.total, done: p.done, percent: p.percent },
      videoModules: sortModules(db.courseModules).filter((m) => m.published).length,
    };
  });
}

/** L'élève coche (ou décoche) un guide terminé. */
export async function PATCH(req: NextRequest) {
  return handle(async (): Promise<{ preview: boolean; completed: string[] }> => {
    const { session, db, student } = studentOf(req);
    const body = (await req.json().catch(() => ({}))) as { lessonId?: string; done?: boolean };
    const lesson = LESSONS.find((l) => l.id === body.lessonId);
    if (!lesson) throw new Error("Guide introuvable.");
    if (!student) {
      if (session.isAdmin) return { preview: true, completed: [] };
      throw new Error("Élève introuvable.");
    }
    if (session.impersonated) return { preview: true, completed: student.completedLessons ?? [] };
    const cur = student.completedLessons ?? [];
    student.completedLessons = body.done ? (cur.includes(lesson.id) ? cur : [...cur, lesson.id]) : cur.filter((id) => id !== lesson.id);
    writeDB(db);
    return { preview: false, completed: student.completedLessons };
  });
}
