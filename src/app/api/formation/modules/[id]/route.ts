import { NextRequest } from "next/server";
import { readDB, writeDB } from "@/lib/db";
import { readSession, requireAdmin } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { toRow } from "@/lib/formation";
import { readModuleFields } from "@/lib/formation-server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Modifier un module : titre, video, annexe, objections, publication. */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    requireAdmin(readSession(req));
    const { id } = await ctx.params;
    const raw = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const db = readDB();
    const m = db.courseModules.find((x) => x.id === id);
    if (!m) throw new Error("Module introuvable.");
    Object.assign(m, readModuleFields(raw, m), { updatedAt: new Date().toISOString() });
    writeDB(db);
    return toRow(m);
  });
}

/** Supprimer un module. La progression des eleves qui l'avaient coche est nettoyee. */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    requireAdmin(readSession(req));
    const { id } = await ctx.params;
    const db = readDB();
    const before = db.courseModules.length;
    db.courseModules = db.courseModules.filter((x) => x.id !== id);
    if (db.courseModules.length === before) throw new Error("Module introuvable.");
    for (const s of db.students) {
      if (s.completedModules?.includes(id)) s.completedModules = s.completedModules.filter((x) => x !== id);
    }
    writeDB(db);
    return { ok: true };
  });
}
