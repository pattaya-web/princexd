import { NextRequest, NextResponse } from "next/server";
import { getSettings, newId, readDB, writeDB } from "@/lib/db";
import { upsertLead } from "@/lib/sales/repo";
import type { Appointment, CallEvent, Lead } from "@/lib/types";

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

  /*
   * Rendez-vous du module commercial.
   *
   * C'est la voie fiable pour recevoir un booking : l'API de liste d'iClosed
   * s'est reveleé incapable de renvoyer les rendez-vous a venir (elle annonce
   * `count: 1` avec une liste vide, verifie sur les 12 pages du compte). Le
   * webhook, lui, pousse l'information au moment ou elle nait.
   *
   * Comme pour l'import manuel, iClosed ne sait pas qui a set le lead : le
   * rendez-vous prend le setter par defaut configure dans les reglages. Sans
   * setter par defaut, on ne cree rien plutot que d'inventer une attribution.
   */
  const settings = getSettings();
  const setterId = settings.salesDefaultSetterId;
  const alreadyLinked = db.appointments.some((a) => a.iclosedEventId === uid);

  if (status === "book" && uid && setterId && !alreadyLinked && db.team.some((m) => m.id === setterId)) {
    const igGuess = (email || name || `iclosed-${uid}`).split("@")[0];
    const lead = upsertLead(db, {
      igUsername: igGuess,
      name,
      email,
      timezone: pick(flat, ["timezone", "inviteTimeZone"]) || "Europe/Paris",
      setterId,
      source: "inbound",
    });

    const appointment: Appointment = {
      id: newId(),
      leadId: lead.id,
      setterId,
      closerId: "",
      scheduledAt: iso,
      timezone: pick(flat, ["timezone", "inviteTimeZone"]) || "Europe/Paris",
      source: "inbound",
      status: "booked",
      qualified: false,
      setterNotes: "",
      closerNotes: "",
      lostReason: "",
      iclosedUrl: url,
      iclosedEventId: uid,
      rescheduledFromId: "",
      completedAt: "",
      history: [
        {
          at: new Date().toISOString(),
          actorId: "",
          actorName: "iClosed",
          from: "",
          to: "booked",
          note: "Reçu par webhook iClosed",
        },
      ],
      createdBy: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    db.appointments.unshift(appointment);
    db.activityLogs.unshift({
      id: newId(),
      at: appointment.createdAt,
      actorId: "",
      actorName: "iClosed",
      action: "appointment.created",
      entity: "appointment",
      entityId: appointment.id,
      summary: `Rendez-vous reçu d'iClosed pour ${lead.handle || lead.name}`,
    });
  }

  writeDB(db);
  return NextResponse.json({ ok: true, id, status });
}
