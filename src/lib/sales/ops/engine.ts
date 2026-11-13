/**
 * Moteur du Sales OS : la file de taches de l'equipe commerciale.
 *
 * Principe : plutot que d'empiler des taches au fil des evenements (et de
 * rater celui qu'un webhook n'a pas envoye), le moteur RECALCULE a chaque
 * passage ce qui doit etre fait a partir de l'etat reel du CRM — leads,
 * rendez-vous, relances, ventes — puis aligne la collection `salesTasks` :
 *
 *  - une tache voulue qui n'existe pas est creee ;
 *  - une tache ouverte voulue est mise a jour (contexte, echeance si elle
 *    n'a pas ete reportee a la main, responsable) ;
 *  - une tache ouverte qui n'est plus voulue est close, avec la raison
 *    (« Rendez-vous annulé », « Confirmé par le prospect ») ;
 *  - une tache terminee n'est jamais rouverte.
 *
 * Chaque tache a une cle stable (« confirm-j1:<rdv>:<date du call> ») :
 * rejouer le moteur, recevoir deux fois le meme webhook ou recharger la page
 * ne cree aucun doublon. Un call deplace change de cle : ses anciennes
 * confirmations tombent, de nouvelles arrivent aux bons horaires.
 *
 * Pur : aucune lecture de fichier, `now` en parametre. Le passage reel
 * (scheduler toutes les 2 min, ouverture du cockpit) est dans `run.ts`.
 */
import type { Appointment, DB, FollowUp, Lead, Sale, SalesTask, SalesTaskKind, TaskPriority } from "../../types";
import { leadIsOut } from "../../types";
import { SOURCE_CHANNEL_LABEL, funnelLabel } from "../attribution";
import { paymentView } from "../installments";
import { defaultOwnerId, leadReceivers, opsSettings, TASK_KIND_LABEL } from "./config";
import type { SalesOpsSettings } from "../../types";
import { addDays, atParis, DAY, dayOf, endOfDay, HOUR, iso, MIN, ms, since } from "./time";

/* ------------------------------ Vocabulaire ------------------------------ */

export interface DesiredTask {
  key: string;
  kind: SalesTaskKind;
  leadId: string;
  appointmentId?: string;
  saleId?: string;
  followUpId?: string;
  setterTaskId?: string;
  ownerId: string;
  priority: TaskPriority;
  dueAt: string;
  title: string;
  context: string;
}

const LIVE_APPT: Appointment["status"][] = ["booked", "confirmed", "rescheduled"];
const SETTING_FINAL = new Set(["not-qualified", "lost", "dnc"]);

/** Le lead est-il dans un etat final (plus rien a faire commercialement) ? */
export function leadIsFinal(lead: Lead): boolean {
  if (lead.doNotContact) return true;
  if (lead.stage === "closed-lost") return true;
  if (lead.settingStatus && SETTING_FINAL.has(lead.settingStatus)) return true;
  if (leadIsOut(lead.callStatus)) return true;
  return false;
}

/** Nom lisible d'un lead pour un titre de tache. */
export const leadName = (l: Lead) => l.name || (l.igUsername ? `@${l.igUsername}` : l.phone || l.email || "Prospect");

/** Source d'acquisition en clair (« Meta Ads · LP1 Ads »). */
export function sourceText(lead: Lead, db: Pick<DB, "settings">): string {
  const ch = lead.sourceChannel ? SOURCE_CHANNEL_LABEL[lead.sourceChannel] : "";
  const fn = lead.funnelSource ? funnelLabel(lead.funnelSource, db.settings.salesFunnels) : "";
  const raw = !ch && !fn ? (lead.source === "lp" ? "Landing page" : lead.source || "") : "";
  return [ch, fn && fn !== ch ? fn : "", raw].filter(Boolean).join(" · ") || "Source inconnue";
}

/** Index des donnees liees a chaque lead, calcule une fois par passage. */
export interface OpsIndex {
  apptsByLead: Map<string, Appointment[]>;
  salesByLead: Map<string, Sale[]>;
  fusByLead: Map<string, FollowUp[]>;
  leadById: Map<string, Lead>;
}

