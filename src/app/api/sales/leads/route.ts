import { NextRequest } from "next/server";
import { readDB } from "@/lib/db";
import { canSee, readSession, requireSales } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { sessionHas } from "@/lib/sales/roles";
import { syncSystemeio } from "@/lib/systemeio";
import type { Lead } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Groupes de la liste, dans l'ordre ou il faut les traiter :
 *  - due      : rappels demandes dont l'heure est passee ;
 *  - new      : jamais appeles ;
 *  - retry    : sans reponse ou message laisse, a retenter ;
 *  - later    : rappels demandes pour plus tard ;
 *  - talking  : joints, rendez-vous a fixer ;
 *  - booked   : rendez-vous pris, en attente du call.
 */
export type CallBucket = "due" | "new" | "retry" | "later" | "talking" | "booked";

export interface CallLeadRow extends Lead {
  setterName: string;
  bucket: CallBucket;
  /** Rendez-vous pris : date du call et closer, pour le groupe « booked ». */
  appointmentAt?: string;
  closerName?: string;
}

/**
 * Les prospects a appeler : ceux de la landing page (et tout lead manuel au
 * meme stade). Un setter voit les siens ET ceux qui n'ont encore personne :
 * un lead arrive avant la creation de son compte ne doit pas rester
 * invisible. L'admin voit tout. Au passage, une synchro Systeme.io si la
 * derniere date de plus de trois minutes : la liste est a jour a chaque
 * ouverture.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const session = requireSales(readSession(req));

    let syncError = "";
    try {
      await syncSystemeio();
    } catch (e) {
      syncError = (e as Error).message;
    }

    const db = readDB();
    const names = new Map(db.team.map((m) => [m.id, m.name]));
    const now = new Date().toISOString();
    const isSetter = session.isAdmin || sessionHas(session, "setter");

    const visible = (l: Lead) => (l.setterId ? canSee(session, { setterId: l.setterId }) : isSetter);

    // Prochain rendez-vous encore a venir (ou du jour) par lead.
    const nextAppt = new Map<string, { at: string; closerId: string }>();
    const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString();
    for (const a of db.appointments) {
      if (a.status !== "booked" && a.status !== "confirmed" && a.status !== "rescheduled") continue;
      if (a.scheduledAt < dayAgo) continue;
      const cur = nextAppt.get(a.leadId);
      if (!cur || a.scheduledAt < cur.at) nextAppt.set(a.leadId, { at: a.scheduledAt, closerId: a.closerId });
    }

    const bucketOf = (l: Lead): CallBucket | null => {
      const appt = nextAppt.get(l.id);
      if (appt) return "booked";
      if (l.stage !== "nouveau" && l.stage !== "contacte" && l.stage !== "conversation") return null;
      switch (l.callStatus) {
        case "callback":
          return l.callbackAt && l.callbackAt <= now ? "due" : "later";
        case "reached":
          return "talking";
        case "no-answer":
        case "message-sent":
          return "retry";
        case "not-interested":
          return null;
        default:
          // Fiches d'avant les statuts : on deduit du stade et des essais.
          if (l.stage === "conversation") return "talking";
          return (l.callAttempts ?? 0) > 0 || l.stage === "contacte" ? "retry" : "new";
      }
    };

    const ORDER: Record<CallBucket, number> = { due: 0, new: 1, retry: 2, later: 3, talking: 4, booked: 5 };

    const rows: CallLeadRow[] = [];
    for (const l of db.leads) {
      if (!visible(l)) continue;
      const bucket = bucketOf(l);
      if (!bucket) continue;
      const appt = nextAppt.get(l.id);
      rows.push({
        ...l,
        setterName: l.setterId ? (names.get(l.setterId) ?? "—") : "",
        bucket,
        appointmentAt: appt?.at,
        closerName: appt?.closerId ? (names.get(appt.closerId) ?? "") : "",
      });
    }

    /*
     * Ordre de travail : rappels en retard par heure de rappel, nouveaux par
     * arrivee (le plus frais d'abord, il est chaud), relances par derniere
     * tentative (la plus ancienne d'abord), rappels a venir par heure, puis
     * les rendez-vous par date de call.
     */
    rows.sort((a, b) => {
      if (ORDER[a.bucket] !== ORDER[b.bucket]) return ORDER[a.bucket] - ORDER[b.bucket];
      switch (a.bucket) {
        case "due":
        case "later":
          return (a.callbackAt ?? "").localeCompare(b.callbackAt ?? "");
        case "retry":
          return (a.lastCallAt ?? "").localeCompare(b.lastCallAt ?? "");
        case "booked":
          return (a.appointmentAt ?? "").localeCompare(b.appointmentAt ?? "");
        default:
          return (b.optInAt || b.createdAt).localeCompare(a.optInAt || a.createdAt);
      }
    });

    const count = (k: CallBucket) => rows.filter((r) => r.bucket === k).length;
    const notInterested = db.leads.filter((l) => visible(l) && l.callStatus === "not-interested").length;

    return {
      rows,
      counts: {
        due: count("due"),
        new: count("new"),
        retry: count("retry"),
        later: count("later"),
        talking: count("talking"),
        booked: count("booked"),
        notInterested,
      },
      lastSyncAt: db.settings.systemeioLastSyncAt ?? "",
      syncError,
    };
  });
}
