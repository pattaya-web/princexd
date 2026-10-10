"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { SourceChip } from "@/components/sales/AttributionBlock";
import { AttentionCard } from "@/components/sales/DashboardBlocks";
import { Card, Empty, ErrorNote, Modal, PageHeader, Spinner, Tabs } from "@/components/ui";
import { api, useLocalState } from "@/lib/client";
import { fmtDate, fmtDateTime, fmtMoney, label as crmLabel } from "@/lib/format";
import { RANGE_PRESETS, type RangePreset } from "@/lib/mediabuying/metrics";
import { funnelLabel } from "@/lib/sales/attribution";
import { BOOKING_STATUS_LABEL, SALE_STATUS_LABEL, type DueInstallment } from "@/lib/sales/business-types";
import type { BusinessGroupRow, BusinessMetrics, BusinessReport, GroupBy, LeadBusiness } from "@/lib/sales/business";
import type { AttentionBlock } from "@/app/api/sales/dashboard/route";

/* ------------------------------- Formats ------------------------------- */

type Fmt = "int" | "money" | "pct" | "x";
function fmt(v: number | null | undefined, f: Fmt, currency: string): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  if (f === "money") return fmtMoney(v, currency);
  if (f === "pct") return `${v.toFixed(1).replace(".", ",")} %`;
  if (f === "x") return `${v.toFixed(2).replace(".", ",")}×`;
  return new Intl.NumberFormat("fr-FR").format(Math.round(v));
}

const GOOD = "var(--good)";
const WARN = "var(--warning)";
const BAD = "var(--critical)";

/** Une case : un chiffre, un libelle, une ligne d'explication. Rien d'autre. */
function Tile({ label, value, sub, color, big }: { label: string; value: ReactNode; sub?: ReactNode; color?: string; big?: boolean }) {
  return (
    <div className="card px-4 py-3.5 min-w-0">
      <div className="label-xs truncate">{label}</div>
      <div className={`${big ? "text-[30px]" : "text-[24px]"} font-semibold num leading-none mt-2`} style={{ letterSpacing: "-0.03em", color }}>
        {value}
      </div>
      {sub && <div className="dim text-[11.5px] mt-1.5 truncate">{sub}</div>}
    </div>
  );
}