export function indexDb(db: DB): OpsIndex {
  const apptsByLead = new Map<string, Appointment[]>();
  for (const a of db.appointments) apptsByLead.set(a.leadId, [...(apptsByLead.get(a.leadId) ?? []), a]);
  const salesByLead = new Map<string, Sale[]>();
  for (const s of db.sales) salesByLead.set(s.leadId, [...(salesByLead.get(s.leadId) ?? []), s]);
  const fusByLead = new Map<string, FollowUp[]>();
  for (const f of db.followUps) fusByLead.set(f.leadId, [...(fusByLead.get(f.leadId) ?? []), f]);
  return { apptsByLead, salesByLead, fusByLead, leadById: new Map(db.leads.map((l) => [l.id, l])) };
}

/** Premier jour du Sales OS : les leads anterieurs ne generent pas de premier contact. */
export function opsStart(cfg: SalesOpsSettings, nowMs: number): string {
  return cfg.startedOn || addDays(dayOf(nowMs), -7);
}

/**
 * Le lead fait-il partie du perimetre suivi par le Sales OS ?
 *
 * Les centaines de leads anterieurs a la mise en route n'inondent pas la
 * file : ils restent consultables (pole Nurturing → anciens prospects) et
 * entrent dans le perimetre des qu'il se passe quelque chose (nouvel opt-in,
 * rendez-vous, contact, relance, reactivation).
 */
export function inScope(lead: Lead, ix: OpsIndex, start: string, today = dayOf(Date.now())): boolean {
  const after = (v?: string) => Boolean(v) && dayOf(v!) >= start;
  if (after(lead.createdAt) || after(lead.lastOptInAt) || after(lead.optInAt) || after(lead.lastContactAt) || after(lead.ownerAssignedAt) || after(lead.lastSetterActionAt)) return true;
  if (lead.settingStatus === "nurturing" && lead.nurtureUntil) return true;
  if ((ix.apptsByLead.get(lead.id) ?? []).some((a) => after(a.scheduledAt) || after(a.createdAt) || after(a.updatedAt))) return true;
  if ((ix.fusByLead.get(lead.id) ?? []).some((f) => f.status === "pending")) return true;
  if ((ix.salesByLead.get(lead.id) ?? []).some((s) => s.status !== "cancelled" && paymentView(s, today).remaining > 0)) return true;
  return false;
}

/** Responsable d'un lead pour ses taches : le sien, sinon le responsable par defaut. */
const ownerOf = (lead: Lead | undefined, fallback: string) => lead?.ownerId || fallback;

/* ------------------------------ Attribution ------------------------------ */

/**
 * Donne un responsable a chaque lead suivi qui n'en a pas.
 *
 * « single » : tout au responsable par defaut (le Head of Setting).
 * « round-robin » : au membre qui a le moins de leads actifs parmi ceux qui
 * recoivent des leads. Le setter d'origine, le closer et la source ne sont
 * jamais modifies. Renvoie les leads attribues (pour le journal).
 */
export function assignOwners(db: DB, nowMs: number, cfg = opsSettings(db), ix = indexDb(db)): Lead[] {
  const head = defaultOwnerId(db, cfg);
  if (!head) return [];
  const start = opsStart(cfg, nowMs);
  const receivers = cfg.assignment === "round-robin" ? leadReceivers(db, cfg) : [head];
  const load = new Map(receivers.map((id) => [id, 0]));
  for (const l of db.leads) if (l.ownerId && load.has(l.ownerId) && !leadIsFinal(l) && l.stage !== "closed-won") load.set(l.ownerId, (load.get(l.ownerId) ?? 0) + 1);

  const assigned: Lead[] = [];
  const at = iso(nowMs);
  // Plus anciens d'abord : la repartition reste stable d'un passage a l'autre.
  const todo = db.leads.filter((l) => !l.ownerId && !l.mock && !leadIsFinal(l) && inScope(l, ix, start, dayOf(nowMs))).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const lead of todo) {
    const pick = receivers.length > 1 ? [...load.entries()].sort((a, b) => a[1] - b[1])[0][0] : head;
    lead.ownerId = pick;
    lead.ownerAssignedAt = at;
    load.set(pick, (load.get(pick) ?? 0) + 1);
    assigned.push(lead);
  }
  // Les relances en cours suivent le responsable du lead.
  for (const fu of db.followUps) {
    if (fu.status !== "pending" || fu.ownerId) continue;
    const lead = ix.leadById.get(fu.leadId);
    fu.ownerId = ownerOf(lead, head);
  }
  return assigned;
}

/* ---------------------------- Taches voulues ----------------------------- */

const clip = (s: string, n = 220) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Tout ce qui doit etre fait, d'apres l'etat du CRM a l'instant `nowMs`.
 * Une regle desactivee dans les reglages ne produit rien.
 */
