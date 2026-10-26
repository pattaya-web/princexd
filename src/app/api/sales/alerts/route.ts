import { NextRequest } from "next/server";
import { readDB } from "@/lib/db";
import { readSession, requireSales } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { sessionHas } from "@/lib/sales/roles";
import { isoToParisInput, label, parisDay } from "@/lib/format";
import { installmentAlerts } from "@/lib/sales/installments";
import { ECOM_OBJECTIVE_LABEL, type Appointment, type FollowUp, type FollowUpHeat, type Lead } from "@/lib/types";

export const dynamic = "force-dynamic";

export interface AlertItem {
  id: string;
  kind: "follow-up-overdue" | "follow-up-today" | "follow-up-upcoming" | "payment-overdue" | "payment-due" | "call-unconfirmed" | "call-tomorrow" | "call-soon";
  /** Rendez-vous a ouvrir (fiche du call), ou vide. */
  appointmentId: string;
  leadId: string;
  leadName: string;
  /** Quand relancer (ISO). */
  at: string;
  title: string;
  detail: string;
  followUpId?: string;
  /* --- La fiche du prospect, pour relancer sans chercher --- */
  phone?: string;
  handle?: string;
  heat?: FollowUpHeat;
  /** Ce qu'il a dit en sortant du call (note posee en statuant). */
  said?: string;
  /** Compte-rendu du call, s'il dit autre chose que la note de relance. */
  callNotes?: string;
  /** Objection notee au call : « veut réfléchir », « doit en parler »… */
  objection?: string;
  objective?: string;
  /** Date du call d'ou vient la relance. */
  callAt?: string;
  lastContactAt?: string;
  /** Nombre de fois ou le prospect a deja ete relance sur cette relance. */
  contacts?: number;
  step?: 1 | 2;
}

export interface AlertsPayload {
  /** A relancer maintenant : en retard ou aujourd'hui. C'est ce que compte la pastille. */
  items: AlertItem[];
  /** Les prochaines relances (deux semaines), pour voir venir. Pas comptees. */
  upcoming: AlertItem[];
  counts: { overdue: number; today: number };
}

/** Construit la ligne de cloche d'une relance, avec tout ce qu'il faut pour rappeler sans ouvrir la fiche. */
function followUpItem(f: FollowUp, lead: Lead | undefined, appt: Appointment | undefined, today: string): AlertItem {
  const day = isoToParisInput(f.dueAt).slice(0, 10);
  const kind: AlertItem["kind"] = day < today ? "follow-up-overdue" : day === today ? "follow-up-today" : "follow-up-upcoming";
  const name = lead?.name ?? "Lead";
  const said = (f.notes || "").trim();
  const recap = appt?.recap;
  const callNotes = [recap?.notClosedDetail, appt?.closerNotes, recap?.leadInfo]
    .map((t) => (t || "").trim())
    .filter((t, i, arr) => t && t !== said && arr.indexOf(t) === i)
    .join(" · ");
  const objection = recap?.notClosedReason ? label(recap.notClosedReason) : appt?.lostReason ? label(appt.lostReason) : "";
  const objective = recap?.objective ? (recap.objective === "other" ? recap.objectiveOther || ECOM_OBJECTIVE_LABEL.other : ECOM_OBJECTIVE_LABEL[recap.objective]) : "";
  const contacts = (f.log ?? []).filter((e) => e.kind === "contact").length;
  return {
    id: `fu-${f.id}`,
    kind,
    appointmentId: f.appointmentId,
    leadId: f.leadId,
    leadName: name,
    at: f.dueAt,
    title: kind === "follow-up-overdue" ? `Relance en retard · ${name}` : kind === "follow-up-today" ? `À relancer aujourd'hui · ${name}` : `À relancer · ${name}`,
    detail: said || callNotes || "Relancer le prospect",
    followUpId: f.id,
    phone: lead?.phone || "",
    handle: lead?.igUsername || lead?.handle || "",
    heat: f.heat,
    said,
    callNotes,
    objection,
    objective,
    callAt: appt?.scheduledAt || "",
    lastContactAt: f.lastContactAt || "",
    contacts,
    step: f.step,
  };
}

/**
 * La cloche en haut a droite : les gens a relancer.
 *
 * Uniquement les relances posees en statuant un call (« je réfléchis »,
 * « je te réponds dans deux semaines »…) et l'argent a reclamer (paiement
 * attendu non recu, echeance du jour ou en retard). Chaque ligne porte la
 * fiche du prospect : telephone, chaleur, ce qu'il a dit, date du call,
 * objection, nombre de relances deja faites. Les calls du jour, les
 * confirmations et les rappels de prospection n'y sont plus : ils restent
 * dans le CRM (vue « À traiter »). Seule exception : un setter garde ses
 * confirmations de la veille et de la derniere heure, c'est son travail.
 * Filtre par role : chacun voit ce qui le concerne, l'admin voit tout.
 */
