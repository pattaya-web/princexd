import { NextRequest } from "next/server";
import { readDB } from "@/lib/db";
import { readSession, requireSales } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { rangeFromParams, inRange } from "@/lib/sales/period";
import {
  closerLeaderboard,
  computeFunnel,
  computeKpis,
  dailySeries,
  lostReasons,
  setterLeaderboard,
} from "@/lib/sales/analytics";
import { buildLedger } from "@/lib/sales/commissions";
import { publicMember } from "@/lib/sales/repo";
import { sessionHas } from "@/lib/sales/roles";
import type { Appointment, Sale } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Tout ce qu'affiche un ecran de pilotage, en un seul aller-retour.
 *
 * Les agregats sont calcules ici, sur le serveur : le navigateur ne recoit
 * que des totaux. C'est la difference entre un dashboard qui reste instantane
 * a dix mille rendez-vous et un dashboard qui telecharge la base entiere.
 */
export async function GET(req: NextRequest) {
  return handle(() => {
    const session = requireSales(readSession(req));
    const db = readDB();
    const range = rangeFromParams(req.nextUrl.searchParams);
    const currency = db.settings.salesCurrency || "USD";

    /*
     * Perimetre de lecture.
     *
     * Un setter ne pilote que ses propres chiffres, un closer les siens. Le
     * filtre est applique avant tout calcul, donc meme les totaux agreges ne
     * peuvent pas fuir la performance des collegues.
     */
    let appointments: Appointment[] = db.appointments;
    let sales: Sale[] = db.sales;

    if (!session.isAdmin) {
      // Un setter-closer voit l'union : ce qu'il a pose et ce qu'il close.
      const asSetter = sessionHas(session, "setter");
      const asCloser = sessionHas(session, "closer");
      appointments = appointments.filter(
        (a) => (asSetter && a.setterId === session.memberId) || (asCloser && a.closerId === session.memberId),
      );
      sales = sales.filter(
        (s) => (asSetter && s.setterId === session.memberId) || (asCloser && s.closerId === session.memberId),
      );
    }

    const visibleApptIds = new Set(appointments.map((a) => a.id));
    const followUps = db.followUps.filter(
      (f) =>
        visibleApptIds.has(f.appointmentId) &&
        (session.isAdmin || sessionHas(session, "setter") || f.closerId === session.memberId),
    );
    const pendingFollowUps = followUps.filter((f) => f.status === "pending");

    const kpis = computeKpis(appointments, sales, range, pendingFollowUps.length);

    // Haut du funnel : les leads crees sur la periode, tous canaux confondus.
    const leadCount = session.isAdmin
      ? db.leads.filter((l) => inRange(l.createdAt, range)).length
      : new Set(appointments.filter((a) => inRange(a.scheduledAt, range)).map((a) => a.leadId)).size;

    const funnel = computeFunnel(appointments, sales, range, leadCount);

    /*
     * Classements et commissions : reserves a l'admin.
     *
     * Un setter n'a aucune raison de voir le chiffre d'affaires d'un collegue,
     * et le tableau des commissions est une donnee confidentielle.
     */
    const ledger = session.isAdmin
      ? buildLedger(db.team, db.commissionRules, db.appointments, db.sales, db.commissionPayments, range, currency)
      : buildLedger(
          db.team.filter((m) => m.id === session.memberId),
          db.commissionRules,
          db.appointments,
          db.sales,
          db.commissionPayments,
          range,
          currency,
        );

    const setterCommissions = ledger
      .filter((r) => r.role === "setter")
      .reduce((a, r) => a + r.earnedInPeriod, 0);
    const closerCommissions = ledger
      .filter((r) => r.role === "closer")
      .reduce((a, r) => a + r.earnedInPeriod, 0);
    const totalDue = ledger.reduce((a, r) => a + r.due, 0);

    return {
      session,
      range,
      currency,
      kpis,
      funnel,
      setters: session.isAdmin ? setterLeaderboard(db.team, db.appointments, db.sales, range) : [],
      closers: session.isAdmin ? closerLeaderboard(db.team, db.appointments, db.sales, range) : [],
      series: dailySeries(appointments, sales, range),
      objections: lostReasons(appointments, range),
      commissions: {
        setters: Math.round(setterCommissions * 100) / 100,
        closers: Math.round(closerCommissions * 100) / 100,
        due: Math.round(totalDue * 100) / 100,
      },
      followUps: {
        overdue: pendingFollowUps.filter((f) => f.dueAt < new Date().toISOString()).length,
        pending: pendingFollowUps.length,
      },
      members: session.isAdmin ? db.team.map(publicMember) : [],
      logs: session.isAdmin ? db.activityLogs.slice(0, 12) : [],
    };
  });
}
