import { NextRequest } from "next/server";
import { newId, readDB, writeDB } from "@/lib/db";
import { canSee, Forbidden, readSession, requireAdmin, requireSales } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { sessionHas } from "@/lib/sales/roles";
import { CHANNEL_LABEL } from "@/lib/sales/templates";
import { fmtDateTime, parisDay, parisToIso } from "@/lib/format";
import { leadIsOut, type DB, type Lead, type LeadCallStatus, type TemplateChannel } from "@/lib/types";
import { leadTimeline } from "@/lib/sales/timeline";
import { paymentView } from "@/lib/sales/installments";
import { fmtIdle, takeoverState } from "@/lib/sales/takeover";
import { notifyTelegram } from "@/lib/telegram";

export const dynamic = "force-dynamic";

export interface LeadMeta {
  campaignName: string;
  adsetName: string;
  adName: string;
  creative: { id: string; name: string; kind: string; thumbnailUrl: string; imageUrl: string } | null;
  /** Date de l'instantane Meta qui a servi. */
  syncedAt: string;
}

/** Noms de campagne / ad set / ad et creative, d'apres l'instantane Meta Ads (par IDs). */
function resolveMeta(db: DB, lead: Lead): LeadMeta | null {
  if (!lead.campaignId && !lead.adsetId && !lead.adId) return null;
  const snaps = [...db.mbSnapshots].sort((a, b) => b.syncedAt.localeCompare(a.syncedAt));
  const out: LeadMeta = { campaignName: lead.campaignName ?? "", adsetName: lead.adsetName ?? "", adName: lead.adName ?? "", creative: null, syncedAt: "" };
  for (const s of snaps) {
    const campaign = lead.campaignId ? s.campaigns.find((c) => c.id === lead.campaignId) : undefined;
    const adset = lead.adsetId ? s.adsets.find((a) => a.id === lead.adsetId) : undefined;
    const ad = lead.adId ? s.ads.find((a) => a.id === lead.adId) : undefined;
    if (!campaign && !adset && !ad) continue;
    out.campaignName = campaign?.name ?? out.campaignName;
    out.adsetName = adset?.name ?? out.adsetName;
    out.adName = ad?.name ?? out.adName;
    const creative = ad ? s.creatives.find((c) => c.id === ad.creativeId) : undefined;
    if (creative) out.creative = { id: creative.id, name: creative.name, kind: creative.kind, thumbnailUrl: creative.thumbnailUrl, imageUrl: creative.imageUrl };
    out.syncedAt = s.syncedAt;
    break;
  }
  return out;
}

type Action = "status" | "reopen" | "attempt" | "reached" | "lost" | "note" | "assign" | "contact" | "message" | "takeover";

const STATUSES: LeadCallStatus[] = ["no-answer", "message-sent", "callback", "reached", "not-interested", "wrong-number", "no-whatsapp", "cold"];

const STATUS_LABEL: Record<LeadCallStatus, string> = {
  "no-answer": "ne répond pas",
  "message-sent": "message envoyé",
  callback: "à rappeler",
  reached: "joint",
  "not-interested": "pas intéressé",
  "wrong-number": "faux numéro",
  "no-whatsapp": "pas de WhatsApp",
  cold: "lead froid (sans réponse)",
};

