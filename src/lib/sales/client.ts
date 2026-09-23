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
    api<Session>("/api/sales/session")
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
 */
export function useSalesData<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(url));
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!url) return;
    setLoading(true);
    try {
      setData(await api<T>(url));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    void reload();
  }, [reload]);

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
