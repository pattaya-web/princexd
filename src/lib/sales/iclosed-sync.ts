import { getSettings, newId, readDB, saveSettings, writeDB } from "@/lib/db";
import { fetchCalls, fetchUpcoming, getIclosedKey, type IclosedCall } from "@/lib/iclosed";
import { dealAmount, findByIclosedId, fromIclosedCall, mapLostReason, mapOutcome, resolveCloser, utmRecord } from "./iclosed-link";
import { FINAL_STATUSES } from "./constants";
import { memberRoles } from "./roles";
import { createAppointment, recordOutcome, upsertLead, type AppointmentInput } from "./repo";
import { touchFromUtm, applyTouch } from "./attribution";
import type { Appointment, DB, Session, TeamMember } from "@/lib/types";

/**
 * Synchronisation automatique des rendez-vous iClosed a venir.
 *
 * Tourne des qu'une page qui affiche des calls est ouverte (agenda, accueil
 * d'un membre, rendez-vous), au plus une fois toutes les dix minutes, par
 * n'importe quel membre. Aucune option a activer, aucun reglage obligatoire :
 * un call iClosed doit apparaitre dans le tool sans que personne n'y pense.
 *
 * Trois regles :
 *  - elle ne fait que CREER (et completer un lien de visio ou un closer
 *    manquant). Les issues et montants restent decides dans le CRM ;
 *  - le setter est celui des reglages, sinon le compte du proprietaire s'il
 *    est setter, sinon le premier setter actif, sinon personne : le rendez-
 *    vous existe quand meme, il est simplement a attribuer ;
 *  - le closer vient de la correspondance hote iClosed → closer, sinon du
 *    closer par defaut, sinon du compte du proprietaire s'il est closer,
 *    sinon du seul closer actif s'il n'y en a qu'un.
 */

// iClosed limite a 200 requetes par heure ; une verification en coute une.
// Deux minutes entre deux verifications = 30 requetes par heure au pire.
const COOLDOWN_MS = 2 * 60_000;
export const ICLOSED_SESSION: Session = { role: "owner", roles: [], memberId: "", memberName: "iClosed", isAdmin: true };
const SYSTEM = ICLOSED_SESSION;

export interface IclosedSyncReport {
  skipped: "no-key" | "off" | "cooldown" | null;
  examined: number;
  created: number;
  updated: number;
  unassignedSetter: number;
  unassignedCloser: number;
}

let inflight: Promise<IclosedSyncReport> | null = null;

const active = (m: TeamMember) => m.status !== "inactif";

const norm = (s: string) => s.trim().toLowerCase().replace(/^@+/, "");
const digits = (s: string) => s.replace(/\D/g, "");

/**
 * Setter signe dans le lien de reservation.
 *
 * Chaque setter envoie le calendrier avec sa signature en parametre UTM
 * (`?utm_source=setter&utm_content=<identifiant>`), et iClosed la garde sur
 * la reservation. C'est l'attribution la plus sure : rien a declarer.
 */
function setterFromUtm(db: DB, call: IclosedCall): string {
  const values = (call.utm ?? []).map((u) => norm(u.utmValue ?? "")).filter(Boolean);
  if (!values.length) return "";
  for (const m of db.team) {
    if (!active(m) || !memberRoles(m).includes("setter")) continue;
    const keys = [m.username, m.id, m.name].filter(Boolean).map((k) => norm(String(k)));
    if (values.some((v) => keys.includes(v))) return m.id;
  }
  return "";
}

/**
 * Prospect declare par un setter (« j'ai envoye le lien a @pseudo »).
 *
 * On rapproche la reservation d'un lead existant par pseudo Instagram du
 * questionnaire, puis email, telephone, et enfin nom complet s'il est unique.
 * Le rendez-vous se rattache alors a ce lead, et au setter qui l'a declare.
 */
function matchLead(db: DB, call: IclosedCall): DB["leads"][number] | undefined {
  const ig = norm(
    (call.questions ?? []).find((q) => /instagram|pseudo|@/i.test(q.statement))?.answer?.match(/@?([A-Za-z0-9._]{2,30})/)?.[1] ?? "",
  );
  const email = (call.inviteeEmail ?? "").trim().toLowerCase();
  const phone = digits(call.phoneNumber ?? "");
  const name = norm(call.inviteeName ?? "");
  const byIg = ig ? db.leads.find((l) => norm(l.igUsername ?? l.handle ?? "") === ig) : undefined;
  if (byIg) return byIg;
  const byEmail = email ? db.leads.find((l) => (l.email ?? "").toLowerCase() === email) : undefined;
  if (byEmail) return byEmail;
  const byPhone = phone.length >= 8 ? db.leads.find((l) => l.phone && digits(l.phone).endsWith(phone.slice(-9))) : undefined;
  if (byPhone) return byPhone;
  if (name.length >= 5) {
    const same = db.leads.filter((l) => norm(l.name) === name);
    if (same.length === 1) return same[0];
  }
  return undefined;
}

