import { NextRequest } from "next/server";
import { newId, readDB, writeDB } from "@/lib/db";
import { Forbidden, readSession, requireSales } from "@/lib/sales/access";
import { handle, required } from "@/lib/sales/http";
import type { SettingExample } from "@/lib/types";

export const dynamic = "force-dynamic";

const OUTCOMES = new Set(["booked", "no-booking", ""]);
const clean = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const urls = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter((x) => x.startsWith("/api/media/") || /^https?:\/\//.test(x)).slice(0, 12) : []);

/** Tous les exemples (toute l'equipe les lit : un bon setting profite a tous). */
export async function GET(req: NextRequest) {
  return handle(() => {
    requireSales(readSession(req));
    const db = readDB();
    return { rows: [...(db.settingExamples ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
  });
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const session = requireSales(readSession(req));
    const b = (await req.json().catch(() => ({}))) as Partial<SettingExample>;
    const db = readDB();
    db.settingExamples ??= [];
    const now = new Date().toISOString();
    const ex: SettingExample = {
      id: newId(),
      ownerId: session.memberId,
      ownerName: session.memberName || "admin",
      title: required(b.title, "Le titre").slice(0, 120),
      context: clean(b.context, 1000),
      outcome: OUTCOMES.has(String(b.outcome ?? "")) ? (b.outcome as SettingExample["outcome"]) : "",
      transcript: clean(b.transcript, 20000),
      screenshots: urls(b.screenshots),
      notes: clean(b.notes, 2000),
      createdAt: now,
      updatedAt: now,
    };
    if (!ex.transcript && !ex.screenshots.length) throw new Error("Colle le transcript de la conversation ou ajoute au moins une capture.");
    db.settingExamples.unshift(ex);
    writeDB(db);
    return { example: ex };
  });
}

export async function PATCH(req: NextRequest) {
  return handle(async () => {
    const session = requireSales(readSession(req));
    const b = (await req.json().catch(() => ({}))) as Partial<SettingExample> & { id?: string };
    const db = readDB();
    const ex = (db.settingExamples ?? []).find((x) => x.id === b.id);
    if (!ex) throw new Error("Exemple introuvable.");
    if (!session.isAdmin && ex.ownerId !== session.memberId) throw new Forbidden("Cet exemple n'est pas à toi.");
    if (typeof b.title === "string") ex.title = clean(b.title, 120) || ex.title;
    if (typeof b.context === "string") ex.context = clean(b.context, 1000);
    if (typeof b.outcome === "string" && OUTCOMES.has(b.outcome)) ex.outcome = b.outcome as SettingExample["outcome"];
    if (typeof b.transcript === "string") ex.transcript = clean(b.transcript, 20000);
    if (b.screenshots !== undefined) ex.screenshots = urls(b.screenshots);
    if (typeof b.notes === "string") ex.notes = clean(b.notes, 2000);
    ex.updatedAt = new Date().toISOString();
    writeDB(db);
    return { example: ex };
  });
}

export async function DELETE(req: NextRequest) {
  return handle(async () => {
    const session = requireSales(readSession(req));
    const b = (await req.json().catch(() => ({}))) as { id?: string };
    const db = readDB();
    const ex = (db.settingExamples ?? []).find((x) => x.id === b.id);
    if (!ex) throw new Error("Exemple introuvable.");
    if (!session.isAdmin && ex.ownerId !== session.memberId) throw new Forbidden("Cet exemple n'est pas à toi.");
    db.settingExamples = db.settingExamples.filter((x) => x.id !== b.id);
    writeDB(db);
    return { ok: true };
  });
}
