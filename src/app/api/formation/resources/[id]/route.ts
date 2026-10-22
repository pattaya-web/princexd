import { NextRequest } from "next/server";
import { readDB, writeDB } from "@/lib/db";
import { readSession, requireAdmin } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { cleanTitle, removeResourceFile, toResourceRow } from "@/lib/formation-resources";

export const dynamic = "force-dynamic";

/** Renommer une annexe (le titre affiche ; le fichier ne bouge pas) ou changer sa visibilite pour les eleves. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    requireAdmin(readSession(req));
    const { id } = await ctx.params;
    const raw = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const db = readDB();
    const row = db.courseResources.find((r) => r.id === id);
    if (!row) throw new Error("Annexe introuvable.");
    row.title = cleanTitle(raw.title, row.title);
    if (typeof raw.studentVisible === "boolean") row.studentVisible = raw.studentVisible;
    row.updatedAt = new Date().toISOString();
    writeDB(db);
    return toResourceRow(row);
  });
}

/** Supprimer une annexe : la ligne et le fichier sur le disque. */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    requireAdmin(readSession(req));
    const { id } = await ctx.params;
    const db = readDB();
    const row = db.courseResources.find((r) => r.id === id);
    if (!row) throw new Error("Annexe introuvable.");
    db.courseResources = db.courseResources.filter((r) => r.id !== id);
    writeDB(db);
    await removeResourceFile(row.stored);
    return { ok: true };
  });
}