export async function GET(req: NextRequest) {
  return handle(() => {
    const session = requireSales(readSession(req));
    const db = readDB();
    const today = parisDay();
    const leads = new Map(db.leads.map((l) => [l.id, l]));
    const appts = new Map(db.appointments.map((a) => [a.id, a]));
    const mine = (setterId?: string, closerId?: string) =>
      session.isAdmin || (sessionHas(session, "closer") && closerId === session.memberId) || (sessionHas(session, "setter") && setterId === session.memberId);

    const items: AlertItem[] = [];
    const upcoming: AlertItem[] = [];
    const horizon = parisDay(14);

    for (const f of db.followUps) {
      if (f.status !== "pending") continue;
      const appt = appts.get(f.appointmentId);
      if (!mine(appt?.setterId, f.closerId || appt?.closerId)) continue;
      const day = isoToParisInput(f.dueAt).slice(0, 10);
      if (day > horizon) continue;
      const item = followUpItem(f, leads.get(f.leadId), appt, today);
      (day > today ? upcoming : items).push(item);
    }

    /* Un setter garde la cadence de confirmation : la veille, puis une heure avant. */
    if (!session.isAdmin && sessionHas(session, "setter")) {
      const tomorrow = parisDay(1);
      const nowMs = Date.now();
      for (const a of db.appointments) {
        if (!mine(a.setterId, a.closerId)) continue;
        if (a.status !== "booked" && a.status !== "confirmed" && a.status !== "rescheduled") continue;
        if (a.confirmation === "confirmed") continue;
        const day = isoToParisInput(a.scheduledAt).slice(0, 10);
        const lead = leads.get(a.leadId);
        const base = { appointmentId: a.id, leadId: a.leadId, leadName: lead?.name ?? "Lead", at: a.scheduledAt, phone: lead?.phone || "" };
        if (day === tomorrow) {
          items.push({ ...base, id: `tmrw-${a.id}`, kind: "call-tomorrow", title: `Call demain · relance ${base.leadName} pour confirmer`, detail: a.confirmation === "awaiting" ? "Message déjà envoyé, pas de réponse" : "Rien envoyé" });
          continue;
        }
        if (day !== today) continue;
        const inMs = Date.parse(a.scheduledAt) - nowMs;
        if (inMs > 0 && inMs <= 60 * 60_000) {
          items.push({ ...base, id: `soon-${a.id}`, kind: "call-soon", title: `Call dans ${Math.max(1, Math.round(inMs / 60_000))} min · ${base.leadName} n'a pas confirmé`, detail: "Relance-le tout de suite pour confirmer" });
        } else if (inMs > 0) {
          items.push({ ...base, id: `call-${a.id}`, kind: "call-unconfirmed", title: `Call à confirmer · ${base.leadName}`, detail: "Le prospect n'a pas confirmé sa présence" });
        }
      }
    }

    /*
     * L'argent a reclamer : paiement attendu non recu, echeance du jour ou en
     * retard. Une echeance a venir n'alerte pas : elle est a jour. Une vente
     * iClosed a preciser n'est pas une relance : elle reste sur le Dashboard.
     */
    for (const i of installmentAlerts(db, session, 0)) {
      if (i.state === "unspecified") continue;
      const lead = leads.get(i.leadId);
      const appt = appts.get(i.appointmentId);
      const money = `${Math.round(i.amount).toLocaleString("fr-FR")} ${i.currency === "EUR" ? "€" : i.currency}`;
      const kind: AlertItem["kind"] = i.state === "overdue" ? "payment-overdue" : "payment-due";
      items.push({
        id: `pay-${i.saleId}-${i.n}`,
        kind,
        appointmentId: i.appointmentId,
        leadId: i.leadId,
        leadName: i.leadName,
        at: `${i.dueAt}T09:00:00.000Z`,
        title:
          kind === "payment-overdue"
            ? `${i.awaitingFirst ? "Paiement non reçu" : `Échéance ${i.n}/${i.total} en retard`} · ${i.leadName}`
            : `${i.awaitingFirst ? "Paiement attendu aujourd'hui" : `Échéance ${i.n}/${i.total} aujourd'hui`} · ${i.leadName}`,
        detail:
          kind === "payment-overdue"
            ? `${money} attendus le ${i.dueAt.split("-").reverse().slice(0, 2).join("/")} · retard de ${i.daysLate} j${i.awaitingFirst ? " · relance, ou annule la vente s'il ne paie pas" : ""}`
            : `${money} à encaisser aujourd'hui`,
        phone: lead?.phone || "",
        handle: lead?.igUsername || lead?.handle || "",
        callNotes: (appt?.closerNotes || "").trim(),
        callAt: appt?.scheduledAt || "",
      });
    }

    items.sort((a, b) => a.at.localeCompare(b.at));
    upcoming.sort((a, b) => a.at.localeCompare(b.at));
    const payload: AlertsPayload = {
      items,
      upcoming: upcoming.slice(0, 8),
      counts: {
        overdue: items.filter((i) => i.kind === "follow-up-overdue" || i.kind === "payment-overdue").length,
        today: items.filter((i) => i.kind !== "follow-up-overdue" && i.kind !== "payment-overdue").length,
      },
    };
    return payload;
  });
}
