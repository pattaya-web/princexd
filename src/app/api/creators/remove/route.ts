import { NextRequest, NextResponse } from "next/server";
import { readDB, writeDB } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Retire un créateur et tout ce qui lui appartient, en une seule écriture.
 *
 * L'ancien retrait passait par N suppressions successives côté client : une
 * interruption laissait des publications orphelines, sans créateur pour les
 * rattacher — c'est arrivé, d'où cette route.
 */
export async function POST(req: NextRequest) {
  const { username } = (await req.json().catch(() => ({}))) as { username?: string };
  const handle = username?.trim().toLowerCase();
  if (!handle) return NextResponse.json({ error: "Pseudo manquant." }, { status: 400 });

  const db = readDB();
  const before = db.creatorPosts.length;

  db.creators = db.creators.filter((c) => c.username !== handle);
  db.creatorPosts = db.creatorPosts.filter((p) => p.creator !== handle);
  writeDB(db);

  return NextResponse.json({ username: handle, postsRemoved: before - db.creatorPosts.length });
}
