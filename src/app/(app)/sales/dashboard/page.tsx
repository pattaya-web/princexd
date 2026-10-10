"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { SourceChip } from "@/components/sales/AttributionBlock";
import { AttentionCard, GoalCard } from "@/components/sales/DashboardBlocks";
import type { AttentionBlock, GoalBlock } from "@/app/api/sales/dashboard/route";
import { Card, Empty, ErrorNote, InfoNote, Modal, PageHeader, Spinner, Tabs } from "@/components/ui";
import { api, useLocalState } from "@/lib/client";
import { fmtDate, fmtDateTime, fmtMoney, label as crmLabel } from "@/lib/format";
import { RANGE_PRESETS, type RangePreset } from "@/lib/mediabuying/metrics";
import { funnelLabel, SOURCE_CHANNEL_LABEL } from "@/lib/sales/attribution";
import { BOOKING_STATUS_LABEL, SALE_STATUS_LABEL } from "@/lib/sales/business-types";
import type { BusinessGroupRow, BusinessMetrics, BusinessReport, GroupBy, LeadBusiness } from "@/lib/sales/business";

/* ------------------------------- Formats ------------------------------- */

type Fmt = "int" | "money" | "pct" | "x";
const KPIS: { key: keyof BusinessMetrics; label: string; fmt: Fmt; ads?: boolean }[] = [
  { key: "leads", label: "Leads", fmt: "int" },
  { key: "validLeads", label: "Valid leads", fmt: "int" },
  { key: "qualifiedLeads", label: "Qualified leads", fmt: "int" },
  { key: "bookings", label: "Bookings", fmt: "int" },
  { key: "bookingRate", label: "Booking rate", fmt: "pct" },
  { key: "shows", label: "Shows", fmt: "int" },
  { key: "showRate", label: "Show rate", fmt: "pct" },
  { key: "sales", label: "Sales", fmt: "int" },
  { key: "closeRate", label: "Close rate", fmt: "pct" },
  { key: "revenue", label: "Revenue", fmt: "money" },
  { key: "cashCollected", label: "Cash collected", fmt: "money" },
  { key: "spend", label: "Spend (ads)", fmt: "money", ads: true },
  { key: "costPerBooking", label: "Cost / Booking", fmt: "money", ads: true },
  { key: "costPerShow", label: "Cost / Show", fmt: "money", ads: true },
  { key: "cac", label: "CAC", fmt: "money", ads: true },
  { key: "roas", label: "ROAS", fmt: "x", ads: true },
];

const TABLE_COLS: { key: keyof BusinessMetrics; label: string; fmt: Fmt }[] = [
  { key: "spend", label: "Spend", fmt: "money" },
  { key: "leads", label: "Leads", fmt: "int" },
  { key: "validLeads", label: "Valid", fmt: "int" },
  { key: "qualifiedLeads", label: "Qualif.", fmt: "int" },
  { key: "cpl", label: "CPL", fmt: "money" },
  { key: "bookings", label: "Bookings", fmt: "int" },
  { key: "bookingRate", label: "Bkg rate", fmt: "pct" },
  { key: "shows", label: "Shows", fmt: "int" },
  { key: "showRate", label: "Show rate", fmt: "pct" },
  { key: "sales", label: "Sales", fmt: "int" },
  { key: "closeRate", label: "Close rate", fmt: "pct" },
  { key: "revenue", label: "Revenue", fmt: "money" },
  { key: "cashCollected", label: "Cash", fmt: "money" },
  { key: "cac", label: "CAC", fmt: "money" },
  { key: "roas", label: "ROAS", fmt: "x" },
];

function fmt(v: number | null | undefined, f: Fmt, currency: string): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  if (f === "money") return fmtMoney(v, currency);
  if (f === "pct") return `${v.toFixed(1).replace(".", ",")} %`;
  if (f === "x") return `${v.toFixed(2).replace(".", ",")}×`;
  return new Intl.NumberFormat("fr-FR").format(Math.round(v));
}

const GROUPS: { key: GroupBy; label: string }[] = [
  { key: "source", label: "Source" },
  { key: "funnel", label: "Funnel" },
  { key: "campaign", label: "Campaign" },
  { key: "adset", label: "Ad set" },
  { key: "ad", label: "Creative" },
];

