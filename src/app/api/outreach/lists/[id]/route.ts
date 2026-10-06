import { NextRequest } from "next/server";
import { newId, readDB, writeDB } from "@/lib/db";
import { readSession, requireAdmin, requireOutreach } from "@/lib/sales/access";
import { handle, required } from "@/lib/sales/http";

export const dynamic = "force-dynamic";

/** Une liste et tous ses contacts, dans l'ordre du fichier. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    requireOutreach(readSession(req));
    const { id } = await ctx.params;
    const db = readDB();
    const list = db.outreachLists.find((l) => l.id === id);
    if (!list) throw new Error("List not found: it may have been deleted.");
    const contacts = db.outreachContacts.filter((c) => c.listId === id).sort((a, b) => a.order - b.order);
    return { list, contacts };
  });
}

/** Renommer une liste (admin). */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    requireAdmin(readSession(req));
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as { name?: unknown };
    const name = required(body.name, "The name").slice(0, 120);
    const db = readDB();
    const list = db.outreachLists.find((l) => l.id === id);
    if (!list) throw new Error("List not found.");
    list.name = name;
    writeDB(db);
    return { list };
  });
}

/**
 * Suppression d'une liste et de ses contacts (admin uniquement).
 *
 * La VA n'a pas ce bouton : une liste effacee par erreur, c'est des heures
 * de prospection perdues.
 */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = requireAdmin(readSession(req));
    const { id } = await ctx.params;
    const db = readDB();
    const list = db.outreachLists.find((l) => l.id === id);
    if (!list) throw new Error("List not found.");
    const before = db.outreachContacts.length;
    db.outreachContacts = db.outreachContacts.filter((c) => c.listId !== id);
    db.outreachLists = db.outreachLists.filter((l) => l.id !== id);
    db.activityLogs.unshift({
      id: newId(),
      at: new Date().toISOString(),
      actorId: session.memberId,
      actorName: session.memberName || "Moi",
      action: "outreach.deleted",
      entity: "outreach",
      entityId: id,
      summary: `Liste de prospection « ${list.name} » supprimée (${before - db.outreachContacts.length} contacts)`,
    });
    writeDB(db);
    return { ok: true };
  });
}
