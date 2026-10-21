import { NextRequest, NextResponse } from "next/server";
import { getSettings, list, saveSettings } from "@/lib/db";
import { contentOsState } from "@/lib/content-os";
import type { ContentItem, ContentOsState, CosHabit, CosProject, CosResource } from "@/lib/types";

export const dynamic = "force-dynamic";

/** L'état Content OS (habitudes, priorités, routine, ressources, chantiers) et les contenus du pipeline. */
export async function GET() {
  return NextResponse.json({ state: contentOsState(getSettings()), items: list("contentItems") as ContentItem[] });
}

type Patch = {
  habits?: CosHabit[];
  routineItems?: CosHabit[];
  resources?: CosResource[];
  projects?: CosProject[];
  priority?: { date: string; text: string };
  habitToggle?: { date: string; id: string; done: boolean };
  routineToggle?: { week: string; id: string; done: boolean };
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const clean = (s: unknown, max = 500) => (typeof s === "string" ? s.trim().slice(0, max) : "");

function cleanHabits(list: unknown): CosHabit[] | null {
  if (!Array.isArray(list)) return null;
  return list
    .filter((h) => h && typeof h === "object")
    .map((h, i) => ({ id: clean((h as CosHabit).id, 40) || `h${Date.now()}${i}`, label: clean((h as CosHabit).label, 300), order: i + 1 }))
    .filter((h) => h.label)
    .slice(0, 30);
}

/** Une modification à la fois : coche du jour, priorité, listes modifiables. Tout est enregistré tout de suite. */
export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Patch;
  const state: ContentOsState = contentOsState(getSettings());

  if (body.habitToggle && DATE.test(body.habitToggle.date)) {
    const { date, id, done } = body.habitToggle;
    const set = new Set(state.habitLog[date] ?? []);
    if (done) set.add(id);
    else set.delete(id);
    state.habitLog[date] = Array.from(set);
  }
  if (body.routineToggle && DATE.test(body.routineToggle.week)) {
    const { week, id, done } = body.routineToggle;
    const set = new Set(state.routineLog[week] ?? []);
    if (done) set.add(id);
    else set.delete(id);
    state.routineLog[week] = Array.from(set);
  }
  if (body.priority && DATE.test(body.priority.date)) {
    const text = clean(body.priority.text, 300);
    if (text) state.priorities[body.priority.date] = text;
    else delete state.priorities[body.priority.date];
  }
  const habits = cleanHabits(body.habits);
  if (habits?.length) state.habits = habits;
  const routine = cleanHabits(body.routineItems);
  if (routine?.length) state.routineItems = routine;
  if (Array.isArray(body.resources)) {
    state.resources = body.resources
      .filter((r) => r && typeof r === "object")
      .map((r, i) => ({ id: clean(r.id, 40) || `r${Date.now()}${i}`, label: clean(r.label, 120), url: clean(r.url, 1000), notes: clean(r.notes, 2000) }))
      .filter((r) => r.label)
      .slice(0, 40);
  }
  if (Array.isArray(body.projects)) {
    state.projects = body.projects
      .filter((p) => p && typeof p === "object")
      .map((p, i) => ({
        id: clean(p.id, 40) || `p${Date.now()}${i}`,
        title: clean(p.title, 200),
        status: (["done", "doing", "todo"] as const).includes(p.status) ? p.status : "todo",
        order: i + 1,
      }))
      .filter((p) => p.title)
      .slice(0, 60);
  }

  // Les journaux ne gardent que 400 jours : assez pour l'historique, sans gonfler la base.
  for (const key of ["habitLog", "routineLog"] as const) {
    const entries = Object.entries(state[key]).sort(([a], [b]) => (a < b ? 1 : -1)).slice(0, 400);
    state[key] = Object.fromEntries(entries);
  }
  saveSettings({ contentOs: state });
  return NextResponse.json({ state });
}
