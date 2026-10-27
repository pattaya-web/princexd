import { createHmac, timingSafeEqual } from "crypto";
import { getSettings, newId, readDB, saveSettings, writeDB } from "./db";
import { askText } from "./kie";
import { recordOutcome } from "./sales/repo";
import { ICLOSED_SESSION } from "./sales/iclosed-sync";
import type { Appointment, DB } from "./types";

/**
 * Fathom (fathom.video) : l'enregistreur des calls de closing.
 *
 * Quand un call est termine, Fathom genere un resume. Deux chemins vers le
 * CRM : le webhook « new meeting content ready » (/api/webhooks/fathom),
 * et une relecture periodique des reunions (`syncFathom`, scheduler) au cas
 * ou le webhook n'est pas pose ou a ete manque. Dans les deux cas
 * `processMeeting` rattache la reunion au rendez-vous (email de l'invite,
 * sinon l'heure), condense le resume en quelques lignes et l'ecrit dans le
 * compte-rendu du call. Un call enregistre a eu lieu : s'il n'etait pas
 * encore statue, il passe « call fait » (show).
 *
 * API : https://developers.fathom.ai — base https://api.fathom.ai/external/v1,
 * en-tete X-Api-Key, 60 appels / min, 30 / min avec resume.
 */

export const FATHOM_BASE = "https://api.fathom.ai/external/v1";

export class FathomError extends Error {
  code: number;
  constructor(message: string, code = 500) {
    super(message);
    this.code = code;
  }
}

/** La variable d'environnement l'emporte sur la cle saisie dans Reglages. */
export function getFathomKey(): string {
  return process.env.FATHOM_API_KEY?.trim() || (getSettings().fathomApiKey ?? "").trim();
}

/* ------------------------------ Types API ------------------------------- */

export interface FathomInvitee {
  name?: string | null;
  email?: string | null;
  email_domain?: string | null;
  is_external?: boolean;
}

