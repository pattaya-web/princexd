import { NextRequest, NextResponse } from "next/server";
import { syncCreator } from "@/lib/creators-sync";
import { InstagramError } from "@/lib/instagram";

export const dynamic = "force-dynamic";
export const maxDuration = 800;

/** Ajoute ou rafraichit un concurrent suivi (voir lib/creators-sync). */
export async function POST(req: NextRequest) {
  const { username, limit = 24 } = (await req.json().catch(() => ({}))) as { username?: string; limit?: number };
  if (!username?.trim()) return NextResponse.json({ error: "Nom d'utilisateur manquant." }, { status: 400 });
  try {
    return NextResponse.json(await syncCreator(username, limit));
  } catch (e) {
    const err = e as InstagramError;
    return NextResponse.json({ error: err.message }, { status: err.code === 401 ? 401 : 502 });
  }
}
