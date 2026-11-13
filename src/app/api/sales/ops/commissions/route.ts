import { NextRequest } from "next/server";
import { readDB } from "@/lib/db";
import { Forbidden, readSession, requireSales } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { effectiveRule, entriesFor, cashMovements } from "@/lib/sales/commissions";
import { paymentView } from "@/lib/sales/installments";
import { dayOf } from "@/lib/sales/ops/time";
import { isSetterSession } from "@/lib/sales/setter-view";

export const dynamic = "force-dynamic";

/**
 * Commissions d'un membre, vues du cockpit : setting (rendez-vous qu'il a
 * poses) et management (tout le cash coaching), separees.
 *  - acquises : calculees sur le cash reellement encaisse ;
 *  - en attente : projection sur le reste du des ventes en cours (rien
 *    n'est du tant que l'argent n'est pas encaisse) ;
 *  - versees : les versements enregistres par l'admin.
 * Un membre ne voit que les siennes ; l'admin, celles de n'importe qui.
 */
export async function GET(req: NextRequest) {
  return handle(() => {
    const session = requireSales(readSession(req));
    const db = readDB();
    const memberId = req.nextUrl.searchParams.get("member") || session.memberId;
    if (!session.isAdmin && memberId !== session.memberId) throw new Forbidden("Tu ne vois que tes propres commissions.");
    const member = db.team.find((m) => m.id === memberId);
    if (!member) throw new Error("Membre introuvable.");
    const entries = entriesFor(member, db.commissionRules, db.appointments, db.sales, db.commissionAdjustments ?? []);
    const setting = entries.filter((e) => e.role === "setter" && e.kind === "sale");
    const management = entries.filter((e) => e.role === "manager");
    const other = entries.filter((e) => !setting.includes(e) && !management.includes(e));
    const sum = (rows: { amount: number }[]) => Math.round(rows.reduce((a, e) => a + e.amount, 0) * 100) / 100;
    const paid = db.commissionPayments.filter((p) => p.memberId === member.id && p.kind !== "bonus").reduce((a, p) => a + (p.amount || 0), 0);

    // Projection : ce que rapporterait le reste du des ventes en cours, aux taux du jour.
    const now = new Date().toISOString();
    const today = dayOf(Date.now());
    const mgr = effectiveRule(db.commissionRules, member.id, now, "manager");
    const set = effectiveRule(db.commissionRules, member.id, now, "setter");
    let pending = 0;
    for (const s of db.sales) {
      if (s.status === "cancelled") continue;
      const remaining = paymentView(s, today).remaining;
      if (remaining <= 0) continue;
      if (mgr) pending += (remaining * mgr.pct) / 100;
      if (set && set.type === "pct-cash" && s.setterId === member.id && !s.setterHold) pending += (remaining * set.pct) / 100;
    }

    // CA coaching encaisse (perimetre management) et CA de ses rendez-vous.
    const cashAll = db.sales.flatMap(cashMovements).reduce((a, m) => a + m.amount, 0);
    const cashMine = db.sales.filter((s) => s.setterId === member.id).flatMap(cashMovements).reduce((a, m) => a + m.amount, 0);

    return {
      member: { id: member.id, name: member.name },
      rates: { setting: set ? { pct: set.pct, type: set.type, from: set.effectiveFrom, to: set.effectiveTo ?? "" } : null, management: mgr ? { pct: mgr.pct, from: mgr.effectiveFrom, to: mgr.effectiveTo ?? "" } : null },
      // Les vrais montants ne sont montres qu'a ceux qui les voient deja (admin, Head of Setting).
      cash: isSetterSession(session) ? null : { coaching: Math.round(cashAll), fromMyAppointments: Math.round(cashMine) },
      totals: { setting: sum(setting), management: sum(management), other: sum(other), acquired: sum(entries), pending: Math.round(pending * 100) / 100, paid: Math.round(paid * 100) / 100, due: Math.round((sum(entries) - paid) * 100) / 100 },
      // Aux montants annonces, le detail ne cite pas l'encaissement reel.
      entries: entries.slice(0, 200).map((e) => (isSetterSession(session) && e.role === "manager" ? { ...e, detail: e.detail.replace(/ de -?\d+ /, " d'un ") } : e)),
      currency: db.settings.salesCurrency || "EUR",
    };
  });
}
