import { getSettings } from "./db";
import type { CallEvent, Lead, LeadStage } from "./types";
import { applyTouch, touchFromUtm, type TouchInput } from "./sales/attribution";

export const ICLOSED_BASE = "https://public.api.iclosed.io";

export class IclosedError extends Error {
  code: number;
  constructor(message: string, code = 500) {
    super(message);
    this.code = code;
  }
}

/** La variable d'environnement l'emporte sur la clé saisie dans l'UI. */
export function getIclosedKey(): string {
  return process.env.ICLOSED_API_KEY?.trim() || getSettings().iclosedApiKey.trim();
}

/* ------------------------------ Types API ------------------------------- */

interface IclosedAnswer {
  statement: string;
  answer: string;
}

interface IclosedSecondaryAnswer {
  statement: string;
  customFieldIdentifier: string;
  answer: { answer: string | null; number: number | null; date: string | null }[];
}

interface IclosedTask {
  outcome: string | null;
  noSaleReason: string | null;
  objection: string | null;
  notes: string | null;
}

/** Utilisateur iClosed : c'est l'hote du call, donc le closer. */
export interface IclosedUser {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
}

export interface IclosedCall {
  id: number;
  dateTimeUTC: string;
  /**
   * Hote du rendez-vous.
   *
   * Verifie sur l'API reelle : c'est le seul champ qui identifie QUI prend le
   * call. Tant qu'un compte n'a qu'un utilisateur, tous les calls remontent
   * avec le meme — il faut creer les closers dans iClosed pour les distinguer.
   */
  user?: IclosedUser;
  userId?: number;
  /** Fuseau dans lequel l'invite a reserve. */
  inviteTimeZone?: string;
  /** Parametres de campagne du lien de reservation (utm_source=ig, etc.). */
  utm?: { utmKey: string; utmValue: string }[];
  duration: number;
  durationUnit: string;
  callType: string;
  cancelReason: string | null;
  cancelledBy: unknown;
  rescheduledBy: unknown;
  notes: string | null;
  locationLink: string | null;
  locationLinkInvitee: string | null;
  inviteeName: string | null;
  inviteeEmail: string | null;
  phoneNumber: string | null;
  questions: IclosedAnswer[];
  secondaryAnswers: IclosedSecondaryAnswer[];
  task: IclosedTask[];
  deals: { amount?: number; value?: number }[];
}

async function call<T>(path: string): Promise<T> {
  const key = getIclosedKey();
  if (!key) {
    throw new IclosedError(
      "Aucune cle API iClosed configuree (Reglages, ou ICLOSED_API_KEY dans .env.local).",
      401,
    );
  }
  const res = await fetch(`${ICLOSED_BASE}${path}`, {
    headers: { Authorization: `Bearer ${key}` },
    cache: "no-store",
  });
  const text = await res.text();

  if (res.status === 429) {
    let retry = 3;
    try {
      retry = Number((JSON.parse(text) as { retryAfter?: number }).retryAfter ?? 3);
    } catch {
      retry = 3;
    }
    throw new IclosedError(`Limite de requetes iClosed atteinte. Reessaie dans ${retry} s.`, 429);
  }
  if (!res.ok) {
    throw new IclosedError(`Erreur iClosed (HTTP ${res.status}) : ${text.slice(0, 250)}`, res.status);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new IclosedError("Reponse iClosed illisible.");
  }
}

/**
 * Récupère les appels page par page.
 *
 * iClosed pagine avec `page`, et la PREMIERE page est la page 0 (vérifié le
 * 2026-09-28 : `page=0` renvoie les 50 calls les plus récents, `page=1` les
 * 50 suivants). Le tool demandait la page 1 et sautait donc les 50 derniers
 * calls ; avec `eventType=UPCOMING`, dont le compte tient en une page, la
 * liste sortait toujours vide alors que `count` annonçait des rendez-vous.
 */
