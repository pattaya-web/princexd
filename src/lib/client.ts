"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CollectionName } from "./types";

/**
 * Appel JSON vers le serveur.
 *
 * `timeoutMs` borne l'attente : au-dela, l'appel echoue avec un message
 * lisible au lieu de laisser un bouton tourner sans fin quand le serveur ou
 * le reseau ne repond plus.
 */
/**
 * Appel JSON au serveur.
 *
 * `job: true` : la route tourne en tache de fond sur le serveur (voir
 * lib/bg-jobs). Le premier appel recoit un identifiant, puis on interroge
 * toutes les 2 s jusqu'a la vraie reponse, rejouee telle quelle. Aucune
 * requete ne dure plus de quelques secondes : le proxy ne peut plus couper
 * un traitement long en « Erreur 502 ». `timeoutMs` devient alors la duree
 * totale acceptee (10 min par defaut).
 */
/** Erreur renvoyée par `api` : `gateway` = réponse du proxy sans l'application (redémarrage, connexion coupée). */
export type ApiError = Error & { status?: number; gateway?: boolean };

export async function api<T>(url: string, init?: RequestInit & { timeoutMs?: number; job?: boolean }): Promise<T> {
  const { timeoutMs, job, ...rest } = init ?? {};
  const perCall = job ? 30_000 : timeoutMs;
  const fetchOnce = async (u: string, opts: RequestInit, signalMs: number | undefined) => {
    try {
      return await fetch(u, { ...opts, ...(signalMs ? { signal: AbortSignal.timeout(signalMs) } : {}) });
    } catch (e) {
      const name = (e as Error).name;
      if (name === "TimeoutError" || name === "AbortError") {
        throw new Error(`Le serveur n'a pas répondu en ${Math.max(1, Math.round((signalMs ?? 0) / 60_000))} min. Réessaie, ou vérifie ta connexion.`);
      }
      throw new Error("Connexion au serveur impossible. Vérifie ta connexion et réessaie.");
    }
  };
  let res = await fetchOnce(url, { ...rest, headers: { "Content-Type": "application/json", ...(job ? { "x-bg-job": "1" } : {}), ...(rest.headers ?? {}) } }, perCall);
  if (job && res.status === 202) {
    const { jobId } = (await res.json().catch(() => ({}))) as { jobId?: string };
    if (jobId) {
      const pollUrl = `${url}${url.includes("?") ? "&" : "?"}job=${encodeURIComponent(jobId)}`;
      const deadline = Date.now() + (timeoutMs ?? 10 * 60_000);
      for (;;) {
        await new Promise((r) => setTimeout(r, 2_000));
        if (Date.now() > deadline) throw new Error("Le traitement n'a pas abouti dans le temps imparti. Réessaie dans un instant.");
        try {
          res = await fetchOnce(pollUrl, { method: "GET", cache: "no-store" }, 20_000);
        } catch {
          // Coupure passagere (reseau, proxy) : la tache tourne toujours, on reinterroge.
          continue;
        }
        if (res.status === 202) continue;
        if ([502, 503, 504].includes(res.status) && !(res.headers.get("content-type") ?? "").includes("json")) continue;
        break;
      }
    }
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const known = (body as { error?: string })?.error;
    // Pas de corps JSON et 502 / 503 / 504 : la reponse vient du proxy, pas de l'application
    // (conteneur en cours de redemarrage apres un deploiement, ou requete trop longue pour lui).
    const gateway = !known && [502, 503, 504].includes(res.status);
    const err: ApiError = new Error(known ?? (gateway ? `Le serveur a été interrompu (mise à jour en cours ou réponse trop longue, erreur ${res.status}). Réessaie dans une minute.` : `Erreur ${res.status}`));
    err.status = res.status;
    err.gateway = gateway;
    throw err;
  }
  return body as T;
}

/**
 * Cache memoire partage entre les pages.
 *
 * Sans lui, changer d'onglet retelechargeait chaque collection depuis zero —
 * plusieurs centaines de kilo-octets a chaque navigation. On affiche donc
 * immediatement ce qu'on avait, puis on revalide en fond.
 */
const CACHE = new Map<string, unknown[]>();

/*
 * Copie persistante dans le navigateur.
 *
 * Depuis Dubai, chaque aller-retour vers le serveur (Paris) coute 300 ms :
 * une page qui attend ses collections reste vide une bonne seconde. On garde
 * donc la derniere version de chaque collection dans localStorage : au retour
 * sur le site, l'ecran se remplit instantanement avec elle, puis le serveur
 * la remplace des qu'il repond. Les collections trop lourdes (au-dela de
 * 1,5 Mo) ne sont pas persistees pour rester sous le quota du navigateur.
 */
const PERSIST_PREFIX = "col:";
const PERSIST_MAX = 1_500_000;

