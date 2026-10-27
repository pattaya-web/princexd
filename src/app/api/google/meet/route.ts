import { NextRequest } from "next/server";
import { newId, readDB, writeDB } from "@/lib/db";
import { createMeetEvent, deleteEvent, disconnectGoogle, googleClient, googleConnected } from "@/lib/google";
import { readSession, requireAdmin } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import type { MeetLink } from "@/lib/types";

export const dynamic = "force-dynamic";

const MEET_KINDS: Record<MeetLink["kind"], string> = { sale: "Call de vente", student: "Call élève", other: "Autre" };

/** Etat de la connexion Google et les liens deja generes (les plus recents d'abord). */
export async function GET(req: NextRequest) {
  return handle(() => {
    requireAdmin(readSession(req));
    const db = readDB();
    const { id, secret } = googleClient();
    return {
      clientSet: Boolean(id && secret),
      connected: googleConnected(),
      email: db.settings.googleAccountEmail ?? "",
      rows: [...(db.meetLinks ?? [])].sort((a, b) => b.startAt.localeCompare(a.startAt)).slice(0, 100),
    };
  });
}

/**
 * Genere un lien Meet : l'evenement est cree dans l'agenda Google de Mady
 * (fuseau choisi : Dubai par defaut, ou France), l'invite recoit
 * l'invitation s'il a un email, et le lien est garde ici pour le recopier.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    requireAdmin(readSession(req));
    const b = (await req.json().catch(() => ({}))) as Partial<MeetLink> & { action?: string };
    if (b.action === "disconnect") {
      disconnectGoogle();
      return { ok: true };
    }
    const kind: MeetLink["kind"] = b.kind === "student" || b.kind === "other" ? b.kind : "sale";
    const guestName = String(b.guestName ?? "").trim().slice(0, 80);
    const guestEmail = String(b.guestEmail ?? "").trim().toLowerCase().slice(0, 120);
    if (guestEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(guestEmail)) throw new Error("Email de l'invité invalide.");
    const timeZone = b.timeZone === "Europe/Paris" ? "Europe/Paris" : "Asia/Dubai";
    const startAt = String(b.startAt ?? "");
    if (Number.isNaN(Date.parse(startAt))) throw new Error("Date et heure du call manquantes.");
    const durationMin = Math.min(Math.max(Number(b.durationMin) || 30, 10), 240);
    const endAt = new Date(Date.parse(startAt) + durationMin * 60_000).toISOString();
    const title = String(b.title ?? "").trim().slice(0, 120) || `${MEET_KINDS[kind]}${guestName ? ` · ${guestName}` : ""} · Mady`;
    const note = String(b.note ?? "").trim().slice(0, 2000);
    const ev = await createMeetEvent({ title, description: note, startAt: new Date(startAt).toISOString(), endAt, timeZone, attendees: guestEmail ? [guestEmail] : [] });
    const db = readDB();
    db.meetLinks ??= [];
    const link: MeetLink = { id: newId(), kind, title, guestName, guestEmail, startAt: new Date(startAt).toISOString(), timeZone, durationMin, meetUrl: ev.meetUrl, eventUrl: ev.eventUrl, eventId: ev.id, note, createdAt: new Date().toISOString() };
    db.meetLinks.unshift(link);
    writeDB(db);
    return { link };
  });
}

/** Annule le call : l'evenement Google est supprime (l'invite est prevenu) et la ligne retiree. */
export async function DELETE(req: NextRequest) {
  return handle(async () => {
    requireAdmin(readSession(req));
    const b = (await req.json().catch(() => ({}))) as { id?: string };
    const db = readDB();
    const link = (db.meetLinks ?? []).find((l) => l.id === b.id);
    if (!link) throw new Error("Lien introuvable.");
    if (link.eventId) await deleteEvent(link.eventId);
    db.meetLinks = (db.meetLinks ?? []).filter((l) => l.id !== b.id);
    writeDB(db);
    return { ok: true };
  });
}
