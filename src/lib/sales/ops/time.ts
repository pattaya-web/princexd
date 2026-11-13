/**
 * Dates du Sales OS, a partir d'un « maintenant » passe en parametre : le
 * moteur doit pouvoir tourner a n'importe quelle date (tests, rattrapage).
 * Tout est stocke en ISO UTC ; les jours se lisent en heure de Paris, et les
 * fuseaux (Paris, Dubai) ne servent qu'a l'affichage. Les changements
 * d'heure sont donc absorbes par Intl, jamais par un decalage fixe.
 */
import { isoToParisInput, parisToIso, TEAM_TZ } from "../../format";

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

/** Jour (AAAA-MM-JJ) d'un instant, en heure de Paris. */
export function dayOf(at: number | string, tz = TEAM_TZ): string {
  const d = typeof at === "number" ? new Date(at) : new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  return isoToParisInput(d, tz).slice(0, 10);
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Debut d'un jour de Paris, en ms. */
export const startOfDay = (day: string, tz = TEAM_TZ) => Date.parse(parisToIso(`${day}T00:00`, tz));

/** Fin d'un jour de Paris (debut du lendemain), en ms. */
export const endOfDay = (day: string, tz = TEAM_TZ) => startOfDay(addDays(day, 1), tz);

/** Un jour a une heure de Paris, en ISO (« le 14 a 9 h »). */
export const atParis = (day: string, hhmm = "09:00", tz = TEAM_TZ) => parisToIso(`${day}T${hhmm}`, tz);

export const ms = (iso: string | undefined) => {
  const n = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(n) ? n : NaN;
};

export const iso = (n: number) => new Date(n).toISOString();

/** « il y a 3 h », « dans 2 j » : durees courtes pour le contexte des taches. */
export function since(fromMs: number, nowMs: number): string {
  const d = nowMs - fromMs;
  const abs = Math.abs(d);
  const txt = abs < HOUR ? `${Math.max(1, Math.round(abs / MIN))} min` : abs < DAY ? `${Math.round(abs / HOUR)} h` : `${Math.round(abs / DAY)} j`;
  return d >= 0 ? `il y a ${txt}` : `dans ${txt}`;
}
