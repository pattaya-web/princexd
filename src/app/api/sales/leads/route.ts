import { NextRequest } from "next/server";
import { newId, readDB, writeDB } from "@/lib/db";
import { canSee, readSession, requireAdmin, requireSales } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { sessionHas } from "@/lib/sales/roles";
import { getSystemeioKey, syncSystemeio } from "@/lib/systemeio";
import type { Lead } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Groupes de la liste, dans l'ordre ou il faut les traiter :
 *  - due      : rappels demandes dont l'heure est passee ;
 *  - new      : jamais appeles ;
 *  - retry    : sans reponse ou message laisse, a retenter ;
 *  - later    : rappels demandes pour plus tard ;
 *  - talking  : joints, rendez-vous a fixer ;
 *  - booked   : rendez-vous pris, en attente du call ;
 *  - lost     : pas interesses des 30 derniers jours, en rouge en bas de
 *               liste, pour garder une trace et pouvoir les remettre.
 */
export type CallBucket = "due" | "new" | "retry" | "later" | "talking" | "booked" | "lost";

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
    if (!getSystemeioKey()) {
      // Sans cle, la synchro se taisait et la liste restait vide sans explication.
      syncError = "aucune clé API Systeme.io sur ce serveur. Colle-la dans Réglages → Systeme.io (ou SYSTEMEIO_API_KEY dans Coolify), puis clique « Vérifier les nouveaux ».";
    } else {
      try {
        await syncSystemeio();
      } catch (e) {
        syncError = (e as Error).message;
      }
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

    const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const bucketOf = (l: Lead): CallBucket | null => {
      const appt = nextAppt.get(l.id);
      if (appt) return "booked";
      if (l.callStatus === "not-interested") return (l.lastCallAt ?? "") >= monthAgo ? "lost" : null;
      if (l.stage !== "nouveau" && l.stage !== "contacte" && l.stage !== "conversation") return null;
      switch (l.callStatus) {
        case "callback":
          return l.callbackAt && l.callbackAt <= now ? "due" : "later";
        case "reached":
          return "talking";
        case "no-answer":
        case "message-sent":
          return "retry";
        default:
          // Fiches d'avant les statuts : on deduit du stade et des essais.
          if (l.stage === "conversation") return "talking";
          return (l.callAttempts ?? 0) > 0 || l.stage === "contacte" ? "retry" : "new";
      }
    };

    const ORDER: Record<CallBucket, number> = { due: 0, new: 1, retry: 2, later: 3, talking: 4, booked: 5, lost: 6 };

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
        case "lost":
          return (b.lastCallAt ?? "").localeCompare(a.lastCallAt ?? "");
        default:
          return (b.optInAt || b.createdAt).localeCompare(a.optInAt || a.createdAt);
      }
    });

    const count = (k: CallBucket) => rows.filter((r) => r.bucket === k).length;
    const notInterested = db.leads.filter((l) => visible(l) && l.callStatus === "not-interested").length;
    // Leads a appeler qui existent mais appartiennent a un autre setter : un
    // membre qui voit une page vide doit savoir qu'il y a matiere, et que
    // c'est une question d'attribution, pas de synchro.
    const hidden = session.isAdmin
      ? 0
      : db.leads.filter(
          (l) => !visible(l) && (l.stage === "nouveau" || l.stage === "contacte" || l.stage === "conversation") && l.callStatus !== "not-interested",
        ).length;

    return {
      rows,
      counts: {
        due: count("due"),
        new: count("new"),
        retry: count("retry"),
        later: count("later"),
        talking: count("talking"),
        booked: count("booked"),
        lost: count("lost"),
        notInterested,
        hidden,
      },
      lastSyncAt: db.settings.systemeioLastSyncAt ?? "",
      syncError,
      /** Closer propose quand un setter pose un rendez-vous (reglages iClosed). */
      defaultCloserId: db.settings.salesDefaultCloserId ?? "",
      /** Compte de l'equipe du proprietaire : propose comme closer quand l'admin pose un rendez-vous. */
      ownerMemberId: db.settings.salesOwnerMemberId ?? "",
    };
  });
}

/**
 * Réattribution en bloc (admin) : tous les leads encore à appeler, ou une
 * liste d'identifiants, passent au setter choisi. Sert quand un setter
 * arrive après les premiers imports : les leads étaient tous chez le
 * premier de la liste et il n'en voyait aucun.
 */
export async function PATCH(req: NextRequest) {
  return handle(async () => {
    const session = requireAdmin(readSession(req));
    const body = (await req.json().catch(() => ({}))) as { setterId?: string; ids?: string[] };
    const db = readDB();
    const setter = db.team.find((m) => m.id === body.setterId);
    if (!setter) throw new Error("Setter inconnu.");

    const wanted = body.ids?.length ? new Set(body.ids) : null;
    const booked = new Set(db.appointments.map((a) => a.leadId));
    let moved = 0;
    for (const l of db.leads) {
      if (wanted ? !wanted.has(l.id) : !(l.stage === "nouveau" || l.stage === "contacte" || l.stage === "conversation") || booked.has(l.id)) continue;
      if (l.setterId === setter.id) continue;
      l.setterId = setter.id;
      l.ownerName = setter.name;
      l.ownerRole = "setter";
      moved++;
    }
    if (moved) {
      db.activityLogs.unshift({
        id: newId(),
        at: new Date().toISOString(),
        actorId: session.memberId,
        actorName: session.memberName || "Moi",
        action: "lead.assign",
        entity: "lead",
        entityId: "",
        summary: `${moved} lead${moved > 1 ? "s" : ""} à appeler attribué${moved > 1 ? "s" : ""} à ${setter.name}`,
      });
      writeDB(db);
    }
    return { moved, setter: setter.name };
  });
}
