import { NextRequest } from "next/server";
import { newId, readDB, writeDB } from "@/lib/db";
import { readSession, requireAdmin } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { asActions, asChannel, sortedTemplates, templateCategories } from "@/lib/sales/templates";
import { ensureMessageTemplates } from "@/lib/sales/templates-server";
import type { MessageTemplate } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Modifie un template, ou le duplique (`action: "duplicate"`). Admin. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    requireAdmin(readSession(req));
    const { id } = await ctx.params;
    const b = (await req.json().catch(() => ({}))) as Partial<MessageTemplate> & { action?: "duplicate" };
    const db = readDB();
    ensureMessageTemplates(db);
    const t = db.messageTemplates.find((x) => x.id === id);
    if (!t) throw new Error("Template introuvable.");
    const now = new Date().toISOString();

    if (b.action === "duplicate") {
      // La copie vient juste apres l'original.
      for (const x of db.messageTemplates) if (x.sortOrder > t.sortOrder) x.sortOrder += 1;
      const copy: MessageTemplate = { ...t, id: newId(), name: `${t.name} (copie)`.slice(0, 80), isFavorite: false, defaultFor: [], sortOrder: t.sortOrder + 1, createdAt: now, updatedAt: now };
      db.messageTemplates.push(copy);
      writeDB(db);
      return { template: copy, rows: sortedTemplates(db.messageTemplates) };
    }

    if (typeof b.name === "string") {
      const name = b.name.trim().slice(0, 80);
      if (!name) throw new Error("Le nom est obligatoire.");
      t.name = name;
    }
    if (typeof b.content === "string") {
      const content = b.content.trim().slice(0, 4000);
      if (!content) throw new Error("Le message est obligatoire.");
      t.content = content;
    }
    if (typeof b.category === "string") {
      t.category = b.category.trim().slice(0, 40) || "AUTRE";
      if (!templateCategories(db).includes(t.category)) db.settings.messageTemplateCategories = [...templateCategories(db), t.category];
    }
    if (b.channel !== undefined) t.channel = asChannel(b.channel);
    if (typeof b.isFavorite === "boolean") t.isFavorite = b.isFavorite;
    if (typeof b.isActive === "boolean") t.isActive = b.isActive;
    if (b.defaultFor !== undefined) {
      t.defaultFor = asActions(b.defaultFor);
      // Une action n'a qu'un template par defaut.
      for (const x of db.messageTemplates) if (x.id !== t.id && x.defaultFor?.length) x.defaultFor = x.defaultFor.filter((a) => !t.defaultFor!.includes(a));
    }
    t.updatedAt = now;
    writeDB(db);
    return { template: t, rows: sortedTemplates(db.messageTemplates) };
  });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    requireAdmin(readSession(req));
    const { id } = await ctx.params;
    const db = readDB();
    const before = db.messageTemplates.length;
    db.messageTemplates = db.messageTemplates.filter((x) => x.id !== id);
    if (db.messageTemplates.length === before) throw new Error("Template introuvable.");
    writeDB(db);
    return { ok: true, rows: sortedTemplates(db.messageTemplates) };
  });
}
