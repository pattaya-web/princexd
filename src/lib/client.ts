"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
 * Accès CRUD à une collection. Optimiste sur les mutations pour que l'UI
 * reste réactive, avec resynchronisation depuis la réponse serveur.
 */
export function useCollection<T extends { id: string }>(name: CollectionName) {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setRows(await api<T[]>(`/api/data/${name}`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [name]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const create = useCallback(
    async (row: Partial<T>) => {
      const created = await api<T>(`/api/data/${name}`, { method: "POST", body: JSON.stringify(row) });
      setRows((prev) => [created, ...prev]);
      return created;
    },
    [name],
  );

  const patch = useCallback(
    async (id: string, changes: Partial<T>) => {
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...changes } : r)));
      const saved = await api<T>(`/api/data/${name}`, {
        method: "PATCH",
        body: JSON.stringify({ id, ...changes }),
      });
      setRows((prev) => prev.map((r) => (r.id === id ? saved : r)));
      return saved;
    },
    [name],
  );

  const destroy = useCallback(
    async (id: string) => {
      setRows((prev) => prev.filter((r) => r.id !== id));
      await api(`/api/data/${name}?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    },
    [name],
  );

  return { rows, setRows, loading, error, reload, create, patch, destroy };
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