function pickSetter(db: DB): string {
  const s = db.settings;
  const ok = (id?: string) => Boolean(id) && db.team.some((m) => m.id === id && active(m));
  if (ok(s.salesDefaultSetterId)) return s.salesDefaultSetterId;
  const me = db.team.find((m) => m.id === s.salesOwnerMemberId);
  if (me && active(me) && memberRoles(me).includes("setter")) return me.id;
  return db.team.find((m) => active(m) && memberRoles(m).includes("setter"))?.id ?? "";
}

/**
 * Closer d'un call iClosed, dans l'ordre : le membre relie a l'hote iClosed,
 * le closer par defaut des reglages (Rendez-vous → synchro), le compte du
 * proprietaire s'il close, sinon le premier closer actif. Un call sans
 * closer n'apparait sur le dashboard de personne : on en a rate un comme
 * ca, donc on ne renvoie jamais vide tant qu'il existe un closer actif.
 */
function pickCloser(db: DB, call: IclosedCall): string {
  const mapped = resolveCloser(db, call);
  if (mapped && active(mapped)) return mapped.id;
  const s = db.settings;
  const def = db.team.find((m) => m.id === s.salesDefaultCloserId);
  if (def && active(def)) return def.id;
  const me = db.team.find((m) => m.id === s.salesOwnerMemberId);
  if (me && active(me) && memberRoles(me).includes("closer")) return me.id;
  const closers = db.team.filter((m) => active(m) && memberRoles(m).includes("closer"));
  return closers[0]?.id ?? "";
}

/** Cree un rendez-vous sans setter : createAppointment l'exige, ici on l'accepte. */
function createUnassigned(db: DB, input: AppointmentInput, closerId: string) {
  const lead = upsertLead(db, { ...input, setterId: "", source: input.source });
  const now = new Date().toISOString();
  const appointment: Appointment = {
    id: newId(),
    leadId: lead.id,
    setterId: "",
    closerId,
    scheduledAt: input.scheduledAt,
    timezone: input.timezone,
    source: input.source,
    ...(input.utm ? { utm: input.utm } : {}),
    status: "booked",
    qualified: false,
    setterNotes: input.setterNotes ?? "",
    closerNotes: "",
    lostReason: "",
    iclosedUrl: input.iclosedUrl ?? "",
    iclosedEventId: input.iclosedEventId ?? "",
    ...(input.calendar ? { calendar: input.calendar } : {}),
    rescheduledFromId: "",
    completedAt: "",
    history: [{ at: now, actorId: "", actorName: "iClosed", from: "", to: "booked", note: "Synchro iClosed, setter à attribuer" }],
    createdBy: "",
    createdAt: now,
    updatedAt: now,
  };
  db.appointments.unshift(appointment);
  db.activityLogs.unshift({
    id: newId(),
    at: now,
    actorId: "",
    actorName: "iClosed",
    action: "appointment.created",
    entity: "appointment",
    entityId: appointment.id,
    summary: `Rendez-vous iClosed pour ${lead.name || lead.handle} — setter à attribuer`,
  });
}

