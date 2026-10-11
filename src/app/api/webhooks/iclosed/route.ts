import { NextRequest, NextResponse } from "next/server";
import { readDB, writeDB } from "@/lib/db";
import { logWebhook } from "@/lib/webhook-log";
import { FINAL_STATUSES } from "@/lib/sales/constants";
import { findByIclosedId } from "@/lib/sales/iclosed-link";
import { ICLOSED_SESSION, syncIclosedOutcomes, syncIclosedUpcoming } from "@/lib/sales/iclosed-sync";
import { recordOutcome } from "@/lib/sales/repo";
import type { CallEvent } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Réception des webhooks iClosed (booking / reschedule / cancel / no-show /
 * show / vente). Le format exact varie selon les versions, donc on pioche
 * les champs de façon tolérante plutôt que d'imposer un schéma strict, et
 * chaque message brut est journalisé dans data/webhooks/iclosed.jsonl.
 *
 * Règles :
 *  - le webhook ne crée JAMAIS de lead : la création d'un rendez-vous passe
 *    par la synchro iClosed (une seule façon, un seul rapprochement par
 *    pseudo / email / téléphone), déclenchée tout de suite après ;
 *  - un événement de statut (annulé, reprogrammé, no-show, show) s'applique
 *    au rendez-vous déjà rattaché par son identifiant iClosed, sauf si le
 *    CRM a déjà tranché (statut final posé à la main) ;
 *  - une vente passe par la synchro des issues (le montant vient de l'API).
 */
function pick(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return "";
}

function flatten(obj: unknown, out: Record<string, unknown> = {}, depth = 0): Record<string, unknown> {
  if (depth > 4 || !obj || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, out, depth + 1);
    else if (out[k] === undefined) out[k] = v;
  }
  return out;
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const body = (() => {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  })();
  if (!body) return NextResponse.json({ error: "Payload illisible" }, { status: 400 });

  const flat = flatten(body);
  const event = pick(flat, ["event", "event_type", "eventType", "type", "action", "trigger"]).toLowerCase();
  const uid = pick(flat, ["eventCallId", "event_call_id", "callId", "call_id", "id", "booking_id", "bookingId", "uuid", "event_id"]);
  const name = pick(flat, ["invitee_name", "inviteeName", "name", "full_name", "contact_name"]);
  const email = pick(flat, ["invitee_email", "inviteeEmail", "email", "contact_email"]);
  const at = pick(flat, ["dateTimeUTC", "start_time", "startTime", "scheduled_at", "start", "date"]);
  const url = pick(flat, ["locationLinkInvitee", "locationLink", "location", "meeting_url", "join_url", "event_url"]);
  logWebhook("iclosed", { event, uid, name, email, at, body: raw.slice(0, 6000) });

  const db = readDB();
  const id = uid ? `iclosed-${uid}` : `iclosed-${Date.now()}`;
  const iso = at && !Number.isNaN(Date.parse(at)) ? new Date(at).toISOString() : new Date().toISOString();

  const kind: "cancel" | "reschedule" | "no-show" | "show" | "sale" | "book" = event.includes("cancel")
    ? "cancel"
    : event.includes("reschedul")
      ? "reschedule"
      : event.includes("no_show") || event.includes("noshow") || event.includes("no-show")
        ? "no-show"
        : event.includes("sale") || event.includes("won") || event.includes("deal")
          ? "sale"
          : event.includes("complete") || event.includes("show")
            ? "show"
            : "book";

  /* Agenda historique (`calls`) : inchange. */
  const status: CallEvent["status"] = kind === "cancel" ? "perdu" : kind === "no-show" ? "no-show" : kind === "show" || kind === "sale" ? "show" : "book";
  const existing = db.calls.find((c) => c.id === id);
  if (existing) {
    existing.at = iso;
    existing.status = status;
    if (name) existing.contact = name;
  } else {
    db.calls.unshift({
      id,
      title: pick(flat, ["event_name", "title", "eventName", "callType"]) || `Call — ${name || email || "inconnu"}`,
      contact: name || email || "inconnu",
      at: iso,
      durationMin: Number(pick(flat, ["duration", "duration_minutes"])) || 45,
      status,
      source: "iclosed",
      outcome: "",
      value: 0,
      url,
      createdAt: new Date().toISOString(),
    });
  }
  writeDB(db);

  /* Rendez-vous du module commercial : statut, par identifiant iClosed. */
  let applied = "";
  const appt = uid ? findByIclosedId(readDB(), uid) : undefined;
  if (appt && !FINAL_STATUSES.includes(appt.status)) {
    try {
      if (kind === "cancel") {
        recordOutcome(ICLOSED_SESSION, appt.id, { status: "cancelled", closerNotes: "Annulé côté iClosed (webhook)" });
        applied = "cancelled";
      } else if (kind === "reschedule" && at) {
        recordOutcome(ICLOSED_SESSION, appt.id, { status: "rescheduled", rescheduledAt: iso });
        applied = "rescheduled";
      } else if (kind === "no-show") {
        recordOutcome(ICLOSED_SESSION, appt.id, { status: "no-show" });
        applied = "no-show";
      } else if (kind === "show" && appt.status !== "completed" && appt.status !== "follow-up") {
        recordOutcome(ICLOSED_SESSION, appt.id, { status: "completed" });
        applied = "completed";
      }
    } catch (e) {
      logWebhook("iclosed", { event, uid, error: (e as Error).message });
    }
  }

  /*
   * Le webhook ne fait que prevenir : on relit iClosed tout de suite avec la
   * meme logique que la synchro (lien signe par setter, prospect declare,
   * closer par defaut). Une seule facon de creer un rendez-vous iClosed, donc
   * une seule attribution possible, et le call est la a la seconde. Une vente
   * ou une issue saisie dans iClosed arrive par la synchro des issues.
   */
  await syncIclosedUpcoming({ force: true }).catch(() => null);
  if (kind === "sale" || kind === "show" || kind === "no-show") await syncIclosedOutcomes({ force: true }).catch(() => null);

  return NextResponse.json({ ok: true, id, kind, applied: applied || undefined });
}