export async function fetchCalls(
  eventType: "UPCOMING" | "PAST",
  maxPages = 12,
  perPage = 50,
): Promise<IclosedCall[]> {
  const out: IclosedCall[] = [];
  for (let page = 0; page < maxPages; page++) {
    const res = await call<{ data: { eventCalls: IclosedCall[]; count: number } }>(
      `/v1/eventCalls?eventType=${eventType}&limit=${perPage}&page=${page}`,
    );
    const batch = res.data?.eventCalls ?? [];
    out.push(...batch);
    if (batch.length < perPage || out.length >= (res.data?.count ?? 0)) break;
  }
  return out;
}

export async function fetchDeals() {
  const res = await call<{ data: { deals: Record<string, unknown>[]; count: number } }>(
    "/v1/deals?limit=100",
  );
  return res.data?.deals ?? [];
}

/* ------------------------------- Mapping -------------------------------- */

/** Aplati les réponses au questionnaire de qualification en texte lisible. */
export function qualification(c: IclosedCall): { lines: string[]; budget: number; objectif: string; niveau: string } {
  const lines: string[] = [];
  let budget = 0;
  let objectif = "";
  let niveau = "";

  for (const q of c.questions ?? []) {
    if (!q.answer || /full name|phone number/i.test(q.statement)) continue;
    lines.push(`${q.statement} : ${q.answer}`);
  }

  for (const s of c.secondaryAnswers ?? []) {
    const values = (s.answer ?? [])
      .map((a) => a.answer ?? (a.number !== null ? String(a.number) : "") ?? "")
      .filter(Boolean);
    if (!values.length) continue;
    const joined = values.join(", ");
    lines.push(`${s.statement} : ${joined}`);

    const id = s.customFieldIdentifier ?? "";
    if (/investir|budget|combien/i.test(`${id} ${s.statement}`)) {
      // "1 000 à 3 000 €" -> on retient la borne haute, plus représentative du potentiel.
      const numbers = joined.replace(/\s/g, "").match(/\d+/g);
      if (numbers?.length) budget = Math.max(...numbers.map(Number));
    }
    if (/objectif/i.test(`${id} ${s.statement}`)) objectif = joined;
    if (/niveau/i.test(`${id} ${s.statement}`)) niveau = joined;
  }

  return { lines, budget, objectif, niveau };
}

function outcomeOf(c: IclosedCall) {
  return (c.task ?? []).map((t) => t.outcome).find(Boolean) ?? null;
}

export function mapCallStatus(c: IclosedCall): CallEvent["status"] {
  if (c.cancelReason || c.cancelledBy) return "perdu";
  const outcome = (outcomeOf(c) ?? "").toUpperCase();
  if (/SALE$/.test(outcome) && !outcome.startsWith("NO_")) return "closed";
  if (outcome.includes("WON") || outcome === "CLOSED") return "closed";
  if (outcome.includes("NO_SHOW") || outcome.includes("NOSHOW")) return "no-show";
  if (outcome) return "show"; // NO_SALE, FOLLOW_UP… : la personne était présente
  return new Date(c.dateTimeUTC).getTime() > Date.now() ? "book" : "book";
}

export function mapLeadStage(status: CallEvent["status"]): LeadStage {
  switch (status) {
    case "closed":
      return "closed-won";
    case "perdu":
      return "closed-lost";
    case "no-show":
      return "call-fait";
    case "show":
      return "call-fait";
    default:
      return "call-book";
  }
}

export function toCallEvent(c: IclosedCall): CallEvent {
  const status = mapCallStatus(c);
  const task = (c.task ?? [])[0];
  const q = qualification(c);

  // Tout ce que je dois avoir sous les yeux avant de décrocher :
  // les coordonnées, les réponses au questionnaire, puis l'issue du call.
  const notes = [
    c.inviteeEmail ? `Email : ${c.inviteeEmail}` : "",
    c.phoneNumber ? `Téléphone : ${c.phoneNumber}` : "",
    q.lines.length ? `\n— Questionnaire —\n${q.lines.join("\n")}` : "",
    task?.notes || task?.objection || task?.noSaleReason || c.cancelReason || c.notes ? "\n— Issue —" : "",
    task?.notes,
    task?.objection ? `Objection : ${task.objection}` : "",
    task?.noSaleReason ? `Raison du non-closing : ${task.noSaleReason}` : "",
    c.cancelReason ? `Annulé : ${c.cancelReason}` : "",
    c.notes,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    id: `iclosed-${c.id}`,
    title: c.inviteeName ? `Call — ${c.inviteeName}` : c.callType.replace(/_/g, " ").toLowerCase(),
    contact: c.inviteeName || c.inviteeEmail || "inconnu",
    at: c.dateTimeUTC,
    durationMin: c.durationUnit === "MINUTES" ? c.duration : c.duration * 60,
    status,
    source: "iclosed",
    outcome: notes.slice(0, 2000),
    value: (c.deals ?? []).reduce((a, d) => a + Number(d.amount ?? d.value ?? 0), 0),
    url: c.locationLinkInvitee || c.locationLink || "",
    createdAt: new Date().toISOString(),
  };
}