export async function syncIclosedUpcoming(opts: { force?: boolean } = {}): Promise<IclosedSyncReport> {
  const none = (skipped: IclosedSyncReport["skipped"]): IclosedSyncReport => ({
    skipped,
    examined: 0,
    created: 0,
    updated: 0,
    unassignedSetter: 0,
    unassignedCloser: 0,
  });
  if (inflight) {
    const r = await inflight.catch(() => null);
    if (!opts.force && r) return r;
  }
  inflight = (async () => {
    try {
      if (!getIclosedKey()) return none("no-key");
      const settings = getSettings();
      if (settings.salesAutoImportOff) return none("off");
      const last = settings.salesLastSyncAt ? Date.parse(settings.salesLastSyncAt) : 0;
      if (!opts.force && Date.now() - last < COOLDOWN_MS) return none("cooldown");

      const calls = await fetchUpcoming();
      const report = none(null);
      report.examined = calls.length;

      for (const call of calls) {
        const db = readDB();
        // Supprime a la main par l'admin : on ne le fait pas revenir.
        if ((db.settings.salesDeletedIclosedEventIds ?? []).includes(String(call.id))) continue;
        const existing = findByIclosedId(db, String(call.id));
        if (existing) {
          // Complete sans ecraser : lien de visio apparu, closer trouve.
          const url = call.locationLinkInvitee || call.locationLink || "";
          const closerId = existing.closerId ? "" : pickCloser(db, call);
          let touched = false;
          if (url && existing.iclosedUrl !== url) {
            existing.iclosedUrl = url;
            touched = true;
          }
          // Source du lien : connue des la creation, mais les rendez-vous
          // importes avant cette evolution ne l'ont pas encore (ou sans les IDs Meta).
          const utm = utmRecord(call);
          if (utm && (!existing.utm || Object.keys(utm).some((k) => !(k in existing.utm!)))) {
            existing.utm = { ...(existing.utm ?? {}), ...utm };
            touched = true;
            // Les IDs Meta du lien completent la fiche du lead sans ecraser une attribution deja fiable.
            const lead = db.leads.find((l) => l.id === existing.leadId);
            if (lead) applyTouch(lead, touchFromUtm(utm, { hint: "iclosed", manualSource: "bio-link" }), existing.createdAt);
          }
          if (call.callType && !existing.calendar) {
            existing.calendar = call.callType;
            touched = true;
          }
          // Reprogramme cote iClosed : la nouvelle heure, avec trace.
          const when = call.dateTimeUTC ? new Date(call.dateTimeUTC).toISOString() : "";
          if (when && when !== existing.scheduledAt && !FINAL_STATUSES.includes(existing.status)) {
            const from = existing.scheduledAt;
            existing.history = [...(existing.history ?? []), { at: new Date().toISOString(), actorId: "", actorName: "iClosed", from: existing.status, to: "rescheduled", note: `Reprogrammé par iClosed : ${from} → ${when}` }];
            existing.status = "rescheduled";
            existing.scheduledAt = when;
            existing.confirmation = "";
            const lead = db.leads.find((l) => l.id === existing.leadId);
            if (lead) lead.callAt = when;
            db.activityLogs.unshift({ id: newId(), at: new Date().toISOString(), actorId: "", actorName: "iClosed", action: "appointment.rescheduled", entity: "appointment", entityId: existing.id, summary: `Rendez-vous reprogrammé par iClosed` });
            touched = true;
          }
          if (closerId) {
            existing.closerId = closerId;
            touched = true;
          }
          if (!existing.setterId) {
            const setterId = pickSetter(db);
            if (setterId) {
              existing.setterId = setterId;
              touched = true;
            }
          }
          if (touched) {
            existing.updatedAt = new Date().toISOString();
            writeDB(db);
            report.updated += 1;
          }
          continue;
        }

        /*
         * Qui a chauffe le prospect : la signature du lien d'abord, puis le
         * lead declare par un setter, puis les reglages.
         */
        const known = matchLead(db, call);
        const setterId = setterFromUtm(db, call) || known?.setterId || pickSetter(db);
        const closerId = pickCloser(db, call);
        const input = fromIclosedCall(call, { setterId, closerId });
        if (!input) continue;
        if (known) input.leadId = known.id;
        // Jamais de pseudo invente (debut d'email, nom…) : s'il n'est pas dans
        // le questionnaire ni sur un lead connu, il reste vide et se saisit
        // a la main sur la fiche.
        if (!input.igUsername) input.igUsername = known?.igUsername || "";
        if (setterId) {
          createAppointment(SYSTEM, input);
        } else {
          createUnassigned(db, input, closerId);
          writeDB(db);
          report.unassignedSetter += 1;
        }
        if (!closerId) report.unassignedCloser += 1;
        report.created += 1;
      }

      saveSettings({ salesLastSyncAt: new Date().toISOString() });
      return report;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/* ------------------------------ Les issues ------------------------------- */

/**
 * Reporte l'issue iClosed (task.outcome, deals, annulation) sur le rendez-
 * vous : SALE → close avec le montant du deal, NO_SALE → perdu avec le motif,
 * NO_SHOW, FOLLOW_UP, autre issue → honore. Une vente sans montant n'invente
 * pas de chiffre : le call est marque honore et signale a completer.
 */
export function applyIclosedOutcome(
  session: Session,
  appointmentId: string,
  call: IclosedCall,
  report: { salesCreated: number; salesWithoutAmount: string[] },
) {
  const status = mapOutcome(call);
  // Le cas le plus frequent : aucune issue saisie dans iClosed. On laisse le
  // rendez-vous tel quel plutot que d'inventer un resultat.
  if (!status || status === "rescheduled") return;
  if (status === "cancelled") {
    recordOutcome(session, appointmentId, { status: "cancelled", closerNotes: call.cancelReason ? `Annulé côté iClosed : ${call.cancelReason}` : undefined });
    return;
  }

  const notes = (call.task ?? []).map((t) => t.notes).filter(Boolean).join("\n");
  const amount = dealAmount(call);

  if (status === "closed-won") {
    if (amount <= 0) {
      report.salesWithoutAmount.push(call.inviteeName || String(call.id));
      recordOutcome(session, appointmentId, {
        status: "completed",
        closerNotes: [notes, "Vente signalée par iClosed sans montant — à compléter à la main."].filter(Boolean).join("\n"),
      });
      return;
    }
    recordOutcome(session, appointmentId, {
      status: "closed-won",
      closerNotes: notes,
      sale: {
        offer: call.callType?.replace(/_/g, " ").toLowerCase() || "Vente iClosed",
        contractValue: amount,
        // iClosed ne distingue pas contrat et cash encaisse : on prend le
        // montant du deal comme cash, quitte a le corriger dans la fiche.
        cashCollected: amount,
        currency: readDB().settings.salesCurrency || "EUR",
        paymentType: "paid-in-full",
        installments: 0,
        paymentMethod: "",
        soldAt: new Date(call.dateTimeUTC).toISOString(),
        notes: "Importé depuis iClosed",
      },
    });
    report.salesCreated += 1;
    return;
  }

  recordOutcome(session, appointmentId, {
    status,
    closerNotes: notes,
    ...(status === "closed-lost" ? { lostReason: mapLostReason(call) } : {}),
  });
}

const OUTCOME_COOLDOWN_MS = 15 * 60_000;
const OUTCOME_WINDOW_MS = 14 * 86_400_000;

export interface IclosedOutcomeReport {
  skipped: "no-key" | "off" | "cooldown" | null;
  examined: number;
  applied: number;
  salesCreated: number;
  salesWithoutAmount: string[];
}

let outcomesInflight: Promise<IclosedOutcomeReport> | null = null;

/**
 * Synchro automatique des ISSUES : les calls passes des deux dernieres
 * semaines sont relus (deux pages iClosed, deux requetes), et chaque
 * rendez-vous dont le CRM n'a pas encore tranche recoit l'issue saisie dans
 * iClosed (show, no-show, vente, perdu, follow-up, annulation). Une issue
 * posee a la main dans le CRM (statut final) n'est jamais ecrasee.
 */
export async function syncIclosedOutcomes(opts: { force?: boolean } = {}): Promise<IclosedOutcomeReport> {
  const none = (skipped: IclosedOutcomeReport["skipped"]): IclosedOutcomeReport => ({ skipped, examined: 0, applied: 0, salesCreated: 0, salesWithoutAmount: [] });
  if (outcomesInflight) {
    const r = await outcomesInflight.catch(() => null);
    if (!opts.force && r) return r;
  }
  outcomesInflight = (async () => {
    try {
      if (!getIclosedKey()) return none("no-key");
      const settings = getSettings();
      if (settings.salesAutoImportOff) return none("off");
      const last = settings.salesLastOutcomeSyncAt ? Date.parse(settings.salesLastOutcomeSyncAt) : 0;
      if (!opts.force && Date.now() - last < OUTCOME_COOLDOWN_MS) return none("cooldown");

      const calls = await fetchCalls("PAST", 2, 50);
      const report = none(null);
      const since = Date.now() - OUTCOME_WINDOW_MS;
      for (const call of calls) {
        if (!call.dateTimeUTC || Date.parse(call.dateTimeUTC) < since) continue;
        report.examined += 1;
        const db = readDB();
        const appt = findByIclosedId(db, String(call.id));
        if (!appt || FINAL_STATUSES.includes(appt.status)) continue;
        const status = mapOutcome(call);
        if (!status || status === "rescheduled" || status === appt.status) continue;
        applyIclosedOutcome(SYSTEM, appt.id, call, report);
        report.applied += 1;
      }
      saveSettings({ salesLastOutcomeSyncAt: new Date().toISOString() });
      return report;
    } finally {
      outcomesInflight = null;
    }
  })();
  return outcomesInflight;
}
