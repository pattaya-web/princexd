import { NextRequest, NextResponse } from "next/server";
import { readDB, writeDB } from "@/lib/db";
import type { CallEvent, Lead } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Réception des webhooks iClosed (booking / reschedule / cancel / no-show).
 * Le format exact varie selon les versions, donc on pioche les champs
 * de façon tolérante plutôt que d'imposer un schéma strict.
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
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Payload illisible" }, { status: 400 });

  const flat = flatten(body);
  const event = pick(flat, ["event", "event_type", "type", "action"]).toLowerCase();
  const uid = pick(flat, ["id", "booking_id", "bookingId", "uuid", "event_id"]);
  const name = pick(flat, ["invitee_name", "name", "full_name", "contact_name", "inviteeName"]);
  const email = pick(flat, ["invitee_email", "email", "contact_email"]);
  const at = pick(flat, ["start_time", "startTime", "scheduled_at", "start", "date"]);
  const url = pick(flat, ["location", "meeting_url", "join_url", "event_url"]);

  const db = readDB();
  const id = uid ? `iclosed-${uid}` : `iclosed-${Date.now()}`;
  const iso = at ? new Date(at).toISOString() : new Date().toISOString();

  const status: CallEvent["status"] = event.includes("cancel")
    ? "perdu"
    : event.includes("no_show") || event.includes("noshow")
      ? "no-show"
      : event.includes("complete") || event.includes("show")
        ? "show"
        : "book";

  const existing = db.calls.find((c) => c.id === id);
  if (existing) {
    existing.at = iso;
    existing.status = status;
    if (name) existing.contact = name;
  } else {
    db.calls.unshift({
      id,
      title: pick(flat, ["event_name", "title", "eventName"]) || `Call — ${name || email || "inconnu"}`,
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

  // Un booking crée aussi le lead correspondant s'il n'existe pas encore.
  if (status === "book" && (name || email)) {
    // Les leads peuvent venir d'un import partiel : on ne présume aucun champ.
    const known = db.leads.find(
      (l) =>
        (email && (l.notes ?? "").includes(email)) ||
        (name && (l.name ?? "").toLowerCase() === name.toLowerCase()),
    );
    if (!known) {
      const lead: Lead = {
        id: `lead-${id}`,
        name: name || email,
        handle: "",
        source: "bio-link",
        stage: "call-book",
        dealValue: 0,
        callAt: iso,
        ownerRole: "moi",
        ownerName: "",
        painPoint: "",
        nextAction: "Préparer le call",
        nextActionAt: iso.slice(0, 10),
        notes: email ? `Email : ${email}` : "",
        createdAt: new Date().toISOString(),
      };
      db.leads.unshift(lead);
    } else if (known.stage === "nouveau" || known.stage === "contacte" || known.stage === "conversation") {
      known.stage = "call-book";
      known.callAt = iso;
    }
  }

  writeDB(db);
  return NextResponse.json({ ok: true, id, status });
}
