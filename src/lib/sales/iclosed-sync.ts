import { getSettings, newId, readDB, saveSettings, writeDB } from "@/lib/db";
import { fetchCalls, fetchUpcoming, getIclosedKey, type IclosedCall } from "@/lib/iclosed";
import { dealAmount, findByIclosedId, fromIclosedCall, mapLostReason, mapOutcome, resolveCloser, utmRecord } from "./iclosed-link";
import { FINAL_STATUSES } from "./constants";
import { memberRoles } from "./roles";
import { defaultCloserId } from "./closers";
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
  return setterFromUtmValues(db, (call.utm ?? []).map((u) => u.utmValue ?? ""));
}

/** Meme regle, a partir des valeurs utm deja normalisees d'un rendez-vous en base (`Appointment.utm`). */
export function setterFromUtmValues(db: DB, raw: string[]): string {
  const values = raw.map((v) => norm(v)).filter(Boolean);
  if (!values.length) return "";
  const firstName = (name: string) => (name.trim().toLowerCase().split(/\s+/)[0] ?? "").replace(/[^a-z0-9]/g, "");
  for (const m of db.team) {
    if (!active(m) || !memberRoles(m).includes("setter")) continue;
    const keys = [m.username, m.id, m.name].filter(Boolean).map((k) => norm(String(k)));
    if (values.some((v) => keys.includes(v))) return m.id;
  }
  // Signature par prenom (lien de l'admin : utm_content=mady), seulement s'il est unique.
  for (const v of values) {
    const same = db.team.filter((m) => active(m) && memberRoles(m).includes("setter") && firstName(m.name) === v.replace(/[^a-z0-9]/g, ""));
    if (same.length === 1) return same[0].id;
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

/**
 * Setter d'un call iClosed sans signature dans le lien.
 *
 * Regle du 2026-10-27 : un setter ne recoit QUE les reservations faites par
 * son lien signe (`utm_source=setter&utm_content=<lui>`), ou par un lead a
 * qui il a declare avoir envoye son lien. Tout le reste va au compte du
 * proprietaire (Mady) s'il est setter, sinon reste sans setter. Le « setter
 * par defaut » des reglages ne sert plus a la synchro : il mettait sur
 * l'agenda du setter des calls qu'il n'avait pas apportes.
 */
function ownerSetter(db: DB): string {
  const me = db.team.find((m) => m.id === db.settings.salesOwnerMemberId);
  return me && active(me) && memberRoles(me).includes("setter") ? me.id : "";
}

/** Setter d'un lead qui a declare « j'ai envoye mon lien » a ce prospect ; vide sinon. */
function declaredSetter(lead: DB["leads"][number] | undefined): string {
  return lead?.setterId && lead.declaredAt ? lead.setterId : "";
}

/**
 * Une seule fois : les rendez-vous iClosed attribues a un setter par le
 * « setter par defaut » des reglages, sans que le lien soit le sien,
 * repassent au proprietaire, calls passes compris (les closes d'autres
 * prospects n'ont rien a faire dans son CRM ni dans ses commissions). Une
 * attribution posee a la main par l'admin (journal « attribue comme
 * setter ») est respectee.
 */
export function applySetterByLinkOnly(db: DB): number {
  const now = new Date().toISOString();
  const owner = ownerSetter(db);
  const manual = new Set(db.activityLogs.filter((l) => l.action === "appointment.assigned" && /attribué comme setter/.test(l.summary)).map((l) => l.entityId));
  /** Le setter dont le lien est signe dans les utm du rendez-vous ("" si aucune signature). */
  const signedOf = (a: Appointment) => setterFromUtmValues(db, Object.values(a.utm ?? {}));
  let n = 0;
  /*
   * Regle (v3, 2026-10-27 soir) : un setter ne perd un call QUE si le lien
   * de reservation porte la signature de quelqu'un d'autre (un autre setter,
   * ou le lien signe de Mady). Sans signature du tout, iClosed n'a pas garde
   * l'information : on ne retire rien. Les deux premieres passes retiraient
   * trop (calls importes sans utm, ou avec seulement un referent) : Johanna
   * et Yacine ont disparu de l'espace de Jora. On les rend ici.
   */
  if (!db.settings.salesSetterByLinkOnlyAt) {
    for (const a of db.appointments) {
      if (!a.iclosedEventId || manual.has(a.id)) continue;
      if (!a.setterId || a.setterId === owner) continue;
      const signed = signedOf(a);
      if (!signed || signed === a.setterId) continue;
      const fromName = db.team.find((m) => m.id === a.setterId)?.name ?? a.setterId;
      a.setterId = signed;
      a.history = [...(a.history ?? []), { at: now, actorId: "", actorName: "Système", from: a.status, to: a.status, note: `Setter retiré (${fromName}) : la réservation ne vient pas de son lien signé` }];
      a.updatedAt = now;
      n++;
    }
    db.settings.salesSetterByLinkOnlyAt = now;
    db.settings.salesSetterByLinkOnlyV2At = now;
    db.settings.salesSetterByLinkOnlyV3At = now;
    if (n) db.activityLogs.unshift({ id: newId(), at: now, actorId: "", actorName: "Système", action: "appointment.updated", entity: "appointment", entityId: "", summary: `Rendez-vous iClosed : ${n} call${n > 1 ? "s" : ""} retiré${n > 1 ? "s" : ""} de l'agenda d'un setter (réservation faite par le lien signé de quelqu'un d'autre)` });
    writeDB(db);
    return n;
  }
  if (!db.settings.salesSetterByLinkOnlyV3At) {
    for (const a of db.appointments) {
      if (!a.iclosedEventId) continue;
      const note = [...(a.history ?? [])].reverse().find((h) => h.note?.startsWith("Setter retiré ("));
      if (!note) continue;
      const name = note.note!.slice("Setter retiré (".length, note.note!.indexOf(")"));
      const member = db.team.find((m) => m.name === name);
      if (!member || a.setterId === member.id) continue;
      // Le lien porte la signature de quelqu'un d'autre : le retrait etait juste.
      const signed = signedOf(a);
      if (signed && signed !== member.id) continue;
      a.setterId = member.id;
      a.history = [...(a.history ?? []), { at: now, actorId: "", actorName: "Système", from: a.status, to: a.status, note: `Setter rendu à ${member.name} : aucun lien signé par quelqu'un d'autre sur cette réservation` }];
      a.updatedAt = now;
      n++;
    }
    db.settings.salesSetterByLinkOnlyV2At = db.settings.salesSetterByLinkOnlyV2At || now;
    db.settings.salesSetterByLinkOnlyV3At = now;
    if (n) db.activityLogs.unshift({ id: newId(), at: now, actorId: "", actorName: "Système", action: "appointment.updated", entity: "appointment", entityId: "", summary: `Rendez-vous iClosed : ${n} call${n > 1 ? "s" : ""} rendu${n > 1 ? "s" : ""} à leur setter (aucune signature d'un autre lien)` });
    writeDB(db);
  }
  return n;
}

/**
 * Un call iClosed relu (a venir ou passe) : on complete les utm du
 * rendez-vous s'ils manquent, et si le lien porte la signature d'un setter
 * alors que le rendez-vous n'en a pas (ou a le proprietaire par defaut), on
 * le lui rattache. Jamais sur une attribution posee a la main par l'admin.
 * Renvoie vrai si quelque chose a change.
 */
function promoteSignedSetter(db: DB, appt: Appointment, call: IclosedCall): boolean {
  let touched = false;
  const utm = utmRecord(call);
  if (utm && (!appt.utm || Object.keys(utm).some((k) => !(k in appt.utm!)))) {
    appt.utm = { ...(appt.utm ?? {}), ...utm };
    touched = true;
  }
  const signed = setterFromUtm(db, call);
  if (!signed || appt.setterId === signed) return touched;
  if (appt.setterId && appt.setterId !== ownerSetter(db)) return touched;
  const manual = db.activityLogs.some((l) => l.action === "appointment.assigned" && l.entityId === appt.id && /attribué comme setter/.test(l.summary));
  if (manual) return touched;
  const name = db.team.find((m) => m.id === signed)?.name ?? "un setter";
  appt.setterId = signed;
  appt.history = [...(appt.history ?? []), { at: new Date().toISOString(), actorId: "", actorName: "iClosed", from: appt.status, to: appt.status, note: `Rattaché à ${name} : réservation faite par son lien signé` }];
  return true;
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
  return defaultCloserId(db);
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
  return appointment.id;
}

/**
 * Un call iClosed jamais vu entre dans le CRM : son lead (cree s'il est
 * inconnu, par pseudo, email, telephone ou nom), son rendez-vous, son
 * setter (signature du lien, lead declare, reglages) et son closer. Sert
 * aux calls a venir comme aux calls passes rattrapes par la synchro des
 * issues. Renvoie l'identifiant du rendez-vous, vide si le call est
 * inexploitable.
 */
function createFromCall(db: DB, call: IclosedCall, report: { created: number; unassignedSetter: number; unassignedCloser: number }): string {
  const known = matchLead(db, call);
  const setterId = setterFromUtm(db, call) || declaredSetter(known) || ownerSetter(db);
  const closerId = pickCloser(db, call);
  const input = fromIclosedCall(call, { setterId, closerId });
  if (!input) return "";
  if (known) input.leadId = known.id;
  // Jamais de pseudo invente (debut d'email, nom…) : s'il n'est pas dans
  // le questionnaire ni sur un lead connu, il reste vide et se saisit
  // a la main sur la fiche.
  if (!input.igUsername) input.igUsername = known?.igUsername || "";
  let id: string;
  if (setterId) {
    id = createAppointment(SYSTEM, input).appointment.id;
  } else {
    id = createUnassigned(db, input, closerId);
    writeDB(db);
    report.unassignedSetter += 1;
  }
  if (!closerId) report.unassignedCloser += 1;
  report.created += 1;
  return id;
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

      applySetterByLinkOnly(readDB());
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
          if (promoteSignedSetter(db, existing, call)) touched = true;
          if (!existing.setterId) {
            const setterId = declaredSetter(db.leads.find((l) => l.id === existing.leadId)) || ownerSetter(db);
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

        createFromCall(db, call, report);
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
        // iClosed ne distingue pas contrat et cash encaisse, ni une fois de
        // plusieurs fois : le contrat compte tout de suite dans le chiffre
        // d'affaires, le cash attend que le closer precise (un clic sur le CRM).
        cashCollected: 0,
        currency: readDB().settings.salesCurrency || "EUR",
        paymentType: "other",
        installments: 0,
        paymentMethod: "",
        soldAt: new Date(call.dateTimeUTC).toISOString(),
        notes: "Importé depuis iClosed — paiement à préciser",
        paymentUnspecified: true,
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
/** Fenetre des calls passes relus : assez large pour rattraper un call jamais importe (reserve pendant une coupure, avant la synchro…). */
const OUTCOME_WINDOW_MS = 60 * 86_400_000;

export interface IclosedOutcomeReport {
  skipped: "no-key" | "off" | "cooldown" | null;
  examined: number;
  applied: number;
  /** Calls passes jamais importes, entres dans le CRM avec leur lead (meme no-show). */
  created: number;
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
  const none = (skipped: IclosedOutcomeReport["skipped"]): IclosedOutcomeReport => ({ skipped, examined: 0, applied: 0, created: 0, salesCreated: 0, salesWithoutAmount: [] });
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

      const calls = await fetchCalls("PAST", 4, 50);
      const report = none(null);
      const since = Date.now() - OUTCOME_WINDOW_MS;
      const scratch = { created: 0, unassignedSetter: 0, unassignedCloser: 0 };
      for (const call of calls) {
        if (!call.dateTimeUTC || Date.parse(call.dateTimeUTC) < since) continue;
        report.examined += 1;
        let db = readDB();
        // Supprime a la main par l'admin : on ne le fait pas revenir.
        if ((db.settings.salesDeletedIclosedEventIds ?? []).includes(String(call.id))) continue;
        let appt = findByIclosedId(db, String(call.id));
        if (!appt) {
          /*
           * Call passe jamais importe : il entre dans le CRM avec son lead,
           * quelle que soit son issue (show, no-show, rien). Le contact est
           * alors dans les leads, relancable, et le call compte dans les
           * chiffres une fois statue.
           */
          if (!createFromCall(db, call, scratch)) continue;
          report.created += 1;
          db = readDB();
          appt = findByIclosedId(db, String(call.id));
          if (!appt) continue;
        }
        // Les utm et la signature du setter se completent aussi sur les calls passes
        // (un call importe avant la lecture des utm, ou statue avant que le setter soit connu).
        if (promoteSignedSetter(db, appt, call)) {
          appt.updatedAt = new Date().toISOString();
          writeDB(db);
        }
        if (FINAL_STATUSES.includes(appt.status)) continue;
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
