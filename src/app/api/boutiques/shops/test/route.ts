import { NextRequest, NextResponse } from "next/server";
import { list, update } from "@/lib/db";
import { adminFor, ShopifyError } from "@/lib/boutique/shopify";
import type { ClientShop } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Vérifie le jeton : lit le nom de la boutique, sa devise, et le thème actif. */
export async function POST(req: NextRequest) {
  const { id } = (await req.json()) as { id?: string };
  const shop = (list("shops") as ClientShop[]).find((s) => s.id === id);
  if (!shop) return NextResponse.json({ error: "Boutique introuvable" }, { status: 404 });
  try {
    const admin = await adminFor(shop);
    const info = await admin.shopInfo();
    let theme = "";
    let themeError = "";
    try {
      theme = (await admin.mainTheme())?.name ?? "";
    } catch (e) {
      themeError = (e as Error).message;
    }
    update("shops", shop.id, { shopName: info.name, currency: info.currency, lastTestAt: new Date().toISOString() });
    return NextResponse.json({ ok: true, info, theme, themeError });
  } catch (e) {
    const status = e instanceof ShopifyError ? e.status : 500;
    return NextResponse.json({ error: (e as Error).message }, { status: status >= 400 && status < 600 ? status : 500 });
  }
}
