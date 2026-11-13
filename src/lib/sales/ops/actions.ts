/**
 * Actions du cockpit : terminer, reporter, annoter une tache ; marquer un
 * contact ; changer le statut, le responsable, la temperature d'un lead ;
 * confirmer, reprogrammer un call ; suivre un paiement.
 *
 * Regles :
 *  - les droits sont verifies ICI, cote serveur ;
 *  - ouvrir Instagram ne vaut pas contact : seul « c'est fait » (confirme par
 *    le membre) pose le contact et ferme la tache ;
 *  - un « j'ai payé » du prospect n'est jamais un encaissement : il cree une
 *    verification pour l'admin, qui seul enregistre l'argent ;
 *  - chaque action passe dans le journal, puis la file est realignee.
 */
import { newId, readDB, writeDB } from "../../db";
import type { DB, FollowUpHeat, Lead, NoShowState, PaymentFollowState, SalesTask, Session, SettingStatus } from "../../types";
import { Forbidden } from "../access";
import { followUpNoReply, patchAppointment, updateFollowUp } from "../repo";
import { runOps } from "./run";
import { SETTING_LABEL } from "./views";
import { PAYMENT_FOLLOW_LABEL } from "./engine";

const SETTING_STATUSES = Object.keys(SETTING_LABEL) as SettingStatus[];
const HEATS: FollowUpHeat[] = ["hot", "warm", "cold"];
const PAY_STATES: PaymentFollowState[] = ["promised", "link-sent", "awaiting-verification", "failed", "abandoned"];
const NOSHOW_STATES: NoShowState[] = ["to-recover", "contacted", "awaiting", "lost", "dnc"];

function log(db: DB, session: Session, entity: "lead" | "task" | "appointment" | "sale" | "report", entityId: string, action: string, summary: string) {
  db.activityLogs.unshift({ id: newId(), at: new Date().toISOString(), actorId: session.memberId, actorName: session.memberName || "Moi", action, entity, entityId, summary });
  if (db.activityLogs.length > 5000) db.activityLogs.length = 5000;
}

const isManager = (s: Session) => s.isAdmin || Boolean(s.salesHead);

/** Le membre peut-il agir sur ce lead ? Responsable, setter d'origine, Head of Setting, admin. */
function canActOnLead(session: Session, lead: Lead): boolean {
  return isManager(session) || lead.ownerId === session.memberId || lead.setterId === session.memberId || lead.declaredBy === session.memberId;
}

function getLead(db: DB, session: Session, leadId: string): Lead {
  const lead = db.leads.find((l) => l.id === leadId);
  if (!lead) throw new Error("Lead introuvable.");
  if (!canActOnLead(session, lead)) throw new Forbidden("Ce lead n'est pas dans ton périmètre.");
  return lead;
}

function getTask(db: DB, session: Session, taskId: string, expectedUpdatedAt?: string): SalesTask {
  const t = (db.salesTasks ?? []).find((x) => x.id === taskId);
  if (!t) throw new Error("Tâche introuvable (déjà traitée ?). Recharge la page.");
  const adminTask = t.kind === "payment-verify" || t.kind === "outcome-missing";
  if (adminTask && !session.isAdmin && t.ownerId !== session.memberId) throw new Forbidden("Cette tâche revient au closer ou à l'admin.");
  if (!isManager(session) && t.ownerId !== session.memberId) throw new Forbidden("Cette tâche ne t'est pas attribuée.");
  // Modification concurrente : quelqu'un d'autre (ou le moteur) a change la tache entre-temps.
  if (expectedUpdatedAt && t.updatedAt !== expectedUpdatedAt && t.status !== "open") {
    throw new Error(`Cette tâche a déjà été ${t.status === "done" ? "terminée" : "close"} (${t.closedReason ?? "mise à jour"}). Recharge la page.`);
  }
  if (t.status !== "open") throw new Error(`Cette tâche est déjà close : ${t.closedReason ?? "terminée"}.`);
  return t;
}

