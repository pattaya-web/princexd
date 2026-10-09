"use client";

import { useMemo, useState } from "react";
import { fmtMoney, relative } from "@/lib/format";
import { METRIC_BY_KEY, METRIC_DEFS } from "@/lib/mediabuying/metrics";
import type { EntityLevel, EntityRow, MetricKey, WinnerStatus } from "@/lib/mediabuying/types";
import { Delta, HealthBadge, MetricValue, PhaseBadge, PostIdChip, StatusDot, VerdictBadge, WinnerSelect, WinnerTag } from "./bits";

/* ------------------------------- Colonnes ------------------------------ */

export const DEFAULT_COLUMNS: Record<EntityLevel, MetricKey[]> = {
  campaign: ["spend", "leads", "cpl", "bookings", "costPerBooking", "shows", "showRate", "sales", "cac", "ctrLink", "cpcLink", "lpv", "costPerLpv", "cpm", "frequency"],
  adset: ["spend", "leads", "cpl", "bookings", "costPerBooking", "shows", "showRate", "sales", "cac", "ctrLink", "cpcLink", "lpv", "costPerLpv", "cpm", "frequency"],
  ad: ["spend", "leads", "cpl", "bookings", "costPerBooking", "shows", "showRate", "sales", "cac", "roas", "ctrLink", "cpcLink", "lpv", "costPerLpv", "cpm", "frequency"],
};

export type SortKey = MetricKey | "name" | "status" | "budget" | "health" | "updated";

export interface EntityTableProps {
  level: EntityLevel;
  rows: EntityRow[];
  currency: string;
  columns: MetricKey[];
  conversionsConnected: boolean;
  selected: Set<string>;
  onSelect: (ids: Set<string>) => void;
  onOpen?: (row: EntityRow) => void;
  onToggleStatus: (row: EntityRow) => void;
  onBudget: (row: EntityRow) => void;
  onCreative: (row: EntityRow) => void;
  onWinner: (row: EntityRow, v: WinnerStatus) => void;
  onNotes: (row: EntityRow) => void;
  onDuplicate: (row: EntityRow) => void;
  onCopiedPostId: (row: EntityRow) => void;
  busy: Set<string>;
  /** Comparaison avec la periode precedente (vue Scaling-Testing). */
  showDeltas?: boolean;
  /** Ligne de contexte sous le nom (campagne › ad set quand on liste toutes les ads). */
  subtitle?: (row: EntityRow) => string;
}

const HEALTH_RANK = { strong: 3, watch: 2, weak: 1, none: 0 } as const;

/**
 * Table facon Ads Manager : en-tete collante, tri sur chaque metrique,
 * selection multiple, toggle de statut, budget cliquable, miniature de la
 * creative, Post ID copiable, tag winner, sante et recommandation. Sur
 * telephone, la meme liste devient des cartes avec les actions essentielles.
 */