export function planTasks(db: DB, nowMs: number, cfg = opsSettings(db), ix = indexDb(db)): DesiredTask[] {
  const out: DesiredTask[] = [];
  const head = defaultOwnerId(db, cfg);
  const adminId = db.settings.salesOwnerMemberId ?? "";
  const start = opsStart(cfg, nowMs);
  const today = dayOf(nowMs);
  const on = (k: SalesTaskKind) => cfg.rules[k]?.enabled !== false;
  const prio = (k: SalesTaskKind) => cfg.rules[k]?.priority ?? 1;
  const objections = new Map(cfg.objections.map((o) => [o.key, o]));
  const currency = db.settings.salesCurrency || "EUR";
  const money = (n: number) => `${Math.round(n).toLocaleString("fr-FR")} ${currency === "EUR" ? "€" : currency}`;
  // Ce qui revient au closer (statuer, encaisser) : a lui s'il est toujours closer et actif, sinon a l'admin.
  const closers = new Set(db.team.filter((m) => m.status !== "inactif" && (m.roles ?? [m.role]).includes("closer")).map((m) => m.id));
  const closerOrAdmin = (id?: string) => (id && closers.has(id) ? id : adminId);

  /* --- Leads : premier contact, conversations, actions datees, nurturing --- */
  for (const lead of db.leads) {
    if (lead.mock || leadIsFinal(lead)) continue;
    if (!inScope(lead, ix, start, today)) continue;
    const owner = ownerOf(lead, head);
    const appts = ix.apptsByLead.get(lead.id) ?? [];
    const liveAppt = appts.some((a) => LIVE_APPT.includes(a.status) && ms(a.scheduledAt) > nowMs - 2 * HOUR);
    const anyAppt = appts.some((a) => a.status !== "cancelled");
    const won = lead.stage === "closed-won";
    const src = sourceText(lead, db);
    const name = leadName(lead);

    // Premier contact : lead entrant, jamais contacte, sans rendez-vous. Un
    // lead qui a reserve directement entre dans la confirmation, pas ici.
    if (on("first-contact") && !won && !anyAppt && !lead.lastContactAt && !lead.callStatus && !lead.declaredAt && (!lead.settingStatus || lead.settingStatus === "to-contact")) {
      const arrived = lead.lastOptInAt || lead.optInAt || lead.createdAt;
      out.push({
        key: `first-contact:${lead.id}`,
        kind: "first-contact",
        leadId: lead.id,
        ownerId: owner,
        priority: prio("first-contact"),
        dueAt: arrived,
        title: `Contacter ${name}`,
        context: clip(`Nouveau lead ${src}, arrivé ${since(ms(arrived), nowMs)}.${lead.phone ? " Téléphone disponible." : ""}${lead.igUsername ? ` Instagram @${lead.igUsername}.` : ""}${lead.notes ? ` Note : ${lead.notes}` : ""}`),
      });
    }

    // Conversation sans reponse : relance apres le delai regle.
    const waiting = lead.settingStatus === "contacted" || lead.settingStatus === "awaiting-reply" || lead.settingStatus === "proposed";
    if (on("setting-nudge") && !won && waiting && !liveAppt && lead.lastContactAt) {
      const due = ms(lead.lastContactAt) + cfg.nudgeAfterHours * HOUR;
      out.push({
        key: `nudge:${lead.id}:${lead.lastContactAt}`,
        kind: "setting-nudge",
        leadId: lead.id,
        ownerId: owner,
        priority: prio("setting-nudge"),
        dueAt: iso(due),
        title: `Relancer ${name}`,
        context: clip(`Sans réponse depuis le dernier contact (${since(ms(lead.lastContactAt), nowMs)}). ${lead.settingStatus === "proposed" ? "Rendez-vous proposé, pas encore réservé." : "Relancer la conversation."} Source : ${src}.`),
      });
    }

    // Prochaine action datee, posee a la main sur la fiche.
    if (on("planned") && !won && lead.nextActionAt && Number.isFinite(ms(lead.nextActionAt)) && dayOf(lead.nextActionAt) >= addDays(start, -1)) {
      out.push({
        key: `planned:${lead.id}:${lead.nextActionAt}`,
        kind: "planned",
        leadId: lead.id,
        ownerId: owner,
        priority: prio("planned"),
        dueAt: lead.nextActionAt,
        title: lead.nextAction ? `${lead.nextAction} — ${name}` : `Action prévue — ${name}`,
        context: clip(`Action planifiée sur la fiche. Source : ${src}.${lead.notes ? ` Note : ${lead.notes}` : ""}`),
      });
    }

    // Rappels de la liste a appeler (rappel demande, relance apres message).
    const cb = lead.callStatus === "callback" ? lead.callbackAt : lead.followUpAt;
    if (on("callback") && !won && cb && Number.isFinite(ms(cb)) && !liveAppt) {
      out.push({
        key: `callback:${lead.id}:${cb}`,
        kind: "callback",
        leadId: lead.id,
        ownerId: owner,
        priority: prio("callback"),
        dueAt: cb,
        title: lead.callStatus === "callback" ? `Rappeler ${name}` : `Relancer ${name}`,
        context: clip(lead.callStatus === "callback" ? `Le prospect a demandé à être rappelé. Source : ${src}.` : `Relance prévue après le dernier message (${lead.callAttempts ?? 0} tentative(s)). Source : ${src}.`),
      });
    }

    // Nurturing : date de reprise.
    if (on("nurture") && lead.settingStatus === "nurturing" && lead.nurtureUntil) {
      out.push({
        key: `nurture:${lead.id}:${lead.nurtureUntil}`,
        kind: "nurture",
        leadId: lead.id,
        ownerId: owner,
        priority: prio("nurture"),
        dueAt: atParis(lead.nurtureUntil.slice(0, 10)),
        title: `Réactiver ${name}`,
        context: clip(`En nurturing${lead.nurtureReason ? ` : ${lead.nurtureReason}` : ""}. ${lead.heat ? `Température : ${lead.heat === "hot" ? "chaud" : lead.heat === "warm" ? "tiède" : "froid"}. ` : ""}Source : ${src}.`),
      });
    }
  }

  /* --- Rendez-vous : confirmation, resultat manquant, no-shows --- */
  for (const appt of db.appointments) {
    const lead = ix.leadById.get(appt.leadId);
    if (!lead || lead.mock) continue;
    const at = ms(appt.scheduledAt);
    if (!Number.isFinite(at)) continue;
    const name = leadName(lead);
    const owner = ownerOf(lead, head);
    const src = sourceText(lead, db);
    const when = `${fmtWhen(appt.scheduledAt)}`;
    const confirmed = appt.confirmation === "confirmed" || appt.status === "confirmed";

    if (LIVE_APPT.includes(appt.status) && at > nowMs && !lead.doNotContact) {
      if (dayOf(at) < start && dayOf(appt.createdAt) < start) continue;
      const booked = ms(appt.createdAt);
      const sent = appt.confirmation === "awaiting" ? " Message de confirmation déjà envoyé, en attente de réponse." : appt.confirmation === "no-answer" ? " Pas de réponse à la confirmation : call à risque." : "";
      if (on("confirm-booking") && !appt.confirmation && at - nowMs > 24 * HOUR) {
        out.push({
          key: `confirm-booking:${appt.id}`,
          kind: "confirm-booking",
          leadId: lead.id,
          appointmentId: appt.id,
          ownerId: owner,
          priority: prio("confirm-booking"),
          dueAt: appt.createdAt,
          title: `Confirmer la réservation de ${name}`,
          context: clip(`Call réservé le ${fmtWhen(appt.createdAt)} pour le ${when}. Envoyer le message de confirmation et le contexte du call. Source : ${src}.`),
        });
      }
      if (on("confirm-j1") && !confirmed && at - booked >= 6 * HOUR) {
        out.push({
          key: `confirm-j1:${appt.id}:${appt.scheduledAt}`,
          kind: "confirm-j1",
          leadId: lead.id,
          appointmentId: appt.id,
          ownerId: owner,
          priority: prio("confirm-j1"),
          dueAt: iso(at - 24 * HOUR),
          title: `Confirmation J-1 — ${name}`,
          context: clip(`Call le ${when}. Obtenir une confirmation explicite du prospect (une confirmation envoyée ne suffit pas).${sent}`),
        });
      }
      if (on("confirm-h3") && !confirmed) {
        out.push({
          key: `confirm-h3:${appt.id}:${appt.scheduledAt}`,
          kind: "confirm-h3",
          leadId: lead.id,
          appointmentId: appt.id,
          ownerId: owner,
          priority: prio("confirm-h3"),
          dueAt: iso(at - 3 * HOUR),
          title: `Contrôle H-3 — ${name} n'a pas confirmé`,
          context: clip(`Call le ${when}, toujours sans confirmation explicite.${sent} Appeler ou écrire maintenant ; prévenir le closer si rien.`),
        });
      }
    }

    // Call passe sans resultat : au closer (Mady), pas au setting.
    if (on("outcome-missing") && LIVE_APPT.includes(appt.status) && at + HOUR < nowMs && dayOf(at) >= start) {
      out.push({
        key: `outcome:${appt.id}:${appt.scheduledAt}`,
        kind: "outcome-missing",
        leadId: lead.id,
        appointmentId: appt.id,
        ownerId: closerOrAdmin(appt.closerId),
        priority: prio("outcome-missing"),
        dueAt: iso(at + HOUR),
        title: `Renseigner le résultat du call de ${name}`,
        context: clip(`Call du ${when} sans résultat. Closé, en attente, perdu ou no-show : la suite part automatiquement au Head of Setting.`),
      });
    }

    // No-show : reprise de contact selon la cadence.
    if (on("no-show") && appt.status === "no-show" && !leadIsFinal(lead) && dayOf(at) >= addDays(start, -7)) {
      const ns = appt.noShow;
      const state = ns?.state ?? "to-recover";
      if (state === "rescheduled" || state === "lost" || state === "dnc") continue;
      if (rescheduledAfter(appt, ix)) continue;
      const attempts = ns?.attempts ?? 0;
      if (attempts >= cfg.noShowCadenceMin.length) continue;
      const base = attempts === 0 ? ms(ns?.at) || noShowAt(appt) : ms(ns?.lastAttemptAt) || noShowAt(appt);
      out.push({
        key: `no-show:${appt.id}:${attempts + 1}`,
        kind: "no-show",
        leadId: lead.id,
        appointmentId: appt.id,
        ownerId: owner,
        priority: attempts === 0 ? prio("no-show") : (Math.min(3, prio("no-show") + 1) as TaskPriority),
        dueAt: iso(base + cfg.noShowCadenceMin[attempts] * MIN),
        title: `${attempts === 0 ? "Recontacter" : attempts + 1 === cfg.noShowCadenceMin.length ? "Dernière tentative" : "Relancer"} ${name} (absent au call)`,
        context: clip(`Absent au call du ${when}. Tentative ${attempts + 1}/${cfg.noShowCadenceMin.length}. Proposer un nouveau créneau sans reproche. Source : ${src}.`),
      });
    }
  }

  /* --- Relances apres call --- */
  for (const fu of db.followUps) {
    if (!on("followup") || fu.status !== "pending") continue;
    const lead = ix.leadById.get(fu.leadId);
    if (!lead || lead.mock || lead.doNotContact) continue;
    if (lead.stage === "closed-won" || lead.stage === "closed-lost") continue;
    const appt = db.appointments.find((a) => a.id === fu.appointmentId);
    const obj = fu.objection ? objections.get(fu.objection) : undefined;
    const lastMsg = [...(fu.log ?? [])].reverse().find((e) => e.kind === "contact" || e.kind === "note");
    const heat = fu.heat === "hot" ? "🔥 chaud" : fu.heat === "warm" ? "🌤 tiède" : fu.heat === "cold" ? "❄️ froid" : "";
    const parts = [
      obj ? `Objection : ${obj.label}.` : appt?.recap?.notClosedReason ? `Raison : ${appt.recap.notClosedReason}.` : "",
      heat ? `Intérêt : ${heat}.` : "",
      fu.notes ? `Ce qu'il a dit : ${fu.notes}` : "",
      lastMsg && lastMsg.note !== fu.notes ? `Dernier échange : ${lastMsg.note}` : "",
      obj?.advice ? `Conseil : ${obj.advice}` : "",
    ].filter(Boolean);
    out.push({
      key: `followup:${fu.id}`,
      kind: "followup",
      leadId: lead.id,
      appointmentId: fu.appointmentId,
      followUpId: fu.id,
      ownerId: fu.ownerId || ownerOf(lead, head) || fu.closerId,
      priority: fu.heat === "cold" ? (Math.max(prio("followup"), 2) as TaskPriority) : prio("followup"),
      dueAt: fu.dueAt,
      title: `${fu.step === 2 ? "Dernière relance" : "Relancer"} ${leadName(lead)} après son call`,
      context: clip(parts.join(" ") || "Relance après le call, sans détail laissé par le closer.", 320),
    });
  }

  /* --- Paiements en attente --- */
  for (const sale of db.sales) {
    if (sale.status === "cancelled") continue;
    const lead = ix.leadById.get(sale.leadId);
    if (!lead || lead.mock) continue;
    const v = paymentView(sale, today);
    const follow = sale.paymentFollow;
    if (follow?.state === "abandoned") continue;
    const name = leadName(lead);

    if (follow?.state === "awaiting-verification" && v.remaining > 0 && on("payment-verify")) {
      out.push({
        key: `payment-verify:${sale.id}:${follow.at}`,
        kind: "payment-verify",
        leadId: lead.id,
        saleId: sale.id,
        ownerId: closerOrAdmin(sale.closerId),
        priority: prio("payment-verify"),
        dueAt: follow.at,
        title: `Vérifier le paiement de ${name}`,
        context: clip(`Le prospect dit avoir payé (${follow.note || "sans détail"}). Reste dû : ${money(v.remaining)}. À vérifier sur le compte avant d'enregistrer l'encaissement.`),
      });
    }

    if (!on("payment") || v.remaining <= 0 || v.state === "paid") continue;
    if (v.state === "scheduled" && (v.daysToNext ?? 99) > 3 && follow?.state !== "failed") continue;
    const dueDay = v.nextDueAt || sale.paymentExpectedAt || "";
    // Apres une relance : la suivante a la date promise par le prospect, sinon deux jours plus tard.
    const remindFrom = follow?.lastReminderAt ?? "";
    const scheduled = dueDay ? atParis(dueDay.slice(0, 10)) : sale.soldAt;
    const dueAt = follow?.promisedFor && remindFrom
      ? atParis(follow.promisedFor)
      : remindFrom
        ? iso(Math.max(ms(remindFrom) + 2 * DAY, ms(scheduled)))
        : follow?.state === "failed"
          ? follow.at
          : scheduled;
    const label =
      follow?.state === "failed" ? "Paiement échoué" : v.state === "overdue" ? "Paiement en retard" : v.state === "unspecified" ? "Paiement à préciser" : v.state === "open" ? "Solde sans échéance" : v.state === "due" ? "Échéance proche" : "Paiement attendu";
    out.push({
      key: `payment:${sale.id}:${dueDay || "open"}:${remindFrom || (follow?.state === "failed" ? follow.at : "")}`,
      kind: "payment",
      leadId: lead.id,
      saleId: sale.id,
      // « A preciser » (vente iClosed sans facon de payer) : au closer / a l'admin, seuls a pouvoir le renseigner.
      ownerId: v.state === "unspecified" ? closerOrAdmin(sale.closerId) : ownerOf(lead, head) || closerOrAdmin(sale.closerId),
      priority: follow?.state === "failed" || v.state === "overdue" ? 0 : prio("payment"),
      dueAt,
      title: `${label} — ${name}`,
      context: clip(`${sale.offer || "Accompagnement"} : ${money(v.contractValue)} convenus, ${money(v.cashCollected)} encaissés, reste ${money(v.remaining)}. ${v.summary}${follow ? ` Suivi : ${PAYMENT_FOLLOW_LABEL[follow.state]}${follow.promisedFor ? ` pour le ${follow.promisedFor.split("-").reverse().join("/")}` : ""}${follow.note ? ` (${follow.note})` : ""}.` : ""}`, 320),
    });
  }

  /* --- Relances envoyees a la main par l'admin --- */
  if (on("admin-task")) {
    for (const t of db.setterTasks ?? []) {
      if (t.status !== "open") continue;
      out.push({
        key: `admin-task:${t.id}`,
        kind: "admin-task",
        leadId: t.leadId,
        setterTaskId: t.id,
        ownerId: t.setterId,
        priority: prio("admin-task"),
        dueAt: atParis(t.dueOn),
        title: `${t.kind === "call" ? "Appeler" : "Écrire à"} ${t.name}`,
        context: clip(t.note ? `De la part de Mady : ${t.note}` : "Relance demandée par Mady."),
      });
    }
  }

  return out;
}

