import { NextRequest, NextResponse } from "next/server";
import { newId, readDB, writeDB } from "@/lib/db";
import { fetchMeta, parseVideoId, watchUrl } from "@/lib/youtube";
import type { YtVideo } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Les vidéos, la plus récente d'abord. */
export async function GET() {
  return NextResponse.json(readDB().ytVideos);
}

/** `{ urls: string[] }` ou `{ text: "un lien par ligne" }` : ajoute les vidéos (vignette + titre), ignore les doublons. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { urls?: string[]; text?: string };
  const raw = [...(body.urls ?? []), ...(body.text ?? "").split(/\s+/)].map((s) => s.trim()).filter(Boolean);
  const ids = Array.from(new Set(raw.map(parseVideoId).filter((x): x is string => Boolean(x)))).slice(0, 30);
  if (!ids.length) return NextResponse.json({ error: "Aucun lien YouTube reconnu (watch?v=, youtu.be, shorts)." }, { status: 400 });

  const db = readDB();
  const known = new Set(db.ytVideos.map((v) => v.videoId));
  const fresh = ids.filter((id) => !known.has(id));
  const metas = await Promise.all(fresh.map((id) => fetchMeta(id)));
  const now = new Date().toISOString();
  const added: YtVideo[] = fresh.map((videoId, i) => ({
    id: newId(),
    videoId,
    url: watchUrl(videoId),
    title: metas[i].title,
    author: metas[i].author,
    thumbnail: metas[i].thumbnail,
    durationSec: metas[i].durationSec,
    transcript: "",
    transcriptLang: "",
    transcriptSource: "",
    script: "",
    scriptAt: "",
    notes: "",
    plan: "",
    filmedAt: "",
    createdAt: now,
    updatedAt: now,
  }));
  db.ytVideos.unshift(...added);
  writeDB(db);
  return NextResponse.json({ added: added.length, skipped: ids.length - fresh.length, videos: db.ytVideos });
}

/** `?id=` : retire une vidéo de la liste. */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  const db = readDB();
  const before = db.ytVideos.length;
  db.ytVideos = db.ytVideos.filter((v) => v.id !== id);
  if (db.ytVideos.length === before) return NextResponse.json({ error: "Vidéo introuvable." }, { status: 404 });
  writeDB(db);
  return NextResponse.json({ ok: true });
}

/** `{ id, notes?, plan?, filmed? }` : note libre, déroulé de ma vidéo (« Mon plan »), vidéo tournée (rushs à envoyer au monteur). */
export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { id?: string; notes?: string; plan?: string; filmed?: boolean };
  const db = readDB();
  const v = db.ytVideos.find((x) => x.id === body.id);
  if (!v) return NextResponse.json({ error: "Vidéo introuvable." }, { status: 404 });
  if (typeof body.notes === "string") v.notes = body.notes.slice(0, 4000);
  if (typeof body.plan === "string") v.plan = body.plan.slice(0, 40_000);
  if (typeof body.filmed === "boolean") v.filmedAt = body.filmed ? v.filmedAt || new Date().toISOString() : "";
  v.updatedAt = new Date().toISOString();
  writeDB(db);
  return NextResponse.json(v);
}