/**
 * Fiche d'un lead : la fiche elle-meme, ses rendez-vous, et son historique
 * (statuts poses, notes, attributions). Sert au panneau « Fiche contact ».
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = requireSales(readSession(req));
    const { id } = await ctx.params;
    const db = readDB();
    const lead = db.leads.find((l) => l.id === id);
    if (!lead) throw new Error("Lead introuvable.");
    const unassigned = !lead.setterId;
    // Le closer d'un de ses calls voit la fiche aussi : c'est lui qui la statue apres le call.
    const myCall = db.appointments.some((a) => a.leadId === lead.id && canSee(session, a));
    if (!myCall) {
      // Une conversation reprenable (regle de l'heure) se lit avant d'etre reprise.
      const takeable = sessionHas(session, "setter") && takeoverState(lead, db.settings, false, Date.now()).eligible;
      if (!unassigned && !canSee(session, { setterId: lead.setterId }) && !takeable) throw new Forbidden();
      if (unassigned && !session.isAdmin && !sessionHas(session, "setter")) throw new Forbidden();
    }
    const names = new Map(db.team.map((m) => [m.id, m.name]));
    // La vente en cours du lead (la plus recente non annulee), pour la fiche.
    const sale = db.sales.filter((s) => s.leadId === lead.id && s.status !== "cancelled").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    const cancelledSale = sale ? undefined : db.sales.filter((s) => s.leadId === lead.id && s.status === "cancelled").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    /*
     * Noms et creative Meta, resolus depuis le dernier instantane du media
     * buying (aucun appel a l'API ici) : les IDs restent la reference, les
     * noms ne servent qu'a lire.
     */
    const meta = resolveMeta(db, lead);
    return {
      lead,
      setterName: lead.setterId ? (names.get(lead.setterId) ?? "—") : "",
      sale: sale ? { ...sale, closerName: names.get(sale.closerId) ?? "", payment: paymentView(sale) } : null,
      cancelledSale: cancelledSale ? { id: cancelledSale.id, contractValue: cancelledSale.contractValue, currency: cancelledSale.currency, updatedAt: cancelledSale.updatedAt, notes: cancelledSale.notes } : null,
      canOutcome: session.isAdmin || sessionHas(session, "closer"),
      canDelete: session.isAdmin,
      today: parisDay(),
      appointments: db.appointments
        .filter((a) => a.leadId === lead.id)
        .sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt))
        .map((a) => ({
          id: a.id,
          scheduledAt: a.scheduledAt,
          status: a.status,
          closerName: a.closerId ? (names.get(a.closerId) ?? "—") : "",
          iclosedUrl: a.iclosedUrl,
          iclosedEventId: a.iclosedEventId,
          calendar: a.calendar ?? "",
          timezone: a.timezone,
          confirmation: a.confirmation ?? "",
          createdAt: a.createdAt,
          source: a.source,
        })),
      meta,
      timeline: leadTimeline(db, lead, names, meta?.adName),
      logs: db.activityLogs.filter((l) => l.entity === "lead" && l.entityId === lead.id).slice(0, 40),
    };
  });
}

/**
 * Suppression d'un lead (admin) : un doublon, un test, une erreur de saisie.
 *
 * Tout ce qui pend au lead part avec lui : rendez-vous, ventes (le chiffre
 * d'affaires et les commissions redescendent d'autant), relances. Un call
 * venu d'iClosed est memorise comme supprime pour que la synchro ne le
 * recree pas ; un contact Systeme.io aussi. Un eleve rattache a ce lead
 * garde sa fiche, seuls les liens vers le lead, la vente et le rendez-vous
 * sont effaces. Rien n'est recuperable ensuite : l'interface confirme avant.
 */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = requireAdmin(readSession(req));
    const { id } = await ctx.params;
    const db = readDB();
    const lead = db.leads.find((l) => l.id === id);
    if (!lead) throw new Error("Lead introuvable.");

    const appts = db.appointments.filter((a) => a.leadId === id);
    const apptIds = new Set(appts.map((a) => a.id));
    const sales = db.sales.filter((s) => s.leadId === id || apptIds.has(s.appointmentId));
    const saleIds = new Set(sales.map((s) => s.id));

    db.leads = db.leads.filter((l) => l.id !== id);
    db.appointments = db.appointments.filter((a) => a.leadId !== id);
    db.sales = db.sales.filter((s) => !saleIds.has(s.id));
    db.followUps = db.followUps.filter((f) => f.leadId !== id && !apptIds.has(f.appointmentId));

    // Les synchros ne doivent pas ramener ce qu'on vient d'enlever.
    const iclosedIds = appts.map((a) => a.iclosedEventId).filter(Boolean);
    if (iclosedIds.length) {
      const skip = new Set(db.settings.salesDeletedIclosedEventIds ?? []);
      for (const x of iclosedIds) skip.add(x);
      db.settings.salesDeletedIclosedEventIds = [...skip].slice(-500);
    }
    if (lead.systemeioId) {
      const ignored = new Set(db.settings.systemeioIgnoredIds ?? []);
      ignored.add(String(lead.systemeioId));
      db.settings.systemeioIgnoredIds = [...ignored];
    }
    // L'eleve reste, sans ses liens vers ce qui n'existe plus.
    for (const st of db.students) {
      if (st.leadId === id) st.leadId = undefined;
      if (st.saleId && saleIds.has(st.saleId)) st.saleId = undefined;
      if (st.appointmentId && apptIds.has(st.appointmentId)) st.appointmentId = undefined;
    }

    const who = session.memberName || "Moi";
    const money = sales.map((s) => `${s.contractValue} ${s.currency}`).join(", ");
    db.activityLogs.unshift({
      id: newId(),
      at: new Date().toISOString(),
      actorId: session.memberId,
      actorName: who,
      action: "lead.deleted",
      entity: "lead",
      entityId: id,
      summary: `${who} a supprimé le lead ${lead.name}${lead.phone ? ` (${lead.phone})` : ""}${appts.length ? ` avec ${appts.length} rendez-vous` : ""}${sales.length ? ` et ${sales.length} vente${sales.length > 1 ? "s" : ""} (${money})` : ""}`,
    });
    writeDB(db);
    return { ok: true, appointments: appts.length, sales: sales.length };
  });
}

