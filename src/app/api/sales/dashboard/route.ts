import { NextRequest } from "next/server";
import { readDB } from "@/lib/db";
import { readSession, requireSales } from "@/lib/sales/access";
import { installmentAlerts } from "@/lib/sales/installments";
import { handle } from "@/lib/sales/http";
import { currentMonthRange, inRange, previousRange, rangeFromParams } from "@/lib/sales/period";
import {
  cashInRange,
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
import { isAttended, isDead } from "@/lib/sales/constants";

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
    const currency = db.settings.salesCurrency || "EUR";

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

    // Meme calcul sur la fenetre precedente : c'est ce qui donne les « +12 % ».
    const prevRange = previousRange(range);
    const previous = prevRange ? computeKpis(appointments, sales, prevRange, 0) : null;

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
      // Echeances de paiement arrivees a date (aujourd'hui ou en retard).
      installments: (() => {
        const alerts = installmentAlerts(db, session, 0);
        return { due: alerts.length, overdue: alerts.filter((a) => a.state === "overdue").length };
      })(),
      previous,
      goal: session.isAdmin ? monthlyGoal(db) : null,
      attention: session.isAdmin ? attentionItems(db) : null,
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

/* ----------------------------- Objectif du mois ------------------------- */

export interface GoalBlock {
  /** Objectif de cash du mois civil. 0 = pas d'objectif fixe. */
  target: number;
  /** Cash arrive depuis le 1er du mois, echeances comprises. */
  cash: number;
  /** Cash du mois precedent complet, pour situer le rythme. */
  lastMonth: number;
  /** Projection a fin de mois au rythme actuel. */
  projected: number;
  dayOfMonth: number;
  daysInMonth: number;
}

/**
 * Objectif mensuel : toujours le mois civil en cours, quelle que soit la
 * periode choisie en haut de page. Un objectif « sur 7 jours glissants » ne
 * veut rien dire pour une equipe payee au mois.
 */
function monthlyGoal(db: ReturnType<typeof readDB>): GoalBlock {
  const month = currentMonthRange();
  const cash = cashInRange(db.sales, month);
  const prevStart = new Date(new Date(month.from).getFullYear(), new Date(month.from).getMonth() - 1, 1);
  const prevEnd = new Date(new Date(month.from).getTime() - 1);
  const lastMonth = cashInRange(db.sales, { from: prevStart.toISOString(), to: prevEnd.toISOString(), key: "custom", label: "" });
  return {
    target: Math.max(0, db.settings.salesMonthlyGoal ?? 0),
    cash,
    lastMonth,
    projected: Math.round((cash / month.dayOfMonth) * month.daysInMonth),
    dayOfMonth: month.dayOfMonth,
    daysInMonth: month.daysInMonth,
  };
}

/* --------------------------------- À traiter ---------------------------- */

export interface AttentionItem {
  id: string;
  leadName: string;
  at: string;
  who: string;
}

export interface AttentionBlock {
  /** Calls passes dont le resultat n'a pas ete saisi : le show rate ment tant qu'ils trainent. */
  noOutcome: AttentionItem[];
  /** Calls dans les 48 h sans confirmation du lead : les no-shows de demain. */
  unconfirmed: AttentionItem[];
  /** Calls a venir sans closer : personne ne les prendra. */
  unassigned: AttentionItem[];
}

/**
 * Ce que l'admin doit regler pour que les chiffres restent vrais.
 *
 * Les trois listes sont des problemes de donnees ou d'organisation, pas des
 * indicateurs : chacune ouvre la fiche concernee en un clic.
 */
function attentionItems(db: ReturnType<typeof readDB>): AttentionBlock {
  const now = new Date();
  const nowIso = now.toISOString();
  const in48h = new Date(now.getTime() + 48 * 3_600_000).toISOString();
  const names = new Map(db.team.map((m) => [m.id, m.name]));
  const leads = new Map(db.leads.map((l) => [l.id, l.name || (l.igUsername ? `@${l.igUsername}` : "Lead")]));

  const item = (a: Appointment, who: string): AttentionItem => ({
    id: a.id,
    leadName: leads.get(a.leadId) ?? "Lead",
    at: a.scheduledAt,
    who,
  });
  // Une relance en cours sur ce call vaut resultat : le closer l'a traite, il relance.
  const followedUp = new Set(db.followUps.filter((f) => f.status === "pending").map((f) => f.appointmentId));
  const pending = (a: Appointment) => !isDead(a.status) && !isAttended(a.status) && a.status !== "no-show" && !followedUp.has(a.id);
  const byDate = (x: AttentionItem, y: AttentionItem) => x.at.localeCompare(y.at);

  return {
    noOutcome: db.appointments
      .filter((a) => pending(a) && a.scheduledAt < nowIso)
      .map((a) => item(a, names.get(a.closerId) ?? "sans closer"))
      .sort(byDate)
      .slice(0, 8),
    unconfirmed: db.appointments
      .filter((a) => pending(a) && a.scheduledAt >= nowIso && a.scheduledAt <= in48h && a.confirmation !== "confirmed")
      .map((a) => item(a, names.get(a.setterId) ?? "—"))
      .sort(byDate)
      .slice(0, 8),
    unassigned: db.appointments
      .filter((a) => pending(a) && a.scheduledAt >= nowIso && !a.closerId)
      .map((a) => item(a, names.get(a.setterId) ?? "—"))
      .sort(byDate)
      .slice(0, 8),
  };
}
