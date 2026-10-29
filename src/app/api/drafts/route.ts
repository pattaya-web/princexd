import { NextRequest, NextResponse } from "next/server";
import { newId, readDB, writeDB } from "@/lib/db";
import { readSession } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import type { Draft, Session } from "@/lib/types";

export const dynamic = "force-dynamic";

const MAX_VALUE = 60_000;
const MAX_PER_WHO = 400;

/** Proprietaire d'un brouillon : le compte principal, ou un membre / eleve. */
function whoOf(s: Session): string | null {
  if (s.role === "anonyme") return null;
  if (s.role === "owner") return "owner";
  return s.memberId ? `${s.role}:${s.memberId}` : s.role;
}

export interface DraftItem {
  page: string;
  field: string;
  label?: string;
  value: string;
  base?: string;
}

/** `?page=` : les brouillons de cette page ; sans page : tous (page Brouillons). */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const who = whoOf(readSession(req));
    if (!who) return { drafts: [] };
    const page = req.nextUrl.searchParams.get("page") ?? "";
    const db = readDB();
    const drafts = db.drafts.filter((d) => d.who === who && (!page || d.page === page)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { drafts };
  });
}

/**
 * `{ items: DraftItem[] }` : chaque champ est cree ou mis a jour ; une valeur
 * vide supprime le brouillon (l'utilisateur a efface, ou l'app a vide le
 * champ apres envoi). Accepte aussi le corps envoye par `navigator.sendBeacon`
 * (Blob JSON) au moment ou la page se ferme.
 */
export async function POST(req: NextRequest) {
  const who = whoOf(readSession(req));
  if (!who) return NextResponse.json({ ok: false }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { items?: DraftItem[] } | null;
  const items = Array.isArray(body?.items) ? body!.items : [];
  if (!items.length) return NextResponse.json({ ok: true, saved: 0 });
  const db = readDB();
  const now = new Date().toISOString();
  let saved = 0;
  for (const it of items) {
    if (!it || typeof it.page !== "string" || typeof it.field !== "string" || typeof it.value !== "string") continue;
    const page = it.page.slice(0, 500);
    const field = it.field.slice(0, 300);
    const idx = db.drafts.findIndex((d) => d.who === who && d.page === page && d.field === field);
    if (!it.value.trim()) {
      if (idx >= 0) db.drafts.splice(idx, 1);
      saved++;
      continue;
    }
    const value = it.value.slice(0, MAX_VALUE);
    const label = (it.label ?? "").slice(0, 120);
    const base = (it.base ?? "").slice(0, MAX_VALUE);
    if (idx >= 0) {
      const d = db.drafts[idx];
      if (d.value === value && d.base === base) continue;
      d.value = value;
      d.base = base;
      if (label) d.label = label;
      d.updatedAt = now;
    } else {
      const draft: Draft = { id: newId(), who, page, field, label, value, base, updatedAt: now };
      db.drafts.push(draft);
    }
    saved++;
  }
  // Pas d'accumulation sans fin : les plus vieux brouillons de ce compte partent.
  const mine = db.drafts.filter((d) => d.who === who).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (mine.length > MAX_PER_WHO) {
    const drop = new Set(mine.slice(MAX_PER_WHO).map((d) => d.id));
    db.drafts = db.drafts.filter((d) => !drop.has(d.id));
  }
  if (saved) writeDB(db);
  return NextResponse.json({ ok: true, saved });
}

/** `?id=` un brouillon, `?page=` ceux d'une page, `?all=1` tous les miens. */
export async function DELETE(req: NextRequest) {
  return handle(async () => {
    const who = whoOf(readSession(req));
    if (!who) return { ok: false };
    const q = req.nextUrl.searchParams;
    const id = q.get("id") ?? "";
    const page = q.get("page") ?? "";
    const all = q.get("all") === "1";
    const db = readDB();
    const before = db.drafts.length;
    db.drafts = db.drafts.filter((d) => d.who !== who || !(all || (id && d.id === id) || (page && d.page === page)));
    if (db.drafts.length !== before) writeDB(db);
    return { ok: true, removed: before - db.drafts.length };
  });
}
