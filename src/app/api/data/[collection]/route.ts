import { NextRequest, NextResponse } from "next/server";
import { insert, list, remove, update } from "@/lib/db";
import type { CollectionName } from "@/lib/types";

export const dynamic = "force-dynamic";

const ALLOWED: CollectionName[] = [
  "posts",
  "stories",
  "followers",
  "leads",
  "students",
  "calls",
  "resources",
  "todos",
  "ads",
  "team",
  "swipes",
  "generations",
  "edits",
];

function resolve(name: string): CollectionName | null {
  return (ALLOWED as string[]).includes(name) ? (name as CollectionName) : null;
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ collection: string }> }) {
  const { collection } = await ctx.params;
  const key = resolve(collection);
  if (!key) return NextResponse.json({ error: "Collection inconnue" }, { status: 404 });
  return NextResponse.json(list(key));
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ collection: string }> }) {
  const { collection } = await ctx.params;
  const key = resolve(collection);
  if (!key) return NextResponse.json({ error: "Collection inconnue" }, { status: 404 });
  const body = (await req.json()) as Record<string, unknown>;
  return NextResponse.json(insert(key, body));
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ collection: string }> }) {
  const { collection } = await ctx.params;
  const key = resolve(collection);
  if (!key) return NextResponse.json({ error: "Collection inconnue" }, { status: 404 });
  const { id, ...patch } = (await req.json()) as { id?: string } & Record<string, unknown>;
  if (!id) return NextResponse.json({ error: "id manquant" }, { status: 400 });
  const row = update(key, id, patch);
  if (!row) return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  return NextResponse.json(row);
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ collection: string }> }) {
  const { collection } = await ctx.params;
  const key = resolve(collection);
  if (!key) return NextResponse.json({ error: "Collection inconnue" }, { status: 404 });
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id manquant" }, { status: 400 });
  return NextResponse.json(remove(key, id));
}
