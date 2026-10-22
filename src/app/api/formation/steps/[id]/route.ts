import { NextRequest } from "next/server";
import { readDB, writeDB } from "@/lib/db";
import { readSession, requireAdmin } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { readStepFields } from "@/lib/formation-steps";

export const dynamic = "force-dynamic";

/** Modifier une étape commune (admin). Champs absents conservés. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    requireAdmin(readSession(req));
    const { id } = await ctx.params;
    const raw = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const db = readDB();
    const step = db.courseSteps.find((s) => s.id === id);
    if (!step) throw new Error("Étape introuvable.");
    Object.assign(step, readStepFields(raw, step), { updatedAt: new Date().toISOString() });
    writeDB(db);
    return step;
  });
}

/** Supprimer une étape commune : elle disparaît aussi des coches des élèves. */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    requireAdmin(readSession(req));
    const { id } = await ctx.params;
    const db = readDB();
    if (!db.courseSteps.some((s) => s.id === id)) throw new Error("Étape introuvable.");
    db.courseSteps = db.courseSteps.filter((s) => s.id !== id);
    for (const s of db.students) if (s.completedSteps?.includes(id)) s.completedSteps = s.completedSteps.filter((x) => x !== id);
    writeDB(db);
    return { ok: true };
  });
}
