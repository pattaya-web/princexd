import { randomBytes } from "crypto";
import { getSettings, readDB, writeDB } from "./db";

/**
 * Google Agenda, pour generer des liens Google Meet depuis le tool.
 *
 * Un seul compte : celui de Mady. Il cree un client OAuth « application
 * Web » dans Google Cloud (identifiant + secret, URI de redirection
 * https://mvdyprince.fr/api/google/callback), colle les deux dans Reglages,
 * puis « Connecter mon Google Agenda ». Le jeton de rafraichissement est
 * garde dans les reglages ; chaque creation d'evenement demande un jeton
 * d'acces frais. L'evenement est cree dans l'agenda principal avec une
 * visio Meet, les invites recoivent l'invitation Google.
 */

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CAL = "https://www.googleapis.com/calendar/v3";
const SCOPES = ["https://www.googleapis.com/auth/calendar.events", "openid", "email"];

export class GoogleError extends Error {
  code: number;
  constructor(message: string, code = 500) {
    super(message);
    this.code = code;
  }
}

export function googleClient(): { id: string; secret: string } {
  const s = getSettings();
  return { id: process.env.GOOGLE_CLIENT_ID?.trim() || (s.googleClientId ?? "").trim(), secret: process.env.GOOGLE_CLIENT_SECRET?.trim() || (s.googleClientSecret ?? "").trim() };
}

export const googleConnected = () => Boolean((getSettings().googleRefreshToken ?? "").trim());

export const redirectUri = (origin: string) => `${origin.replace(/\/+$/, "")}/api/google/callback`;

/** L'adresse de consentement Google ; `state` est verifie au retour. */
export function authUrl(origin: string, state: string): string {
  const { id } = googleClient();
  if (!id) throw new GoogleError("Identifiant client Google manquant (Réglages → Google Agenda).", 400);
  const q = new URLSearchParams({ client_id: id, redirect_uri: redirectUri(origin), response_type: "code", scope: SCOPES.join(" "), access_type: "offline", prompt: "consent", include_granted_scopes: "true", state });
  return `${AUTH_URL}?${q.toString()}`;
}

export const newState = () => randomBytes(16).toString("hex");

async function token(body: Record<string, string>): Promise<{ access_token: string; refresh_token?: string; expires_in?: number; id_token?: string }> {
  const { id, secret } = googleClient();
  if (!id || !secret) throw new GoogleError("Identifiant ou secret client Google manquant (Réglages → Google Agenda).", 400);
  const res = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...body, client_id: id, client_secret: secret }).toString(), cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || !json.access_token) throw new GoogleError(`Google a refusé (${String(json.error ?? res.status)} : ${String(json.error_description ?? "")})`.trim(), res.status || 500);
  return json as { access_token: string; refresh_token?: string; expires_in?: number; id_token?: string };
}

/** Echange le code du consentement contre un jeton de rafraichissement, garde en reglages avec l'email du compte. */
export async function connectWithCode(code: string, origin: string): Promise<string> {
  const t = await token({ code, redirect_uri: redirectUri(origin), grant_type: "authorization_code" });
  if (!t.refresh_token) throw new GoogleError("Google n'a pas renvoyé de jeton de rafraîchissement : retire l'accès de l'app dans ton compte Google (myaccount.google.com/permissions) puis reconnecte.");
  let email = "";
  try {
    const me = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { Authorization: `Bearer ${t.access_token}` }, cache: "no-store" });
    email = String(((await me.json()) as { email?: string }).email ?? "");
  } catch {
    // l'email n'est qu'informatif
  }
  const db = readDB();
  db.settings.googleRefreshToken = t.refresh_token;
  db.settings.googleAccountEmail = email;
  db.settings.googleConnectedAt = new Date().toISOString();
  writeDB(db);
  return email;
}

let cached: { token: string; until: number } | null = null;

async function accessToken(): Promise<string> {
  if (cached && cached.until > Date.now() + 30_000) return cached.token;
  const refresh = (getSettings().googleRefreshToken ?? "").trim();
  if (!refresh) throw new GoogleError("Google Agenda n'est pas connecté (Réglages → Google Agenda).", 401);
  const t = await token({ refresh_token: refresh, grant_type: "refresh_token" });
  cached = { token: t.access_token, until: Date.now() + (t.expires_in ?? 3600) * 1000 };
  return t.access_token;
}

export function disconnectGoogle() {
  const db = readDB();
  db.settings.googleRefreshToken = "";
  db.settings.googleAccountEmail = "";
  db.settings.googleConnectedAt = "";
  writeDB(db);
  cached = null;
}

export interface MeetEventInput {
  title: string;
  description: string;
  /** Debut et fin en ISO UTC. */
  startAt: string;
  endAt: string;
  /** Fuseau affiche dans l'agenda et l'invitation (Asia/Dubai, Europe/Paris…). */
  timeZone: string;
  attendees: string[];
}

export interface MeetEvent {
  id: string;
  meetUrl: string;
  eventUrl: string;
}

/** Cree l'evenement dans l'agenda principal, avec une visio Meet ; les invites recoivent l'invitation. */
export async function createMeetEvent(input: MeetEventInput): Promise<MeetEvent> {
  const at = await accessToken();
  const body = {
    summary: input.title,
    description: input.description || undefined,
    start: { dateTime: input.startAt, timeZone: input.timeZone },
    end: { dateTime: input.endAt, timeZone: input.timeZone },
    attendees: input.attendees.filter(Boolean).map((email) => ({ email })),
    conferenceData: { createRequest: { requestId: randomBytes(8).toString("hex"), conferenceSolutionKey: { type: "hangoutsMeet" } } },
    reminders: { useDefault: true },
  };
  const res = await fetch(`${CAL}/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all`, { method: "POST", headers: { Authorization: `Bearer ${at}`, "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as { id?: string; hangoutLink?: string; htmlLink?: string; conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] }; error?: { message?: string } };
  if (!res.ok || !json.id) throw new GoogleError(`Google Agenda a refusé : ${json.error?.message ?? res.status}`, res.status || 500);
  const meet = json.hangoutLink || json.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri || "";
  if (!meet) throw new GoogleError("Événement créé mais sans lien Meet : vérifie que Google Meet est activé sur ce compte.");
  return { id: json.id, meetUrl: meet, eventUrl: json.htmlLink ?? "" };
}

/** Supprime l'evenement (les invites sont prevenus). */
export async function deleteEvent(eventId: string): Promise<void> {
  const at = await accessToken();
  const res = await fetch(`${CAL}/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`, { method: "DELETE", headers: { Authorization: `Bearer ${at}` }, cache: "no-store" });
  if (!res.ok && res.status !== 404 && res.status !== 410) throw new GoogleError(`Suppression refusée par Google (${res.status}).`, res.status);
}
