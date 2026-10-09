"use client";

import { useState } from "react";
import Link from "next/link";
import { fmtMoney } from "@/lib/format";
import { fmtMetric, leadGoalFor, METRIC_BY_KEY } from "@/lib/mediabuying/metrics";
import { PHASE_LABEL, PHASES, type EntityRow, type MediaBuyingSettings, type Phase, type RankingMetric } from "@/lib/mediabuying/types";
import { GoalBar, HealthBadge, MetricValue, PHASE_COLOR, StatusDot, VerdictBadge, WinnerTag } from "./bits";

/**
 * Les trois phases en colonnes. Chaque campagne apparait sous la sienne ;
 * on la glisse d'une colonne a l'autre pour la reclasser — classification
 * INTERNE : Meta n'est jamais touche.
 */
export function PhaseBoard({
  campaigns,
  settings,
  currency,
  conversionsConnected,
  onPhase,
  onOpen,
}: {
  campaigns: EntityRow[];
  settings: MediaBuyingSettings;
  currency: string;
  conversionsConnected: boolean;
  onPhase: (campaignId: string, phase: Phase) => void;
  onOpen: (campaignId: string) => void;
}) {
  const [over, setOver] = useState<Phase | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const columns: Phase[] = [...PHASES, ...(campaigns.some((c) => c.phase === "unclassified") ? (["unclassified"] as Phase[]) : [])];

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3" style={columns.length === 4 ? { gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))" } : undefined}>
      {columns.map((phase) => {
        const list = campaigns.filter((c) => c.phase === phase).sort((a, b) => b.metrics.spend - a.metrics.spend);
        const spend = list.reduce((s, c) => s + c.metrics.spend, 0);
        const leads = list.reduce((s, c) => s + c.metrics.leads, 0);
        const goal = phase === "unclassified" ? 0 : leadGoalFor(phase, settings);
        return (
          <section
            key={phase}
            className="card flex flex-col min-h-[220px]"
            style={{ borderTop: `3px solid ${PHASE_COLOR[phase]}`, outline: over === phase ? `2px dashed ${PHASE_COLOR[phase]}` : "none", outlineOffset: -4 }}
            onDragOver={(e) => {
              e.preventDefault();
              if (over !== phase) setOver(phase);
            }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData("text/campaign") || dragging;
              setOver(null);
              setDragging(null);
              if (id) onPhase(id, phase);
            }}
          >
            <header className="px-3.5 pt-3 pb-2.5" style={{ borderBottom: "1px solid var(--border)" }}>
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="mono text-[11px] uppercase tracking-wide font-semibold" style={{ color: PHASE_COLOR[phase] }}>
                  {PHASE_LABEL[phase]}
                </h3>
                <span className="dim text-[11px] num">
                  {list.length} camp. · {fmtMoney(spend, currency)}
                </span>
              </div>
              {goal > 0 && (
                <div className="mt-2">
                  <GoalBar value={leads} goal={goal} />
                </div>
              )}
            </header>
            <div className="flex flex-col gap-2 p-2.5 flex-1">
              {list.length === 0 && <div className="dim text-[12px] text-center py-6">Glisse une campagne ici.</div>}
              {list.map((c) => {
                const m = c.metrics;
                const b = c.budget;
                return (
                  <div
                    key={c.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/campaign", c.id);
                      setDragging(c.id);
                    }}
                    onDragEnd={() => setDragging(null)}
                    onClick={() => onOpen(c.id)}
                    className="card-flat px-3 py-2.5 cursor-grab active:cursor-grabbing"
                    style={{ opacity: dragging === c.id ? 0.5 : 1, borderLeft: `3px solid ${PHASE_COLOR[phase]}` }}
                    title="Glisser pour reclasser · cliquer pour ouvrir"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-[12.5px] font-semibold leading-snug min-w-0" style={{ overflowWrap: "anywhere" }}>
                        {c.name}
                      </div>
                      <StatusDot status={c.status} label={false} />
                    </div>
                    <div className="dim text-[11px] num mt-1">
                      {b ? `${fmtMoney(b.amount, currency)}${b.type === "daily" ? "/jour" : " total"}${b.level === "adset" ? " (ABO)" : " (CBO)"}` : "sans budget"}
                    </div>
                    <div className="grid grid-cols-3 gap-x-2 mt-2 text-[12px]">
                      <div>
                        <div className="label-xs !text-[9.5px]">Spend</div>
                        <div className="font-semibold num">{fmtMoney(m.spend, currency)}</div>
                      </div>
                      <div>
                        <div className="label-xs !text-[9.5px]">Leads</div>
                        <div className="font-semibold num">{m.leads}</div>
                      </div>
                      <div>
                        <div className="label-xs !text-[9.5px]">CPL</div>
                        <div className="font-semibold num">{fmtMetric("cpl", m.cpl, currency)}</div>
                      </div>
                      {phase === "hyper-scaling" && conversionsConnected && (
                        <>
                          <div>
                            <div className="label-xs !text-[9.5px]">Sales</div>
                            <div className="font-semibold num">{m.sales ?? "—"}</div>
                          </div>
                          <div>
                            <div className="label-xs !text-[9.5px]">CAC</div>
                            <div className="font-semibold num">{fmtMetric("cac", m.cac, currency)}</div>
                          </div>
                          <div>
                            <div className="label-xs !text-[9.5px]">ROAS</div>
                            <div className="font-semibold num">{fmtMetric("roas", m.roas, currency)}</div>
                          </div>
                        </>
                      )}
                      {phase !== "hyper-scaling" && conversionsConnected && (
                        <>
                          <div>
                            <div className="label-xs !text-[9.5px]">Bookings</div>
                            <div className="font-semibold num">{m.bookings ?? "—"}</div>
                          </div>
                          <div>
                            <div className="label-xs !text-[9.5px]">Show rate</div>
                            <div className="font-semibold num">{fmtMetric("showRate", m.showRate, currency)}</div>
                          </div>
                          <div>
                            <div className="label-xs !text-[9.5px]">CTR</div>
                            <div className="font-semibold num">{fmtMetric("ctrLink", m.ctrLink, currency)}</div>
                          </div>
                        </>
                      )}
                    </div>
                    {c.leadGoal ? (
                      <div className="mt-2">
                        <GoalBar value={m.leads} goal={c.leadGoal} />
                      </div>
                    ) : null}
                    <div className="flex items-center justify-between gap-2 mt-2">
                      <HealthBadge health={c.health} />
                      <VerdictBadge rec={c.recommendation} compact />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

const RANKINGS: { key: RankingMetric; label: string }[] = [
  { key: "costPerBooking", label: "Cost / Booking" },
  { key: "bookings", label: "Bookings" },
  { key: "sales", label: "Ventes" },
  { key: "cac", label: "CAC" },
  { key: "roas", label: "ROAS" },
  { key: "cpl", label: "CPL" },
];

/** Classement des creatives selon la metrique business choisie. */
export function TopCreatives({ ads, currency, conversionsConnected, ranking, onRanking, onOpen }: { ads: EntityRow[]; currency: string; conversionsConnected: boolean; ranking: RankingMetric; onRanking: (r: RankingMetric) => void; onOpen: (ad: EntityRow) => void }) {
  const def = METRIC_BY_KEY.get(ranking);
  const usable = conversionsConnected || !def?.business ? ranking : "cpl";
  const udef = METRIC_BY_KEY.get(usable);
  const list = ads
    .filter((a) => a.metrics.spend > 0 && a.metrics[usable] !== null && a.metrics[usable] !== undefined)
    .sort((a, b) => {
      const x = a.metrics[usable] as number;
      const y = b.metrics[usable] as number;
      // Priorite business a egalite : ventes, puis bookings, puis leads.
      return (udef?.lowerIsBetter ? x - y : y - x) || (b.metrics.sales ?? 0) - (a.metrics.sales ?? 0) || (b.metrics.bookings ?? 0) - (a.metrics.bookings ?? 0) || b.metrics.leads - a.metrics.leads;
    })
    .slice(0, 6);
  return (
    <section className="card">
      <div className="flex items-center justify-between gap-2 px-4 pt-3.5 pb-2.5" style={{ borderBottom: "1px solid var(--border)" }}>
        <h3 className="text-[15px] font-semibold">Top créatives</h3>
        <select className="select select-xs !w-auto" value={ranking} onChange={(e) => onRanking(e.target.value as RankingMetric)} title="Classer par">
          {RANKINGS.map((r) => (
            <option key={r.key} value={r.key} disabled={!conversionsConnected && Boolean(METRIC_BY_KEY.get(r.key)?.business)}>
              {r.label}
            </option>
          ))}
        </select>
      </div>
      <ol className="flex flex-col">
        {list.length === 0 && <li className="dim text-[12.5px] px-4 py-5">Pas encore de créative avec de la dépense sur la période.</li>}
        {list.map((a, i) => (
          <li key={a.id} className="flex items-center gap-3 px-4 py-2 row-hover cursor-pointer" style={{ borderBottom: "1px solid var(--border)" }} onClick={() => onOpen(a)}>
            <span className="mono text-[12px] w-[22px] shrink-0" style={{ color: "var(--text-3)" }}>
              #{i + 1}
            </span>
            <div className="rounded-[6px] overflow-hidden shrink-0" style={{ width: 34, height: 42, background: "var(--surface-3)" }}>
              {a.creative?.thumbnailUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.creative.thumbnailUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold">{a.name}</span>
                <WinnerTag value={a.winnerStatus} />
              </div>
              <div className="dim text-[11.5px] num truncate">
                {a.metrics.leads} lead{a.metrics.leads > 1 ? "s" : ""}
                {conversionsConnected ? ` · ${a.metrics.bookings ?? 0} booking${(a.metrics.bookings ?? 0) > 1 ? "s" : ""} · ${a.metrics.sales ?? 0} vente${(a.metrics.sales ?? 0) > 1 ? "s" : ""}` : ""}
                {` · CPL ${fmtMetric("cpl", a.metrics.cpl, currency)}`}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-[13.5px] font-semibold num">
                <MetricValue k={usable} v={a.metrics[usable]} currency={currency} />
              </div>
              <div className="label-xs !text-[9.5px]">{udef?.short}</div>
            </div>
          </li>
        ))}
      </ol>
      <div className="px-4 py-2 text-[11px] dim flex items-center justify-between">
        <span>Priorité business : vente &gt; show &gt; booking &gt; lead.</span>
        <Link href="/mediabuying/campaigns?level=ad" className="link">
          Toutes les ads →
        </Link>
      </div>
    </section>
  );
}
