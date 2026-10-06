import { NextRequest } from "next/server";
import { getSettings, saveSettings } from "@/lib/db";
import { readSession, requireAdmin, requireSales } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import type { SalesOffer } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Les offres a vendre, telles que le closer doit les connaitre.
 *
 * Ecrites par l'admin depuis le Sales Dashboard, lues par toute l'equipe
 * commerciale : le closer les voit sur son accueil et les retrouve dans le
 * formulaire de resultat (« Offre vendue »), ou le prix se pre-remplit.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    requireSales(readSession(req));
    const s = getSettings();
    return { offers: s.salesOffers ?? [], currency: s.salesCurrency || "EUR" };
  });
}

export async function PUT(req: NextRequest) {
  return handle(async () => {
    requireAdmin(readSession(req));
    const body = (await req.json()) as { offers?: unknown };
    if (!Array.isArray(body.offers)) throw new Error("Liste d'offres attendue.");
    const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
    const offers: SalesOffer[] = body.offers
      .map((o) => (o && typeof o === "object" ? (o as Record<string, unknown>) : {}))
      .map((o, i) => ({
        id: str(o.id, 40) || `offer-${Date.now().toString(36)}-${i}`,
        name: str(o.name, 120),
        price: Math.max(0, Number(o.price) || 0),
        description: str(o.description, 1500),
      }))
      .filter((o) => o.name);
    saveSettings({ salesOffers: offers });
    return { offers, currency: getSettings().salesCurrency || "EUR" };
  });
}
