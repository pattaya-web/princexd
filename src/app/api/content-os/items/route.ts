import { NextRequest, NextResponse } from "next/server";
import { insert, list, remove, update } from "@/lib/db";
import { emptyItem, FORMATS, FUNNELS, PLATFORMS, STATUSES } from "@/lib/content-os";
import type { ContentItem } from "@/lib/types";

export const dynamic = "force-dynamic";

const str = (v: unknown, max = 2000) => (typeof v === "string" ? v.trim().slice(0, max) : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : typeof v === "string" && v.trim() ? Math.max(0, Math.round(Number(v)) || 0) : undefined);

/** Ne garde que les champs connus, avec leurs valeurs permises. */
function sanitize(body: Record<string, unknown>): Partial<ContentItem> {
  const p: Partial<ContentItem> = {};
  const title = str(body.title, 200);
  if (title !== undefined) p.title = title;
  if (PLATFORMS.some((x) => x.id === body.platform)) p.platform = body.platform as ContentItem["platform"];
  if (FORMATS.some((x) => x.id === body.format)) p.format = body.format as ContentItem["format"];
  if (FUNNELS.includes(body.funnel as ContentItem["funnel"])) p.funnel = body.funnel as ContentItem["funnel"];
  if (STATUSES.some((x) => x.id === body.status)) p.status = body.status as ContentItem["status"];
  for (const k of ["hook", "plan", "owner", "rushesUrl", "editUrl", "postNotes", "winnerNotes", "variations"] as const) {
    const v = str(body[k], k === "plan" || k === "postNotes" ? 8000 : 2000);
    if (v !== undefined) p[k] = v;
  }
  const due = str(body.dueAt, 10);
  if (due !== undefined) p.dueAt = /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : "";
  for (const k of ["views", "comments", "dms", "leads", "order"] as const) {
    const v = num(body[k]);
    if (v !== undefined) p[k] = v;
  }
  if (typeof body.winner === "boolean") p.winner = body.winner;
  return p;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch = sanitize(body);
  if (!patch.title) return NextResponse.json({ error: "Donne un titre au contenu." }, { status: 400 });
  const now = new Date().toISOString();
  const items = list("contentItems") as ContentItem[];
  // `insert` pose lui-même l'identifiant et la date de création : on renvoie la ligne telle qu'enregistrée.
  const row = insert("contentItems", { ...emptyItem(), ...patch, order: items.length + 1, updatedAt: now } as unknown as Record<string, unknown>);
  return NextResponse.json({ item: row as unknown as ContentItem });
}

export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const id = typeof body.id === "string" ? body.id : "";
  const items = list("contentItems") as ContentItem[];
  if (!items.some((x) => x.id === id)) return NextResponse.json({ error: "Contenu introuvable." }, { status: 404 });
  const patch = { ...sanitize(body), updatedAt: new Date().toISOString() };
  update("contentItems", id, patch);
  const item = (list("contentItems") as ContentItem[]).find((x) => x.id === id);
  return NextResponse.json({ item });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  const items = list("contentItems") as ContentItem[];
  if (!items.some((x) => x.id === id)) return NextResponse.json({ error: "Contenu introuvable." }, { status: 404 });
  remove("contentItems", id);
  return NextResponse.json({ ok: true });
}
