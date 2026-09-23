/**
 * Couche d'integration iClosed pour le module commercial.
 *
 * Volontairement isolee du reste : la logique CRM ne doit rien savoir de
 * iClosed, et iClosed ne doit rien savoir des commissions. Tout ce qui entre
 * par cette couche ressort sous la forme d'un `AppointmentInput` standard,
 * exactement comme une saisie manuelle.
 *
 * Ce que l'API iClosed expose reellement (verifie sur le compte connecte) :
 *
 *   user / userId        l'hote du call — c'est le CLOSER
 *   task[].outcome       SALE, NO_SALE, NO_SHOW, FOLLOW_UP…
 *   task[].noSaleReason  motif de perte (CONTACT_CANCELLED, etc.)
 *   deals[]              le montant de la vente
 *   utm[]                la source d'acquisition du lien de reservation
 *   questions[]          le questionnaire de qualification
 *
 * iClosed ne connait en revanche PAS le setter : il n'enregistre que le
 * booking, pas qui a chauffe le prospect en DM. L'attribution setter reste
 * donc une saisie du CRM, et c'est voulu.
 *
 * Trois portes d'entree possibles, toutes vers `fromIclosedCall` :
 *   - l'API      : `lib/iclosed.ts` (`fetchCalls`), deja authentifiee ;
 *   - le webhook : `/api/webhooks/iclosed` ;
 *   - Zapier/Make : n'importe quel POST au format `IclosedCall` partiel.
 *
 * Rien n'est simule : sans cle iClosed, aucune de ces portes ne produit de
 * donnee.
 */
import type { IclosedCall } from "../iclosed";
import { qualification } from "../iclosed";
import type {
  AppointmentSource,
  AppointmentStatus,
  DB,
  LostReason,
  TeamMember,
} from "../types";
import type { AppointmentInput } from "./repo";

/* ------------------------------ Le closer ------------------------------- */

/**
 * Closer correspondant a l'hote iClosed du call.
 *
 * La correspondance est explicite (`iclosedUserId` sur le membre) et jamais
 * devinee par le nom : deux personnes peuvent s'appeler pareil, et une
 * attribution fausse contamine directement les commissions.
 */
export function resolveCloser(db: DB, call: Partial<IclosedCall>): TeamMember | undefined {
  const hostId = call.user?.id ?? call.userId;
  if (hostId === undefined) return undefined;
  return db.team.find((m) => m.iclosedUserId === hostId);
}

/** Hotes distincts rencontres dans un lot de calls, pour l'ecran de mapping. */
export function distinctHosts(calls: Partial<IclosedCall>[]) {
  const map = new Map<number, { id: number; name: string; email: string; calls: number }>();
  for (const c of calls) {
    const u = c.user;
    const id = u?.id ?? c.userId;
    if (id === undefined) continue;
    const existing = map.get(id);
    if (existing) {
      existing.calls += 1;
      continue;
    }
    map.set(id, {
      id,
      name: [u?.firstName, u?.lastName].filter(Boolean).join(" ").trim() || `Utilisateur ${id}`,
      email: u?.email ?? "",
      calls: 1,
    });
  }
  return [...map.values()].sort((a, b) => b.calls - a.calls);
}

/* ------------------------------ Le resultat ------------------------------ */

const firstTask = (call: Partial<IclosedCall>) => (call.task ?? []).find((t) => t.outcome) ?? null;

/**
 * Traduit l'issue iClosed en statut de rendez-vous.
 *
 * Renvoie `null` quand iClosed n'a rien enregistre — le cas le plus frequent
 * en pratique. On laisse alors le rendez-vous sur son statut courant plutot
 * que de le declarer arbitrairement honore ou perdu.
 */
export function mapOutcome(call: Partial<IclosedCall>): AppointmentStatus | null {
  if (call.cancelReason || call.cancelledBy) return "cancelled";

  const outcome = (firstTask(call)?.outcome ?? "").toUpperCase();
  if (!outcome) {
    if (call.rescheduledBy) return "rescheduled";
    return null;
  }
  if (outcome.includes("NO_SHOW") || outcome.includes("NOSHOW")) return "no-show";
  if (outcome.includes("FOLLOW")) return "follow-up";
  if (outcome.includes("NO_SALE") || outcome.includes("LOST")) return "closed-lost";
  if (outcome.includes("SALE") || outcome.includes("WON")) return "closed-won";
  // Une issue renseignee mais inconnue prouve au moins que la personne etait la.
  return "completed";
}

