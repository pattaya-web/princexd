import { NextRequest } from "next/server";
import { newId, readDB, writeDB } from "@/lib/db";
import { readSession, requireAdmin, requireSales } from "@/lib/sales/access";
import { handle, required } from "@/lib/sales/http";
import { asActions, asChannel, sortedTemplates, TEMPLATE_ACTIONS, TEMPLATE_CHANNELS, templateCategories } from "@/lib/sales/templates";
import { ensureConfirmationTemplate, ensureMessageTemplates } from "@/lib/sales/templates-server";
import type { MessageTemplate } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Les templates (tous les commerciaux), leurs categories et les canaux. */
export async function GET(req: NextRequest) {
  return handle(() => {
    requireSales(readSession(req));
    const db = readDB();
    const seeded = ensureMessageTemplates(db);
    if (ensureConfirmationTemplate(db) || seeded) writeDB(db);
    return { rows: sortedTemplates(db.messageTemplates), categories: templateCategories(db), channels: TEMPLATE_CHANNELS, actions: TEMPLATE_ACTIONS };
  });
}

/** Nouveau template. Ouvert a tout commercial : « sauvegarder comme nouveau template » depuis la liste des leads. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const session = requireSales(readSession(req));
    const b = (await req.json().catch(() => ({}))) as Partial<MessageTemplate>;
    const db = readDB();
    ensureMessageTemplates(db);
    const now = new Date().toISOString();
    const t: MessageTemplate = {
      id: newId(),
      name: required(b.name, "Le nom").slice(0, 80),
      category: String(b.category ?? "").trim().slice(0, 40) || "AUTRE",
      content: required(b.content, "Le message").slice(0, 4000),
      channel: asChannel(b.channel),
      isFavorite: Boolean(b.isFavorite),
      isActive: b.isActive !== false,
      sortOrder: db.messageTemplates.reduce((m, x) => Math.max(m, x.sortOrder), -1) + 1,
      defaultFor: session.isAdmin ? asActions(b.defaultFor) : [],
      // Un script cree par un setter lui appartient : lui et l'admin le modifient.
      ...(session.isAdmin ? {} : { ownerId: session.memberId }),
      notes: String(b.notes ?? "").trim().slice(0, 2000),
      createdAt: now,
      updatedAt: now,
    };
    if (!templateCategories(db).includes(t.category)) db.settings.messageTemplateCategories = [...templateCategories(db), t.category];
    db.messageTemplates.push(t);
    writeDB(db);
    return { template: t };
  });
}

/** Ordre des templates et liste des categories (admin). */
export async function PUT(req: NextRequest) {
  return handle(async () => {
    requireAdmin(readSession(req));
    const b = (await req.json().catch(() => ({}))) as { order?: string[]; categories?: string[] };
    const db = readDB();
    ensureMessageTemplates(db);
    if (Array.isArray(b.order)) {
      const pos = new Map(b.order.map((id, i) => [id, i]));
      const rest = sortedTemplates(db.messageTemplates).filter((t) => !pos.has(t.id));
      for (const t of db.messageTemplates) t.sortOrder = pos.has(t.id) ? pos.get(t.id)! : b.order.length + rest.indexOf(t);
    }
    if (Array.isArray(b.categories)) {
      const clean = [...new Set(b.categories.map((c) => String(c).trim().slice(0, 40)).filter(Boolean))];
      if (!clean.length) throw new Error("Garde au moins une catégorie.");
      db.settings.messageTemplateCategories = clean;
    }
    writeDB(db);
    return { rows: sortedTemplates(db.messageTemplates), categories: templateCategories(db) };
  });
}
