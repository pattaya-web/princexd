import { NextRequest } from "next/server";
import { readDB } from "@/lib/db";
import { readSession, requireSales } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { sessionHas } from "@/lib/sales/roles";
import { isoToParisInput, parisDay } from "@/lib/format";

export const dynamic = "force-dynamic";

export interface AlertItem {
  id: string;
  kind: "follow-up-overdue" | "follow-up-today" | "call-today" | "call-unconfirmed" | "callback";
  /** Rendez-vous a ouvrir (fiche), ou lead. */
  appointmentId: string;
  leadId: string;
  leadName: string;
  at: string;
  title: string;
  detail: string;
  followUpId?: string;
}

/**
 * Ce qu'il y a a faire maintenant, pour la cloche en haut a droite :
 * relances en retard ou du jour, calls du jour pas encore confirmes, rappels
 * demandes par les prospects. Filtre par role : chacun voit ce qui le
 * concerne, l'admin voit tout.
 */
export async function GET(req: NextRequest) {
  return handle(() => {
    const session = requireSales(readSession(req));
    const db = readDB();
    const today = parisDay();
    const nowIso = new Date().toISOString();
    const leads = new Map(db.leads.map((l) => [l.id, l]));
    const appts = new Map(db.appointments.map((a) => [a.id, a]));
    const mine = (setterId?: string, closerId?: string) =>
      session.isAdmin || (sessionHas(session, "closer") && closerId === session.memberId) || (sessionHas(session, "setter") && setterId === session.memberId);

    const items: AlertItem[] = [];

    for (const f of db.followUps) {
      if (f.status !== "pending") continue;
      const appt = appts.get(f.appointmentId);
      if (!mine(appt?.setterId, f.closerId || appt?.closerId)) continue;
      const day = isoToParisInput(f.dueAt).slice(0, 10);
      if (day > today) continue;
      const lead = leads.get(f.leadId);
      items.push({
        id: `fu-${f.id}`,
        kind: f.dueAt < nowIso && day < today ? "follow-up-overdue" : "follow-up-today",
        appointmentId: f.appointmentId,
        leadId: f.leadId,
        leadName: lead?.name ?? "Lead",
        at: f.dueAt,
        title: day < today ? `Relance en retard · ${lead?.name ?? "Lead"}` : `Relance aujourd'hui · ${lead?.name ?? "Lead"}`,
        detail: f.notes || "Relancer le prospect",
        followUpId: f.id,
      });
    }

    for (const a of db.appointments) {
      if (!mine(a.setterId, a.closerId)) continue;
      if (a.status !== "booked" && a.status !== "confirmed" && a.status !== "rescheduled") continue;
      const day = isoToParisInput(a.scheduledAt).slice(0, 10);
      if (day !== today) continue;
      const lead = leads.get(a.leadId);
      const unconfirmed = a.confirmation !== "confirmed";
      items.push({
        id: `call-${a.id}`,
        kind: unconfirmed ? "call-unconfirmed" : "call-today",
        appointmentId: a.id,
        leadId: a.leadId,
        leadName: lead?.name ?? "Lead",
        at: a.scheduledAt,
        title: `${unconfirmed ? "Call à confirmer" : "Call aujourd'hui"} · ${lead?.name ?? "Lead"}`,
        detail: unconfirmed ? "Le prospect n'a pas confirmé sa présence" : "Préparer le call",
      });
    }

    for (const l of db.leads) {
      if (l.callStatus !== "callback" || !l.callbackAt) continue;
      if (!session.isAdmin && !(sessionHas(session, "setter") && (l.setterId === session.memberId || !l.setterId))) continue;
      if (isoToParisInput(l.callbackAt).slice(0, 10) > today) continue;
      items.push({ id: `cb-${l.id}`, kind: "callback", appointmentId: "", leadId: l.id, leadName: l.name, at: l.callbackAt, title: `Rappeler · ${l.name}`, detail: l.phone || "Rappel demandé par le prospect" });
    }

    items.sort((a, b) => a.at.localeCompare(b.at));
    return {
      items,
      counts: {
        overdue: items.filter((i) => i.kind === "follow-up-overdue").length,
        today: items.filter((i) => i.kind !== "follow-up-overdue").length,
      },
    };
  });
}
