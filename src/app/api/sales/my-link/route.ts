import { NextRequest } from "next/server";
import { getSettings, readDB } from "@/lib/db";
import { readSession, requireSales } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";

export const dynamic = "force-dynamic";

const firstName = (name: string) => (name.trim().toLowerCase().split(/\s+/)[0] ?? "").replace(/[^a-z0-9]/g, "");

/**
 * Lien de reservation signe du membre connecte : le calendrier iClosed de
 * l'admin avec la signature du setter (utm_content = son identifiant). Il
 * l'envoie sur Instagram ; la reservation lui est attribuee. Vide tant que
 * l'admin n'a pas colle le lien du calendrier dans Comptes.
 *
 * L'admin lui-meme (session proprietaire, sans membre) recoit le lien de son
 * compte dans l'equipe (« Mady (moi) ») : quand il fait du setting, ses
 * reservations lui reviennent. La signature est son prenom quand il est
 * seul a le porter (lien lisible : utm_content=mady), sinon son identifiant.
 */
export async function GET(req: NextRequest) {
  return handle(() => {
    const session = requireSales(readSession(req));
    const settings = getSettings();
    const base = (settings.salesBookingUrl ?? "").trim();
    const memberId = session.memberId || (session.isAdmin ? (settings.salesOwnerMemberId ?? "") : "");
    if (!base || !memberId) return { link: "", configured: Boolean(base) };
    const db = readDB();
    const me = db.team.find((m) => m.id === memberId);
    if (!me) return { link: "", configured: true };
    const first = firstName(me.name);
    const unique = first && db.team.filter((m) => m.status !== "inactif" && firstName(m.name) === first).length === 1;
    try {
      const u = new URL(base);
      u.searchParams.set("utm_source", "setter");
      u.searchParams.set("utm_content", me.username || (unique ? first : me.id));
      return { link: u.toString(), configured: true, memberName: me.name };
    } catch {
      return { link: "", configured: true };
    }
  });
}
