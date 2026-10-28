"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { AnalysisStats, InsightsCard } from "@/components/sales/CallsAnalysis";
import { ClosingReviewCard } from "@/components/sales/ClosingReviewCard";
import { ErrorNote, PageHeader, Spinner, useToast } from "@/components/ui";
import { api } from "@/lib/client";
import type { CallsReviewPayload } from "@/app/api/sales/calls-review/route";

const ACCENT = { "--accent": "#006dbc", "--accent-hover": "#005a9c", "--accent-soft": "#e6f1fa", "--accent-ring": "#9cc9ea", "--grad-accent": "linear-gradient(135deg, #006dbc 0%, #2a8fd8 100%)" } as CSSProperties;

/**
 * Analyse des calls : chaque call enregistre par Fathom est relu par l'IA
 * tout seul (dans l'heure qui suit), les enseignements et le script de
 * closing se mettent a jour sans rien demander. Ici : la synthese, les
 * enseignements, puis chaque call avec son debrief.
 */
export default function CallsAnalysisPage() {
  const toast = useToast();
  const [data, setData] = useState<CallsReviewPayload | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<CallsReviewPayload>("/api/sales/calls-review?light=1"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(t);
  }, [load]);

  const refreshInsights = async () => {
    setBusy(true);
    try {
      await api("/api/sales/calls-review", { method: "POST", body: JSON.stringify({ action: "insights" }), timeoutMs: 300_000 });
      await load();
      toast("Enseignements mis à jour.");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={ACCENT}>
      <PageHeader title="Analyse des calls" subtitle="Fathom enregistre, l'IA relit : chaque call closé ou perdu est analysé tout seul, les enseignements et ton script se mettent à jour sans rien demander." />
      {error && (
        <div className="mb-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      {!data && !error && <Spinner label="Chargement…" />}
      {data && (
        <div className="flex flex-col gap-4">
          {!data.configured && (
            <div className="rounded-lg px-3.5 py-2.5 text-[12.5px]" style={{ background: "color-mix(in srgb, var(--warning) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--warning) 35%, transparent)" }}>
              Aucune clé Fathom : ajoute-la dans Réglages → Fathom. Sans elle, aucun enregistrement n&apos;arrive et rien ne s&apos;analyse.
            </div>
          )}
          <AnalysisStats stats={data.stats} />
          <InsightsCard insights={data.insights} onRefresh={() => void refreshInsights()} busy={busy} />
          <ClosingReviewCard currency={data.currency} />
        </div>
      )}
    </div>
  );
}
