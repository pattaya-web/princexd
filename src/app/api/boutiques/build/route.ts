import { NextRequest, NextResponse } from "next/server";
import { list } from "@/lib/db";
import { getApiKey } from "@/lib/db";
import { DEFAULT_BRIEF, runningBuild, startBuild } from "@/lib/boutique/build";
import type { ClientShop, ScrapedProduct, ShopBuild, ShopBuildBrief } from "@/lib/types";

export const dynamic = "force-dynamic";

/** `?id=` : une génération ; `?shopId=` : l'historique d'une boutique ; rien : les 30 dernières. */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const shopId = req.nextUrl.searchParams.get("shopId");
  const builds = list("shopBuilds") as ShopBuild[];
  if (id) {
    const b = builds.find((x) => x.id === id);
    return b ? NextResponse.json(b) : NextResponse.json({ error: "Génération introuvable" }, { status: 404 });
  }
  const rows = (shopId ? builds.filter((b) => b.shopId === shopId) : builds).slice(0, 30);
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { shopId?: string; urls?: string[]; brief?: Partial<ShopBuildBrief>; products?: ScrapedProduct[] };
  const shop = (list("shops") as ClientShop[]).find((s) => s.id === body.shopId);
  if (!shop) return NextResponse.json({ error: "Choisis une boutique cliente." }, { status: 400 });
  if (!getApiKey()) return NextResponse.json({ error: "Aucune clé KIE configurée (Réglages) : le copywriting IA en a besoin." }, { status: 400 });
  const urls = (body.urls ?? []).map((u) => u.trim()).filter((u) => /^https?:\/\//i.test(u)).slice(0, 10);
  const products = Array.isArray(body.products) ? body.products.filter((p) => p && p.title).slice(0, 40) : [];
  if (!urls.length && !products.length) return NextResponse.json({ error: "Donne au moins un lien concurrent." }, { status: 400 });
  if (runningBuild(shop.id)) return NextResponse.json({ error: "Une génération est déjà en cours pour cette boutique." }, { status: 409 });

  const b = body.brief ?? {};
  const factor = Number(b.priceFactor);
  const brief: ShopBuildBrief = {
    ...DEFAULT_BRIEF,
    brandName: (b.brandName ?? "").trim(),
    language: (b.language ?? "fr").trim() || "fr",
    notes: (b.notes ?? "").trim(),
    primaryColor: (b.primaryColor ?? "").trim(),
    secondaryColor: (b.secondaryColor ?? "").trim(),
    installTheme: b.installTheme !== false,
    publishTheme: b.publishTheme !== false,
    priceFactor: Number.isFinite(factor) && factor > 0 ? factor : 1,
  };
  const build = startBuild(shop, urls, brief, products.length ? products : undefined);
  return NextResponse.json(build);
}
