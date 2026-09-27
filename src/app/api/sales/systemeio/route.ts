import { randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { readDB, writeDB } from "@/lib/db";
import { readSession, requireAdmin, requireSales } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { createWebhook, getSystemeioKey, listWebhooks, syncSystemeio } from "@/lib/systemeio";

export const dynamic = "force-dynamic";

/** Etat de l'integration : cle, derniere synchro, webhook en place chez Systeme.io. */
export async function GET(req: NextRequest) {
  return handle(async () => {
    requireSales(readSession(req));
    const s = readDB().settings;
    const configured = Boolean(getSystemeioKey());
    let webhooks: { id: string; url: string; active: boolean; events: string[] }[] = [];
    let error = "";
    if (configured) {
      try {
        webhooks = (await listWebhooks()).map((w) => ({ id: w.id, url: w.url, active: w.active, events: w.subscriptions.map((x) => x.event) }));
      } catch (e) {
        error = (e as Error).message;
      }
    }
    return {
      configured,
      lastSyncAt: s.systemeioLastSyncAt ?? "",
      sourceFilter: s.systemeioSourceFilter ?? "",
      assignment: s.salesLeadAssignment ?? "default",
      secretSet: Boolean(process.env.SYSTEMEIO_WEBHOOK_SECRET?.trim() || s.systemeioWebhookSecret),
      webhooks,
      error,
    };
  });
}

/** Synchro manuelle, forcee. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    requireSales(readSession(req));
    if (!getSystemeioKey()) throw new Error("Clé API Systeme.io manquante.");
    const report = await syncSystemeio({ force: true });
    return { created: report?.created ?? 0, updated: report?.updated ?? 0, skipped: report?.skipped ?? 0 };
  });
}

/**
 * Cree le webhook chez Systeme.io vers ce site, avec un secret genere ici et
 * garde dans les reglages : rien a recopier a la main.
 */
export async function PUT(req: NextRequest) {
  return handle(async () => {
    requireAdmin(readSession(req));
    const body = (await req.json().catch(() => ({}))) as { origin?: string };
    const origin = (body.origin ?? "").replace(/\/+$/, "");
    if (!/^https:\/\//.test(origin)) throw new Error("Le webhook exige une adresse publique en https (le site en ligne).");
    const url = `${origin}/api/webhooks/systemeio`;

    const existing = (await listWebhooks()).find((w) => w.url === url);
    if (existing) return { webhook: existing, alreadyExisted: true };

    const db = readDB();
    const secret = db.settings.systemeioWebhookSecret || randomBytes(24).toString("hex");
    const webhook = await createWebhook(url, secret);
    db.settings.systemeioWebhookSecret = secret;
    writeDB(db);
    return { webhook, alreadyExisted: false };
  });
}
