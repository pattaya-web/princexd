import { NextRequest } from "next/server";
import { readDB } from "@/lib/db";
import { readSession, requireSales } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { installmentAlerts, parisToday } from "@/lib/sales/installments";

export const dynamic = "force-dynamic";

/**
 * Echeances de paiement arrivees a date : l'alerte du CRM, du Sales
 * Dashboard et de l'accueil du closer. L'admin voit toutes les ventes, un
 * closer les siennes.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const session = requireSales(readSession(req));
    const horizon = Math.min(30, Math.max(0, Number(req.nextUrl.searchParams.get("horizon")) || 3));
    return { today: parisToday(), items: installmentAlerts(readDB(), session, horizon) };
  });
}
