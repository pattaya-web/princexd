import { NextRequest } from "next/server";
import { readDB, writeDB } from "@/lib/db";
import { createWebhook, getFathomKey, syncFathom } from "@/lib/fathom";
import { readSession, requireAdmin } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";

export const dynamic = "force-dynamic";

/** Etat de l'integration Fathom : cle, webhook pose, derniere relecture, derniers comptes-rendus. */
export async function GET(req: NextRequest) {
  return handle(() => {
    requireAdmin(readSession(req));
    const db = readDB();
    const s = db.settings;
    const recent = db.appointments
      .filter((a) => a.fathomAt)
      .sort((a, b) => (b.fathomAt ?? "").localeCompare(a.fathomAt ?? ""))
      .slice(0, 8)
      .map((a) => ({ id: a.id, at: a.fathomAt ?? "", leadName: db.leads.find((l) => l.id === a.leadId)?.name ?? "—", scheduledAt: a.scheduledAt, url: a.fathomUrl ?? "", summary: a.fathomSummary ?? "" }));
    return {
      configured: Boolean(getFathomKey()),
      webhookId: s.fathomWebhookId ?? "",
      webhookUrl: s.fathomWebhookUrl ?? "",
      secretSet: Boolean(process.env.FATHOM_WEBHOOK_SECRET?.trim() || s.fathomWebhookSecret),
      lastSyncAt: s.fathomLastSyncAt ?? "",
      recent,
    };
  });
}

/**
 * `action: "webhook"` + origin : pose le webhook chez Fathom vers ce site et
 * garde son secret. `action: "sync"` (+ days) : relit les reunions recentes.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    requireAdmin(readSession(req));
    const b = (await req.json().catch(() => ({}))) as { action?: string; origin?: string; days?: number };
    if (b.action === "webhook") {
      const origin = (b.origin ?? "").replace(/\/+$/, "");
      if (!/^https:\/\//.test(origin)) throw new Error("Le webhook exige une adresse publique en https (le site en ligne).");
      const url = `${origin}/api/webhooks/fathom`;
      const wh = await createWebhook(url);
      const db = readDB();
      db.settings.fathomWebhookId = wh.id;
      db.settings.fathomWebhookUrl = url;
      if (wh.secret) db.settings.fathomWebhookSecret = wh.secret;
      writeDB(db);
      return { webhook: { id: wh.id, url }, secretSet: Boolean(wh.secret) };
    }
    if (b.action === "sync") {
      const days = Math.min(Math.max(Number(b.days) || 7, 1), 90);
      const r = await syncFathom({ force: true, days });
      if (!r) throw new Error("Aucune clé API Fathom.");
      return r;
    }
    throw new Error("Action inconnue.");
  });
}
