import { NextRequest } from "next/server";
import { readDB } from "@/lib/db";
import { canSeeMember, Forbidden, readSession, requireSales } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { rangeFromParams } from "@/lib/sales/period";
import { closerLeaderboard, dailySeries, setterLeaderboard } from "@/lib/sales/analytics";
import { buildLedger, describeRule, effectiveRule } from "@/lib/sales/commissions";
import { publicMember } from "@/lib/sales/repo";
import { memberRoles } from "@/lib/sales/roles";

export const dynamic = "force-dynamic";

/**
 * Fiche de performance d'un membre.
 *
 * Reprend exactement les fonctions du dashboard global, filtrees sur une seule
 * personne : c'est ce qui garantit que la fiche d'Alex et le classement des
 * setters affichent le meme nombre de rendez-vous.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = requireSales(readSession(req));
    const { id } = await ctx.params;
    if (!canSeeMember(session, id)) throw new Forbidden("Cette fiche ne vous est pas accessible.");

    const db = readDB();
    const member = db.team.find((m) => m.id === id);
    if (!member) throw new Forbidden("Membre introuvable.");

    const range = rangeFromParams(req.nextUrl.searchParams);
    const currency = db.settings.salesCurrency || "USD";
    // Un membre setter ET closer est presente sous l'angle setter, mais ses
    // lignes de grand livre couvrent les deux metiers (`ledgers`).
    const roles = memberRoles(member);
    const isSetter = roles.includes("setter");
    const viewRole = isSetter ? "setter" : "closer";

    const appointments = db.appointments.filter((a) =>
      isSetter ? a.setterId === member.id : a.closerId === member.id,
    );
    const sales = db.sales.filter((s) => (isSetter ? s.setterId === member.id : s.closerId === member.id));

    const [stats] = isSetter
      ? setterLeaderboard([member], db.appointments, db.sales, range)
      : closerLeaderboard([member], db.appointments, db.sales, range);

    const ledgers = buildLedger(
      [member],
      db.commissionRules,
      db.appointments,
      db.sales,
      db.commissionPayments,
      range,
      currency,
    );
    const ledger = ledgers.find((l) => l.role === viewRole) ?? ledgers[0];

    const rule = effectiveRule(db.commissionRules, member.id, new Date().toISOString(), viewRole);

    return {
      member: publicMember(member),
      isSetter,
      roles,
      ledgers,
      range,
      currency,
      stats: stats ?? null,
      ledger: ledger ?? null,
      rule,
      ruleLabel: describeRule(rule, currency),
      series: dailySeries(appointments, sales, range),
      payments: db.commissionPayments
        .filter((p) => p.memberId === member.id)
        .sort((a, b) => b.paidAt.localeCompare(a.paidAt)),
      // Historique des regles : permet de comprendre pourquoi une commission
      // ancienne n'a pas ete calculee au taux actuel.
      ruleHistory: db.commissionRules
        .filter((r) => r.memberId === member.id)
        .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom)),
    };
  });
}