function readPersisted(key: string): unknown[] | null {
  try {
    const raw = window.localStorage.getItem(PERSIST_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function persist(key: string, rows: unknown[]) {
  try {
    const raw = JSON.stringify(rows);
    if (raw.length > PERSIST_MAX) {
      window.localStorage.removeItem(PERSIST_PREFIX + key);
      return;
    }
    window.localStorage.setItem(PERSIST_PREFIX + key, raw);
  } catch {
    // Quota atteint ou stockage indisponible : le cache memoire suffit.
  }
}

/** Vide le cache d'une collection, ou tout le cache. */
export function invalidate(name?: CollectionName) {
  if (!name) CACHE.clear();
  else for (const k of [...CACHE.keys()]) if (k.startsWith(name)) CACHE.delete(k);
  try {
    for (const k of Object.keys(window.localStorage)) {
      if (k.startsWith(PERSIST_PREFIX) && (!name || k.startsWith(PERSIST_PREFIX + name))) {
        window.localStorage.removeItem(k);
      }
    }
  } catch {
    // Ignore.
  }
}

/**
 * Accès CRUD à une collection. Optimiste sur les mutations pour que l'UI
 * reste réactive, avec resynchronisation depuis la réponse serveur.
 *
 * `light` demande la version allegee : le serveur retire les champs lourds
 * (transcriptions, plans de tournage) dont les listes n'ont pas besoin.
 */
export function useCollection<T extends { id: string }>(
  name: CollectionName,
  opts: { light?: boolean; skip?: boolean } = {},
) {
  const light = Boolean(opts.light);
  /** `skip` : ne rien charger (collection fermée à ce rôle) ; les lignes restent vides. */
  const skip = Boolean(opts.skip);
  const key = light ? `${name}:light` : name;

  const [rows, setRows] = useState<T[]>(() => (CACHE.get(key) as T[]) ?? []);
  // Deja en cache : rien a attendre, l'ecran s'affiche tout de suite.
  const [loading, setLoading] = useState(!CACHE.has(key));

  // Copie persistante : affichee des le montage, en attendant le serveur.
  // (Apres l'hydratation, pour que serveur et client rendent la meme chose.)
  useEffect(() => {
    if (skip || CACHE.has(key)) return;
    const saved = readPersisted(key) as T[] | null;
    if (saved && saved.length) {
      CACHE.set(key, saved);
      setRows(saved);
      setLoading(false);
    }
  }, [key, skip]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (skip) {
      setLoading(false);
      return;
    }
    try {
      const data = await api<T[]>(`/api/data/${name}${light ? "?light=1" : ""}`);
      CACHE.set(key, data);
      persist(key, data);
      setRows(data);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [name, key, light, skip]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const create = useCallback(
    async (row: Partial<T>) => {
      const created = await api<T>(`/api/data/${name}`, { method: "POST", body: JSON.stringify(row) });
      setRows((prev) => {
        const next = [created, ...prev];
        CACHE.set(key, next);
        persist(key, next);
        return next;
      });
      return created;
    },
    [name, key],
  );

  const patch = useCallback(
    async (id: string, changes: Partial<T>) => {
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...changes } : r)));
      const saved = await api<T>(`/api/data/${name}`, {
        method: "PATCH",
        body: JSON.stringify({ id, ...changes }),
      });
      setRows((prev) => {
        const next = prev.map((r) => (r.id === id ? saved : r));
        CACHE.set(key, next);
        persist(key, next);
        return next;
      });
      return saved;
    },
    [name, key],
  );

  const destroy = useCallback(
    async (id: string) => {
      setRows((prev) => {
        const next = prev.filter((r) => r.id !== id);
        CACHE.set(key, next);
        persist(key, next);
        return next;
      });
      await api(`/api/data/${name}?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    },
    [name, key],
  );

  /** Suppression d'une selection, en un seul aller-retour. */
  const destroyMany = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      const doomed = new Set(ids);
      setRows((prev) => {
        const next = prev.filter((r) => !doomed.has(r.id));
        CACHE.set(key, next);
        persist(key, next);
        return next;
      });
      await api(`/api/data/${name}?ids=${encodeURIComponent(ids.join(","))}`, { method: "DELETE" });
    },
    [name, key],
  );

  /*
   * Objet memoise : un consommateur qui le met en dependance d'un effet ne
   * doit pas voir cet effet se relancer a chaque rendu. Il ne change que
   * quand les donnees ou l'etat de chargement changent reellement.
   */
  return useMemo(
    () => ({ rows, setRows, loading, error, reload, create, patch, destroy, destroyMany }),
    [rows, loading, error, reload, create, patch, destroy, destroyMany],
  );
}

/** Sauvegarde différée : évite un appel réseau à chaque frappe. */
export function useDebouncedSave<T>(save: (value: T) => void | Promise<void>, delay = 600) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return useCallback(
    (value: T) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void saveRef.current(value), delay);
    },
    [delay],
  );
}

export function useLocalState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) setValue(JSON.parse(raw) as T);
    } catch {
      // Stockage indisponible (navigation privée) : on garde la valeur initiale.
    }
    setReady(true);
  }, [key]);

  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Ignoré : ce n'est qu'un confort d'affichage.
    }
  }, [key, value, ready]);

  return [value, setValue] as const;
}

/* ------------------------------ Voix du Studio ------------------------------ */

export interface VoicesPayload {
  configured: boolean;
  engine?: "elevenlabs-sts" | "kie-tts" | null;
  voices: import("./studio/types").VoiceInfo[];
  error?: string;
}

let voicesCache: { at: number; data: VoicesPayload } | null = null;
let voicesPending: Promise<VoicesPayload> | null = null;

/**
 * Liste des voix, partagee entre le Swap, la Photo qui parle et le choix de
 * voix d'un rendu : trois composants la demandaient chacun au montage.
 * Gardee cinq minutes ; `fresh` force un rechargement (apres un clonage).
 */
export function loadVoices(fresh = false): Promise<VoicesPayload> {
  if (!fresh && voicesCache && Date.now() - voicesCache.at < 5 * 60_000) return Promise.resolve(voicesCache.data);
  if (!voicesPending) {
    voicesPending = api<VoicesPayload>("/api/studio/voices")
      .then((data) => {
        voicesCache = { at: Date.now(), data };
        return data;
      })
      .finally(() => { voicesPending = null; });
  }
  return voicesPending;
}

/** A appeler quand la liste change cote serveur (voix clonee ou supprimee). */
export function forgetVoices() {
  voicesCache = null;
}
