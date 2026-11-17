import { createTask, isRateLimited, KieError } from "@/lib/kie";
import { withKieKey } from "@/lib/db";
import { keyForOwner } from "@/lib/studio-tenant";
import type { DB, Generation } from "@/lib/types";

/**
 * Relance automatique d'une génération refusée pour cause de cadence.
 *
 * Le 2026-11-17, deux images GPT Image 2 sont arrivées en carte rouge avec
 * « Your call frequency is too high. Please try again later. » : la tâche a
 * été acceptée par KIE puis a échoué chez lui, sans rien à reprocher à la
 * demande. Plutôt que de laisser l'échec, on repose exactement la même tâche
 * un peu plus tard, jusqu'à trois fois, en espaçant les essais. La relance
 * est faite par le sondage (`/api/kie/task`), que le dock appelle tant qu'une
 * génération est en attente.
 */

export const RELAUNCH_MAX = 3;
/** Délais avant chaque relance, en millisecondes (1re, 2e, 3e). */
const RELAUNCH_DELAYS_MS = [10_000, 30_000, 60_000];

export const RELAUNCH_EXHAUSTED =
  "KIE a refusé la cadence trois fois de suite (« call frequency is too high »). Attends une minute, puis relance depuis la tuile.";

/** Vrai si cet échec est un refus de cadence, donc à retenter. */
export function isTransientFailure(msg: string, code?: number): boolean {
  return isRateLimited(msg, code);
}

/**
 * Programme la prochaine relance si l'échec est passager et qu'il reste des
 * essais. Renvoie vrai si la génération repart en attente ; sinon elle est
 * laissée en échec, avec un message en français quand les essais sont épuisés.
 */
export function scheduleRelaunch(gen: Generation, failMsg: string, code?: number): boolean {
  if (!isTransientFailure(failMsg, code)) return false;
  const done = gen.relaunches ?? 0;
  if (done >= RELAUNCH_MAX) {
    gen.state = "fail";
    gen.failMsg = RELAUNCH_EXHAUSTED;
    gen.relaunchAt = "";
    gen.updatedAt = new Date().toISOString();
    return false;
  }
  const delay = RELAUNCH_DELAYS_MS[Math.min(done, RELAUNCH_DELAYS_MS.length - 1)];
  gen.state = "waiting";
  gen.failMsg = "";
  gen.progress = 0;
  gen.resultUrls = [];
  gen.relaunches = done + 1;
  gen.relaunchAt = new Date(Date.now() + delay).toISOString();
  gen.updatedAt = new Date().toISOString();
  return true;
}

function callbackUrl(): string | undefined {
  const base = process.env.PUBLIC_BASE_URL?.trim();
  return base && !base.includes("localhost") ? `${base}/api/kie/callback` : undefined;
}

/**
 * Repose la même tâche chez KIE (même modèle, mêmes entrées), avec la clé du
 * propriétaire. La génération garde sa ligne, sa date et son nom : seul le
 * taskId change. Un refus de cadence à ce moment-là reprogramme une relance ;
 * un autre refus laisse la génération en échec avec son message.
 */
export async function relaunchNow(db: Pick<DB, "students" | "studioMembers">, gen: Generation): Promise<void> {
  const key = keyForOwner(db, gen.ownerId);
  if (gen.ownerId && !key) {
    gen.state = "fail";
    gen.failMsg = "Clé KIE introuvable pour relancer cette génération.";
    gen.relaunchAt = "";
    gen.updatedAt = new Date().toISOString();
    return;
  }
  try {
    const run = () => createTask(gen.model, gen.input, callbackUrl());
    const taskId = key ? await withKieKey(key, run) : await run();
    gen.taskId = taskId;
    gen.state = "waiting";
    gen.failMsg = "";
    gen.progress = 0;
    gen.resultUrls = [];
    gen.relaunchAt = "";
    gen.updatedAt = new Date().toISOString();
  } catch (e) {
    const err = e as KieError;
    if (scheduleRelaunch(gen, err.message, err.code)) return;
    if (!isTransientFailure(err.message, err.code)) {
      gen.state = "fail";
      gen.failMsg = err.message;
      gen.relaunchAt = "";
      gen.updatedAt = new Date().toISOString();
    }
  }
}

/** Une relance programmée dont l'heure est passée. */
export function relaunchDue(gen: Generation, now = Date.now()): boolean {
  return Boolean(gen.relaunchAt) && gen.state !== "success" && gen.state !== "fail" && new Date(gen.relaunchAt!).getTime() <= now;
}

/** Relance programmée mais pas encore due : la tâche KIE n'existe pas encore, ne pas la sonder. */
export function relaunchPending(gen: Generation): boolean {
  return Boolean(gen.relaunchAt) && gen.state !== "success" && gen.state !== "fail";
}

/**
 * Relance tout ce qui est dû parmi ces générations, une par une pour ne pas
 * recréer le refus de cadence. Renvoie les générations touchées.
 */
export async function relaunchAllDue(db: Pick<DB, "students" | "studioMembers">, gens: Generation[]): Promise<Generation[]> {
  const touched: Generation[] = [];
  for (const gen of gens) {
    if (!relaunchDue(gen)) continue;
    await relaunchNow(db, gen);
    touched.push(gen);
  }
  return touched;
}