interface Filters {
  source: string;
  funnel: string;
  campaignId: string;
  adsetId: string;
  adId: string;
  crmStage: string;
  bookingStatus: string;
  saleStatus: string;
}
const NO_FILTERS: Filters = { source: "", funnel: "", campaignId: "", adsetId: "", adId: "", crmStage: "", bookingStatus: "", saleStatus: "" };

/**
 * Sales Dashboard : un seul tableau de bord pour tout le business, toutes
 * sources confondues, filtre et groupe par source d'acquisition (first
 * touch). Les calculs tournent cote serveur.
 */
export default function SalesDashboardPage() {
  const [preset, setPreset] = useLocalState<RangePreset>("sales.dash.preset", "last30");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [groupBy, setGroupBy] = useLocalState<GroupBy>("sales.dash.group", "source");
  const [report, setReport] = useState<BusinessReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ row: BusinessGroupRow | null; leads: LeadBusiness[] | null } | null>(null);
  const [view, setView] = useState<"table" | "pipeline">("table");
  // Ce qu'il y a a regler (resultats a saisir, confirmations, sans closer) et l'objectif du mois.
  const [ops, setOps] = useState<{ attention: AttentionBlock | null; goal: GoalBlock | null; currency: string; followUps: { overdue: number } } | null>(null);
  const loadOps = () => api<{ attention: AttentionBlock | null; goal: GoalBlock | null; currency: string; followUps: { overdue: number } }>("/api/sales/dashboard?period=month").then(setOps).catch(() => undefined);
  useEffect(() => {
    void loadOps();
    const on = () => void loadOps();
    window.addEventListener("sales:changed", on);
    return () => window.removeEventListener("sales:changed", on);
  }, []);

  const query = useMemo(() => {
    const p = new URLSearchParams({ preset, groupBy });
    if (preset === "custom") {
      if (custom.from) p.set("from", custom.from);
      if (custom.to) p.set("to", custom.to);
    }
    for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v);
    return p.toString();
  }, [preset, custom, filters, groupBy]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api<BusinessReport>(`/api/sales/business?${query}`)
      .then((r) => {
        if (!alive) return;
        setReport(r);
        setError(null);
      })
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [query]);

  const openDetail = async (row: BusinessGroupRow | null) => {
    setDetail({ row, leads: null });
    try {
      const r = await api<{ leads: LeadBusiness[] }>(`/api/sales/business?${query}&detail=${encodeURIComponent(row?.key ?? "all")}`);
      setDetail({ row, leads: r.leads });
    } catch (e) {
      setError((e as Error).message);
      setDetail(null);
    }
  };

  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));
  const o = report?.options;
  const currency = report?.currency ?? "EUR";
  const paidView = !filters.source || filters.source === "META_ADS";
  const activeFilters = Object.entries(filters).filter(([, v]) => v).length;

  // Cascade : les ad sets suivent la campagne choisie, les creatives l'ad set.
  const adsets = (o?.adsets ?? []).filter((a) => !filters.campaignId || a.campaignId === filters.campaignId);
  const ads = (o?.ads ?? []).filter((a) => (!filters.adsetId || a.adsetId === filters.adsetId) && (!filters.campaignId || a.campaignId === filters.campaignId));

  const Sel = ({ label, value, onChange, children, disabled }: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode; disabled?: boolean }) => (
    <label className="flex flex-col gap-1 min-w-0">
      <span className="label-xs">{label}</span>
      <select className="select select-sm !w-auto max-w-[200px]" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        {children}
      </select>
    </label>
  );

  return (
    <div
      style={
        {
          "--accent": "#006dbc",
          "--accent-hover": "#005a9c",
          "--accent-soft": "#e6f1fa",
          "--accent-ring": "#9cc9ea",
          "--grad-accent": "linear-gradient(135deg, #006dbc 0%, #2a8fd8 100%)",
        } as React.CSSProperties
      }
    >
      <PageHeader
        title="Sales Dashboard"
        subtitle="Tout le business en un seul endroit, par source d'acquisition : quel canal, quelle campagne, quelle créative amène les ventes."
        actions={
          <div className="flex items-center gap-1.5 flex-wrap">
            <select className="select select-sm !w-auto" value={preset} onChange={(e) => setPreset(e.target.value as RangePreset)}>
              {RANGE_PRESETS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
            {preset === "custom" && (
              <>
                <input className="input !h-[30px] !w-auto !text-[12.5px]" type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
                <input className="input !h-[30px] !w-auto !text-[12.5px]" type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
              </>
            )}
            {report && (
              <span className="dim text-[11.5px] num">
                {fmtDate(`${report.range.from}T12:00:00Z`)} → {fmtDate(`${report.range.to}T12:00:00Z`)}
              </span>
            )}
            {loading && <span className="spinner" />}
          </div>
        }
      />
      {error && <div className="mb-3"><ErrorNote>{error}</ErrorNote></div>}
      {ops && ops.followUps.overdue > 0 && (
        <Link href="/sales/relances" className="block mb-4">
          <div className="rounded-lg px-3.5 py-2.5 text-[12.5px] flex items-center gap-2" style={{ background: "color-mix(in srgb, var(--warning) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--warning) 35%, transparent)" }}>
            <strong className="num">{ops.followUps.overdue}</strong>
            relance{ops.followUps.overdue > 1 ? "s" : ""} en retard — à traiter avant que le lead refroidisse.
          </div>
        </Link>
      )}
      {ops?.attention && <AttentionCard block={ops.attention} />}
      {ops?.goal && (
        <div className="mb-4">
          <GoalCard goal={ops.goal} currency={ops.currency} onSaved={() => void loadOps()} />
        </div>
      )}
      {report?.hasMock && (
        <div className="mb-3">
          <InfoNote>
            Les chiffres incluent les leads de démonstration du compte Meta simulé (jamais écrits dans le CRM). Ils disparaîtront avec le vrai compte. Les bookings viennent des rendez-vous, les ventes des récaps de call : une seule entité Lead.
          </InfoNote>
        </div>
      )}

      {/* Filtres en cascade */}
      <Card padded={false} className="mb-4">
        <div className="flex flex-wrap items-end gap-3 px-4 py-3">
          <Sel label="Source" value={filters.source} onChange={(v) => set({ source: v, funnel: "", campaignId: "", adsetId: "", adId: "" })}>
            <option value="">Tous</option>
            {(o?.sources ?? []).map((s) => (
              <option key={s.key} value={s.key}>
                {s.label} ({s.n})
              </option>
            ))}
          </Sel>
          <Sel label="Funnel" value={filters.funnel} onChange={(v) => set({ funnel: v })}>
            <option value="">Tous</option>
            {(o?.funnels ?? []).filter((f) => !filters.source || f.channel === filters.source).map((f) => (
              <option key={f.key} value={f.key}>
                {f.label} ({f.n})
              </option>
            ))}
          </Sel>
          <Sel label="Campaign" value={filters.campaignId} onChange={(v) => set({ campaignId: v, adsetId: "", adId: "" })} disabled={Boolean(filters.source) && filters.source !== "META_ADS"}>
            <option value="">Toutes</option>
            {(o?.campaigns ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Sel>
          <Sel label="Ad set" value={filters.adsetId} onChange={(v) => set({ adsetId: v, adId: "" })} disabled={Boolean(filters.source) && filters.source !== "META_ADS"}>
            <option value="">Tous</option>
            {adsets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Sel>
          <Sel label="Creative" value={filters.adId} onChange={(v) => set({ adId: v })} disabled={Boolean(filters.source) && filters.source !== "META_ADS"}>
            <option value="">Toutes</option>
            {ads.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Sel>
          <Sel label="CRM status" value={filters.crmStage} onChange={(v) => set({ crmStage: v })}>
            <option value="">Tous</option>
            {(o?.crmStages ?? []).map((s) => (
              <option key={s} value={s}>
                {crmLabel(s)}
              </option>
            ))}
          </Sel>
          <Sel label="Booking status" value={filters.bookingStatus} onChange={(v) => set({ bookingStatus: v })}>
            <option value="">Tous</option>
            {Object.entries(BOOKING_STATUS_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Sel>
          <Sel label="Sale status" value={filters.saleStatus} onChange={(v) => set({ saleStatus: v })}>
            <option value="">Tous</option>
            {Object.entries(SALE_STATUS_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Sel>
          {activeFilters > 0 && (
            <button className="btn btn-sm" onClick={() => setFilters(NO_FILTERS)}>
              ✕ Réinitialiser ({activeFilters})
            </button>
          )}
        </div>
      </Card>

      {!report && loading && <Spinner label="Calcul du dashboard…" />}
      {report && (
        <>
          {/* KPI */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 mb-4">
            {KPIS.map((k) => {
              const v = report.totals[k.key];
              const na = k.ads && (!paidView || v === null);
              return (
                <div key={k.key} className="card px-3 py-2.5 min-w-0" style={k.ads ? { background: "var(--surface-2)" } : undefined}>
                  <div className="label-xs truncate" title={k.ads ? "Métrique payante : calculée sur la dépense Meta" : undefined}>
                    {k.label}
                  </div>
                  <div className="text-[19px] sm:text-[21px] font-semibold num leading-none mt-1.5" style={{ letterSpacing: "-0.03em", color: na ? "var(--text-3)" : undefined }}>
                    {na ? "—" : fmt(v as number | null, k.fmt, currency)}
                  </div>
                </div>
              );
            })}
          </div>
          {!paidView && <div className="dim text-[11.5px] -mt-2 mb-4">Source sans dépense publicitaire : Spend, CAC et ROAS ne sont pas inventés. Les métriques commerciales restent calculées.</div>}

          {/* Table groupée / pipeline */}
          <Card
            padded={false}
            title={
              <span className="flex items-center gap-3 flex-wrap">
                <Tabs value={view} onChange={setView} options={[{ value: "table", label: "Par source" }, { value: "pipeline", label: "Pipeline" }]} />
              </span>
            }
            actions={
              view === "table" ? (
                <div className="flex items-center gap-1.5">
                  <span className="label-xs">Group by</span>
                  {GROUPS.map((g) => (
                    <button key={g.key} className={`btn btn-sm ${groupBy === g.key ? "btn-primary" : ""}`} onClick={() => setGroupBy(g.key)}>
                      {g.label}
                    </button>
                  ))}
                  <button className="btn btn-sm btn-ghost" onClick={() => void openDetail(null)} title="Tous les leads de la sélection">
                    Leads ↗
                  </button>
                </div>
              ) : undefined
            }
          >
            {view === "pipeline" ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 p-3">
                {report.pipeline.map((p, i) => (
                  <div key={p.key} className="card-flat px-3 py-2.5" style={{ borderTop: `3px solid ${p.key === "CLOSED_WON" ? "var(--good)" : p.key === "CLOSED_LOST" ? "var(--critical)" : "var(--accent)"}`, opacity: 0.6 + (i / report.pipeline.length) * 0.4 }}>
                    <div className="label-xs">{p.label}</div>
                    <div className="text-[22px] font-semibold num">{p.n}</div>
                  </div>
                ))}
                <div className="col-span-full dim text-[11.5px] px-1">Même leads que le CRM, lus par étape : aucune duplication de contact.</div>
              </div>
            ) : report.rows.length === 0 ? (
              <Empty>Aucun lead sur cette période avec ces filtres.</Empty>
            ) : (
              <div className="scroll-x">
                <table className="table" style={{ minWidth: 1100 }}>
                  <thead>
                    <tr>
                      <th>{GROUPS.find((g) => g.key === groupBy)?.label}</th>
                      {TABLE_COLS.map((c) => (
                        <th key={c.key} className="!text-right whitespace-nowrap">
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows.map((r) => (
                      <tr key={r.key} className="cursor-pointer" onClick={() => void openDetail(r)} title="Voir les leads">
                        <td className="min-w-[200px] max-w-[320px]">
                          <div className="flex items-center gap-2 min-w-0">
                            {groupBy === "source" ? <SourceChip channel={r.sourceChannel || "UNKNOWN"} /> : <span className="text-[13px] font-medium truncate">{r.label}</span>}
                            {groupBy !== "source" && r.sourceChannel && <SourceChip channel={r.sourceChannel} />}
                          </div>
                        </td>
                        {TABLE_COLS.map((c) => {
                          const v = r.metrics[c.key];
                          const strong = c.key === "sales" || c.key === "shows" || c.key === "bookings";
                          return (
                            <td key={c.key} className={`text-right num whitespace-nowrap ${strong ? "font-semibold" : ""}`} style={v === null ? { color: "var(--text-3)" } : undefined}>
                              {fmt(v as number | null, c.fmt, currency)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                    <tr style={{ background: "var(--surface-2)" }}>
                      <td className="font-semibold">Total</td>
                      {TABLE_COLS.map((c) => (
                        <td key={c.key} className="text-right num font-semibold whitespace-nowrap">
                          {fmt(report.totals[c.key] as number | null, c.fmt, currency)}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            <div className="px-4 py-2 dim text-[11px] flex flex-wrap gap-x-4 gap-y-1">
              <span>Priorité : vente &gt; show &gt; booking &gt; lead qualifié &gt; lead. Un CPL bas ne fait pas une bonne créative.</span>
              <span>Cohorte par date d&apos;acquisition (first touch) ; les bookings et ventes suivent leurs leads.</span>
              {!report.metaConnected && (
                <Link href="/mediabuying/connections" className="link">
                  Connecter Meta pour la dépense →
                </Link>
              )}
            </div>
          </Card>
        </>
      )}

      {/* Detail : les leads derriere une ligne */}
      <Modal open={detail !== null} onClose={() => setDetail(null)} title={detail?.row ? `${detail.row.label} · détail` : "Leads de la sélection"} wide>
        {detail?.row && (
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-4">
            {(["spend", "leads", "bookings", "shows", "sales", "revenue"] as (keyof BusinessMetrics)[]).map((k) => {
              const def = TABLE_COLS.find((c) => c.key === k)!;
              return (
                <div key={k} className="card-flat px-3 py-2">
                  <div className="label-xs">{def.label}</div>
                  <div className="text-[16px] font-semibold num">{fmt(detail.row!.metrics[k] as number | null, def.fmt, currency)}</div>
                </div>
              );
            })}
          </div>
        )}
        {!detail?.leads ? (
          <Spinner label="Chargement des leads…" />
        ) : detail.leads.length === 0 ? (
          <Empty>Aucun lead.</Empty>
        ) : (
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th>Lead</th>
                  <th>Acquisition</th>
                  <th>Source</th>
                  <th>Créative</th>
                  <th>Booking</th>
                  <th>Call</th>
                  <th>Vente</th>
                  <th className="!text-right">Revenue</th>
                  <th className="!text-right">Cash</th>
                </tr>
              </thead>
              <tbody>
                {detail.leads.map((l) => (
                  <tr key={l.leadId}>
                    <td>
                      <div className="text-[13px] font-medium">
                        {l.name}
                        {l.mock && <span className="dim text-[10px]"> démo</span>}
                      </div>
                      <div className="dim text-[11px]">{l.handle || l.email || l.phone}</div>
                    </td>
                    <td className="num text-[12px] whitespace-nowrap">{fmtDateTime(l.acquiredAt)}</td>
                    <td>
                      <SourceChip channel={l.sourceChannel} />
                      <div className="dim text-[11px]">{funnelLabel(l.funnelSource)}</div>
                    </td>
                    <td className="text-[12px]">
                      {l.adName || "—"}
                      {l.campaignName && <div className="dim text-[10.5px] truncate max-w-[180px]">{l.campaignName}</div>}
                    </td>
                    <td className="text-[12px]">
                      {l.bookingStatus ? BOOKING_STATUS_LABEL[l.bookingStatus] : "—"}
                      {l.appointmentAt && <div className="dim text-[10.5px] num">{fmtDateTime(l.appointmentAt)}</div>}
                    </td>
                    <td className="text-[12px]">{l.showStatus === "SHOWED" ? "Showed" : l.showStatus === "NO_SHOW" ? "No-show" : l.showStatus === "PENDING" ? "À venir" : "—"}</td>
                    <td className="text-[12px]" style={{ color: l.saleStatus === "WON" ? "var(--good)" : l.saleStatus === "LOST" ? "var(--critical)" : undefined }}>
                      {SALE_STATUS_LABEL[l.saleStatus]}
                    </td>
                    <td className="text-right num">{l.revenue ? fmtMoney(l.revenue, l.currency) : "—"}</td>
                    <td className="text-right num">{l.cashCollected ? fmtMoney(l.cashCollected, l.currency) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="dim text-[11px] mt-3">
          Source affichée = first touch. {SOURCE_CHANNEL_LABEL.INSTAGRAM} après une pub Meta reste une interaction, pas la source.
        </div>
      </Modal>
    </div>
  );
}
