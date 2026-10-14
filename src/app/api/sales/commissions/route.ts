import { NextRequest } from "next/server";
import { readDB } from "@/lib/db";
import { readSession, requireAdmin, requireSales } from "@/lib/sales/access";
import { handle, num, required } from "@/lib/sales/http";
import { inRange, rangeFromParams } from "@/lib/sales/period";
import { buildLedger } from "@/lib/sales/commissions";
import { setCommissionRule } from "@/lib/sales/repo";
import { COMMISSION_TYPES } from "@/lib/sales/constants";
import { memberRoles, primaryRole, type CommercialRole } from "@/lib/sales/roles";
import type { CommissionType } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Grand livre des commissions.
 *
 * Un membre ne voit que sa propre ligne : ce que gagne un collegue ne le
 * regarde pas. Le filtre est applique sur la liste des membres passee au
 * moteur, donc il n'y a rien a masquer ensuite cote client.
 */
export async function GET(req: NextRequest) {
  return handle(() => {
    const session = requireSales(readSession(req));
    const db = readDB();
    const range = rangeFromParams(req.nextUrl.searchParams);
    const currency = db.settings.salesCurrency || "EUR";

    const members = session.isAdmin ? db.team : db.team.filter((m) => m.id === session.memberId);

    const rows = buildLedger(
      members,
      db.commissionRules,
      db.appointments,
      db.sales,
      db.commissionPayments,
      range,
      currency,
      db.commissionAdjustments ?? [],
    );

    const payments = db.commissionPayments
      .filter((p) => session.isAdmin || p.memberId === session.memberId)
      .slice(0, 200)
      .map((p) => ({
        ...p,
        memberName: db.team.find((m) => m.id === p.memberId)?.name ?? "—",
      }));

    // Bonus / malus poses par le proprietaire : chacun ne voit que les siens.
    const adjustments = (db.commissionAdjustments ?? [])
      .filter((a) => session.isAdmin || a.memberId === session.memberId)
      .slice(0, 200)
      .map((a) => ({ ...a, memberName: db.team.find((m) => m.id === a.memberId)?.name ?? "—" }));

    /*
     * Signal pour juger le setting : conversations reprises par un autre
     * setter (laissees dormir) et conversations reprises aux autres, sur la
     * periode affichee.
     */
    const takeovers: Record<string, { lost: number; taken: number }> = {};
    for (const g of db.activityLogs) {
      if (g.action !== "lead.takeover" || !inRange(g.at, range)) continue;
      if (g.relatedId) (takeovers[g.relatedId] ??= { lost: 0, taken: 0 }).lost++;
      if (g.actorId) (takeovers[g.actorId] ??= { lost: 0, taken: 0 }).taken++;
    }

    return {
      rows,
      payments,
      adjustments,
      takeovers: session.isAdmin ? takeovers : { [session.memberId]: takeovers[session.memberId] ?? { lost: 0, taken: 0 } },
      range,
      currency,
      isAdmin: session.isAdmin,
      rules: session.isAdmin
        ? db.commissionRules
        : db.commissionRules.filter((r) => r.memberId === session.memberId),
    };
  });
}

/**
 * Definit la regle de commission d'un membre.
 *
 * Une nouvelle regle ne modifie jamais la precedente : elle la remplace a
 * partir de sa date d'effet, et les commissions deja gagnees conservent
 * l'ancien taux.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const session = requireAdmin(readSession(req));
    const body = (await req.json()) as Record<string, unknown>;
    const db = readDB();

    const memberId = required(body.memberId, "Le membre");
    const member = db.team.find((m) => m.id === memberId);
    if (!member) throw new Error("Membre introuvable.");
    const roles = memberRoles(member);
    if (!roles.length) {
      throw new Error("Seuls les setters et les closers touchent une commission.");
    }
    // Un setter-closer a un tarif par metier : le client precise lequel.
    const role: CommercialRole =
      body.role === "setter" || body.role === "closer" ? body.role : primaryRole(roles)!;
    if (!roles.includes(role)) throw new Error(`${member.name} n'est pas ${role}.`);

    const type = body.type as CommissionType;
    if (!COMMISSION_TYPES.includes(type)) throw new Error("Type de commission inconnu.");

    const pct = num(body.pct);
    if (pct < 0 || pct > 100) throw new Error("Le pourcentage doit être compris entre 0 et 100.");

    return setCommissionRule(session, {
      memberId,
      role,
      type,
      pct,
      fixed: Math.max(0, num(body.fixed)),
      monthlyFixed: Math.max(0, num(body.monthlyFixed)),
      basis: body.basis === "contract" ? "contract" : "cash",
      onlyQualified: Boolean(body.onlyQualified),
      currency: (body.currency as string) || db.settings.salesCurrency || "EUR",
      effectiveFrom: (body.effectiveFrom as string) || new Date().toISOString().slice(0, 10),
      active: true,
      notes: (body.notes as string) || "",
    });
  });
}
