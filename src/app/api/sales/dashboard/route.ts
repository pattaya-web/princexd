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
      /*
       * Un setter-closer voit l'union par defaut : ce qu'il a pose et ce
       * qu'il close. `?as=setter|closer` restreint a une seule casquette :
       * c'est la bascule de son accueil, pour lire ses chiffres de closer
       * sans ses rendez-vous poses, et inversement.
       */
      const as = req.nextUrl.searchParams.get("as");
      const asSetter = sessionHas(session, "setter") && as !== "closer";
      const asCloser = sessionHas(session, "closer") && as !== "setter";
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
      activity: session.isAdmin ? recentActivity(db) : null,
    };
  });
}

/**
 * Activite recente, triee en trois blocs pour l'admin : les shifts des
 * setters (pointage et taches du jour), les rendez-vous et la prospection
 * (rendez-vous, ventes, statuts poses sur les leads), et les versements.
 * Melanges dans un seul journal, ces lignes ne se lisaient pas.
 */
export interface ActivityBlocks {
  shifts: { id: string; memberName: string; startedAt: string; endedAt: string; hours: number }[];
  tasksToday: { memberName: string; done: number; total: number }[];
  appointments: { id: string; at: string; actorName: string; summary: string }[];
  payments: { id: string; at: string; actorName: string; summary: string }[];
}

function recentActivity(db: ReturnType<typeof readDB>): ActivityBlocks {
  const names = new Map(db.team.map((m) => [m.id, m.name]));
  const now = Date.now();
  const shifts = (db.workSessions ?? [])
    .slice()
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, 15)
    .map((s) => ({
      id: s.id,
      memberName: names.get(s.memberId) ?? "—",
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      hours: Math.round((Math.min(((s.endedAt ? new Date(s.endedAt).getTime() : now) - new Date(s.startedAt).getTime()) / 3_600_000, 14)) * 100) / 100,
    }));

  const today = new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" }).format(new Date());
  const custom = (db.settings.salesDailyTasks ?? []).map((t) => t.trim()).filter(Boolean);
  const total = custom.length || 6;
  const tasksToday = db.team
    .filter((m) => m.status !== "inactif" && sessionHas({ role: m.role, roles: m.roles }, "setter"))
    .map((m) => ({
      memberName: m.name,
      done: (db.taskChecks ?? []).filter((c) => c.memberId === m.id && c.day === today).length,
      total,
    }));

  const pick = (test: (action: string) => boolean, n: number) =>
    db.activityLogs
      .filter((l) => test(l.action))
      .slice(0, n)
      .map((l) => ({ id: l.id, at: l.at, actorName: l.actorName, summary: l.summary }));

  return {
    shifts,
    tasksToday,
    appointments: pick((a) => a.startsWith("appointment.") || a.startsWith("sale.") || a.startsWith("lead."), 15),
    payments: pick((a) => a === "commission.paid", 10),
  };
}
