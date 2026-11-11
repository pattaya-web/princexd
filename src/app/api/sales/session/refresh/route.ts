import { NextRequest, NextResponse } from "next/server";
import { readSession, renewToken } from "@/lib/sales/access";
import { SESSION_COOKIE, SESSION_MAX_AGE_S } from "@/lib/sales/session";

export const dynamic = "force-dynamic";

/**
 * Session glissante : appele par SessionKeepAlive a l'ouverture de l'app,
 * toutes les quelques heures et au retour sur l'onglet. Tant que quelqu'un
 * se sert du dash, sa session ne perime jamais ; seule une absence de plus
 * de 30 jours oblige a se reconnecter.
 *
 * Route publique pour le middleware (prefixe /api/sales/session) : c'est ici
 * que la signature du jeton est verifiee.
 */
export async function POST(req: NextRequest) {
  const session = readSession(req);
  // Compte desactive ou jeton invalide : rien a prolonger.
  if (session.role === "anonyme") return NextResponse.json({ ok: false, expired: true });

  const fresh = renewToken(req.cookies.get(SESSION_COOKIE)?.value);
  const res = NextResponse.json({ ok: true, renewed: Boolean(fresh) });
  if (fresh) {
    res.cookies.set(SESSION_COOKIE, fresh, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_S,
      secure: process.env.NODE_ENV === "production",
    });
  }
  return res;
}
