"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card, CopyButton, useToast } from "@/components/ui";
import { api } from "@/lib/client";
import { relative } from "@/lib/format";
import { ScriptView } from "@/components/sales/ClosingReviewCard";
import type { CallsReviewPayload } from "@/app/api/sales/calls-review/route";

/**
 * Analyse des calls (Fathom + IA), pilotee toute seule : les tuiles de
 * synthese, les enseignements (« pourquoi ca close, pourquoi ca ne close
 * pas ») et, sur le Sales Dashboard, un raccourci vers la page.
 */

const scoreColor = (s: number) => (s >= 8 ? "var(--good)" : s >= 6 ? "var(--warning)" : "var(--critical)");

export function AnalysisStats({ stats }: { stats: CallsReviewPayload["stats"] }) {
  const tile = (label: string, value: string, sub?: string, color?: string) => (
    <div className="card px-4 py-3.5 min-w-0" key={label}>
      <div className="label-xs truncate">{label}</div>
      <div className="text-[24px] font-semibold num leading-none mt-2" style={{ letterSpacing: "-0.03em", color }}>
        {value}
      </div>
      {sub && <div className="dim text-[11.5px] mt-1.5 truncate">{sub}</div>}
    </div>
  );
  const f = (v: number | null) => (v === null ? "—" : `${v.toFixed(1).replace(".", ",")}/10`);
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
      {tile("Calls enregistrés", String(stats.recorded), `${stats.reviewed} analysés · ${stats.pending} en attente`)}
      {tile("Note moyenne", f(stats.avg), "qualité du closing, tous calls", stats.avg === null ? undefined : scoreColor(stats.avg))}
      {tile("Closés", f(stats.avgWon), `${stats.won} calls closés analysés`, "var(--good)")}
      {tile("Perdus", f(stats.avgLost), `${stats.lost} calls perdus analysés`, "var(--critical)")}
      {tile("Dernière analyse", stats.lastReviewAt ? relative(stats.lastReviewAt) : "—", "automatique, dans l'heure qui suit le call")}
      {tile("Pilote", stats.autopilotAt ? relative(stats.autopilotAt) : "—", "dernier passage du pilote automatique")}
    </div>
  );
}

export function InsightsCard({ insights, onRefresh, busy }: { insights: CallsReviewPayload["insights"]; onRefresh: () => void; busy: boolean }) {
  return (
    <Card
      title="Pourquoi ça close, pourquoi ça ne close pas"
      subtitle="écrit par l'IA du tool à partir de toutes les analyses, mis à jour tout seul quand de nouveaux calls arrivent"
      actions={
        <div className="flex items-center gap-1.5">
          {insights && <CopyButton text={insights.text} label="Copier" />}
          <button type="button" className="btn btn-sm" onClick={onRefresh} disabled={busy}>
            {busy ? "Rédaction…" : insights ? "Mettre à jour" : "Rédiger"}
          </button>
        </div>
      }
    >
      {insights ? (
        <>
          <ScriptView text={insights.text} />
          <div className="dim text-[11.5px] mt-3">
            Rédigé {relative(insights.at)} à partir de {insights.calls} call{insights.calls > 1 ? "s" : ""} analysé{insights.calls > 1 ? "s" : ""}.
          </div>
        </>
      ) : (
        <p className="dim text-[13px] leading-relaxed">Dès qu&apos;au moins un call est analysé, les enseignements s&apos;écrivent ici tout seuls : ce qui fait closer, ce qui fait perdre, les objections récurrentes et la meilleure réponse, les points à travailler.</p>
      )}
    </Card>
  );
}

/** Sales Dashboard : le raccourci vers l'analyse des calls, avec l'essentiel. */
export function CallsAnalysisTeaser() {
  const toast = useToast();
  const [data, setData] = useState<CallsReviewPayload | null>(null);
  useEffect(() => {
    api<CallsReviewPayload>("/api/sales/calls-review?light=1")
      .then(setData)
      .catch((e: Error) => toast(e.message, "err"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!data) return null;
  const s = data.stats;
  const n1 = (v: number | null) => (v === null ? "—" : v.toFixed(1).replace(".", ","));
  return (
    <Link href="/sales/analyse" className="card px-4 py-3.5 flex items-center gap-4 hover:bg-[var(--surface-2)] transition-colors">
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-[14px]">Analyse des calls (Fathom + IA) →</div>
        <div className="dim text-[12.5px] mt-0.5">
          {!data.configured
            ? "Aucune clé Fathom : à poser dans Réglages pour que chaque call enregistré soit analysé tout seul."
            : s.reviewed === 0
              ? `${s.recorded} call${s.recorded > 1 ? "s" : ""} enregistré${s.recorded > 1 ? "s" : ""}, analyse automatique en attente.`
              : `${s.reviewed} call${s.reviewed > 1 ? "s" : ""} analysé${s.reviewed > 1 ? "s" : ""} · note moyenne ${n1(s.avg)}/10 · closés ${n1(s.avgWon)} · perdus ${n1(s.avgLost)}${data.insights ? ` · enseignements ${relative(data.insights.at)}` : ""}`}
        </div>
      </div>
      {s.nextTime && (
        <div className="hidden md:block max-w-[380px] text-[12.5px] rounded-lg px-3 py-2" style={{ background: "color-mix(in srgb, var(--accent) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--accent) 35%, transparent)" }}>
          🎯 <strong>Prochain call :</strong> {s.nextTime}
        </div>
      )}
    </Link>
  );
}