export const PAYMENT_FOLLOW_LABEL: Record<NonNullable<Sale["paymentFollow"]>["state"], string> = {
  promised: "paiement promis",
  "link-sent": "lien de paiement envoyé",
  "awaiting-verification": "paiement à vérifier",
  failed: "paiement échoué",
  abandoned: "paiement abandonné",
};

const fmtWhen = (isoStr: string) => {
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return "—";
  const f = (tz: string) => new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: tz }).format(d);
  const dxb = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" }).format(d);
  return `${f("Europe/Paris")} FR · ${dxb} DXB`;
};

/** Moment ou le no-show a ete constate : la transition dans l'historique, sinon l'heure du call. */
export function noShowAt(appt: Appointment): number {
  const h = [...(appt.history ?? [])].reverse().find((e) => e.to === "no-show");
  return ms(h?.at) || ms(appt.scheduledAt) || ms(appt.updatedAt);
}

/** Un autre call (non annule) a-t-il ete pris apres ce no-show ? */
export function rescheduledAfter(appt: Appointment, ix: OpsIndex): Appointment | null {
  const after = noShowAt(appt);
  return (ix.apptsByLead.get(appt.leadId) ?? []).find((a) => a.id !== appt.id && a.status !== "cancelled" && (ms(a.createdAt) > after || ms(a.scheduledAt) > ms(appt.scheduledAt))) ?? null;
}