function toLeadBase(c: IclosedCall, status: CallEvent["status"]): Lead {
  const q = qualification(c);
  const notes = [
    c.inviteeEmail ? `Email : ${c.inviteeEmail}` : "",
    c.phoneNumber ? `Téléphone : ${c.phoneNumber}` : "",
    "",
    ...q.lines,
  ]
    .filter((l) => l !== undefined)
    .join("\n")
    .trim();

  return {
    id: `iclosed-lead-${c.id}`,
    name: c.inviteeName || c.inviteeEmail || "inconnu",
    handle: "",
    source: "bio-link",
    stage: mapLeadStage(status),
    dealValue: q.budget,
    callAt: c.dateTimeUTC,
    ownerRole: "moi",
    ownerName: "",
    painPoint: [q.niveau, q.objectif].filter(Boolean).join(" → "),
    nextAction: status === "book" ? "Préparer le call" : status === "show" ? "Relancer" : "",
    nextActionAt: c.dateTimeUTC.slice(0, 10),
    notes: notes.slice(0, 1500),
    createdAt: new Date().toISOString(),
  };
}

/**
 * Rendez-vous a venir, avec repli.
 *
 * Le filtre `eventType=UPCOMING` fonctionne des lors qu'on lit la page 0 (voir
 * `fetchCalls`) : c'etait la page 1 qui rendait une liste vide avec un `count`
 * non nul. On garde neanmoins le repli : si le filtre annonce des resultats
 * sans en fournir, on balaie la liste complete et on tranche sur la date
 * nous-memes, pour ne jamais rater un booking a cause d'un caprice de l'API.
 */
export async function fetchUpcoming(maxPages = 12, perPage = 50): Promise<IclosedCall[]> {
  const direct = await fetchCalls("UPCOMING", 4, perPage);
  if (direct.length > 0) return direct;
  const probe = await call<{ data: { eventCalls: IclosedCall[]; count: number } }>(
    `/v1/eventCalls?eventType=UPCOMING&limit=1&page=0`,
  );
  if (!probe.data?.count) return [];

  // Le filtre ment : on relit tout et on tranche sur la date.
  const now = new Date().toISOString();
  const seen = new Map<number, IclosedCall>();
  for (let page = 0; page < maxPages; page++) {
    const res = await call<{ data: { eventCalls: IclosedCall[]; count: number } }>(
      `/v1/eventCalls?limit=${perPage}&page=${page}`,
    );
    const batch = res.data?.eventCalls ?? [];
    if (!batch.length) break;
    for (const c of batch) seen.set(c.id, c);
    if (seen.size >= (res.data?.count ?? 0)) break;
  }
  return [...seen.values()].filter((c) => (c.dateTimeUTC ?? "") > now);
}

/** Parametres utm du lien de reservation, tels que l'attribution les lit. */
export function touchOf(c: IclosedCall): TouchInput {
  const utm: Record<string, string> = {};
  for (const u of c.utm ?? []) if (u.utmKey) utm[u.utmKey] = u.utmValue;
  return touchFromUtm(utm, { hint: "iclosed", manualSource: "bio-link" });
}

/** Lead iClosed avec son attribution : les utm du lien de reservation font foi. */
export function toLead(c: IclosedCall, status: CallEvent["status"]): Lead {
  const lead = toLeadBase(c, status);
  applyTouch(lead, touchOf(c), lead.createdAt);
  return lead;
}