/**
 * Suivi d'un appel depuis la liste « À appeler ».
 *  - status  : pose un statut d'appel (ne repond pas, message envoye, a
 *              rappeler + date, joint, pas interesse) ;
 *  - attempt / reached / lost : anciennes actions, gardees pour les clients
 *              deja ouverts, traduites vers un statut ;
 *  - note    : remplace la note libre ;
 *  - assign  : admin, change de setter (sans setterId : rendu a tout le monde).
 *
 * Un lead sans setter (pool commun : c'est le cas de tout lead frais) est
 * pris par le setter qui agit dessus : c'est lui qui l'a appele en premier,
 * c'est a lui qu'il revient, et les autres ne le voient plus.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = requireSales(readSession(req));
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as {
      action?: Action;
      status?: LeadCallStatus;
      callbackAt?: string;
      note?: string;
      setterId?: string;
      reason?: string;
      /** Action « contact » : pseudo Instagram saisi a la main. */
      igUsername?: string;
      /** Avec `status` : annule le rendez-vous a venir du lead (RDV pris puis annule). */
      cancelAppointment?: boolean;
      /** Action « message » (marque comme envoye) : template utilise, canal, et prochaine relance. */
      templateId?: string;
      templateName?: string;
      channel?: TemplateChannel;
      /** "tomorrow" | "3d" | "none" | date-heure ISO. */
      next?: string;
    };

    const db = readDB();
    const lead = db.leads.find((l) => l.id === id);
    if (!lead) throw new Error("Lead introuvable : il a été supprimé.");
    const unassigned = !lead.setterId;
    const now = new Date();
    /*
     * Regle de reprise : la conversation d'un autre setter, sans action de sa
     * part depuis plus de `salesTakeoverMin` minutes, peut etre reprise. Un
     * setter qui agit dessus (bouton « Reprendre » ou n'importe quel statut)
     * en devient le setter ; l'ancien est prevenu sur Telegram.
     */
    let takenFrom: { id: string; name: string; idleMin: number } | null = null;
    if (!unassigned && !canSee(session, { setterId: lead.setterId })) {
      const owner = db.team.find((m) => m.id === lead.setterId);
      const booked = db.appointments.some(
        (a) => a.leadId === lead.id && (a.status === "booked" || a.status === "confirmed" || a.status === "rescheduled") && a.scheduledAt >= new Date(now.getTime() - 24 * 3600_000).toISOString(),
      );
      const t = takeoverState(lead, db.settings, booked, now.getTime());
      if (t.eligible && sessionHas(session, "setter")) {
        takenFrom = { id: lead.setterId!, name: owner?.name ?? "un autre setter", idleMin: t.idleMin };
        lead.setterId = session.memberId;
        lead.ownerName = session.memberName;
        lead.ownerRole = "setter";
        lead.claimedAt = now.toISOString();
        lead.takeoverWarnedAt = "";
      } else {
        // Pool commun : l'autre setter l'a appele en premier pendant que cette
        // liste n'etait pas a jour. On le dit clairement, la page se recharge.
        const name = owner?.name ?? "un autre setter";
        throw new Forbidden(
          body.action === "takeover"
            ? `${lead.name} n'est plus à reprendre : ${name} vient d'agir dessus. Ta liste vient d'être mise à jour.`
            : `${lead.name} a déjà été appelé par ${name} : ce lead est à ${name}. Ta liste vient d'être mise à jour.`,
        );
      }
    }
    if (unassigned && !session.isAdmin && !sessionHas(session, "setter")) throw new Forbidden();
    if (body.action === "takeover" && !takenFrom && !unassigned && !session.isAdmin) {
      throw new Error(lead.setterId === session.memberId ? "Ce lead est déjà à toi." : "Ce lead n'est pas à reprendre.");
    }
    const today = now.toISOString().slice(0, 10);
    const tomorrow = new Date(now.getTime() + 24 * 3600_000).toISOString().slice(0, 10);
    /** Relance a J+n, le matin (heure de Paris) : le lead ressort en tete de liste ce jour-la. */
    const relanceAt = (days: number) => parisToIso(`${parisDay(days)}T08:00`);
    const who = session.memberName || "Moi";
    let summary = "";

    // Reprise d'un lead du pool par le setter qui agit.
    const claim = () => {
      if (unassigned && !session.isAdmin && body.action !== "assign") {
        lead.setterId = session.memberId;
        lead.ownerName = session.memberName;
        lead.ownerRole = "setter";
        lead.claimedAt = now.toISOString();
      }
    };

    const setStatus = (status: LeadCallStatus, callbackAt = "") => {
      // Un lead sorti de la liste (pas interesse, rendez-vous pris puis annule,
      // call fait) qui recoit un statut d'appel y revient.
      const inList = lead.stage === "nouveau" || lead.stage === "contacte" || lead.stage === "conversation";
      if (!inList && !leadIsOut(status)) lead.stage = "contacte";
      lead.callStatus = status;
      lead.lastCallAt = now.toISOString();
      lead.callbackAt = status === "callback" ? callbackAt : "";
      // Un nouveau statut ouvre un nouveau cycle : la relance programmee d'avant ne vaut plus.
      lead.followUpAt = "";
      switch (status) {
        case "no-answer": {
          /*
           * Cadence sans reponse : J0 appel + WhatsApp, relance J+1, relance
           * J+3, puis lead froid au troisieme essai sans reponse. Le setter n'a
           * rien a programmer : le lead ressort tout seul a la bonne date.
           */
          lead.callAttempts = (lead.callAttempts ?? 0) + 1;
          if (lead.stage === "nouveau") lead.stage = "contacte";
          if (lead.callAttempts >= 3) {
            lead.callStatus = "cold";
            lead.nextAction = "";
            lead.nextActionAt = "";
            break;
          }
          lead.followUpAt = relanceAt(lead.callAttempts === 1 ? 1 : 2);
          lead.nextAction = "Relancer le prospect";
          lead.nextActionAt = lead.followUpAt.slice(0, 10);
          break;
        }
        case "message-sent":
          if (lead.stage === "nouveau") lead.stage = "contacte";
          lead.followUpAt = relanceAt(1);
          lead.nextAction = "Relancer le prospect";
          lead.nextActionAt = lead.followUpAt.slice(0, 10);
          break;
        case "callback":
          lead.stage = "conversation";
          lead.nextAction = "Rappeler le prospect";
          lead.nextActionAt = callbackAt.slice(0, 10) || today;
          break;
        case "reached":
          lead.callAttempts = (lead.callAttempts ?? 0) + 1;
          lead.stage = "conversation";
          lead.nextAction = "Fixer le rendez-vous";
          lead.nextActionAt = today;
          break;
        case "not-interested":
        case "wrong-number":
        case "no-whatsapp":
          lead.stage = "closed-lost";
          lead.nextAction = "";
          lead.nextActionAt = "";
          break;
      }
    };

    switch (body.action) {
      case "status": {
        const status = body.status;
        if (!status || !STATUSES.includes(status)) throw new Error("Statut inconnu.");
        let callbackAt = "";
        if (status === "callback") {
          const d = new Date(body.callbackAt ?? "");
          if (Number.isNaN(d.getTime())) throw new Error("Indique la date et l'heure du rappel.");
          callbackAt = d.toISOString();
        }
        claim();
        if (body.cancelAppointment) {
          /*
           * Rendez-vous pris puis annule par le prospect : on annule le (ou
           * les) rendez-vous a venir, avec trace, et le lead reprend un
           * statut d'appel. Le closer ne le voit plus dans ses prochains calls.
           */
          const dayAgo = new Date(now.getTime() - 24 * 3600_000).toISOString();
          for (const a of db.appointments) {
            if (a.leadId !== lead.id || a.scheduledAt < dayAgo) continue;
            if (a.status !== "booked" && a.status !== "confirmed" && a.status !== "rescheduled") continue;
            a.history.push({ at: now.toISOString(), actorId: session.memberId, actorName: who, from: a.status, to: "cancelled", note: "Annulé depuis « À appeler »" });
            a.status = "cancelled";
            a.updatedAt = now.toISOString();
            db.activityLogs.unshift({
              id: newId(),
              at: now.toISOString(),
              actorId: session.memberId,
              actorName: who,
              action: "appointment.cancelled",
              entity: "appointment",
              entityId: a.id,
              summary: `${who} a annulé le rendez-vous de ${lead.name}`,
            });
          }
        }
        setStatus(status, callbackAt);
        if (body.note?.trim()) lead.notes = `${lead.notes ? `${lead.notes}\n` : ""}${body.note.trim()}`;
        summary =
          status === "callback"
            ? `${who} : ${lead.name} demande à être rappelé le ${callbackAt.slice(0, 16).replace("T", " à ")}`
            : `${who} : ${lead.name} — ${STATUS_LABEL[lead.callStatus ?? status]}${status === "no-answer" ? ` (essai ${lead.callAttempts})` : ""}${lead.followUpAt ? ` · relance le ${fmtDateTime(lead.followUpAt)}` : ""}${lead.callStatus === "cold" && status !== "cold" ? " · lead froid après 3 essais" : ""}`;
        break;
      }
      case "reopen":
        // Un « pas interesse » qui revient : il repasse dans les leads a retenter.
        claim();
        lead.callStatus = undefined;
        lead.callbackAt = "";
        lead.followUpAt = "";
        lead.stage = "contacte";
        lead.nextAction = "Rappeler le prospect";
        lead.nextActionAt = today;
        summary = `${who} a remis ${lead.name} dans la liste à appeler`;
        break;
      case "attempt":
        claim();
        setStatus("no-answer");
        summary = `${who} a appelé ${lead.name} sans réponse (essai ${lead.callAttempts})`;
        break;
      case "reached":
        claim();
        setStatus("reached");
        summary = `${who} a joint ${lead.name}`;
        break;
      case "lost":
        claim();
        setStatus("not-interested");
        if (body.reason?.trim()) lead.notes = `${lead.notes ? `${lead.notes}\n` : ""}Perdu : ${body.reason.trim()}`;
        summary = `${who} a classé ${lead.name} comme perdu${body.reason ? ` (${body.reason})` : ""}`;
        break;
      case "note":
        lead.notes = (body.note ?? "").trim();
        break;
      case "contact": {
        const clean = (body.igUsername ?? "").trim().replace(/^@+/, "");
        lead.igUsername = clean;
        lead.handle = clean ? `@${clean}` : "";
        summary = clean ? `Pseudo Instagram de ${lead.name} : @${clean}` : `Pseudo Instagram de ${lead.name} effacé`;
        break;
      }
      case "message": {
        /*
         * « Marquer comme envoye » depuis les templates : rien n'est envoye
         * par l'outil, le setter l'a fait lui-meme (copier / WhatsApp). On
         * note le message dans la timeline, le lead passe « message envoye »
         * (sans retrograder un lead joint ou a rappeler), et la relance
         * choisie le fait revenir dans la liste a la date dite.
         */
        claim();
        const t = body.templateId ? db.messageTemplates.find((x) => x.id === body.templateId) : undefined;
        const channel = CHANNEL_LABEL[body.channel ?? t?.channel ?? "whatsapp"] ?? "Message";
        const templateName = (t?.name ?? body.templateName ?? "").trim();
        if (!lead.callStatus || lead.callStatus === "no-answer" || lead.callStatus === "message-sent" || leadIsOut(lead.callStatus)) setStatus("message-sent");
        else lead.lastCallAt = now.toISOString();
        // Sans choix explicite : relance demain matin, c'est la cadence par defaut.
        const next = (body.next ?? "tomorrow").trim() || "tomorrow";
        let followUpAt = "";
        if (next === "tomorrow") followUpAt = relanceAt(1);
        else if (next === "3d") followUpAt = relanceAt(3);
        else if (next && next !== "none") {
          const d = new Date(next);
          if (Number.isNaN(d.getTime())) throw new Error("Date de relance illisible.");
          followUpAt = d.toISOString();
        }
        lead.followUpAt = followUpAt;
        if (followUpAt) {
          lead.nextAction = "Relancer le prospect";
          lead.nextActionAt = followUpAt.slice(0, 10);
        }
        summary = `${channel} envoyé${templateName ? ` · Template : ${templateName}` : ""} · Par : ${who}${followUpAt ? ` · Relance le ${fmtDateTime(followUpAt)}` : ""}`;
        break;
      }
      case "takeover":
        // La reprise elle-meme est faite plus haut (ou c'est une prise simple du pool).
        claim();
        if (!takenFrom) summary = `${who} a pris ${lead.name}`;
        break;
      case "assign":
        if (!session.isAdmin) throw new Forbidden("Seul l'admin réattribue un lead.");
        if (body.setterId && !db.team.some((m) => m.id === body.setterId)) throw new Error("Setter inconnu.");
        lead.setterId = body.setterId ?? "";
        lead.ownerName = db.team.find((m) => m.id === body.setterId)?.name ?? "";
        lead.ownerRole = "setter";
        summary = lead.setterId ? `${lead.name} attribué à ${lead.ownerName}` : `${lead.name} remis à tous les setters`;
        break;
      default:
        throw new Error("Action inconnue.");
    }

    // Toute action du setter proprietaire remet son compteur d'inactivite a zero.
    if (lead.setterId && lead.setterId === session.memberId) {
      lead.lastSetterActionAt = now.toISOString();
      lead.takeoverWarnedAt = "";
    }

    if (takenFrom) {
      db.activityLogs.unshift({
        id: newId(),
        at: now.toISOString(),
        actorId: session.memberId,
        actorName: who,
        action: "lead.takeover",
        entity: "lead",
        entityId: lead.id,
        relatedId: takenFrom.id,
        summary: `${who} a repris la conversation avec ${lead.name} : ${takenFrom.name} sans action dessus depuis ${fmtIdle(takenFrom.idleMin)}`,
      });
      const prev = db.team.find((m) => m.id === takenFrom!.id);
      if (prev) {
        notifyTelegram(
          prev,
          `🔁 <b>${who}</b> a repris ta conversation avec <b>${lead.name.replace(/[<>&]/g, "")}</b> : aucune action de ta part dessus depuis ${fmtIdle(takenFrom.idleMin)}. Règle du setting : 1 h sans réponse, la conversation peut être reprise.`,
        );
      }
    }
    if (summary) {
      db.activityLogs.unshift({
        id: newId(),
        at: now.toISOString(),
        actorId: session.memberId,
        actorName: who,
        action: `lead.${body.action}`,
        entity: "lead",
        entityId: lead.id,
        summary,
      });
    }
    writeDB(db);
    return { lead, takenFrom: takenFrom?.name ?? "" };
  });
}