export function EntityTable(p: EntityTableProps) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "spend", dir: -1 });

  const rows = useMemo(() => {
    const list = [...p.rows];
    const { key, dir } = sort;
    list.sort((a, b) => {
      let x: number | string | null;
      let y: number | string | null;
      if (key === "name") {
        x = a.name;
        y = b.name;
      } else if (key === "status") {
        x = a.status;
        y = b.status;
      } else if (key === "budget") {
        x = a.budget?.amount ?? null;
        y = b.budget?.amount ?? null;
      } else if (key === "health") {
        x = HEALTH_RANK[a.health];
        y = HEALTH_RANK[b.health];
      } else if (key === "updated") {
        x = a.updatedTime;
        y = b.updatedTime;
      } else {
        x = a.metrics[key];
        y = b.metrics[key];
      }
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      if (typeof x === "string" || typeof y === "string") return String(x).localeCompare(String(y), undefined, { numeric: true }) * dir;
      return (x - y) * dir;
    });
    return list;
  }, [p.rows, sort]);

  const toggleSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "name" ? 1 : -1 }));
  const allSelected = rows.length > 0 && rows.every((r) => p.selected.has(r.id));
  const toggleAll = () => p.onSelect(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  const toggleOne = (id: string) => {
    const next = new Set(p.selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    p.onSelect(next);
  };

  const Th = ({ k, label, align = "right", title }: { k: SortKey; label: string; align?: "left" | "right"; title?: string }) => (
    <th
      className={`cursor-pointer select-none whitespace-nowrap ${align === "right" ? "!text-right" : ""}`}
      onClick={() => toggleSort(k)}
      title={title ?? "Trier"}
      style={sort.key === k ? { color: "var(--accent)" } : undefined}
    >
      {label}
      {sort.key === k ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
    </th>
  );

  const budgetLabel = (r: EntityRow) => {
    if (!r.budget) return "—";
    const t = r.budget.type === "daily" ? "/ jour" : "total";
    return `${fmtMoney(r.budget.amount, p.currency)} ${t}`;
  };
  const budgetEditable = (r: EntityRow) => r.budget && ((r.level === "campaign" && r.budget.level === "campaign") || (r.level === "adset" && r.budget.level === "adset"));

  if (!rows.length) {
    return <div className="dim text-[13px] px-4 py-8 text-center">Aucune ligne sur cette période.</div>;
  }

  return (
    <>
      {/* Ordinateur et tablette : la table, scroll horizontal au besoin. */}
      <div className="hidden sm:block scroll-x" style={{ maxHeight: "70vh", overflowY: "auto" }}>
        <table className="table" style={{ minWidth: 900 }}>
          <thead>
            <tr>
              <th className="!px-2 w-[32px]">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} title="Tout sélectionner" />
              </th>
              <Th k="status" label="Statut" align="left" />
              <Th k="name" label={p.level === "campaign" ? "Campagne" : p.level === "adset" ? "Ad set" : "Ad"} align="left" />
              {p.level !== "ad" && <Th k="budget" label="Budget" />}
              {p.columns.map((k) => {
                const def = METRIC_BY_KEY.get(k);
                return <Th key={k} k={k} label={def?.short ?? k} title={def?.label} />;
              })}
              <Th k="health" label="Health" align="left" />
              <th>Recommandation</th>
              {p.level === "ad" && <th>Post ID</th>}
              {p.level === "ad" && <th>Tag</th>}
              <Th k="updated" label="MàJ" align="left" />
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const busy = p.busy.has(r.id);
              const isSel = p.selected.has(r.id);
              return (
                <tr key={r.id} className={p.onOpen ? "cursor-pointer" : ""} onClick={() => p.onOpen?.(r)} style={isSel ? { background: "var(--accent-soft)" } : undefined}>
                  <td className="!px-2" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={isSel} onChange={() => toggleOne(r.id)} />
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={r.status === "active"}
                        disabled={busy || r.status === "pending"}
                        onClick={() => p.onToggleStatus(r)}
                        className="relative inline-block rounded-full shrink-0 transition-colors"
                        style={{ width: 30, height: 17, background: r.status === "active" ? "var(--good)" : "var(--border-strong)", opacity: busy ? 0.5 : 1 }}
                        title={r.status === "active" ? "Mettre en pause" : "Activer"}
                      >
                        <span className="absolute rounded-full bg-white transition-transform" style={{ width: 13, height: 13, top: 2, left: 2, transform: r.status === "active" ? "translateX(13px)" : "none" }} />
                      </button>
                      <StatusDot status={r.status} />
                    </div>
                  </td>
                  <td className="min-w-[220px] max-w-[360px]">
                    <div className="flex items-center gap-2 min-w-0">
                      {p.level === "ad" && (
                        <button type="button" className="shrink-0 rounded-[6px] overflow-hidden" style={{ width: 36, height: 45, background: "var(--surface-3)" }} onClick={(e) => { e.stopPropagation(); p.onCreative(r); }} title="Aperçu de la créative">
                          {r.creative?.thumbnailUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={r.creative.thumbnailUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                          ) : (
                            <span className="dim text-[10px] flex items-center justify-center h-full">{r.creative?.kind === "video" ? "▶" : "▣"}</span>
                          )}
                        </button>
                      )}
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium truncate" title={r.name}>
                          {r.name}
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                          {p.level === "campaign" && <PhaseBadge phase={r.phase} />}
                          {p.level === "campaign" && r.children > 0 && <span className="dim text-[10.5px]">{r.children} ad set{r.children > 1 ? "s" : ""}</span>}
                          {p.level === "adset" && <span className="dim text-[10.5px] truncate">{r.targetingSummary}{r.children ? ` · ${r.children} ad${r.children > 1 ? "s" : ""}` : ""}</span>}
                          {p.subtitle && <span className="dim text-[10.5px] truncate max-w-[260px]" title={p.subtitle(r)}>{p.subtitle(r)}</span>}
                          {p.level === "ad" && r.notes && <span className="dim text-[10.5px] truncate" title={r.notes}>« {r.notes} »</span>}
                        </div>
                      </div>
                    </div>
                  </td>
                  {p.level !== "ad" && (
                    <td className="text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      {budgetEditable(r) ? (
                        <button type="button" className="num text-[12.5px] font-medium underline decoration-dotted underline-offset-4" onClick={() => p.onBudget(r)} title="Modifier le budget" disabled={busy}>
                          {budgetLabel(r)}
                        </button>
                      ) : (
                        <span className="num text-[12.5px]" title={r.budget?.level === "campaign" ? "Budget géré au niveau de la campagne (CBO)" : "Somme des budgets des ad sets (ABO)"} style={{ color: "var(--text-2)" }}>
                          {budgetLabel(r)}
                          {r.budget && <span className="dim text-[10px]"> {r.budget.level === "campaign" ? "CBO" : "ABO"}</span>}
                        </span>
                      )}
                    </td>
                  )}
                  {p.columns.map((k) => {
                    const def = METRIC_BY_KEY.get(k);
                    const notConnected = def?.business && !p.conversionsConnected;
                    return (
                      <td key={k} className="text-right whitespace-nowrap">
                        {notConnected ? (
                          <span className="dim text-[11px]" title="Source business non connectée">n/c</span>
                        ) : (
                          <div className="flex flex-col items-end">
                            <MetricValue k={k} v={r.metrics[k]} currency={p.currency} strong={k === "cpl" || k === "leads" || k === "spend"} />
                            {p.showDeltas && (k === "cpl" || k === "ctrLink" || k === "spend" || k === "leads") && (
                              <Delta now={r.metrics[k]} before={r.prev[k]} lowerIsBetter={def?.lowerIsBetter} suffix="" />
                            )}
                          </div>
                        )}
                      </td>
                    );
                  })}
                  <td>
                    <HealthBadge health={r.health} />
                  </td>
                  <td className="max-w-[240px]">
                    <VerdictBadge rec={r.recommendation} />
                  </td>
                  {p.level === "ad" && (
                    <td onClick={(e) => e.stopPropagation()}>
                      <PostIdChip postId={r.postId} onCopied={() => p.onCopiedPostId(r)} />
                    </td>
                  )}
                  {p.level === "ad" && (
                    <td onClick={(e) => e.stopPropagation()}>
                      <WinnerSelect value={r.winnerStatus} onChange={(v) => p.onWinner(r, v)} disabled={busy} />
                    </td>
                  )}
                  <td className="dim text-[11px] whitespace-nowrap">{r.updatedTime ? relative(r.updatedTime) : "—"}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-1 justify-end">
                      {p.level === "ad" && (
                        <button className="btn btn-ghost btn-sm !h-[24px] !px-1.5 !text-[11px]" onClick={() => p.onNotes(r)} title="Note interne">
                          ✎
                        </button>
                      )}
                      <button className="btn btn-ghost btn-sm !h-[24px] !px-1.5 !text-[11px]" onClick={() => p.onDuplicate(r)} title="Dupliquer">
                        ⧉
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Telephone : cartes essentielles. */}
      <ul className="sm:hidden flex flex-col gap-2 p-2">
        {rows.map((r) => {
          const busy = p.busy.has(r.id);
          const m = r.metrics;
          return (
            <li key={r.id} className="card-flat px-3 py-2.5" onClick={() => p.onOpen?.(r)}>
              <div className="flex items-start gap-2.5">
                {p.level === "ad" && (
                  <button type="button" className="shrink-0 rounded-[6px] overflow-hidden" style={{ width: 44, height: 55, background: "var(--surface-3)" }} onClick={(e) => { e.stopPropagation(); p.onCreative(r); }}>
                    {r.creative?.thumbnailUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.creative.thumbnailUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                    )}
                  </button>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[13.5px] font-semibold truncate">{r.name}</div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={r.status === "active"}
                      disabled={busy || r.status === "pending"}
                      onClick={(e) => { e.stopPropagation(); p.onToggleStatus(r); }}
                      className="relative inline-block rounded-full shrink-0"
                      style={{ width: 34, height: 19, background: r.status === "active" ? "var(--good)" : "var(--border-strong)" }}
                    >
                      <span className="absolute rounded-full bg-white transition-transform" style={{ width: 15, height: 15, top: 2, left: 2, transform: r.status === "active" ? "translateX(15px)" : "none" }} />
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                    <StatusDot status={r.status} />
                    {p.level === "campaign" && <PhaseBadge phase={r.phase} />}
                    <HealthBadge health={r.health} />
                    <WinnerTag value={r.winnerStatus} />
                  </div>
                  <div className="grid grid-cols-4 gap-x-2 gap-y-1 mt-2 text-[12px]">
                    {(["spend", "leads", "cpl", "bookings", "ctrLink", "cpcLink", "lpv", "shows"] as MetricKey[]).map((k) => (
                      <div key={k} className="min-w-0">
                        <div className="label-xs !text-[9.5px] truncate">{METRIC_BY_KEY.get(k)?.short}</div>
                        <div className="font-semibold truncate">
                          {METRIC_BY_KEY.get(k)?.business && !p.conversionsConnected ? <span className="dim">n/c</span> : <MetricValue k={k} v={m[k]} currency={p.currency} />}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-1.5">
                    <VerdictBadge rec={r.recommendation} />
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap mt-2" onClick={(e) => e.stopPropagation()}>
                    {p.level !== "ad" && budgetEditable(r) && (
                      <button className="btn btn-sm !h-[28px]" onClick={() => p.onBudget(r)}>
                        {budgetLabel(r)}
                      </button>
                    )}
                    {p.level === "ad" && <PostIdChip postId={r.postId} onCopied={() => p.onCopiedPostId(r)} />}
                    {p.level === "ad" && (
                      <button className="btn btn-sm !h-[28px]" onClick={() => p.onCreative(r)}>
                        Aperçu
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** Choix des colonnes visibles, memorise par l'appelant. */
export function ColumnsPicker({ value, onChange, onClose, open }: { value: MetricKey[]; onChange: (v: MetricKey[]) => void; open: boolean; onClose: () => void }) {
  if (!open) return null;
  const toggle = (k: MetricKey) => onChange(value.includes(k) ? value.filter((x) => x !== k) : [...value, k]);
  return (
    <div className="card p-3 absolute right-0 top-full mt-1 z-20 w-[300px] max-h-[60vh] overflow-y-auto" style={{ boxShadow: "var(--shadow-lg)" }} onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between mb-2">
        <span className="label-xs">Colonnes</span>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        {METRIC_DEFS.map((d) => (
          <label key={d.key} className="flex items-center gap-1.5 text-[12px] cursor-pointer">
            <input type="checkbox" checked={value.includes(d.key)} onChange={() => toggle(d.key)} />
            <span className="truncate" title={d.label}>
              {d.short}
              {d.business && <span className="dim"> ·biz</span>}
            </span>
          </label>
        ))}
      </div>
      <div className="flex gap-1.5 mt-3">
        <button className="btn btn-sm" onClick={() => onChange(["spend", "leads", "cpl", "bookings", "costPerBooking", "shows", "showRate", "sales", "cac", "ctrLink", "cpcLink", "lpv", "costPerLpv", "cpm", "frequency"])}>
          Par défaut
        </button>
        <button className="btn btn-sm" onClick={() => onChange(["spend", "leads", "cpl", "ctrLink", "cpcLink", "lpv", "costPerLpv", "impressions", "reach", "cpm", "frequency"])}>
          Testing
        </button>
        <button className="btn btn-sm" onClick={() => onChange(["spend", "leads", "cpl", "validLeads", "qualifiedLeads", "bookings", "leadToBooking", "costPerBooking", "shows", "showRate", "costPerShow", "sales", "closeRate", "cac", "revenue", "cashCollected", "roas", "cashRoas"])}>
          Business
        </button>
      </div>
    </div>
  );
}