/** Contact effectif avec le prospect, confirme par le membre. */
function markContacted(db: DB, session: Session, lead: Lead, note = "", channel = "") {
  const now = new Date().toISOString();
  lead.lastContactAt = now;
  lead.firstContactAt ??= now;
  lead.lastSetterActionAt = now;
  if (!lead.settingStatus || lead.settingStatus === "to-contact") lead.settingStatus = "contacted";
  log(db, session, "lead", lead.id, "lead.contacted", `${session.memberName || "Moi"} a contacté ${lead.name}${channel ? ` (${channel})` : ""}${note ? ` : ${note}` : ""}`);
}

const finish = (db: DB) => {
  writeDB(db);
  runOps();
};

/* --------------------------------- Taches --------------------------------- */

export interface TaskDoneInput {
  taskId: string;
  expectedUpdatedAt?: string;
  /** Issue choisie par le membre, selon le type de tache. */
  outcome?: string;
  note?: string;
  channel?: string;
  /** Paiement promis : date (AAAA-MM-JJ) annoncee par le prospect. */
  at?: string;
}

/**
 * Termine une tache, avec l'issue qui fait avancer le lead :
 *  - contact (premier contact, relance, rappel, reactivation) : contact pose ;
 *  - confirmation : « confirmed » (le prospect a dit oui), « sent » (message
 *    envoye, en attente), « no-answer » ;
 *  - no-show : « no-reply » (tentative faite), « replied » (il a repondu),
 *    « lost » ;
 *  - relance apres call : « no-reply » (sequence J+1 / J+3 existante),
 *    « done » (il a repondu, relance faite) ;
 *  - paiement : nouvel etat du suivi (promis, lien envoye, a verifier…).
 */
