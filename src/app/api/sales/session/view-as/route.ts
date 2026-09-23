import { NextRequest, NextResponse } from "next/server";
import { readDB } from "@/lib/db";
import { issueToken, readSession, requireAdmin } from "@/lib/sales/access";
import { SESSION_COOKIE, SESSION_MAX_AGE_S } from "@/lib/sales/session";
import { memberRoles, primaryRole } from "@/lib/sales/roles";
import type { SessionRole } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Aperçu de l'espace d'un membre, sans son code.
 *
 * Sert a verifier ce que voit reellement un setter ou un closer pendant qu'on
 * construit le module, sans jongler entre deux navigateurs.
 *
 * Deux garde-fous importants :
 *
 *  - reserve a l'admin. Un setter ne peut pas s'en servir pour se glisser dans
 *    la peau d'un collegue ;
 *  - l'apercu a EXACTEMENT les droits du membre, pas ceux de l'admin. Le jeton
 *    emis est celui d'un setter ordinaire, donc toutes les routes le filtrent
 *    comme tel. C'est ce qui rend l'apercu fidele : si quelque chose fuit en
 *    apercu, cela fuirait aussi pour de vrai.
 *
 * Le retour a l'admin se fait en supprimant le cookie (DELETE sur
 * /api/sales/session), puisque l'absence de cookie vaut proprietaire.
 */
export async function POST(req: NextRequest) {
  const session = readSession(req);
  try {
    requireAdmin(session);
  } catch {
    return NextResponse.json({ error: "Action réservée à l'administrateur." }, { status: 403 });
  }

  const { memberId } = (await req.json().catch(() => ({}))) as { memberId?: string };
  if (!memberId) return NextResponse.json({ error: "memberId manquant." }, { status: 400 });

  const member = readDB().team.find((m) => m.id === memberId);
  if (!member) return NextResponse.json({ error: "Membre introuvable." }, { status: 404 });

  const role: SessionRole = primaryRole(memberRoles(member)) ?? "anonyme";
  if (role === "anonyme") {
    return NextResponse.json({ error: "Ce rôle n'a pas d'espace à visualiser." }, { status: 400 });
  }

  const res = NextResponse.json({ ok: true, role, memberId: member.id, memberName: member.name });
  res.cookies.set(
    SESSION_COOKIE,
    issueToken({ role, memberId: member.id, memberName: member.name, impersonated: true }),
    {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      // Duree courte : un apercu n'a pas vocation a durer un mois.
      maxAge: Math.min(SESSION_MAX_AGE_S, 60 * 60 * 8),
      secure: process.env.NODE_ENV === "production",
    },
  );
  return res;
}