export interface FathomMeeting {
  recording_id?: number | string;
  id?: number | string;
  title?: string | null;
  meeting_title?: string | null;
  url?: string | null;
  share_url?: string | null;
  created_at?: string;
  scheduled_start_time?: string | null;
  scheduled_end_time?: string | null;
  recording_start_time?: string | null;
  recording_end_time?: string | null;
  calendar_invitees?: FathomInvitee[] | null;
  recorded_by?: { name?: string | null; email?: string | null } | null;
  default_summary?: { template_name?: string | null; markdown_formatted?: string | null } | null;
  action_items?: { description?: string | null; completed?: boolean }[] | null;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const key = getFathomKey();
  if (!key) throw new FathomError("Aucune clé API Fathom (Réglages → Fathom, ou FATHOM_API_KEY).", 401);
  const res = await fetch(`${FATHOM_BASE}${path}`, {
    ...init,
    headers: { "X-Api-Key": key, Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  if (res.status === 429) throw new FathomError(`Limite de requêtes Fathom atteinte. Réessaie dans ${res.headers.get("Retry-After") ?? "60"} s.`, 429);
  if (!res.ok) throw new FathomError(`Erreur Fathom (HTTP ${res.status}) : ${text.slice(0, 250)}`, res.status);
  try {
    return (text ? JSON.parse(text) : {}) as T;
  } catch {
    throw new FathomError("Réponse Fathom illisible.");
  }
}

/** Les reunions creees apres `createdAfter`, resume et actions compris (requete « lourde » : 30 / min). */
export async function listMeetings(createdAfter: string, maxPages = 5): Promise<FathomMeeting[]> {
  const out: FathomMeeting[] = [];
  let cursor = "";
  for (let i = 0; i < maxPages; i++) {
    const q = new URLSearchParams({ include_summary: "true", include_action_items: "true", created_after: createdAfter });
    if (cursor) q.set("cursor", cursor);
    const res = await call<{ items?: FathomMeeting[]; next_cursor?: string | null }>(`/meetings?${q.toString()}`);
    out.push(...(res.items ?? []));
    if (!res.next_cursor) break;
    cursor = res.next_cursor;
  }
  return out;
}

export interface FathomWebhook {
  id: string;
  url: string;
  secret?: string;
  created_at?: string;
}

/** Pose le webhook vers ce site : Fathom enverra chaque reunion terminee avec son resume. */
export async function createWebhook(destinationUrl: string): Promise<FathomWebhook> {
  return call<FathomWebhook>("/webhooks", {
    method: "POST",
    body: JSON.stringify({ destination_url: destinationUrl, triggered_for: ["my_recordings", "shared_team_recordings"], include_summary: true, include_action_items: true, include_transcript: false, include_crm_matches: false }),
  });
}

/* ------------------------------ Signature ------------------------------- */

/**
 * Signature des webhooks Fathom (format Standard Webhooks) : en-tetes
 * webhook-id, webhook-timestamp, webhook-signature (« v1,<base64> … »),
 * HMAC-SHA256 de `id.timestamp.corps` avec le secret (prefixe whsec_,
 * base64). Rejet au-dela de 5 minutes d'ecart.
 */
export function verifyFathomSignature(headers: { id: string | null; timestamp: string | null; signature: string | null }, rawBody: string, secret: string): boolean {
  if (!headers.id || !headers.timestamp || !headers.signature) return false;
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;
  let key: Buffer;
  try {
    key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  } catch {
    return false;
  }
  const expected = createHmac("sha256", key).update(`${headers.id}.${headers.timestamp}.${rawBody}`).digest();
  for (const part of headers.signature.split(/\s+/)) {
    const sig = part.includes(",") ? part.slice(part.indexOf(",") + 1) : part;
    let given: Buffer;
    try {
      given = Buffer.from(sig, "base64");
    } catch {
      continue;
    }
    if (given.length === expected.length && timingSafeEqual(given, expected)) return true;
  }
  return false;
}

/* ------------------------------ Resume court ------------------------------- */

const stripMd = (s: string) =>
  s
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*|__|`/g, "")
    .replace(/^\s*[-*•]\s+/gm, "• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/**
 * Le resume Fathom, condense en quelques lignes en francais : situation du
 * prospect, ce qu'il veut, objections, decision, suite. Par l'IA du tool
 * (askText) ; sans cle ou en cas d'echec, les premieres lignes du resume
 * Fathom, nettoyees.
 */
export async function condenseSummary(m: FathomMeeting): Promise<string> {
  const md = (m.default_summary?.markdown_formatted ?? "").trim();
  const actions = (m.action_items ?? []).map((a) => (a.description ?? "").trim()).filter(Boolean);
  const raw = [md, actions.length ? `Actions :\n${actions.map((a) => `- ${a}`).join("\n")}` : ""].filter(Boolean).join("\n\n");
  if (!raw) return "";
  const fallback = stripMd(raw).slice(0, 900);
  try {
    const out = await askText(
      `Voici le résumé automatique d'un call de vente (coaching e-commerce, Mady est le closer, l'autre personne est le prospect) :\n\n${raw.slice(0, 12000)}\n\nÉcris le compte-rendu pour le CRM.`,
      "Tu rédiges des comptes-rendus de calls de vente pour un CRM. En français, 4 à 6 lignes maximum, phrases courtes, une ligne par point : situation du prospect, ce qu'il veut, objection(s) ou frein, décision du call (closé / pas closé / réfléchit / suite prévue), prochaine étape et date si elle existe. Pas de titre, pas de markdown, pas de formule de politesse, pas de détail inutile. Chiffres en euros.",
      800,
    );
    const clean = out.trim();
    return clean ? clean.slice(0, 1200) : fallback;
  } catch {
    return fallback;
  }
}

/* ------------------------------ Rattachement ------------------------------- */

const MARK = "Résumé du call (Fathom)";
const lower = (v?: string | null) => (v ?? "").trim().toLowerCase();

/** Le rendez-vous qui correspond a la reunion : par email d'invite, sinon par l'heure si un seul call colle. */
export function matchAppointment(db: DB, m: FathomMeeting): Appointment | null {
  const start = Date.parse(m.recording_start_time || m.scheduled_start_time || m.created_at || "");
  if (!Number.isFinite(start)) return null;
  const live = db.appointments.filter((a) => a.status !== "cancelled");
  const host = lower(m.recorded_by?.email);
  const emails = (m.calendar_invitees ?? []).map((i) => lower(i.email)).filter((e) => e && e !== host);
  if (emails.length) {
    const leadIds = new Set(db.leads.filter((l) => emails.includes(lower(l.email))).map((l) => l.id));
    const mine = live.filter((a) => leadIds.has(a.leadId)).map((a) => ({ a, d: Math.abs(Date.parse(a.scheduledAt) - start) })).filter((x) => x.d <= 3 * 3600_000).sort((x, y) => x.d - y.d);
    if (mine.length) return mine[0].a;
  }
  const near = live.filter((a) => Math.abs(Date.parse(a.scheduledAt) - start) <= 45 * 60_000);
  return near.length === 1 ? near[0] : null;
}

export interface FathomReport {
  examined: number;
  attached: number;
  skipped: number;
  unmatched: string[];
}

/**
 * Une reunion Fathom vers le CRM. Idempotent : une reunion deja rattachee
 * (meme identifiant) n'est pas reecrite, sauf `force`.
 */
export async function processMeeting(m: FathomMeeting, report: FathomReport, opts: { force?: boolean } = {}): Promise<void> {
  report.examined += 1;
  const id = String(m.recording_id ?? m.id ?? "");
  let db = readDB();
  if (id && !opts.force && db.appointments.some((a) => a.fathomRecordingId === id)) {
    report.skipped += 1;
    return;
  }
  const appt = matchAppointment(db, m);
  const title = (m.title || m.meeting_title || `Réunion ${id}`).trim();
  if (!appt) {
    report.unmatched.push(title);
    db.activityLogs.unshift({ id: newId(), at: new Date().toISOString(), actorId: "", actorName: "Fathom", action: "appointment.updated", entity: "appointment", entityId: "", summary: `Enregistrement Fathom non rattaché : « ${title} » (${(m.calendar_invitees ?? []).map((i) => i.email).filter(Boolean).join(", ") || "sans invité"})` });
    writeDB(db);
    return;
  }
  const summary = await condenseSummary(m);
  db = readDB();
  const live = db.appointments.find((a) => a.id === appt.id);
  if (!live) return;
  const now = new Date().toISOString();
  const lead = db.leads.find((l) => l.id === live.leadId);
  live.fathomRecordingId = id;
  live.fathomUrl = (m.share_url || m.url || "").trim();
  live.fathomSummary = summary;
  live.fathomAt = now;
  const block = summary ? `${MARK} : ${summary}` : "";
  const existing = (live.closerNotes ?? "").trim();
  const notes = block ? (existing.includes(MARK) ? existing.replace(new RegExp(`${MARK}[\\s\\S]*$`), block) : [existing, block].filter(Boolean).join("\n\n")) : existing;
  live.closerNotes = notes;
  live.updatedAt = now;
  live.history = [...(live.history ?? []), { at: now, actorId: "", actorName: "Fathom", from: live.status, to: live.status, note: `Compte-rendu Fathom ajouté${live.fathomUrl ? ` · ${live.fathomUrl}` : ""}` }];
  db.activityLogs.unshift({ id: newId(), at: now, actorId: "", actorName: "Fathom", action: "appointment.updated", entity: "appointment", entityId: live.id, summary: `Compte-rendu du call de ${lead?.name ?? "un lead"} ajouté par Fathom` });
  writeDB(db);
  report.attached += 1;
  // Un call enregistre a bien eu lieu : s'il n'etait pas statue, il passe « call fait ». Le closer pose l'issue (close / pas close) ensuite.
  const started = Date.parse(m.recording_start_time || m.created_at || now);
  if ((live.status === "booked" || live.status === "confirmed" || live.status === "rescheduled") && started < Date.now()) {
    try {
      recordOutcome(ICLOSED_SESSION, live.id, { status: "completed", closerNotes: notes });
    } catch {
      // Statut deja pose entre-temps : le compte-rendu est ecrit, c'est l'essentiel.
    }
  }
}

/* ------------------------------ Relecture ------------------------------- */

const SYNC_COOLDOWN_MS = 15 * 60_000;
let inflight: Promise<FathomReport | null> | null = null;

/** Relit les reunions recentes (depuis la derniere synchro moins un jour, sinon `days` jours). */
export async function syncFathom(opts: { force?: boolean; days?: number } = {}): Promise<FathomReport | null> {
  if (!getFathomKey()) return null;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const s = getSettings();
      const last = s.fathomLastSyncAt ? Date.parse(s.fathomLastSyncAt) : 0;
      if (!opts.force && Date.now() - last < SYNC_COOLDOWN_MS) return null;
      const since = opts.days ? Date.now() - opts.days * 86_400_000 : last ? last - 86_400_000 : Date.now() - 7 * 86_400_000;
      const meetings = await listMeetings(new Date(since).toISOString());
      const report: FathomReport = { examined: 0, attached: 0, skipped: 0, unmatched: [] };
      for (const m of meetings) await processMeeting(m, report, { force: opts.force && Boolean(opts.days) });
      saveSettings({ fathomLastSyncAt: new Date().toISOString() });
      return report;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
