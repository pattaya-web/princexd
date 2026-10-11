import { NextRequest, NextResponse } from "next/server";
import { readDB, writeDB } from "@/lib/db";
import {
  funnelStepUrl,
  getContact,
  getSystemeioKey,
  getWebhookSecret,
  importContacts,
  importOptIn,
  logWebhook,
  verifySignature,
  type OptInEvent,
  type SioContact,
} from "@/lib/systemeio";

export const dynamic = "force-dynamic";

/**
 * Webhook Systeme.io. Deux formats arrivent ici :
 *
 *  1. Le webhook API (cree par l'outil) : en-tete X-Webhook-Event
 *     CONTACT_CREATED / CONTACT_OPT_IN, corps `{ contact }`. Il ne dit PAS
 *     sur quelle page le contact vient de s'inscrire : `sourceURL` est
 *     l'URL de sa premiere inscription, meme six mois plus tard.
 *  2. Le webhook d'automatisation (regle « formulaire d'etape soumis →
 *     envoyer un webhook » posee dans le funnel Systeme.io) : corps
 *     `{ type: "contact.optin.completed", data: { contact, funnel_step: { id, name, funnel: { id, name } } } }`.
 *     L'etape donne la page exacte de l'opt-in : c'est elle qui range un
 *     reinscrit dans le bon funnel (Ads ou organique).
 *
 * Authentification : signature HMAC si un secret est configure ; dans tous
 * les cas, quand la cle API est la, le contact est relu chez Systeme.io par
 * son identifiant, ce qui rend impossible l'injection d'un faux prospect.
 * Reponse 200 des que le message est compris, meme s'il ne cree rien :
 * Systeme.io coupe l'abonnement quand trop de livraisons echouent.
 */

interface ParsedMessage {
  contact: SioContact;
  event: string;
  optIn: boolean;
  at: string;
  funnelStep?: { id?: string | number; name?: string; funnel?: { id?: string | number; name?: string } };
}

const asRecord = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

function asContact(v: unknown): SioContact | null {
  const c = asRecord(v);
  if (!c) return null;
  if (c.id === undefined && !c.email) return null;
  return c as unknown as SioContact;
}

function parseMessage(body: unknown, headerEvent: string): ParsedMessage | null {
  const o = asRecord(body);
  if (!o) return null;
  const data = asRecord(o.data);
  const type = typeof o.type === "string" ? o.type.toLowerCase() : "";

  // Format automatisation : type + data.contact (+ data.funnel_step).
  if (data && (type || data.funnel_step || data.contact)) {
    const contact = asContact(data.contact) ?? asContact(data);
    if (contact) {
      const step = asRecord(data.funnel_step);
      const funnel = step ? asRecord(step.funnel) : null;
      const created = typeof o.created_at === "string" || typeof o.created_at === "number" ? new Date(o.created_at) : null;
      return {
        contact,
        event: type || headerEvent || "AUTOMATION",
        optIn: !type || type.includes("optin") || type.includes("opt_in") || type.includes("subscribed") || Boolean(step),
        at: created && !Number.isNaN(created.getTime()) ? created.toISOString() : new Date().toISOString(),
        funnelStep: step
          ? {
              id: step.id as string | number | undefined,
              name: typeof step.name === "string" ? step.name : undefined,
              funnel: funnel ? { id: funnel.id as string | number | undefined, name: typeof funnel.name === "string" ? funnel.name : undefined } : undefined,
            }
          : undefined,
      };
    }
  }

  // Format API : { contact }.
  const contact = asContact(o.contact) ?? asContact(o);
  if (!contact) return null;
  return { contact, event: headerEvent || "CONTACT", optIn: headerEvent === "CONTACT_OPT_IN", at: new Date().toISOString() };
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Payload illisible" }, { status: 400 });
  }

  const headerEvent = (req.headers.get("x-webhook-event") ?? "").toUpperCase();
  const secret = getWebhookSecret();
  const signed = secret ? verifySignature(raw, req.headers.get("x-webhook-signature"), secret) : false;

  const msg = parseMessage(body, headerEvent);
  logWebhook({ event: msg?.event ?? headerEvent, signed, contactId: msg?.contact.id, body: raw.slice(0, 6000) });
  if (!msg) return NextResponse.json({ ok: true, ignored: "aucun contact dans le message", event: headerEvent });

  // Source de verite : le contact tel que Systeme.io le connait (id, email, telephone, date d'inscription).
  let contact = msg.contact;
  if (getSystemeioKey() && contact.id !== undefined) {
    try {
      contact = await getContact(contact.id);
    } catch (e) {
      // Sans relecture ni signature valable, on ne prend pas le risque.
      if (!signed) return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 200 });
    }
  } else if (secret && !signed) {
    return NextResponse.json({ error: "Signature invalide" }, { status: 401 });
  }

  const db = readDB();
  if (!msg.optIn) {
    const report = importContacts(db, [contact], "Webhook Systeme.io");
    if (report.created || report.updated) writeDB(db);
    return NextResponse.json({ ok: true, event: msg.event, created: report.created, updated: report.updated, skipped: report.skipped });
  }

  // La page de l'etape (webhook d'automatisation) vaut plus que l'URL historique du contact.
  const ev: OptInEvent = {
    at: msg.at,
    pageUrl: msg.funnelStep ? await funnelStepUrl(msg.funnelStep.funnel?.id, msg.funnelStep.id) : "",
    funnelName: msg.funnelStep?.funnel?.name,
    stepName: msg.funnelStep?.name,
  };
  const report = importOptIn(db, contact, ev, "Webhook Systeme.io");
  if (report.lead) writeDB(db);
  return NextResponse.json({
    ok: true,
    event: msg.event,
    created: report.created,
    updated: report.updated,
    skipped: report.skipped,
    reoptin: report.reoptin,
    pageKnown: report.pageKnown,
    funnel: report.funnelKey,
    revived: report.revived,
  });
}

/** Ping de configuration : permet de verifier l'URL depuis un navigateur. */
export async function GET() {
  return NextResponse.json({ ok: true, service: "systemeio-webhook", configured: Boolean(getSystemeioKey()) });
}