/* ------------------------------ Alignement ------------------------------- */

export interface ReconcileResult {
  created: number;
  updated: number;
  closed: number;
  assigned: Lead[];
}

/** Pourquoi une tache ouverte n'est plus voulue : « done » quand le but est atteint, « obsolete » sinon. */
function whyGone(t: SalesTask, db: DB, ix: OpsIndex, nowMs: number): { status: "done" | "obsolete"; reason: string } {
  const lead = ix.leadById.get(t.leadId);
  if (!lead) return { status: "obsolete", reason: "Lead supprimé" };
  if (lead.doNotContact) return { status: "obsolete", reason: "Ne plus contacter" };
  const appt = t.appointmentId ? db.appointments.find((a) => a.id === t.appointmentId) : undefined;
  switch (t.kind) {
    case "first-contact":
      if ((ix.apptsByLead.get(lead.id) ?? []).some((a) => a.status !== "cancelled")) return { status: "done", reason: "Rendez-vous réservé" };
      return lead.lastContactAt || lead.callStatus || lead.declaredAt ? { status: "done", reason: "Prospect contacté" } : { status: "obsolete", reason: "Lead clos" };
    case "confirm-booking":
    case "confirm-j1":
    case "confirm-h3":
      if (!appt) return { status: "obsolete", reason: "Rendez-vous supprimé" };
      if (appt.status === "cancelled") return { status: "obsolete", reason: "Rendez-vous annulé" };
      if (appt.confirmation === "confirmed" || appt.status === "confirmed") return { status: "done", reason: "Confirmé par le prospect" };
      if (t.kind === "confirm-booking" && appt.confirmation) return { status: "done", reason: "Message de confirmation envoyé" };
      if (!t.key.endsWith(appt.scheduledAt) && t.kind !== "confirm-booking") return { status: "obsolete", reason: "Rendez-vous déplacé" };
      if (ms(appt.scheduledAt) <= nowMs) return { status: "obsolete", reason: "Heure du call passée" };
      return { status: "obsolete", reason: "Plus nécessaire" };
    case "outcome-missing":
      return appt && appt.status !== "cancelled" ? { status: "done", reason: "Résultat renseigné" } : { status: "obsolete", reason: "Rendez-vous annulé" };
    case "no-show": {
      if (!appt) return { status: "obsolete", reason: "Rendez-vous supprimé" };
      if (rescheduledAfter(appt, ix) || appt.noShow?.state === "rescheduled") return { status: "done", reason: "Reprogrammé" };
      if (appt.status !== "no-show") return { status: "obsolete", reason: "Le call n'est plus noté absent" };
      if (appt.noShow?.state === "lost") return { status: "obsolete", reason: "Classé perdu" };
      return { status: "done", reason: "Tentative faite" };
    }
    case "followup": {
      const fu = db.followUps.find((f) => f.id === t.followUpId);
      if (!fu) return { status: "obsolete", reason: "Relance supprimée" };
      if (lead.stage === "closed-won") return { status: "done", reason: "Prospect closé" };
      if (fu.status === "done") return { status: "done", reason: "Relance faite" };
      return { status: "obsolete", reason: fu.status === "cancelled" ? "Relance abandonnée" : "Plus nécessaire" };
    }
    case "payment":
    case "payment-verify": {
      const sale = db.sales.find((s) => s.id === t.saleId);
      if (!sale || sale.status === "cancelled") return { status: "obsolete", reason: "Vente annulée" };
      if (paymentView(sale, dayOf(nowMs)).remaining <= 0) return { status: "done", reason: "Paiement encaissé" };
      if (sale.paymentFollow?.state === "abandoned") return { status: "obsolete", reason: "Paiement abandonné" };
      return { status: "done", reason: "Échéance traitée" };
    }
    case "admin-task":
      return { status: "done", reason: "Relance faite" };
    default:
      return { status: leadIsFinal(lead) ? "obsolete" : "done", reason: leadIsFinal(lead) ? "Lead clos" : "Fait" };
  }
}

