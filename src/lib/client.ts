"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CollectionName } from "./types";

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const msg = (body as { error?: string })?.error ?? `Erreur ${res.status}`;
    throw new Error(msg);
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

/** Vide le cache d'une collection, ou tout le cache. */
export function invalidate(name?: CollectionName) {
  if (!name) CACHE.clear();
  else for (const k of [...CACHE.keys()]) if (k.startsWith(name)) CACHE.delete(k);
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
  opts: { light?: boolean } = {},
) {
  const light = Boolean(opts.light);
  const key = light ? `${name}:light` : name;

  const [rows, setRows] = useState<T[]>(() => (CACHE.get(key) as T[]) ?? []);
  // Deja en cache : rien a attendre, l'ecran s'affiche tout de suite.
  const [loading, setLoading] = useState(!CACHE.has(key));
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const data = await api<T[]>(`/api/data/${name}${light ? "?light=1" : ""}`);
      CACHE.set(key, data);
      setRows(data);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [name, key, light]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const create = useCallback(
    async (row: Partial<T>) => {
      const created = await api<T>(`/api/data/${name}`, { method: "POST", body: JSON.stringify(row) });
      setRows((prev) => {
        const next = [created, ...prev];
        CACHE.set(key, next);
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
