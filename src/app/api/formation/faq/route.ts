import { NextRequest } from "next/server";
import { newId, readDB, writeDB } from "@/lib/db";
import { readSession, requireAdmin, requireFormation } from "@/lib/sales/access";
import { handle, required } from "@/lib/sales/http";
import { youtubeId } from "@/lib/formation";
import type { CourseFaqVideo, DB } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Questions rapides en vidéo (Ressources de la plateforme élèves, 2026-10-30).
 *
 * Une objection ou une question qui revient souvent chez les élèves, et la
 * vidéo YouTube de 5-10 min qui y répond. Lues par les élèves, gérées par
 * Mady directement sur la page (titre de la section, question, lien, ordre).
 */
const DEFAULT_FAQ_TITLE = "Questions rapides";

export interface FaqVideoRow extends CourseFaqVideo {
  youtubeId: string | null;
}

export interface FaqPayload {
  title: string;
  items: FaqVideoRow[];
  isAdmin: boolean;
}

/** La première question, posée une fois : la vidéo « créer des avis » que Mady a donnée le 2026-10-30. */
function seed(db: DB) {
  if (db.settings.courseFaqSeededAt) return;
  const now = new Date().toISOString();
  if (db.courseFaq.length === 0) {
    db.courseFaq.push({ id: newId(), question: "Comment je fais pour créer des avis ?", youtubeUrl: "https://www.youtube.com/watch?v=tx1jPvvGCLE", order: 1, createdAt: now, updatedAt: now });
  }
  db.settings.courseFaqSeededAt = now;
  writeDB(db);
}

const sorted = (items: CourseFaqVideo[]) => items.slice().sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));

function payload(db: DB, isAdmin: boolean): FaqPayload {
  return {
    title: (db.settings.studentFaqTitle ?? "").trim() || DEFAULT_FAQ_TITLE,
    items: sorted(db.courseFaq).map((f) => ({ ...f, youtubeId: youtubeId(f.youtubeUrl) })),
    isAdmin,
  };
}

function readUrl(raw: unknown, fallback = ""): string {
  const url = typeof raw === "string" ? raw.trim() : fallback;
  if (!youtubeId(url)) throw new Error("Lien YouTube non reconnu. Colle le lien de la vidéo (youtube.com/watch?v=… ou youtu.be/…).");
  return url;
}

export async function GET(req: NextRequest) {
  return handle((): FaqPayload => {
    const session = requireFormation(readSession(req));
    const db = readDB();
    seed(db);
    return payload(db, session.isAdmin);
  });
}

/** Nouvelle question : à la fin de la liste. */
export async function POST(req: NextRequest) {
  return handle(async (): Promise<FaqPayload> => {
    requireAdmin(readSession(req));
    const body = (await req.json()) as Record<string, unknown>;
    const db = readDB();
    const now = new Date().toISOString();
    db.courseFaq.push({
      id: newId(),
      question: required(body.question, "La question").slice(0, 200),
      youtubeUrl: readUrl(body.youtubeUrl),
      order: db.courseFaq.reduce((m, f) => Math.max(m, f.order), 0) + 1,
      createdAt: now,
      updatedAt: now,
    });
    writeDB(db);
    return payload(db, true);
  });
}

/** Modifier une question (texte, lien, monter / descendre) ou le titre de la section. */
export async function PATCH(req: NextRequest) {
  return handle(async (): Promise<FaqPayload> => {
    requireAdmin(readSession(req));
    const body = (await req.json()) as Record<string, unknown>;
    const db = readDB();
    if (typeof body.title === "string") db.settings.studentFaqTitle = body.title.trim().slice(0, 80);
    if (typeof body.id === "string") {
      const items = sorted(db.courseFaq);
      const idx = items.findIndex((f) => f.id === body.id);
      if (idx < 0) throw new Error("Question introuvable.");
      const item = items[idx];
      if (typeof body.question === "string") item.question = required(body.question, "La question").slice(0, 200);
      if (typeof body.youtubeUrl === "string") item.youtubeUrl = readUrl(body.youtubeUrl, item.youtubeUrl);
      if (body.move === "up" || body.move === "down") {
        const j = body.move === "up" ? idx - 1 : idx + 1;
        if (j >= 0 && j < items.length) [items[idx], items[j]] = [items[j], items[idx]];
        items.forEach((f, i) => {
          f.order = i + 1;
        });
      }
      item.updatedAt = new Date().toISOString();
    }
    writeDB(db);
    return payload(db, true);
  });
}

export async function DELETE(req: NextRequest) {
  return handle(async (): Promise<FaqPayload> => {
    requireAdmin(readSession(req));
    const body = (await req.json().catch(() => ({}))) as { id?: string };
    const db = readDB();
    const before = db.courseFaq.length;
    db.courseFaq = db.courseFaq.filter((f) => f.id !== body.id);
    if (db.courseFaq.length === before) throw new Error("Question introuvable.");
    writeDB(db);
    return payload(db, true);
  });
}