/**
 * Aligne `db.salesTasks` sur les taches voulues. Modifie `db` en place
 * (l'appelant ecrit). Idempotent : deux passages de suite sur la meme base
 * ne changent rien au second.
 */
export function reconcileTasks(db: DB, nowMs: number): ReconcileResult {
  db.salesTasks ??= [];
  const cfg = opsSettings(db);
  // Premiere mise en route : le perimetre demarre une semaine avant, et cette date est figee.
  if (!cfg.startedOn && defaultOwnerId(db, cfg)) {
    db.settings.salesOps = { ...(db.settings.salesOps ?? {}), startedOn: addDays(dayOf(nowMs), -7) };
    cfg.startedOn = db.settings.salesOps.startedOn!;
  }
  const ix = indexDb(db);
  const assigned = assignOwners(db, nowMs, cfg, ix);
  const desired = planTasks(db, nowMs, cfg, ix);
  const byKey = new Map(db.salesTasks.map((t) => [t.key, t]));
  const wanted = new Set<string>();
  const now = iso(nowMs);
  let created = 0;
  let updated = 0;
  let closed = 0;

  for (const d of desired) {
    if (wanted.has(d.key)) continue;
    wanted.add(d.key);
    const t = byKey.get(d.key);
    if (!t) {
      const task: SalesTask = { id: `t${nowMs.toString(36)}${Math.random().toString(36).slice(2, 8)}`, ...d, status: "open", createdAt: now, updatedAt: now };
      db.salesTasks.push(task);
      byKey.set(d.key, task);
      created++;
      continue;
    }
    if (t.status !== "open") continue;
    let changed = false;
    const set = <K extends keyof SalesTask>(k: K, v: SalesTask[K]) => {
      if (t[k] !== v) {
        t[k] = v;
        changed = true;
      }
    };
    set("title", d.title);
    set("context", d.context);
    set("priority", d.priority);
    set("ownerId", d.ownerId);
    if (!t.snoozed) set("dueAt", d.dueAt);
    if (changed) {
      t.updatedAt = now;
      updated++;
    }
  }

  for (const t of db.salesTasks) {
    if (t.status !== "open" || wanted.has(t.key)) continue;
    const why = whyGone(t, db, ix, nowMs);
    t.status = why.status;
    t.closedReason = why.reason;
    t.doneAt = now;
    t.updatedAt = now;
    closed++;
  }

  // Les taches closes depuis plus de 120 jours partent : la base reste legere.
  const cutoff = nowMs - 120 * DAY;
  db.salesTasks = db.salesTasks.filter((t) => t.status === "open" || ms(t.doneAt || t.updatedAt) > cutoff);
  return { created, updated, closed, assigned };
}

