import { NextResponse } from "next/server";
import { getSettings, newId, readDB, writeDB } from "@/lib/db";
import type { CallEvent } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Déplie les lignes ICS coupées (une continuation commence par une espace ou une tabulation). */
function unfold(ics: string) {
  return ics.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
}

function unescapeIcs(v: string) {
  return v.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

/** "20260315T140000Z" ou "20260315T140000" -> ISO */
function parseIcsDate(raw: string): string {
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return "";
  const [, y, mo, d, h = "00", mi = "00", s = "00", z] = m;
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}${z ? "Z" : ""}`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

interface IcsEvent {
  uid: string;
  summary: string;
  attendee: string;
  start: string;
  end: string;
  url: string;
  description: string;
}

function parseIcs(ics: string): IcsEvent[] {
  const lines = unfold(ics).split(/\r?\n/);
  const events: IcsEvent[] = [];
  let cur: Partial<IcsEvent> | null = null;

  for (const line of lines) {
    if (line.startsWith("BEGIN:VEVENT")) {
      cur = {};
      continue;
    }
    if (line.startsWith("END:VEVENT")) {
      if (cur?.start) {
        events.push({
          uid: cur.uid ?? newId(),
          summary: cur.summary ?? "Call",
          attendee: cur.attendee ?? "",
          start: cur.start,
          end: cur.end ?? "",
          url: cur.url ?? "",
          description: cur.description ?? "",
        });
      }
      cur = null;
      continue;
    }
    if (!cur) continue;

    const sep = line.indexOf(":");
    if (sep === -1) continue;
    const name = line.slice(0, sep).split(";")[0].toUpperCase();
    const value = unescapeIcs(line.slice(sep + 1));

    if (name === "UID") cur.uid = value;
    else if (name === "SUMMARY") cur.summary = value;
    else if (name === "DTSTART") cur.start = parseIcsDate(value);
    else if (name === "DTEND") cur.end = parseIcsDate(value);
    else if (name === "URL") cur.url = value;
    else if (name === "DESCRIPTION") cur.description = value;
    else if (name === "ATTENDEE") cur.attendee = value.replace(/^mailto:/i, "");
  }
  return events;
}

export async function POST() {
  const url = getSettings().iclosedIcsUrl.trim();
  if (!url) {
    return NextResponse.json(
      { error: "Aucun flux .ics configuré. Ajoute l'URL de ton calendrier iClosed dans Réglages." },
      { status: 400 },
    );
  }

  let ics: string;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    ics = await res.text();
  } catch (e) {
    return NextResponse.json({ error: `Flux .ics injoignable : ${(e as Error).message}` }, { status: 502 });
  }

  const events = parseIcs(ics);
  const db = readDB();
  let created = 0;
  let updated = 0;

  for (const ev of events) {
    const durationMin =
      ev.end && ev.start ? Math.round((new Date(ev.end).getTime() - new Date(ev.start).getTime()) / 60000) : 45;
    // L'UID iCal sert de clé de déduplication entre deux synchros.
    const existing = db.calls.find((c) => c.id === `ics-${ev.uid}`);
    if (existing) {
      existing.title = ev.summary;
      existing.at = ev.start;
      existing.durationMin = durationMin;
      existing.url = ev.url;
      updated++;
    } else {
      const row: CallEvent = {
        id: `ics-${ev.uid}`,
        title: ev.summary,
        contact: ev.attendee || ev.summary,
        at: ev.start,
        durationMin,
        status: "book",
        source: "iclosed",
        outcome: ev.description.slice(0, 500),
        value: 0,
        url: ev.url,
        createdAt: new Date().toISOString(),
      };
      db.calls.unshift(row);
      created++;
    }
  }

  writeDB(db);
  return NextResponse.json({ created, updated, total: events.length });
}