export function completeTask(session: Session, input: TaskDoneInput) {
  let db = readDB();
  const t = getTask(db, session, input.taskId, input.expectedUpdatedAt);
  const lead = db.leads.find((l) => l.id === t.leadId);
  const note = (input.note ?? "").trim().slice(0, 1000);
  const outcome = input.outcome ?? "";
  let reason = `Fait par ${session.memberName || "l'admin"}`;

  switch (t.kind) {
    case "first-contact":
    case "setting-nudge":
    case "callback":
    case "planned":
    case "nurture": {
      if (!lead) break;
      markContacted(db, session, lead, note, input.channel);
      if (t.kind === "callback") {
        lead.followUpAt = "";
        if (lead.callStatus === "callback") lead.callbackAt = "";
      }
      if (t.kind === "nurture") lead.settingStatus = "conversation";
      if (t.kind === "planned") lead.nextActionAt = "";
      if (outcome === "replied" && lead.settingStatus === "contacted") lead.settingStatus = "conversation";
      if (outcome === "no-reply") lead.settingStatus = "awaiting-reply";
      break;
    }
    case "confirm-booking":
    case "confirm-j1":
    case "confirm-h3": {
      if (!t.appointmentId) break;
      const confirmation = outcome === "confirmed" ? "confirmed" : outcome === "no-answer" ? "no-answer" : "awaiting";
      writeDB(db);
      patchAppointment(session, t.appointmentId, { confirmation });
      db = readDB();
      if (lead) markContacted(db, session, lead, note, input.channel);
      reason = confirmation === "confirmed" ? "Confirmé par le prospect" : confirmation === "no-answer" ? "Prospect injoignable" : "Message de confirmation envoyé";
      break;
    }
    case "no-show": {
      const appt = db.appointments.find((a) => a.id === t.appointmentId);
      if (!appt) break;
      const now = new Date().toISOString();
      appt.noShow ??= { state: "to-recover", attempts: 0, lastAttemptAt: "", at: appt.updatedAt };
      appt.noShow.attempts += 1;
      appt.noShow.lastAttemptAt = now;
      appt.noShow.state = outcome === "lost" ? "lost" : outcome === "replied" ? "awaiting" : "contacted";
      if (lead) markContacted(db, session, lead, note, input.channel);
      log(db, session, "appointment", appt.id, "noshow.attempt", `No-show de ${lead?.name ?? "un lead"} : tentative ${appt.noShow.attempts} (${outcome === "replied" ? "il a répondu" : outcome === "lost" ? "classé perdu" : "pas de réponse"})`);
      break;
    }
    case "followup": {
      if (!t.followUpId) break;
      writeDB(db);
      if (outcome === "no-reply") {
        const r = followUpNoReply(session, t.followUpId);
        reason = r.cold ? "Sans réponse : lead froid" : "Sans réponse : dernière relance programmée";
      } else {
        updateFollowUp(session, t.followUpId, { status: "done", note: note || "Relance faite", contact: true });
        reason = "Relance faite";
      }
      db = readDB();
      if (lead) {
        lead.lastContactAt = new Date().toISOString();
        lead.firstContactAt ??= lead.lastContactAt;
      }
      break;
    }
    case "payment": {
      const sale = db.sales.find((s) => s.id === t.saleId);
      if (!sale) break;
      const state = PAY_STATES.includes(outcome as PaymentFollowState) ? (outcome as PaymentFollowState) : (sale.paymentFollow?.state ?? "promised");
      const now = new Date().toISOString();
      const promisedFor = /^\d{4}-\d{2}-\d{2}$/.test(input.at ?? "") ? input.at : undefined;
      sale.paymentFollow = { state, note: note || sale.paymentFollow?.note || "", at: now, by: session.memberId, lastReminderAt: now, ...(promisedFor ? { promisedFor } : {}) };
      log(db, session, "sale", sale.id, "payment.follow", `Paiement de ${lead?.name ?? "un client"} : ${PAYMENT_FOLLOW_LABEL[state]}${note ? ` — ${note}` : ""}`);
      if (lead) markContacted(db, session, lead, "", input.channel);
      reason = `Relance faite : ${PAYMENT_FOLLOW_LABEL[state]}`;
      break;
    }
    case "admin-task": {
      const st = (db.setterTasks ?? []).find((x) => x.id === t.setterTaskId);
      if (st) {
        st.status = "done";
        st.doneAt = new Date().toISOString();
      }
      if (lead) markContacted(db, session, lead, note, input.channel);
      break;
    }
    case "outcome-missing":
    case "payment-verify":
      throw new Error(t.kind === "outcome-missing" ? "Renseigne le résultat depuis la fiche du call : la tâche se ferme toute seule." : "Enregistre l'encaissement (ou marque le paiement échoué) depuis la fiche de la vente : la tâche se ferme toute seule.");
  }

  // La tache peut avoir deja ete close par la relecture : on la relit dans la base courante.
  const task = (db.salesTasks ?? []).find((x) => x.id === t.id);
  if (task && task.status === "open") {
    const now = new Date().toISOString();
    task.status = "done";
    task.doneAt = now;
    task.doneBy = session.memberId;
    task.closedReason = reason;
    task.updatedAt = now;
    if (note) (task.notes ??= []).push({ at: now, by: session.memberName || "Moi", text: note });
    log(db, session, "task", task.id, "task.done", `${task.title} — ${reason}${note ? ` : ${note}` : ""}`);
  }
  finish(db);
  return { ok: true, reason };
}