/* ------------------------------ Lecture ---------------------------------- */

/**
 * Priorite affichee : la priorite de base, remontee quand la tache arrive a
 * echeance (P2 / P3 dus aujourd'hui passent P1) ou traine (en retard de plus
 * de 24 h : un cran de plus). Une tache a venir n'est jamais au-dessus de P2.
 */
export function effectivePriority(t: Pick<SalesTask, "priority" | "dueAt">, nowMs: number): TaskPriority {
  const due = ms(t.dueAt);
  let p = t.priority;
  if (!Number.isFinite(due)) return p;
  const endToday = endOfDay(dayOf(nowMs));
  if (due >= endToday) return Math.max(p, 2) as TaskPriority;
  if (p > 1) p = 1;
  if (nowMs - due > 24 * HOUR && p > 0) p = (p - 1) as TaskPriority;
  return p;
}

/** Tache en retard : echeance d'un jour precedent, ou P0 depasse d'une heure. */
export function isOverdue(t: Pick<SalesTask, "priority" | "dueAt">, nowMs: number): boolean {
  const due = ms(t.dueAt);
  if (!Number.isFinite(due)) return false;
  if (dayOf(due) < dayOf(nowMs)) return true;
  return t.priority === 0 && nowMs - due > HOUR;
}

export const taskKindLabel = (k: SalesTaskKind) => TASK_KIND_LABEL[k];
