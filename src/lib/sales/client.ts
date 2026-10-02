"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "../client";
import type { Session } from "../types";
import type { PeriodKey } from "./period";

/**
 * Acces client aux routes du module.
 *
 * Volontairement separe de `useCollection` : celui-ci tape `/api/data/*`, qui
 * renvoie une collection entiere sans notion d'attribution. Le module
 * commercial ne lit que des routes agregees et cloisonnees.
 */

/** Session courante, chargee une fois et partagee par tous les ecrans. */
let sessionCache: Session | null = null;
/** Appel en cours : le Shell, le menu et la page montent ensemble et partagent la meme requete. */
let sessionPending: Promise<Session> | null = null;

export function useSession() {
  /*
   * Etat initial toujours vide, meme si le cache est deja rempli.
   *
   * Le Shell charge la session en premier ; quand une page arrive ensuite en
   * streaming, son HTML serveur a ete rendu « sans session » alors que le
   * cache client est deja plein. Partir du cache au premier rendu faisait
   * diverger les deux arbres et React signalait une erreur d'hydratation a
   * chaque ouverture de l'espace commercial.
   */
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (sessionCache) {
      setSession(sessionCache);
      setLoading(false);
      return;
    }
    let alive = true;
    if (!sessionPending) {
      sessionPending = api<Session>("/api/sales/session").finally(() => { sessionPending = null; });
    }
    sessionPending
      .then((s) => {
        sessionCache = s;
        if (alive) setSession(s);
      })
      .catch(() => {
        if (alive) setSession(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  return { session, loading };
}

export function forgetSession() {
  sessionCache = null;
}

/**
 * Chargement d'une route du module, avec rechargement a la demande.
 *
 * `deps` sert a relancer la requete quand un filtre change ; `reload` sert a
 * la rejouer apres une ecriture, pour que les compteurs suivent sans que
 * l'utilisateur ait a rafraichir la page.
 *
 * `every` (ms) : rechargement silencieux a intervalle regulier tant que
 * l'onglet est visible, et des que l'onglet redevient visible. Les setters
 * travaillent sur la meme liste de leads : ce que l'un statue doit
 * disparaitre chez l'autre sans qu'il ait a recharger. Silencieux = sans
 * passer par `loading`, pour ne pas faire clignoter la page.
 */
export function useSalesData<T>(url: string | null, opts: { every?: number } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(url));
  const [error, setError] = useState<string | null>(null);
  const every = opts.every ?? 0;

  const reload = useCallback(async (silent = false) => {
    if (!url) return;
    if (!silent) setLoading(true);
    try {
      setData(await api<T>(url));
      setError(null);
    } catch (e) {
      // En arriere-plan, une coupure passagere ne doit pas remplacer la liste par une erreur.
      if (!silent) setError((e as Error).message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!every || !url || typeof document === "undefined") return;
    let inflight = false;
    const tick = () => {
      if (document.visibilityState !== "visible" || inflight) return;
      inflight = true;
      void reload(true).finally(() => {
        inflight = false;
      });
    };
    const timer = setInterval(tick, every);
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [every, url, reload]);

  return { data, loading, error, reload, setData };
}

/** Construit la query string d'une periode, filtres compris. */
export function periodQuery(
  period: PeriodKey,
  from: string,
  to: string,
  extra: Record<string, string> = {},
): string {
  const p = new URLSearchParams({ period });
  if (period === "custom") {
    if (from) p.set("from", from);
    if (to) p.set("to", to);
  }
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
  return p.toString();
}
