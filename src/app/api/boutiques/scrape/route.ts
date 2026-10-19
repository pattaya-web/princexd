import { NextRequest, NextResponse } from "next/server";
import { scrapeLinks } from "@/lib/boutique/scrape";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Aperçu : lit les produits derrière les liens concurrents, sans rien créer. */
export async function POST(req: NextRequest) {
  const { urls } = (await req.json()) as { urls?: string[] };
  const clean = (urls ?? []).map((u) => u.trim()).filter((u) => /^https?:\/\//i.test(u)).slice(0, 10);
  if (!clean.length) return NextResponse.json({ error: "Donne au moins un lien complet (https://…)." }, { status: 400 });
  const out = await scrapeLinks(clean);
  return NextResponse.json(out);
}