/** Reporte une tache. Pour une relance apres call, c'est la relance elle-meme qui bouge. */
export function snoozeTask(session: Session, input: { taskId: string; until: string; note?: string; expectedUpdatedAt?: string }) {
  const db = readDB();
  const t = getTask(db, session, input.taskId, input.expectedUpdatedAt);
  const until = new Date(input.until);
  if (Number.isNaN(until.getTime())) throw new Error("Date de report invalide.");
  const iso = until.toISOString();
  const lead = db.leads.find((l) => l.id === t.leadId);
  if (t.kind === "followup" && t.followUpId) {
    writeDB(db);
    updateFollowUp(session, t.followUpId, { dueAt: iso, note: input.note });
    runOps();
    return { ok: true };
  }
  if (t.kind === "nurture" && lead) {
    lead.nurtureUntil = iso.slice(0, 10);
  } else if (t.kind === "planned" && lead) {
    lead.nextActionAt = iso;
  } else {
    t.dueAt = iso;
    t.snoozed = true;
  }
  const now = new Date().toISOString();
  t.updatedAt = now;
  if (input.note?.trim()) (t.notes ??= []).push({ at: now, by: session.memberName || "Moi", text: input.note.trim().slice(0, 500) });
  log(db, session, "task", t.id, "task.snoozed", `${t.title} reportée au ${new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }).format(until)}${input.note ? ` : ${input.note}` : ""}`);
  finish(db);
  return { ok: true };
}

export function noteTask(session: Session, input: { taskId: string; text: string }) {
  const db = readDB();
  const t = getTask(db, session, input.taskId);
  const text = input.text.trim().slice(0, 1000);
  if (!text) throw new Error("Note vide.");
  const now = new Date().toISOString();
  (t.notes ??= []).push({ at: now, by: session.memberName || "Moi", text });
  t.updatedAt = now;
  const lead = db.leads.find((l) => l.id === t.leadId);
  if (lead) lead.notes = [lead.notes, `${now.slice(0, 10)} — ${text}`].filter(Boolean).join("\n").slice(-8000);
  log(db, session, "lead", t.leadId, "lead.note", `Note : ${text}`);
  writeDB(db);
  return { ok: true };
}

/* ---------------------------------- Leads --------------------------------- */

export interface LeadActionInput {
  leadId: string;
  op: "contacted" | "status" | "owner" | "heat" | "nurture" | "next" | "dnc" | "tags" | "reactivate";
  settingStatus?: string;
  reason?: string;
  ownerId?: string;
  heat?: string;
  until?: string;
  text?: string;
  at?: string;
  tags?: string[];
  channel?: string;
  note?: string;
  value?: boolean;
}

