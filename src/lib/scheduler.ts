/**
 * Synchronisations en arriere-plan, au demarrage du serveur.
 *
 * Les leads doivent arriver dans le CRM sans que personne n'ouvre une page :
 *  - Systeme.io (opt-ins LP1 Ads et LP organique) toutes les 2 minutes ;
 *  - iClosed (rendez-vous) toutes les 5 minutes, si la synchro auto est active.
 * Un seul minuteur par processus (garde sur globalThis : Next recharge les
 * modules en dev), jamais deux synchros en meme temps, et une erreur reseau
 * n'arrete pas le cycle : elle est notee, la suivante repart.
 */

import { readDB, writeDB } from "./db";
import { getIclosedKey } from "./iclosed";
import { syncIclosedUpcoming } from "./sales/iclosed-sync";
import { getSystemeioKey, syncSystemeio } from "./systemeio";

const SIO_EVERY_MS = 2 * 60_000;
const ICLOSED_EVERY_MS = 5 * 60_000;

interface State {
  started: boolean;
  running: boolean;
  lastSio: string;
  lastSioError: string;
  lastIclosed: string;
  lastIclosedError: string;
}
const g = globalThis as unknown as { __princexdScheduler?: State };
const state: State = (g.__princexdScheduler ??= { started: false, running: false, lastSio: "", lastSioError: "", lastIclosed: "", lastIclosedError: "" });

export const schedulerState = () => state;

async function tickSystemeio() {
  if (!getSystemeioKey()) return;
  try {
    const r = await syncSystemeio({ force: true });
    state.lastSio = new Date().toISOString();
    state.lastSioError = "";
    if (r && (r.created || r.updated)) {
      const db = readDB();
      db.settings.systemeioLastSyncAt = state.lastSio;
      writeDB(db);
    }
  } catch (e) {
    state.lastSioError = e instanceof Error ? e.message : String(e);
    console.warn("[scheduler] Systeme.io :", state.lastSioError);
  }
}

async function tickIclosed() {
  if (!getIclosedKey()) return;
  if (readDB().settings.salesAutoImportOff) return;
  try {
    await syncIclosedUpcoming({ force: true });
    state.lastIclosed = new Date().toISOString();
    state.lastIclosedError = "";
  } catch (e) {
    state.lastIclosedError = e instanceof Error ? e.message : String(e);
    console.warn("[scheduler] iClosed :", state.lastIclosedError);
  }
}

export function startScheduler() {
  if (state.started) return;
  state.started = true;
  let n = 0;
  const run = async () => {
    if (state.running) return;
    state.running = true;
    try {
      await tickSystemeio();
      // iClosed toutes les 5 min : un tick sur deux et demi, on arrondit a un sur deux.
      if (n % Math.round(ICLOSED_EVERY_MS / SIO_EVERY_MS) === 0) await tickIclosed();
    } finally {
      state.running = false;
      n++;
    }
  };
  // Premier passage 20 s apres le demarrage, le temps que tout soit charge.
  setTimeout(() => void run(), 20_000);
  const timer = setInterval(() => void run(), SIO_EVERY_MS);
  // Ne retient pas le processus a l'arret.
  if (typeof timer === "object" && "unref" in timer) timer.unref();
  console.log("[scheduler] synchros automatiques : Systeme.io 2 min, iClosed 5 min");
}
