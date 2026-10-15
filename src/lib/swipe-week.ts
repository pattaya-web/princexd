import { parisDay, parisToIso, parisWeekday } from "./format";
import {
  DEFAULT_WEEKLY_TARGETS,
  SWIPE_PROD_STATUSES,
  swipeProdStatus,
  swipeStage,
  type Swipe,
  type SwipeProdStatus,
  type SwipeStage,
  type WeeklyReelTargets,
} from "./types";

/**
 * La semaine de production (2026-10-15).
 *
 * Objectif : 25 Reels par semaine, 15 TOFU / 5 MOFU / 5 BOFU (reglable).
 * La semaine commence le lundi, heure de Paris. Un swipe compte dans une
 * etape de la chaine (source, scripte, tourne, monte, publie) la semaine ou
 * il y est passe : la date de chaque passage est sur le swipe. Un Reel
 * source la semaine derniere et publie cette semaine compte donc dans
 * « publie » cette semaine, pas dans « source ».
 *
 * Tout est calcule a partir des swipes, cote serveur comme cote client :
 * aucun compteur stocke, rien a remettre a zero.
 */

/** Les etapes affichees dans le bloc, dans l'ordre de la chaine. */
export const WEEK_STEPS = ["source", "scripte", "tourne", "monte", "publie"] as const;
export type WeekStep = (typeof WEEK_STEPS)[number];
export const WEEK_STEP_LABEL: Record<WeekStep, string> = { source: "Sourcé", scripte: "Scripté", tourne: "Tourné", monte: "Monté", publie: "Publié" };

export interface WeekBounds {
  /** Lundi 00:00 Paris, ISO. */
  from: string;
  /** Lundi suivant 00:00 Paris, ISO (exclu). */
  to: string;
  /** « AAAA-MM-JJ » du lundi. */
  monday: string;
  /** Jours restants dans la semaine, aujourd'hui compris (lundi = 7, dimanche = 1). */
  daysLeft: number;
}

export function weekBounds(): WeekBounds {
  const today = parisDay(0);
  const wd = parisWeekday(); // 0 = dimanche
  const back = (wd + 6) % 7; // lundi = 0
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - back);
  const monday = d.toISOString().slice(0, 10);
  d.setUTCDate(d.getUTCDate() + 7);
  const next = d.toISOString().slice(0, 10);
  return { from: parisToIso(`${monday}T00:00`), to: parisToIso(`${next}T00:00`), monday, daysLeft: 7 - back };
}

export interface StageProgress {
  stage: SwipeStage;
  target: number;
  /** Nombre de swipes passes par chaque etape cette semaine. */
  counts: Record<WeekStep, number>;
  /** Swipes actuellement a chaque statut (toutes semaines), pour savoir ce qui est disponible. */
  pipeline: Record<SwipeProdStatus, number>;
}

export interface WeekProgress {
  bounds: WeekBounds;
  targets: WeeklyReelTargets;
  stages: StageProgress[];
  /** Swipes analyses mais sans etape (non classes) : hors objectifs. */
  unclassified: number;
  /** Ce qu'il reste a faire aujourd'hui pour tenir la cadence. */
  today: { step: Exclude<WeekStep, "source">; n: number }[];
  /** Phrase prete a afficher, ex. « 3 à tourner, 2 à monter ». */
  todayLabel: string;
}

const STEP_ORDER: Record<SwipeProdStatus, number> = { source: 0, scripte: 1, "a-tourner": 2, tourne: 3, monte: 4, publie: 5 };

/** Date a laquelle le swipe est passe par une etape (source = creation). */
function reachedAt(s: Swipe, step: WeekStep): string {
  if (step === "source") return s.prodDates?.source || s.createdAt;
  return s.prodDates?.[step] || "";
}

export function weekProgress(swipes: Swipe[], targets: Partial<WeeklyReelTargets> | undefined, bounds = weekBounds()): WeekProgress {
  const t: WeeklyReelTargets = { ...DEFAULT_WEEKLY_TARGETS, ...(targets ?? {}) };
  const inWeek = (iso: string) => Boolean(iso) && iso >= bounds.from && iso < bounds.to;
  const stages: StageProgress[] = (["TOFU", "MOFU", "BOFU"] as SwipeStage[]).map((stage) => {
    const mine = swipes.filter((s) => swipeStage(s) === stage);
    const counts = Object.fromEntries(WEEK_STEPS.map((st) => [st, mine.filter((s) => inWeek(reachedAt(s, st))).length])) as Record<WeekStep, number>;
    const pipeline = Object.fromEntries(SWIPE_PROD_STATUSES.map((st) => [st, mine.filter((s) => swipeProdStatus(s) === st).length])) as Record<SwipeProdStatus, number>;
    return { stage, target: t[stage], counts, pipeline };
  });
  const unclassified = swipes.filter((s) => !swipeStage(s)).length;

  /*
   * Plan du jour : pour chaque etape, ce qu'il manque a l'objectif de la
   * semaine, etale sur les jours restants, borne par ce qui est reellement
   * disponible en amont (on ne peut pas tourner ce qui n'est pas scripte).
   */
  const today: WeekProgress["today"] = [];
  const steps: Exclude<WeekStep, "source">[] = ["scripte", "tourne", "monte", "publie"];
  for (const step of steps) {
    let n = 0;
    for (const sp of stages) {
      const remaining = Math.max(0, sp.target - sp.counts[step]);
      if (!remaining) continue;
      const perDay = Math.ceil(remaining / Math.max(1, bounds.daysLeft));
      // Disponible : tout ce qui est en amont de l'etape (statut strictement inferieur).
      const order = STEP_ORDER[step];
      const available = SWIPE_PROD_STATUSES.filter((st) => STEP_ORDER[st] < order).reduce((a, st) => a + sp.pipeline[st], 0);
      n += Math.min(perDay, available);
    }
    if (n > 0) today.push({ step, n });
  }
  const verb: Record<Exclude<WeekStep, "source">, string> = { scripte: "à scripter", tourne: "à tourner", monte: "à monter", publie: "à publier" };
  const todayLabel = today.length ? today.map((x) => `${x.n} ${verb[x.step]}`).join(", ") : "";
  return { bounds, targets: t, stages, unclassified, today, todayLabel };
}

/** Le statut de production qui suit, ou null en bout de chaine. */
export function nextProdStatus(s: SwipeProdStatus): SwipeProdStatus | null {
  const i = SWIPE_PROD_STATUSES.indexOf(s);
  return i >= 0 && i < SWIPE_PROD_STATUSES.length - 1 ? SWIPE_PROD_STATUSES[i + 1] : null;
}