function Section({ title, hint, children, right }: { title: string; hint?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="mb-5">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {hint && <span className="dim text-[11.5px]">{hint}</span>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

const GROUPS: { key: GroupBy; label: string }[] = [
  { key: "source", label: "Source" },
  { key: "funnel", label: "Funnel" },
  { key: "campaign", label: "Campaign" },
  { key: "adset", label: "Ad set" },
  { key: "ad", label: "Creative" },
];

const TABLE_COLS: { key: keyof BusinessMetrics; label: string; fmt: Fmt; paid?: boolean }[] = [
  { key: "leads", label: "Leads", fmt: "int" },
  { key: "bookings", label: "RDV", fmt: "int" },
  { key: "shows", label: "Shows", fmt: "int" },
  { key: "showRate", label: "Show rate", fmt: "pct" },
  { key: "sales", label: "Closés", fmt: "int" },
  { key: "closeRate", label: "Close rate", fmt: "pct" },
  { key: "revenue", label: "CA", fmt: "money" },
  { key: "cashCollected", label: "Cash", fmt: "money" },
  { key: "spend", label: "Spend", fmt: "money", paid: true },
  { key: "cac", label: "CAC", fmt: "money", paid: true },
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
 * Sales Dashboard : les chiffres du business en cases lisibles (calls,
 * shows, closes, cash, reste a encaisser, echeances), puis la repartition
 * par source en bas, filtres replies. Calculs cote serveur.
 */
export default function SalesDashboardPage() {
  const [preset, setPreset] = useLocalState<RangePreset>("sales.dash.preset", "last30");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [groupBy, setGroupBy] = useLocalState<GroupBy>("sales.dash.group", "source");
  const [report, setReport] = useState<BusinessReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ row: BusinessGroupRow | null; leads: LeadBusiness[] | null } | null>(null);
  const [view, setView] = useState<"table" | "pipeline">("table");
  const [ops, setOps] = useState<{ attention: AttentionBlock | null; followUps: { overdue: number } } | null>(null);

  const loadOps = () => api<{ attention: AttentionBlock | null; followUps: { overdue: number } }>("/api/sales/dashboard?period=month").then(setOps).catch(() => undefined);
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
  const t = report?.totals;
  const cf = report?.cashflow;
  const currency = report?.currency ?? "EUR";
  const paidView = !filters.source || filters.source === "META_ADS";
  const activeFilters = Object.values(filters).filter(Boolean).length;
  const adsets = (o?.adsets ?? []).filter((a) => !filters.campaignId || a.campaignId === filters.campaignId);
  const ads = (o?.ads ?? []).filter((a) => (!filters.adsetId || a.adsetId === filters.adsetId) && (!filters.campaignId || a.campaignId === filters.campaignId));

  const Sel = ({ label, value, onChange, children, disabled }: { label: string; value: string; onChange: (v: string) => void; children: ReactNode; disabled?: boolean }) => (
    <label className="flex flex-col gap-1 min-w-0">
      <span className="label-xs">{label}</span>
      <select className="select select-sm" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        {children}
      </select>
    </label>
  );

  const Due = ({ rows, tone }: { rows: DueInstallment[]; tone: string }) => (
    <ul className="flex flex-col">
      {rows.map((d) => (
        <li key={`${d.saleId}-${d.n}`} style={{ borderBottom: "1px solid var(--border)" }}>
          <Link href={`/sales/rendez-vous?open=${d.appointmentId}`} className="flex items-center gap-3 px-3.5 py-2 text-[12.5px] row-hover">
            <span className="num w-[64px] shrink-0" style={{ color: tone }}>
              {fmtDate(`${d.dueAt}T12:00:00Z`)}
            </span>
            <span className="font-medium truncate flex-1">{d.leadName}</span>
            <span className="dim text-[11px] shrink-0">
              {d.n}/{d.of}
            </span>
            <span className="num font-semibold shrink-0">{fmtMoney(d.amount, currency)}</span>
          </Link>
        </li>
      ))}
    </ul>
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
            <button className={`btn btn-sm ${filtersOpen || activeFilters ? "btn-primary" : ""}`} onClick={() => setFiltersOpen((v) => !v)}>
              Filtres{activeFilters ? ` (${activeFilters})` : ""}
            </button>
            {loading && <span className="spinner" />}
          </div>
        }
      />
      {report && (
        <div className="dim text-[11.5px] num -mt-4 mb-4">
          Période : {fmtDate(`${report.range.from}T12:00:00Z`)} → {fmtDate(`${report.range.to}T12:00:00Z`)} · leads comptés à leur date d&apos;arrivée, leurs calls et ventes suivent.
        </div>
      )}
      {error && <div className="mb-3"><ErrorNote>{error}</ErrorNote></div>}

      {filtersOpen && (
        <Card className="mb-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Sel label="Source" value={filters.source} onChange={(v) => set({ source: v, funnel: "", campaignId: "", adsetId: "", adId: "" })}>
              <option value="">Toutes</option>
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
            <Sel label="Statut CRM" value={filters.crmStage} onChange={(v) => set({ crmStage: v })}>
              <option value="">Tous</option>
              {(o?.crmStages ?? []).map((s) => (
                <option key={s} value={s}>
                  {crmLabel(s)}
                </option>
              ))}
            </Sel>
            <Sel label="Booking" value={filters.bookingStatus} onChange={(v) => set({ bookingStatus: v })}>
              <option value="">Tous</option>
              {Object.entries(BOOKING_STATUS_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Sel>
            <Sel label="Vente" value={filters.saleStatus} onChange={(v) => set({ saleStatus: v })}>
              <option value="">Tous</option>
              {Object.entries(SALE_STATUS_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Sel>
            <div className="flex items-end">
              <button className="btn btn-sm" onClick={() => setFilters(NO_FILTERS)} disabled={!activeFilters}>
                Réinitialiser
              </button>
            </div>
          </div>
        </Card>
      )}

      {ops && ops.followUps.overdue > 0 && (
        <Link href="/sales/relances" className="block mb-4">
          <div className="rounded-lg px-3.5 py-2.5 text-[12.5px] flex items-center gap-2" style={{ background: "color-mix(in srgb, var(--warning) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--warning) 35%, transparent)" }}>
            <strong className="num">{ops.followUps.overdue}</strong>
            relance{ops.followUps.overdue > 1 ? "s" : ""} en retard — à traiter avant que le lead refroidisse.
          </div>
        </Link>
      )}
      {ops?.attention && <AttentionCard block={ops.attention} />}

      {!report && loading && <Spinner label="Calcul du dashboard…" />}
      {report && t && cf && (
        <>
          <Section title="Calls" hint="sur la période">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
              <Tile label="Leads" value={fmt(t.leads, "int", currency)} sub={`${fmt(t.qualifiedLeads, "int", currency)} qualifiés`} />
              <Tile label="Rendez-vous" value={fmt(t.bookings, "int", currency)} sub={`Booking rate ${fmt(t.bookingRate, "pct", currency)}`} />
              <Tile label="Shows" value={fmt(t.shows, "int", currency)} color={t.shows ? GOOD : undefined} sub="venus au call" />
              <Tile label="No-shows" value={fmt(t.noShows, "int", currency)} color={t.noShows ? BAD : undefined} sub="pas venus" />
              <Tile label="Show rate" value={fmt(t.showRate, "pct", currency)} color={t.showRate === null ? undefined : t.showRate >= 70 ? GOOD : t.showRate >= 50 ? WARN : BAD} sub="shows / calls passés" big />
              <Tile label="À venir" value={fmt(t.upcomingCalls, "int", currency)} sub="calls planifiés" />
            </div>
          </Section>

          <Section title="Ventes" hint="sur la période">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
              <Tile label="Closés" value={fmt(t.sales, "int", currency)} color={t.sales ? GOOD : undefined} sub={`Close rate ${fmt(t.closeRate, "pct", currency)}`} big />
              <Tile label="CA (contrats)" value={fmt(t.revenue, "money", currency)} sub="valeur des contrats signés" />
              <Tile label="Cash encaissé" value={fmt(t.cashCollected, "money", currency)} color={t.cashCollected ? GOOD : undefined} sub="sur ces ventes" />
              <Tile label="Cash ce mois" value={fmt(cf.cashMonth, "money", currency)} sub="encaissé depuis le 1er" />
              <Tile label="Reste à encaisser" value={fmt(cf.remainingTotal, "money", currency)} color={cf.remainingTotal ? WARN : undefined} sub="toutes ventes actives" />
              <Tile label="Paiement en attente" value={fmt(cf.pendingSales, "int", currency)} color={cf.pendingSales ? WARN : undefined} sub={cf.overdueTotal ? `dont ${fmtMoney(cf.overdueTotal, currency)} en retard` : "ventes pas soldées"} />
            </div>
          </Section>

          <Section title="Échéances" hint="d'après les échéanciers saisis sur les ventes">
            <div className="grid lg:grid-cols-2 gap-3">
              <Card
                padded={false}
                title={
                  <span className="flex items-center gap-2 !text-[14px]">
                    <span className="w-[8px] h-[8px] rounded-full" style={{ background: BAD }} />
                    En retard
                    <span className="badge !text-[10.5px] !py-0 num">{cf.overdue.length}</span>
                  </span>
                }
                subtitle={cf.overdue.length ? `${fmtMoney(cf.overdueTotal, currency)} attendus, date dépassée` : "Aucune échéance en retard"}
              >
                {cf.overdue.length ? <Due rows={cf.overdue} tone={BAD} /> : <div className="dim text-[12.5px] px-3.5 py-4">Rien en retard ✓</div>}
              </Card>
              <Card
                padded={false}
                title={
                  <span className="flex items-center gap-2 !text-[14px]">
                    <span className="w-[8px] h-[8px] rounded-full" style={{ background: "var(--accent)" }} />
                    À venir · 30 jours
                    <span className="badge !text-[10.5px] !py-0 num">{cf.upcoming.length}</span>
                  </span>
                }
                subtitle={cf.upcoming.length ? `${fmtMoney(cf.upcomingTotal, currency)} à encaisser` : "Aucune échéance dans les 30 jours"}
              >
                {cf.upcoming.length ? <Due rows={cf.upcoming} tone="var(--accent)" /> : <div className="dim text-[12.5px] px-3.5 py-4">Les paiements en plusieurs fois apparaissent ici avec leur date.</div>}
              </Card>
            </div>
          </Section>

          {paidView && t.spend !== null && (
            <Section title="Acquisition payante" hint="Meta Ads">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
                <Tile label="Spend" value={fmt(t.spend, "money", currency)} />
                <Tile label="CPL" value={fmt(t.cpl, "money", currency)} />
                <Tile label="Coût / RDV" value={fmt(t.costPerBooking, "money", currency)} />
                <Tile label="Coût / show" value={fmt(t.costPerShow, "money", currency)} />
                <Tile label="CAC" value={fmt(t.cac, "money", currency)} />
                <Tile label="ROAS" value={fmt(t.roas, "x", currency)} color={t.roas !== null && t.roas >= 3 ? GOOD : undefined} />
              </div>
            </Section>
          )}

          <Section
            title="Par source"
            hint="d'où viennent les calls et les ventes"
            right={
              <div className="flex items-center gap-1.5">
                <Tabs value={view} onChange={setView} options={[{ value: "table", label: "Répartition" }, { value: "pipeline", label: "Pipeline" }]} />
              </div>
            }
          >
            <Card padded={false}>
              {view === "pipeline" ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 p-3">
                  {report.pipeline.map((p) => (
                    <div key={p.key} className="card-flat px-3 py-2.5" style={{ borderTop: `3px solid ${p.key === "CLOSED_WON" ? GOOD : p.key === "CLOSED_LOST" ? BAD : "var(--accent)"}` }}>
                      <div className="label-xs">{p.label}</div>
                      <div className="text-[22px] font-semibold num">{p.n}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-1.5 px-3.5 py-2" style={{ borderBottom: "1px solid var(--border)" }}>
                    <span className="label-xs mr-1">Grouper par</span>
                    {GROUPS.map((g) => (
                      <button key={g.key} className={`btn btn-sm !h-[26px] ${groupBy === g.key ? "btn-primary" : ""}`} onClick={() => setGroupBy(g.key)}>
                        {g.label}
                      </button>
                    ))}
                    <button className="btn btn-sm btn-ghost !h-[26px] ml-auto" onClick={() => void openDetail(null)}>
                      Voir les leads ↗
                    </button>
                  </div>
                  {report.rows.length === 0 ? (
                    <Empty>Aucun lead sur cette période.</Empty>
                  ) : (
                    <div className="scroll-x">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>{GROUPS.find((g) => g.key === groupBy)?.label}</th>
                            {TABLE_COLS.filter((c) => !c.paid || paidView).map((c) => (
                              <th key={c.key} className="!text-right whitespace-nowrap">
                                {c.label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {report.rows.map((r) => (
                            <tr key={r.key} className="cursor-pointer" onClick={() => void openDetail(r)} title="Voir les leads">
                              <td className="min-w-[160px] max-w-[300px]">
                                <div className="flex items-center gap-2 min-w-0">
                                  {groupBy === "source" ? <SourceChip channel={r.sourceChannel || "UNKNOWN"} /> : <span className="text-[13px] font-medium truncate">{r.label}</span>}
                                </div>
                              </td>
                              {TABLE_COLS.filter((c) => !c.paid || paidView).map((c) => {
                                const v = r.metrics[c.key];
                                return (
                                  <td key={c.key} className={`text-right num whitespace-nowrap ${c.key === "sales" || c.key === "shows" ? "font-semibold" : ""}`} style={v === null ? { color: "var(--text-3)" } : undefined}>
                                    {fmt(v as number | null, c.fmt, currency)}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </Card>
          </Section>
          {report.hasMock && <div className="dim text-[11px]">Les chiffres incluent les leads de démonstration du compte Meta simulé ; ils disparaîtront avec le vrai compte.</div>}
        </>
      )}

      <Modal open={detail !== null} onClose={() => setDetail(null)} title={detail?.row ? `${detail.row.label} · leads` : "Leads de la sélection"} wide>
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
                  <th>Arrivé</th>
                  <th>Source</th>
                  <th>Call</th>
                  <th>Vente</th>
                  <th className="!text-right">CA</th>
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
                      {l.bookingStatus ? BOOKING_STATUS_LABEL[l.bookingStatus] : "—"}
                      {l.appointmentAt && <div className="dim text-[10.5px] num">{fmtDateTime(l.appointmentAt)}</div>}
                    </td>
                    <td className="text-[12px]" style={{ color: l.saleStatus === "WON" ? GOOD : l.saleStatus === "LOST" ? BAD : undefined }}>
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
      </Modal>
    </div>
  );
}
