import { NextRequest, NextResponse } from "next/server";
import { readDB, writeDB } from "@/lib/db";
import { getContact, getSystemeioKey, getWebhookSecret, importContacts, verifySignature, type SioContact } from "@/lib/systemeio";

export const dynamic = "force-dynamic";

/**
 * Webhook Systeme.io (CONTACT_OPT_IN, CONTACT_CREATED).
 *
 * Authentification : signature HMAC si un secret est configure ; dans tous
 * les cas, quand la cle API est la, le contact est relu chez Systeme.io par
 * son identifiant, ce qui rend impossible l'injection d'un faux prospect.
 * Reponse 200 des que le message est compris, meme s'il ne cree rien :
 * Systeme.io coupe l'abonnement quand trop de livraisons echouent.
 */

function findContact(body: unknown): SioContact | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  const candidates = [o.contact, o.data, (o.data as Record<string, unknown> | undefined)?.contact, o];
  for (const c of candidates) {
    if (c && typeof c === "object" && ("email" in (c as object) || "id" in (c as object))) {
      const rec = c as SioContact;
      if (rec.id !== undefined || rec.email) return rec;
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Payload illisible" }, { status: 400 });
  }

  const event = (req.headers.get("x-webhook-event") ?? "").toUpperCase();
  const secret = getWebhookSecret();
  const signed = secret ? verifySignature(raw, req.headers.get("x-webhook-signature"), secret) : false;

  let contact = findContact(body);
  if (!contact) return NextResponse.json({ ok: true, ignored: "aucun contact dans le message", event });

  // Source de verite : le contact tel que Systeme.io le connait.
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
  const report = importContacts(db, [contact], "Webhook Systeme.io");
  if (report.created || report.updated) writeDB(db);
  return NextResponse.json({ ok: true, event, created: report.created, updated: report.updated, skipped: report.skipped });
}

/** Ping de configuration : permet de verifier l'URL depuis un navigateur. */
export async function GET() {
  return NextResponse.json({ ok: true, service: "systemeio-webhook", configured: Boolean(getSystemeioKey()) });
}
