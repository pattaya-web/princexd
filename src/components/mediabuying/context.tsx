"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/client";
import { useToast } from "@/components/ui";
import type { RangePreset } from "@/lib/mediabuying/metrics";
import type { AuditEntityType, Overview, PublicConnection } from "@/lib/mediabuying/types";

/**
 * Etat partage du module media buying : compte selectionne, periode,
 * vue agregee, synchro. Une seule requete (`/overview`) nourrit toutes les
 * pages ; les actions passent par `act()` qui rafraichit derriere.
 */

export interface MbCtx {
  connections: PublicConnection[];
  connection: PublicConnection | null;
  setConnectionId: (id: string) => void;
  reloadConnections: () => Promise<void>;
  preset: RangePreset;
  setPreset: (p: RangePreset) => void;
  custom: { from: string; to: string };
  setCustom: (r: { from: string; to: string }) => void;
  overview: Overview | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  sync: () => Promise<void>;
  syncing: boolean;
  /** Horloge qui bat toutes les 5 s : fait vivre « il y a 18 s ». */
  now: number;
  currency: string;
  /** Appel de mutation : toast en cas d'erreur, rechargement ensuite. */
  act: <T>(url: string, init: RequestInit, okMessage?: string) => Promise<T | null>;
  /** Journalise un evenement navigateur (copie d'un Post ID…). */
  logEvent: (entityType: AuditEntityType, entityId: string, entityName: string, action: string, summary: string) => void;
}

const Ctx = createContext<MbCtx | null>(null);

export const useMb = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useMb hors du module media buying");
  return c;
};

const LS_CONN = "mb.connection";
const LS_PRESET = "mb.preset";

function readLs(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}
function writeLs(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* navigation privee */
  }
}

export function MbProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [connections, setConnections] = useState<PublicConnection[]>([]);
  const [connectionId, setConnId] = useState<string>("");
  const [preset, setPresetState] = useState<RangePreset>("last7");
  const [custom, setCustomState] = useState({ from: "", to: "" });
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [ready, setReady] = useState(false);
  const inflight = useRef(0);

  // Preferences locales : compte et periode retenus d'une visite a l'autre.
  useEffect(() => {
    const p = readLs(LS_PRESET) as RangePreset;
    if (p) setPresetState(p);
    setConnId(readLs(LS_CONN));
    setReady(true);
  }, []);

  const reloadConnections = useCallback(async () => {
    try {
      const r = await api<{ rows: PublicConnection[] }>("/api/mediabuying/connections");
      setConnections(r.rows);
      setConnId((cur) => (cur && r.rows.some((c) => c.id === cur) ? cur : (r.rows[0]?.id ?? "")));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (ready) void reloadConnections();
  }, [ready, reloadConnections]);

  const url = useMemo(() => {
    if (!connectionId) return null;
    const p = new URLSearchParams({ connectionId, preset });
    if (preset === "custom") {
      if (custom.from) p.set("from", custom.from);
      if (custom.to) p.set("to", custom.to);
    }
    return `/api/mediabuying/overview?${p}`;
  }, [connectionId, preset, custom]);

  const reload = useCallback(async () => {
    if (!url) {
      setOverview(null);
      setLoading(false);
      return;
    }
    const n = ++inflight.current;
    setLoading(true);
    try {
      const data = await api<Overview>(url, { timeoutMs: 90_000 });
      // Une reponse plus ancienne qu'une requete deja partie est ignoree.
      if (n === inflight.current) {
        setOverview(data);
        setError(null);
      }
    } catch (e) {
      if (n === inflight.current) setError((e as Error).message);
    } finally {
      if (n === inflight.current) setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    if (ready) void reload();
  }, [ready, reload]);

  // Rafraichissement silencieux toutes les 60 s quand l'onglet est visible.
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible" && !syncing) void reload();
    }, 60_000);
    return () => clearInterval(t);
  }, [reload, syncing]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(t);
  }, []);

  const sync = useCallback(async () => {
    if (!connectionId) return;
    setSyncing(true);
    try {
      const r = await api<{ syncMs: number; campaigns: number; ads: number; error: string }>(`/api/mediabuying/sync?connectionId=${connectionId}&force=1`, { method: "POST", timeoutMs: 120_000 });
      toast(`Meta synchronisé en ${(r.syncMs / 1000).toFixed(1).replace(".", ",")} s : ${r.campaigns} campagnes, ${r.ads} ads.`);
      await reload();
      void reloadConnections();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setSyncing(false);
    }
  }, [connectionId, reload, reloadConnections, toast]);

  const act = useCallback(
    async <T,>(u: string, init: RequestInit, okMessage?: string): Promise<T | null> => {
      try {
        const r = await api<T>(u, init);
        if (okMessage) toast(okMessage);
        void reload();
        return r;
      } catch (e) {
        toast((e as Error).message, "err");
        return null;
      }
    },
    [reload, toast],
  );

  const logEvent = useCallback(
    (entityType: AuditEntityType, entityId: string, entityName: string, action: string, summary: string) => {
      if (!connectionId) return;
      void api("/api/mediabuying/audit", { method: "POST", body: JSON.stringify({ connectionId, entityType, entityId, entityName, action, summary }) }).catch(() => undefined);
    },
    [connectionId],
  );

  const value: MbCtx = {
    connections,
    connection: connections.find((c) => c.id === connectionId) ?? null,
    setConnectionId: (id) => {
      setConnId(id);
      writeLs(LS_CONN, id);
    },
    reloadConnections,
    preset,
    setPreset: (p) => {
      setPresetState(p);
      writeLs(LS_PRESET, p);
    },
    custom,
    setCustom: setCustomState,
    overview,
    loading,
    error,
    reload,
    sync,
    syncing,
    now,
    currency: overview?.currency ?? "EUR",
    act,
    logEvent,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
