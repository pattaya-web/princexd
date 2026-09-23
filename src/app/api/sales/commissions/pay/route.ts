import { NextRequest } from "next/server";
import { readDB } from "@/lib/db";
import { readSession, requireAdmin } from "@/lib/sales/access";
import { handle, num, required } from "@/lib/sales/http";
import { buildLedger } from "@/lib/sales/commissions";
import { payCommission } from "@/lib/sales/repo";
import { resolveRange } from "@/lib/sales/period";

export const dynamic = "force-dynamic";

/**
 * Verse une commission.
 *
 * Le montant du n'est jamais ecrase : on ajoute un versement, et le solde se
 * recalcule en soustrayant les versements des commissions gagnees. Payer deux
 * fois laisse donc deux lignes, ce qui se voit — au lieu d'un compteur remis
 * a zero dont personne ne saura expliquer l'origine six mois plus tard.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const session = requireAdmin(readSession(req));
    const body = (await req.json()) as Record<string, unknown>;
    const db = readDB();

    const memberId = required(body.memberId, "Le membre");
    const member = db.team.find((m) => m.id === memberId);
    if (!member) throw new Error("Membre introuvable.");

    const amount = num(body.amount);
    if (amount <= 0) throw new Error("Le montant doit être supérieur à 0.");

    // Garde-fou : on refuse de verser plus que le solde du, sauf mention
    // explicite. Une avance reste possible, mais elle doit etre voulue.
    const [row] = buildLedger(
      [member],
      db.commissionRules,
      db.appointments,
      db.sales,
      db.commissionPayments,
      resolveRange("all"),
      db.settings.salesCurrency || "USD",
    );
    if (row && amount > row.due + 0.01 && !body.allowOverpay) {
      throw new Error(
        `Le solde dû n'est que de ${row.due}. Coche « avance » pour verser davantage.`,
      );
    }

    return payCommission(session, {
      memberId,
      amount,
      currency: (body.currency as string) || db.settings.salesCurrency || "USD",
      paidAt: (body.paidAt as string) || new Date().toISOString(),
      method: (body.method as string) || "",
      notes: (body.notes as string) || "",
      periodFrom: (body.periodFrom as string) || "",
      periodTo: (body.periodTo as string) || "",
    });
  });
}
