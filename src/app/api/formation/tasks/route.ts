import { NextRequest } from "next/server";
import { readDB, writeDB } from "@/lib/db";
import { readSession, requireAdmin } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { ensureCourseSteps, newTask, stepItems, type StepItem } from "@/lib/formation-steps";
import type { ShopRequest } from "@/lib/types";
import { lessonProgress } from "@/lib/formation-education";
import { gateState } from "@/lib/formation-gate";

export const dynamic = "force-dynamic";

/**
 * Suivi d'un élève par le coach (admin) : où il en est dans la marche à
 * suivre, les étapes qu'on lui a assignées, les notes du coach.
 */
export interface StudentFollowUpPayload {
  student: { id: string; name: string; email: string; phone: string; portalLastSeenAt: string };
  steps: StepItem[];
  tasks: StepItem[];
  coachNotes: string;
  modulesDone: number;
  modulesTotal: number;
  lessonsDone: number;
  lessonsTotal: number;
  shopRequest: ShopRequest | null;
  /** Adresse de sa boutique (étape « Ta boutique »). */
  shopUrl: string;
  shopUrlAt: string;
  /** Le parcours Scale X : chaque étape, validée ou non, avec sa date. */
  parcours: { key: string; label: string; done: boolean; doneAt: string }[];
}

function payload(studentId: string): StudentFollowUpPayload {
  const db = readDB();
  if (ensureCourseSteps(db)) writeDB(db);
  const s = db.students.find((x) => x.id === studentId);
  if (!s) throw new Error("Élève introuvable.");
  const published = db.courseModules.filter((m) => m.published);
  const done = new Set(s.completedModules ?? []);
  return {
    student: { id: s.id, name: s.name, email: s.email ?? "", phone: s.phone ?? "", portalLastSeenAt: s.portalLastSeenAt ?? "" },
    ...stepItems(db, s),
    coachNotes: s.coachNotes ?? "",
    modulesDone: published.filter((m) => done.has(m.id)).length,
    modulesTotal: published.length,
    lessonsDone: lessonProgress(s.completedLessons).done,
    lessonsTotal: lessonProgress(s.completedLessons).total,
    shopRequest: s.shopRequest ?? null,
    shopUrl: s.shopUrl ?? "",
    shopUrlAt: s.shopUrlAt ?? "",
    parcours: gateState(s).tabs.map((t) => ({ key: t.key, label: t.label, done: t.done, doneAt: t.done ? (s.tabsDoneAt?.[t.key] ?? "") : "" })),
  };
}

export async function GET(req: NextRequest) {
  return handle(() => {
    requireAdmin(readSession(req));
    const studentId = req.nextUrl.searchParams.get("studentId") ?? "";
    if (!studentId) throw new Error("studentId manquant.");
    return payload(studentId);
  });
}

/** Assigner une étape à un élève. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    requireAdmin(readSession(req));
    const body = (await req.json().catch(() => ({}))) as { studentId?: string; title?: string; detail?: string; link?: string };
    const db = readDB();
    const s = db.students.find((x) => x.id === body.studentId);
    if (!s) throw new Error("Élève introuvable.");
    s.tasks = [...(s.tasks ?? []), newTask({ title: body.title ?? "", detail: body.detail, link: body.link })];
    writeDB(db);
    return payload(s.id);
  });
}

/**
 * Modifier le suivi : une étape assignée (`taskId` : faite, titre, consigne),
 * une étape commune cochée pour lui (`stepId` + `done`), ou les notes du coach.
 */
export async function PATCH(req: NextRequest) {
  return handle(async () => {
    requireAdmin(readSession(req));
    const body = (await req.json().catch(() => ({}))) as {
      studentId?: string;
      taskId?: string;
      stepId?: string;
      done?: boolean;
      title?: string;
      detail?: string;
      link?: string;
      coachNotes?: string;
      /** Demande de boutique : « livree » quand la boutique est générée, « demandee » pour la rouvrir, null pour l'effacer. */
      shopRequest?: "livree" | "demandee" | null;
    };
    const db = readDB();
    const s = db.students.find((x) => x.id === body.studentId);
    if (!s) throw new Error("Élève introuvable.");
    const now = new Date().toISOString();
    if (body.taskId) {
      const t = (s.tasks ?? []).find((x) => x.id === body.taskId);
      if (!t) throw new Error("Étape introuvable.");
      if (typeof body.done === "boolean") {
        t.done = body.done;
        t.doneAt = body.done ? now : "";
      }
      if (typeof body.title === "string" && body.title.trim()) t.title = body.title.trim().slice(0, 160);
      if (typeof body.detail === "string") t.detail = body.detail.trim().slice(0, 4000);
      if (typeof body.link === "string") t.link = body.link.trim().slice(0, 500);
    }
    if (body.stepId && typeof body.done === "boolean") {
      const cur = s.completedSteps ?? [];
      s.completedSteps = body.done ? (cur.includes(body.stepId) ? cur : [...cur, body.stepId]) : cur.filter((x) => x !== body.stepId);
    }
    if (typeof body.coachNotes === "string") s.coachNotes = body.coachNotes.slice(0, 8000);
    if (body.shopRequest === null) delete s.shopRequest;
    else if (body.shopRequest && s.shopRequest) {
      s.shopRequest.status = body.shopRequest;
      s.shopRequest.doneAt = body.shopRequest === "livree" ? now : undefined;
    }
    writeDB(db);
    return payload(s.id);
  });
}

/** Retirer une étape assignée. */
export async function DELETE(req: NextRequest) {
  return handle(async () => {
    requireAdmin(readSession(req));
    const body = (await req.json().catch(() => ({}))) as { studentId?: string; taskId?: string };
    const db = readDB();
    const s = db.students.find((x) => x.id === body.studentId);
    if (!s) throw new Error("Élève introuvable.");
    s.tasks = (s.tasks ?? []).filter((t) => t.id !== body.taskId);
    writeDB(db);
    return payload(s.id);
  });
}
