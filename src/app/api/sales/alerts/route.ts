import { NextRequest } from "next/server";
import { readDB } from "@/lib/db";
import { readSession, requireSales } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { sessionHas } from "@/lib/sales/roles";
import { isoToParisInput, parisDay } from "@/lib/format";
import { installmentAlerts } from "@/lib/sales/installments";

export const dynamic = "force-dynamic";

export interface AlertItem {
  id: string;
  kind: "follow-up-overdue" | "follow-up-today" | "call-today" | "call-unconfirmed" | "call-tomorrow" | "call-soon" | "callback" | "payment-overdue" | "payment-due" | "payment-unspecified";
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

    const tomorrow = parisDay(1);
    const nowMs = Date.now();
    for (const a of db.appointments) {
      if (!mine(a.setterId, a.closerId)) continue;
      if (a.status !== "booked" && a.status !== "confirmed" && a.status !== "rescheduled") continue;
      const day = isoToParisInput(a.scheduledAt).slice(0, 10);
      const lead = leads.get(a.leadId);
      const unconfirmed = a.confirmation !== "confirmed";
      /*
       * Cadence de confirmation : la veille, « relance-le pour confirmer » ;
       * une heure avant, si toujours pas confirme, une derniere relance. Le
       * clic ouvre la fiche du rendez-vous, ou le message est pret a copier.
       */
      if (day === tomorrow && unconfirmed) {
        items.push({
          id: `tmrw-${a.id}`,
          kind: "call-tomorrow",
          appointmentId: a.id,
          leadId: a.leadId,
          leadName: lead?.name ?? "Lead",
          at: a.scheduledAt,
          title: `Call demain · relance ${lead?.name ?? "le prospect"} pour confirmer`,
          detail: `Envoie-lui le rappel de confirmation (${a.confirmation === "awaiting" ? "message déjà envoyé, pas de réponse" : "rien envoyé"})`,
        });
        continue;
      }
      if (day !== today) continue;
      const inMs = Date.parse(a.scheduledAt) - nowMs;
      if (unconfirmed && inMs > 0 && inMs <= 60 * 60_000) {
        items.push({
          id: `soon-${a.id}`,
          kind: "call-soon",
          appointmentId: a.id,
          leadId: a.leadId,
          leadName: lead?.name ?? "Lead",
          at: a.scheduledAt,
          title: `Call dans ${Math.max(1, Math.round(inMs / 60_000))} min · ${lead?.name ?? "Lead"} n'a pas confirmé`,
          detail: "Relance-le tout de suite pour confirmer",
        });
        continue;
      }
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

    /*
     * L'argent : echeance du jour ou en retard, paiement attendu non recu,
     * vente iClosed a preciser. Une echeance a venir n'alerte pas : elle est
     * a jour. Le clic ouvre la fiche du call, ou l'echeance se marque encaissee.
     */
    for (const i of installmentAlerts(db, session, 0)) {
      const money = `${Math.round(i.amount).toLocaleString("fr-FR")} ${i.currency === "EUR" ? "€" : i.currency}`;
      const kind: AlertItem["kind"] = i.state === "unspecified" ? "payment-unspecified" : i.state === "overdue" ? "payment-overdue" : "payment-due";
      items.push({
        id: `pay-${i.saleId}-${i.n}`,
        kind,
        appointmentId: i.appointmentId,
        leadId: i.leadId,
        leadName: i.leadName,
        at: `${i.dueAt}T09:00:00.000Z`,
        title:
          kind === "payment-unspecified"
            ? `Vente iClosed · ${i.leadName} : précise le paiement`
            : kind === "payment-overdue"
              ? `${i.awaitingFirst ? "Paiement non reçu" : `Échéance ${i.n}/${i.total} en retard`} · ${i.leadName}`
              : `${i.awaitingFirst ? "Paiement attendu aujourd'hui" : `Échéance ${i.n}/${i.total} aujourd'hui`} · ${i.leadName}`,
        detail:
          kind === "payment-unspecified"
            ? `${money} remontés par iClosed : payé en une fois, en plusieurs fois, ou contrat envoyé ?`
            : kind === "payment-overdue"
              ? `${money} attendus le ${i.dueAt.split("-").reverse().slice(0, 2).join("/")} · retard de ${i.daysLate} j${i.awaitingFirst ? " · relance, ou annule la vente s'il ne paie pas" : ""}`
              : `${money} à encaisser aujourd'hui`,
      });
    }

    items.sort((a, b) => a.at.localeCompare(b.at));
    return {
      items,
      counts: {
        overdue: items.filter((i) => i.kind === "follow-up-overdue" || i.kind === "payment-overdue").length,
        today: items.filter((i) => i.kind !== "follow-up-overdue" && i.kind !== "payment-overdue").length,
      },
    };
  });
}