/** Motif de perte iClosed ramene au vocabulaire du CRM. */
export function mapLostReason(call: Partial<IclosedCall>): LostReason {
  const raw = (firstTask(call)?.noSaleReason ?? "").toUpperCase();
  if (raw.includes("PRICE") || raw.includes("EXPENSIVE")) return "too-expensive";
  if (raw.includes("MONEY") || raw.includes("BUDGET")) return "no-money";
  if (raw.includes("THINK")) return "need-to-think";
  if (raw.includes("PARTNER") || raw.includes("SPOUSE")) return "need-partner-approval";
  if (raw.includes("QUALIF")) return "not-qualified";
  if (raw.includes("INTEREST")) return "not-interested";
  if (raw.includes("TIMING") || raw.includes("CANCELLED")) return "timing";
  if (raw.includes("COMPETITOR")) return "competitor";
  return "other";
}

/** Montant total des deals attaches au call. 0 si iClosed n'en porte aucun. */
export function dealAmount(call: Partial<IclosedCall>): number {
  return (call.deals ?? []).reduce((a, d) => a + Number(d.amount ?? d.value ?? 0), 0);
}

/* ------------------------------ La source -------------------------------- */

/** Source d'acquisition deduite des UTM du lien de reservation. */
export function sourceFromUtm(call: Partial<IclosedCall>, fallback: AppointmentSource): AppointmentSource {
  const utm = Object.fromEntries((call.utm ?? []).map((u) => [u.utmKey, (u.utmValue ?? "").toLowerCase()]));
  const src = utm.utm_source ?? "";
  const medium = utm.utm_medium ?? "";

  if (src.includes("ig") || src.includes("insta")) {
    if (medium.includes("story")) return "instagram-story";
    if (medium.includes("reel")) return "instagram-reel";
    return "instagram-dm";
  }
  if (src.includes("referral")) return "referral";
  if (src) return "inbound";
  return fallback;
}

/* ------------------------------ Conversion ------------------------------- */

/** Pseudo Instagram devine depuis les reponses au questionnaire iClosed. */
function igFromQuestions(call: Partial<IclosedCall>): string {
  for (const q of call.questions ?? []) {
    if (!/instagram|pseudo|@/i.test(q.statement)) continue;
    const match = (q.answer ?? "").match(/@?([A-Za-z0-9._]{2,30})/);
    if (match) return match[1];
  }
  return "";
}

/**
 * Traduit un appel iClosed en rendez-vous du module.
 *
 * `setterId` n'est pas devinable depuis iClosed : c'est a l'appelant de le
 * fournir. Mieux vaut un trou visible qu'une attribution inventee, qui
 * fausserait silencieusement classements et commissions.
 */
export function fromIclosedCall(
  call: Partial<IclosedCall> & { id?: number | string; dateTimeUTC?: string },
  opts: { setterId?: string; closerId?: string; source?: AppointmentSource; timezone?: string } = {},
): AppointmentInput | null {
  if (!call.dateTimeUTC) return null;

  const q = call.questions || call.secondaryAnswers ? qualification(call as IclosedCall) : null;

  return {
    igUsername: igFromQuestions(call),
    name: call.inviteeName ?? "",
    email: call.inviteeEmail ?? "",
    phone: call.phoneNumber ?? "",
    country: "",
    timezone: call.inviteTimeZone || opts.timezone || "Europe/Paris",
    scheduledAt: new Date(call.dateTimeUTC).toISOString(),
    setterId: opts.setterId ?? "",
    closerId: opts.closerId ?? "",
    source: sourceFromUtm(call, opts.source ?? "inbound"),
    iclosedUrl: call.locationLinkInvitee || call.locationLink || "",
    iclosedEventId: call.id !== undefined ? String(call.id) : "",
    setterNotes: q?.lines.length ? `— Questionnaire iClosed —\n${q.lines.join("\n")}` : "",
    qualified: false,
  };
}

/**
 * Rendez-vous deja rattache a cet identifiant iClosed.
 *
 * Sert a rendre les imports idempotents : reprendre une synchro ne doit pas
 * creer un doublon, ce qui fausserait le nombre de rendez-vous du setter.
 */
export function findByIclosedId(db: DB, iclosedEventId: string) {
  if (!iclosedEventId) return undefined;
  return db.appointments.find((a) => a.iclosedEventId === iclosedEventId);
}
