import { NextRequest } from "next/server";
import { getSettings, readDB } from "@/lib/db";
import { readSession, requireSales } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";

export const dynamic = "force-dynamic";

/**
 * Lien de reservation signe du membre connecte : le calendrier iClosed de
 * l'admin avec la signature du setter (utm_content = son identifiant). Il
 * l'envoie sur Instagram ; la reservation lui est attribuee. Vide tant que
 * l'admin n'a pas colle le lien du calendrier dans Comptes.
 */
export async function GET(req: NextRequest) {
  return handle(() => {
    const session = requireSales(readSession(req));
    const base = (getSettings().salesBookingUrl ?? "").trim();
    if (!base || !session.memberId) return { link: "", configured: Boolean(base) };
    const me = readDB().team.find((m) => m.id === session.memberId);
    if (!me) return { link: "", configured: true };
    try {
      const u = new URL(base);
      u.searchParams.set("utm_source", "setter");
      u.searchParams.set("utm_content", me.username || me.id);
      return { link: u.toString(), configured: true };
    } catch {
      return { link: "", configured: true };
    }
  });
}
