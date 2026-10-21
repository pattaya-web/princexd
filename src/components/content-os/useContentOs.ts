"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { useToast } from "@/components/ui";
import { EMPTY_CONTENT_OS } from "@/lib/content-os";
import type { ContentItem, ContentOsState } from "@/lib/types";

/** État Content OS + contenus, avec les mutations qui enregistrent tout de suite. */
export function useContentOs() {
  const toast = useToast();
  const [state, setState] = useState<ContentOsState>(EMPTY_CONTENT_OS);
  const [items, setItems] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const r = await api<{ state: ContentOsState; items: ContentItem[] }>("/api/content-os");
      setState(r.state);
      setItems(r.items);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const patchState = useCallback(
    async (patch: Record<string, unknown>, optimistic?: (s: ContentOsState) => ContentOsState) => {
      if (optimistic) setState((s) => optimistic(s));
      try {
        const r = await api<{ state: ContentOsState }>("/api/content-os", { method: "PATCH", body: JSON.stringify(patch) });
        setState(r.state);
      } catch (e) {
        toast((e as Error).message, "err");
        void reload();
      }
    },
    [toast, reload],
  );

  const createItem = useCallback(
    async (data: Partial<ContentItem>) => {
      const r = await api<{ item: ContentItem }>("/api/content-os/items", { method: "POST", body: JSON.stringify(data) });
      setItems((list) => [r.item, ...list]);
      return r.item;
    },
    [],
  );

  const updateItem = useCallback(
    async (id: string, data: Partial<ContentItem>) => {
      setItems((list) => list.map((x) => (x.id === id ? { ...x, ...data } : x)));
      try {
        const r = await api<{ item: ContentItem }>("/api/content-os/items", { method: "PATCH", body: JSON.stringify({ id, ...data }) });
        setItems((list) => list.map((x) => (x.id === id ? r.item : x)));
        return r.item;
      } catch (e) {
        toast((e as Error).message, "err");
        void reload();
        return null;
      }
    },
    [toast, reload],
  );

  const deleteItem = useCallback(
    async (id: string) => {
      try {
        await api(`/api/content-os/items?id=${id}`, { method: "DELETE" });
        setItems((list) => list.filter((x) => x.id !== id));
      } catch (e) {
        toast((e as Error).message, "err");
      }
    },
    [toast],
  );

  return { state, items, loading, reload, patchState, createItem, updateItem, deleteItem };
}