export function leadAction(session: Session, input: LeadActionInput) {
  const db = readDB();
  const lead = getLead(db, session, input.leadId);
  const now = new Date().toISOString();
  const who = session.memberName || "Moi";

  switch (input.op) {
    case "contacted":
      markContacted(db, session, lead, (input.note ?? "").trim().slice(0, 500), input.channel);
      break;
    case "status": {
      const st = input.settingStatus as SettingStatus;
      if (!SETTING_STATUSES.includes(st)) throw new Error("Statut inconnu.");
      lead.settingStatus = st;
      lead.lastSetterActionAt = now;
      if (st === "dnc") {
        lead.doNotContact = true;
        lead.doNotContactAt = now;
      }
      if (st === "lost" || st === "not-qualified") lead.lostReason = (input.reason ?? "").trim().slice(0, 300);
      if (st === "nurturing" && !lead.nurtureUntil) lead.nurtureUntil = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
      log(db, session, "lead", lead.id, "lead.status", `${who} : ${lead.name} → ${SETTING_LABEL[st]}${input.reason ? ` (${input.reason})` : ""}`);
      break;
    }
    case "owner": {
      if (!isManager(session)) throw new Forbidden("Le transfert d'un lead revient au Head of Setting ou à l'admin.");
      const target = db.team.find((m) => m.id === input.ownerId && m.status !== "inactif");
      if (!target) throw new Error("Membre introuvable ou inactif.");
      const before = lead.ownerId ? (db.team.find((m) => m.id === lead.ownerId)?.name ?? "—") : "personne";
      lead.ownerId = target.id;
      lead.ownerAssignedAt = now;
      // Les relances en cours suivent, les taches ouvertes aussi (au prochain passage du moteur).
      for (const f of db.followUps) if (f.leadId === lead.id && f.status === "pending") f.ownerId = target.id;
      log(db, session, "lead", lead.id, "lead.transferred", `${lead.name} transféré de ${before} à ${target.name} par ${who}${input.reason ? ` : ${input.reason}` : ""}`);
      break;
    }
    case "heat": {
      if (input.heat && !HEATS.includes(input.heat as FollowUpHeat)) throw new Error("Température inconnue.");
      if (input.heat) lead.heat = input.heat as FollowUpHeat;
      else delete lead.heat;
      log(db, session, "lead", lead.id, "lead.updated", `${lead.name} : température ${input.heat || "retirée"}`);
      break;
    }
    case "nurture": {
      const day = (input.until ?? "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("Indique la date de reprise.");
      lead.settingStatus = "nurturing";
      lead.nurtureUntil = day;
      lead.nurtureReason = (input.reason ?? "").trim().slice(0, 300);
      lead.lastSetterActionAt = now;
      log(db, session, "lead", lead.id, "lead.nurture", `${lead.name} en nurturing jusqu'au ${day}${lead.nurtureReason ? ` : ${lead.nurtureReason}` : ""}`);
      break;
    }
    case "reactivate": {
      // Ancien prospect remis dans le circuit : une tache de reactivation aujourd'hui.
      lead.settingStatus = "nurturing";
      lead.nurtureUntil = now.slice(0, 10);
      lead.nurtureReason = (input.reason ?? "Ancien prospect à réactiver").trim().slice(0, 300);
      lead.ownerId ||= session.memberId || lead.ownerId;
      lead.ownerAssignedAt = now;
      log(db, session, "lead", lead.id, "lead.nurture", `${lead.name} remis en réactivation par ${who}`);
      break;
    }
    case "next": {
      const at = new Date(input.at ?? "");
      if (Number.isNaN(at.getTime())) throw new Error("Date de la prochaine action invalide.");
      lead.nextAction = (input.text ?? "").trim().slice(0, 200) || "Recontacter";
      lead.nextActionAt = at.toISOString();
      log(db, session, "lead", lead.id, "lead.next", `Prochaine action pour ${lead.name} : ${lead.nextAction}`);
      break;
    }
    case "dnc": {
      lead.doNotContact = input.value !== false;
      lead.doNotContactAt = lead.doNotContact ? now : "";
      if (lead.doNotContact) lead.settingStatus = "dnc";
      else if (lead.settingStatus === "dnc") lead.settingStatus = "conversation";
      log(db, session, "lead", lead.id, "lead.dnc", lead.doNotContact ? `${lead.name} ne veut plus être contacté : plus aucune sollicitation` : `${lead.name} à nouveau contactable`);
      break;
    }
    case "tags":
      lead.tags = (input.tags ?? []).map((t) => String(t).trim().slice(0, 30)).filter(Boolean).slice(0, 12);
      break;
  }
  finish(db);
  return { ok: true, lead };
}

/* ------------------------------- Rendez-vous ------------------------------ */

export function appointmentAction(session: Session, input: { appointmentId: string; op: "confirm" | "reschedule" | "no-show" | "noshow-state"; confirmation?: string; at?: string; state?: string }) {
  const db = readDB();
  const appt = db.appointments.find((a) => a.id === input.appointmentId);
  if (!appt) throw new Error("Rendez-vous introuvable.");
  const lead = db.leads.find((l) => l.id === appt.leadId);
  if (!lead || !canActOnLead(session, lead)) throw new Forbidden("Ce rendez-vous n'est pas dans ton périmètre.");

  if (input.op === "confirm") {
    const c = input.confirmation;
    if (c !== "confirmed" && c !== "awaiting" && c !== "no-answer" && c !== "") throw new Error("Confirmation inconnue.");
    patchAppointment(session, appt.id, { confirmation: c });
  } else if (input.op === "reschedule") {
    const at = new Date(input.at ?? "");
    if (Number.isNaN(at.getTime())) throw new Error("Nouvelle date invalide.");
    if (at.getTime() < Date.now() - 5 * 60_000) throw new Error("La nouvelle date est dans le passé.");
    // Un call deplace repart sans confirmation : il faudra la reobtenir.
    patchAppointment(session, appt.id, { scheduledAt: at.toISOString(), confirmation: "" });
    const fresh = readDB();
    const a = fresh.appointments.find((x) => x.id === appt.id);
    if (a?.noShow) a.noShow.state = "rescheduled";
    writeDB(fresh);
  } else if (input.op === "no-show") {
    // Le Head of Setting constate l'absence ; le resultat d'un call honore reste au closer.
    if (!isManager(session) && appt.closerId !== session.memberId) throw new Forbidden("Seuls le closer, le Head of Setting ou l'admin notent un no-show.");
    if (!["booked", "confirmed", "rescheduled"].includes(appt.status)) throw new Error("Ce call a déjà un résultat.");
    if (Date.parse(appt.scheduledAt) > Date.now()) throw new Error("Le call n'a pas encore eu lieu.");
    const now = new Date().toISOString();
    appt.history = [...(appt.history ?? []), { at: now, actorId: session.memberId, actorName: session.memberName || "Moi", from: appt.status, to: "no-show", note: "Absent au call" }];
    appt.status = "no-show";
    appt.updatedAt = now;
    appt.completedAt ||= now;
    appt.noShow = { state: "to-recover", attempts: 0, lastAttemptAt: "", at: now };
    lead.stage = "call-fait";
    log(db, session, "appointment", appt.id, "appointment.status", `${session.memberName || "Moi"} a noté ${lead.name} absent au call`);
    writeDB(db);
  } else if (input.op === "noshow-state") {
    if (!NOSHOW_STATES.includes(input.state as NoShowState)) throw new Error("État inconnu.");
    appt.noShow ??= { state: "to-recover", attempts: 0, lastAttemptAt: "", at: appt.updatedAt };
    appt.noShow.state = input.state as NoShowState;
    if (input.state === "dnc") {
      lead.doNotContact = true;
      lead.doNotContactAt = new Date().toISOString();
      lead.settingStatus = "dnc";
    }
    log(db, session, "appointment", appt.id, "noshow.state", `No-show de ${lead.name} : ${input.state}`);
    writeDB(db);
  }
  runOps();
  return { ok: true };
}

/* -------------------------------- Paiements ------------------------------- */

/**
 * Suivi d'un paiement par l'equipe. Jamais d'encaissement ici : seuls
 * l'admin et le closer enregistrent l'argent (fiche de la vente).
 */
export function paymentFollowAction(session: Session, input: { saleId: string; state: string; note?: string }) {
  const db = readDB();
  const sale = db.sales.find((s) => s.id === input.saleId);
  if (!sale) throw new Error("Vente introuvable.");
  const lead = db.leads.find((l) => l.id === sale.leadId);
  if (!lead || !canActOnLead(session, lead)) throw new Forbidden("Cette vente n'est pas dans ton périmètre.");
  if (!PAY_STATES.includes(input.state as PaymentFollowState)) throw new Error("État de paiement inconnu.");
  if (input.state === "abandoned" && !session.isAdmin && !session.salesHead) throw new Forbidden("Abandonner un paiement revient au Head of Setting ou à l'admin.");
  const now = new Date().toISOString();
  sale.paymentFollow = { state: input.state as PaymentFollowState, note: (input.note ?? "").trim().slice(0, 500), at: now, by: session.memberId, lastReminderAt: sale.paymentFollow?.lastReminderAt };
  log(db, session, "sale", sale.id, "payment.follow", `Paiement de ${lead.name} : ${PAYMENT_FOLLOW_LABEL[sale.paymentFollow.state]}${sale.paymentFollow.note ? ` — ${sale.paymentFollow.note}` : ""}`);
  finish(db);
  return { ok: true };
}
