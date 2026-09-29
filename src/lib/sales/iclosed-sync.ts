import { getSettings, newId, readDB, saveSettings, writeDB } from "@/lib/db";
import { fetchUpcoming, getIclosedKey, type IclosedCall } from "@/lib/iclosed";
import { findByIclosedId, fromIclosedCall, resolveCloser } from "./iclosed-link";
import { memberRoles } from "./roles";
import { createAppointment, upsertLead, type AppointmentInput } from "./repo";
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
const SYSTEM: Session = { role: "owner", roles: [], memberId: "", memberName: "iClosed", isAdmin: true };

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

function pickCloser(db: DB, call: IclosedCall): string {
  const mapped = resolveCloser(db, call);
  if (mapped && active(mapped)) return mapped.id;
  const s = db.settings;
  const def = db.team.find((m) => m.id === s.salesDefaultCloserId);
  if (def && active(def)) return def.id;
  const me = db.team.find((m) => m.id === s.salesOwnerMemberId);
  if (me && active(me) && memberRoles(me).includes("closer")) return me.id;
  const closers = db.team.filter((m) => active(m) && memberRoles(m).includes("closer"));
  return closers.length === 1 ? closers[0].id : "";
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
    status: "booked",
    qualified: false,
    setterNotes: input.setterNotes ?? "",
    closerNotes: "",
    lostReason: "",
    iclosedUrl: input.iclosedUrl ?? "",
    iclosedEventId: input.iclosedEventId ?? "",
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
        if (!input.igUsername) input.igUsername = known?.igUsername || (input.email || input.name || `iclosed-${call.id}`).split("@")[0];
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
