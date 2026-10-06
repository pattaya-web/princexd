import { NextRequest } from "next/server";
import { readDB } from "@/lib/db";
import { canSee, readSession, requireSales } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import type { FollowUp } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * L'ecran du matin : ce qu'il reste a faire sur les calls passes.
 *
 * Trois listes, calculees d'un coup pour que la page s'ouvre en un
 * aller-retour : les no-shows a relancer (pas reprogrammes), les relances
 * emises (en attente, et celles cloturees ces derniers jours), et tous les
 * closes avec ce qui reste a encaisser. L'admin voit tout ; un membre ne
 * voit que les calls qu'il a poses ou qu'il close.
 */

export interface SuiviNoShow {
  id: string;
  leadId: string;
  leadName: string;
  igUsername: string;
  phone: string;
  email: string;
  scheduledAt: string;
  daysAgo: number;
  setterName: string;
  closerName: string;
  /** Une relance a ete emise apres ce no-show (date de la derniere). */
  relaunchedAt: string;
  /** Nombre de relances emises sur ce call. */
  relaunches: number;
}

export interface SuiviFollowUp extends FollowUp {
  leadName: string;
  igUsername: string;
  phone: string;
  closerName: string;
  appointmentStatus: string;
  bucket: "overdue" | "today" | "upcoming" | "closed";
}

export interface SuiviClosed {
  id: string;
  saleId: string;
  leadName: string;
  igUsername: string;
  phone: string;
  soldAt: string;
  offer: string;
  contractValue: number;
  cashCollected: number;
  remaining: number;
  currency: string;
  saleStatus: string;
  setterName: string;
  closerName: string;
  /** Prochaine echeance non encaissee, s'il en reste. */
  nextDue: { dueAt: string; amount: number; late: boolean } | null;
}

export async function GET(req: NextRequest) {
  return handle(() => {
    const session = requireSales(readSession(req));
    const db = readDB();
    const leads = new Map(db.leads.map((l) => [l.id, l]));
    const names = new Map(db.team.map((m) => [m.id, m.name]));
    const name = (id: string) => (id ? (names.get(id) ?? "—") : "");

    const now = new Date();
    const nowIso = now.toISOString();
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).toISOString();
    const todayKey = new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" }).format(now);
    const recentCutoff = new Date(now.getTime() - 14 * 86_400_000).toISOString();

    const visible = db.appointments.filter((a) => canSee(session, a));
    const byLead = new Map<string, typeof visible>();
    for (const a of db.appointments) {
      const list = byLead.get(a.leadId) ?? [];
      list.push(a);
      byLead.set(a.leadId, list);
    }

    /* ------------------------------ No-shows ------------------------------ */
    const noShows: SuiviNoShow[] = visible
      .filter((a) => a.status === "no-show")
      // Un no-show deja reprogramme (un rendez-vous plus tard pour le meme
      // lead, non annule) n'a plus besoin d'etre relance.
      .filter((a) => !(byLead.get(a.leadId) ?? []).some((b) => b.id !== a.id && b.scheduledAt > a.scheduledAt && b.status !== "cancelled"))
      .map((a) => {
        const lead = leads.get(a.leadId);
        const relaunches = db.followUps.filter((f) => f.appointmentId === a.id && f.createdAt >= a.scheduledAt);
        const last = relaunches.map((f) => f.createdAt).sort().at(-1) ?? "";
        return {
          id: a.id,
          leadId: a.leadId,
          leadName: lead?.name ?? "Lead supprimé",
          igUsername: lead?.igUsername ?? "",
          phone: lead?.phone ?? "",
          email: lead?.email ?? "",
          scheduledAt: a.scheduledAt,
          daysAgo: Math.max(0, Math.floor((now.getTime() - new Date(a.scheduledAt).getTime()) / 86_400_000)),
          setterName: name(a.setterId),
          closerName: name(a.closerId),
          relaunchedAt: last,
          relaunches: relaunches.length,
        };
      })
      .sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt))
      .slice(0, 100);

    /* ------------------------------ Relances ------------------------------ */
    const visibleIds = new Set(visible.map((a) => a.id));
    const appts = new Map(db.appointments.map((a) => [a.id, a]));
    const followUps: SuiviFollowUp[] = db.followUps
      .filter((f) => visibleIds.has(f.appointmentId))
      .filter((f) => f.status === "pending" || (f.completedAt || f.createdAt) >= recentCutoff)
      .map((f) => {
        const lead = leads.get(f.leadId);
        return {
          ...f,
          leadName: lead?.name ?? "Lead supprimé",
          igUsername: lead?.igUsername ?? "",
          phone: lead?.phone ?? "",
          closerName: name(f.closerId),
          appointmentStatus: appts.get(f.appointmentId)?.status ?? "",
          bucket: (f.status !== "pending" ? "closed" : f.dueAt < nowIso ? "overdue" : f.dueAt <= todayEnd ? "today" : "upcoming") as SuiviFollowUp["bucket"],
        };
      })
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt));

    /* -------------------------------- Closés ------------------------------ */
    const closed: SuiviClosed[] = db.sales
      .filter((s) => s.status !== "cancelled" && visibleIds.has(s.appointmentId))
      .map((s) => {
        const a = appts.get(s.appointmentId);
        const lead = leads.get(s.leadId);
        const remaining = Math.max(0, Math.round((s.contractValue - s.cashCollected) * 100) / 100);
        const next = (s.schedule ?? []).filter((it) => !it.paidAt).sort((x, y) => x.dueAt.localeCompare(y.dueAt))[0];
        return {
          id: s.appointmentId,
          saleId: s.id,
          leadName: lead?.name ?? "Lead supprimé",
          igUsername: lead?.igUsername ?? "",
          phone: lead?.phone ?? "",
          soldAt: s.soldAt,
          offer: s.offer,
          contractValue: s.contractValue,
          cashCollected: s.cashCollected,
          remaining,
          currency: s.currency,
          saleStatus: s.status,
          setterName: name(s.setterId || a?.setterId || ""),
          closerName: name(s.closerId || a?.closerId || ""),
          nextDue: next && remaining > 0 ? { dueAt: next.dueAt, amount: next.amount, late: next.dueAt < todayKey } : null,
        };
      })
      .sort((a, b) => b.soldAt.localeCompare(a.soldAt));

    return {
      noShows,
      followUps,
      closed,
      currency: db.settings.salesCurrency || "EUR",
      totals: {
        noShows: noShows.length,
        toRelaunch: noShows.filter((n) => !n.relaunchedAt).length,
        overdue: followUps.filter((f) => f.bucket === "overdue").length,
        today: followUps.filter((f) => f.bucket === "today").length,
        closed: closed.length,
        contract: Math.round(closed.reduce((a, c) => a + c.contractValue, 0) * 100) / 100,
        cash: Math.round(closed.reduce((a, c) => a + c.cashCollected, 0) * 100) / 100,
        remaining: Math.round(closed.reduce((a, c) => a + c.remaining, 0) * 100) / 100,
      },
    };
  });
}
