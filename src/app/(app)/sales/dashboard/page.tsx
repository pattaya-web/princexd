"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { SourceChip } from "@/components/sales/AttributionBlock";
import { AttentionCard } from "@/components/sales/DashboardBlocks";
import { CallsSection } from "@/components/sales/CallsSection";
import { CallsAnalysisTeaser } from "@/components/sales/CallsAnalysis";
import { InvestmentsCard } from "@/components/sales/InvestmentsCard";
import { UtmLinksTable } from "@/components/sales/UtmLinksTable";
import { SetterTasksAdminCard } from "@/components/sales/SetterTasksCard";
import type { UtmLinkRow } from "@/lib/sales/utm-links";
import { Card, Empty, ErrorNote, Modal, PageHeader, Spinner, Tabs } from "@/components/ui";
import { ShopifyAffiliate } from "@/components/ShopifyAffiliate";
import { api, useLocalState } from "@/lib/client";
import { fmtDate, fmtDateTime, fmtMoney, label as crmLabel } from "@/lib/format";
import type { RangePreset } from "@/lib/mediabuying/metrics";
import type { CallsReport } from "@/lib/sales/calls-months";
import { funnelLabel } from "@/lib/sales/attribution";
import { BOOKING_STATUS_LABEL, CLOSED_DETAIL_KEY, NO_SHOWS_DETAIL_KEY, SALE_STATUS_LABEL, SHOWS_DETAIL_KEY, type DueInstallment, type RemainingSale } from "@/lib/sales/business-types";
import { PAYMENT_STATE_LABEL } from "@/lib/sales/installments";
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
function Tile({ label, value, sub, color, big, onClick }: { label: string; value: ReactNode; sub?: ReactNode; color?: string; big?: boolean; onClick?: () => void }) {
  return (
    <div
      className={`card px-4 py-3.5 min-w-0 ${onClick ? "cursor-pointer hover:bg-[var(--surface-2)] transition-colors" : ""}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => (e.key === "Enter" || e.key === " ") && onClick() : undefined}
      title={onClick ? "Voir le détail" : undefined}
    >
      <div className="label-xs truncate">
        {label}
        {onClick ? <span className="dim"> ↗</span> : null}
      </div>
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
/** Ce que la fenetre de detail liste : les leads d'une ligne, les closes, les shows ou les no-shows. */
type DetailKind = "group" | "closed" | "shows" | "noshows";

/** Les periodes du dashboard : des chips, du plus court au plus long. */
const DASH_PRESETS: { key: RangePreset; label: string }[] = [
  { key: "last7", label: "7 jours" },
  { key: "last14", label: "14 jours" },
  { key: "last21", label: "21 jours" },
  { key: "last30", label: "30 jours" },
  { key: "month", label: "Ce mois" },
  { key: "last90", label: "3 mois" },
  { key: "all", label: "Tout" },
  { key: "custom", label: "Dates" },
];

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
  /* Les calls (date du call, un rendez-vous = un call) : meme periode, memes filtres, closer au choix. */
  const [closer, setCloser] = useLocalState<string>("sales.dash.closer", "all");
  const [calls, setCalls] = useState<CallsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ row: BusinessGroupRow | null; kind: DetailKind; leads: LeadBusiness[] | null } | null>(null);
  /* La tuile « Reste à encaisser » : qui doit quoi. null = fermee, [] en chargement. */
  const [remaining, setRemaining] = useState<RemainingSale[] | null>(null);
  const [remainingLoading, setRemainingLoading] = useState(false);
  const openRemaining = async () => {
    setRemaining([]);
    setRemainingLoading(true);
    try {
      const r = await api<{ sales: RemainingSale[] }>(`/api/sales/business?${query}&detail=remaining`);
      setRemaining(r.sales);
    } catch (e) {
      setError((e as Error).message);
      setRemaining(null);
    } finally {
      setRemainingLoading(false);
    }
  };
  const [view, setView] = useState<"table" | "pipeline">("table");
  const [ops, setOps] = useState<{ attention: AttentionBlock | null; followUps: { overdue: number } } | null>(null);
  /* « Compter depuis le » : la date de depart des chiffres, un reglage global. */
  const [since, setSince] = useState("");
  const [tick, setTick] = useState(0);
  /* Liens UTM : quel lien (video, post, story) a amene quels leads, et ce qu'ils sont devenus. */
  const [utm, setUtm] = useState<UtmLinkRow[] | null>(null);
  useEffect(() => {
    api<{ rows: UtmLinkRow[] }>("/api/sales/utm").then((r) => setUtm(r.rows)).catch(() => setUtm([]));
  }, [tick]);
  const saveSince = async (v: string) => {
    setSince(v);
    if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
    try {
      await api("/api/settings", { method: "PATCH", body: JSON.stringify({ salesStatsSince: v }) });
      setTick((t) => t + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  };

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
    if (tick) p.set("v", String(tick));
    return p.toString();
  }, [preset, custom, filters, groupBy, tick]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api<BusinessReport>(`/api/sales/business?${query}`)
      .then((r) => {
        if (!alive) return;
        setReport(r);
        setSince(r.statsSince ?? "");
        setError(null);
      })
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [query]);

  useEffect(() => {
    let alive = true;
    api<CallsReport>(`/api/sales/calls-months?${query}&closer=${encodeURIComponent(closer)}`)
      .then((r) => alive && setCalls(r))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [query, closer]);

  const openDetail = async (row: BusinessGroupRow | null, kind: DetailKind = "group") => {
    setDetail({ row, kind, leads: null });
    try {
      const key = kind === "closed" ? CLOSED_DETAIL_KEY : kind === "shows" ? SHOWS_DETAIL_KEY : kind === "noshows" ? NO_SHOWS_DETAIL_KEY : (row?.key ?? "all");
      const r = await api<{ leads: LeadBusiness[] }>(`/api/sales/business?${query}&detail=${encodeURIComponent(key)}`);
      setDetail({ row, kind, leads: r.leads });
    } catch (e) {
      setError((e as Error).message);
      setDetail(null);
    }
  };

  /* Bilan par closer des ventes affichées : qui a closé combien, contrat et cash. */
  const closedByCloser = useMemo(() => {
    if (detail?.kind !== "closed" || !detail.leads) return [];
    const m = new Map<string, { name: string; n: number; revenue: number; cash: number }>();
    for (const l of detail.leads) {
      const k = l.closerName || "Sans closer";
      const cur = m.get(k) ?? { name: k, n: 0, revenue: 0, cash: 0 };
      cur.n++;
      cur.revenue += l.revenue;
      cur.cash += l.cashCollected;
      m.set(k, cur);
    }
    return [...m.values()].sort((a, b) => b.revenue - a.revenue);
  }, [detail]);

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
            <div className="inline-flex gap-0.5 p-0.5 rounded-full" style={{ background: "var(--surface-3)" }} role="tablist" aria-label="Période">
              {DASH_PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  role="tab"
                  aria-selected={preset === p.key}
                  className="px-2.5 h-[26px] rounded-full text-[12px] font-medium transition-colors whitespace-nowrap"
                  style={preset === p.key ? { background: "var(--accent)", color: "#fff" } : { color: "var(--muted)" }}
                  onClick={() => setPreset(p.key)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {preset === "custom" && (
              <>
                <input className="input !h-[30px] !w-auto !text-[12.5px]" type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
                <span className="dim text-[12px]">→</span>
                <input className="input !h-[30px] !w-auto !text-[12.5px]" type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
              </>
            )}
            <button className={`btn btn-sm ${filtersOpen || activeFilters ? "btn-primary" : ""}`} onClick={() => setFiltersOpen((v) => !v)}>
              Filtres{activeFilters ? ` (${activeFilters})` : ""}
            </button>
            <label className="flex items-center gap-1.5 text-[12px] dim" title="Tout ce qui est avant cette date est ignoré (leads, calls, no-shows, ventes) : pour repartir sur une base propre. Vide = tout l'historique.">
              compter depuis le
              <input type="date" className="input !h-[30px] !w-auto !text-[12.5px]" value={since} onChange={(e) => void saveSince(e.target.value)} />
            </label>
            <a className="btn btn-sm" href={`/api/sales/business?${query}&export=csv`} download title="Toute la data de la période : totaux, puis un lead par ligne (call, issue, vente, closer)">
              Exporter CSV
            </a>
            {loading && <span className="spinner" />}
          </div>
        }
      />
      {report && (
        <div className="dim text-[11.5px] num -mt-4 mb-4">
          Période : {fmtDate(`${report.range.from}T12:00:00Z`)} → {fmtDate(`${report.range.to}T12:00:00Z`)}
        </div>
      )}
      {error && <div className="mb-3"><ErrorNote>{error}</ErrorNote></div>}

      <div className="mb-4">
        <ShopifyAffiliate compact />
      </div>

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

      {!report && loading && <Spinner label="Calcul du dashboard…" />}
      {report && t && cf && (
        <>
          <Section title="Calls" hint="sur la période, à la date du call · clique une tuile pour la liste">
            {calls ? <CallsSection report={calls} closer={closer} onCloser={setCloser} /> : <Spinner label="Calcul des calls…" />}
          </Section>

          <Section title="Trésorerie" hint="toutes ventes actives, hors période">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              <Tile label="Cash ce mois" value={fmt(cf.cashMonth, "money", currency)} color={cf.cashMonth ? GOOD : undefined} sub="encaissé depuis le 1er, toutes ventes" />
              <Tile label="Reste à encaisser" value={fmt(cf.remainingTotal, "money", currency)} color={cf.remainingTotal ? WARN : undefined} sub="toutes ventes actives · clique : qui doit quoi" onClick={() => void openRemaining()} />
              <Tile label="Ventes pas soldées" value={fmt(cf.pendingSales, "int", currency)} color={cf.overdueTotal ? WARN : undefined} sub={cf.overdueTotal ? `dont ${fmtMoney(cf.overdueTotal, currency)} en retard · clique : qui` : "échéances à venir, à jour · clique : qui"} onClick={() => void openRemaining()} />
            </div>
          </Section>

          <Section title="Acquisition" hint="leads arrivés sur la période (à leur date d'arrivée) : combien prennent un call">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <Tile label="Leads arrivés" value={fmt(t.leads, "int", currency)} sub={`${fmt(t.validLeads, "int", currency)} joignables`} />
              <Tile label="Qualifiés" value={fmt(t.qualifiedLeads, "int", currency)} sub="joints ou call pris" />
              <Tile label="Ont pris un call" value={fmt(t.bookings, "int", currency)} sub="rendez-vous non annulé" />
              <Tile label="Booking rate" value={fmt(t.bookingRate, "pct", currency)} sub="ont pris un call / leads arrivés" />
            </div>
          </Section>

          {/* Les alertes (relances, à confirmer) viennent APRÈS les chiffres : les chiffres d'abord. */}
          {ops && ops.followUps.overdue > 0 && (
            <Link href="/sales/rendez-vous?view=followup" className="block mb-4">
              <div className="rounded-lg px-3.5 py-2.5 text-[12.5px] flex items-center gap-2" style={{ background: "color-mix(in srgb, var(--warning) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--warning) 35%, transparent)" }}>
                <strong className="num">{ops.followUps.overdue}</strong>
                relance{ops.followUps.overdue > 1 ? "s" : ""} en retard — à traiter avant que le lead refroidisse.
              </div>
            </Link>
          )}
          {ops?.attention && <AttentionCard block={ops.attention} />}

          <div className="mb-4">
            <CallsAnalysisTeaser />
          </div>

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

          <Section title="Mes setters" hint="une relance que tu envoies atterrit sur son accueil, avec le contexte">
            <SetterTasksAdminCard />
          </Section>

          <Section title="Investissements business" hint="hors publicité : accompagnements, contenu, outils">
            <InvestmentsCard currency={currency} />
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
          <Section
            title="Mes liens UTM"
            hint="quel lien a amené combien de leads, quel jour, et ce qu'ils sont devenus"
            right={
              <Link href="/sales/utm" className="btn btn-sm">
                Créer / gérer les liens
              </Link>
            }
          >
            {utm === null ? <Spinner label="Liens…" /> : <UtmLinksTable rows={utm} currency={currency} />}
          </Section>
          {report.hasMock && <div className="dim text-[11px]">Les chiffres incluent les leads de démonstration du compte Meta simulé ; ils disparaîtront avec le vrai compte.</div>}
        </>
      )}

      <Modal open={remaining !== null} onClose={() => setRemaining(null)} title="Reste à encaisser · qui doit quoi" wide>
        {remainingLoading ? (
          <Spinner label="Chargement des ventes…" />
        ) : !remaining || remaining.length === 0 ? (
          <Empty>Tout est soldé ✓</Empty>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="dim text-[12px]">
              Clique sur un nom pour ouvrir sa fiche dans le CRM : « Encaissé ✓ » sur une échéance reçue, ou « Corriger la vente » si le contrat, l&apos;encaissé ou les dates sont faux.
            </div>
            <div className="scroll-x">
              <table className="table">
                <thead>
                  <tr>
                    <th>Lead</th>
                    <th>Closé le</th>
                    <th>Closer</th>
                    <th>État</th>
                    <th className="!text-right">Contrat</th>
                    <th className="!text-right">Encaissé</th>
                    <th className="!text-right">Reste</th>
                    <th>Prochaine échéance</th>
                  </tr>
                </thead>
                <tbody>
                  {remaining.map((s) => {
                    const tone = s.state === "overdue" ? BAD : s.state === "due" || s.state === "open" || s.state === "unspecified" ? WARN : undefined;
                    return (
                      <tr key={s.saleId}>
                        <td>
                          <Link href={`/sales/rendez-vous?view=payment&q=${encodeURIComponent(s.leadName)}`} className="text-[13px] font-medium link" title="Ouvrir dans le CRM pour encaisser ou corriger">
                            {s.leadName}
                          </Link>
                          {s.offer && <div className="dim text-[11px]">{s.offer}</div>}
                        </td>
                        <td className="num text-[12px] whitespace-nowrap">{s.soldAt ? fmtDate(s.soldAt) : "—"}</td>
                        <td className="text-[12px] whitespace-nowrap">{s.closerName || "—"}</td>
                        <td className="text-[12px] font-semibold whitespace-nowrap" style={{ color: tone }}>
                          {PAYMENT_STATE_LABEL[s.state]}
                          {s.state === "open" && <div className="dim text-[10.5px] font-normal">aucune échéance planifiée → Corriger la vente</div>}
                        </td>
                        <td className="text-right num">{fmtMoney(s.contractValue, s.currency)}</td>
                        <td className="text-right num" style={{ color: s.cashCollected ? GOOD : undefined }}>{fmtMoney(s.cashCollected, s.currency)}</td>
                        <td className="text-right num font-semibold" style={{ color: tone ?? WARN }}>{fmtMoney(s.remaining, s.currency)}</td>
                        <td className="text-[12px]">
                          {s.nextDueAt ? (
                            <>
                              <span className="num">{fmtDate(`${s.nextDueAt}T12:00:00Z`)}</span> · <span className="num font-semibold">{fmtMoney(s.nextDueAmount, s.currency)}</span>
                              <div className="dim text-[10.5px]">{s.summary}</div>
                            </>
                          ) : (
                            <span className="dim">{s.summary || "—"}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  <tr>
                    <td colSpan={4} className="text-[12px] font-semibold">
                      Total · {remaining.length} vente{remaining.length > 1 ? "s" : ""} pas soldée{remaining.length > 1 ? "s" : ""}
                    </td>
                    <td className="text-right num font-semibold">{fmtMoney(remaining.reduce((n, s) => n + s.contractValue, 0), currency)}</td>
                    <td className="text-right num font-semibold" style={{ color: GOOD }}>{fmtMoney(remaining.reduce((n, s) => n + s.cashCollected, 0), currency)}</td>
                    <td className="text-right num font-semibold" style={{ color: WARN }}>{fmtMoney(remaining.reduce((n, s) => n + s.remaining, 0), currency)}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={detail !== null} onClose={() => setDetail(null)} title={detail?.kind === "closed" ? "Closés · qui a closé quoi" : detail?.kind === "shows" ? "Shows · qui est venu au call" : detail?.kind === "noshows" ? "No-shows · qui n'est pas venu" : detail?.row ? `${detail.row.label} · leads` : "Leads de la sélection"} wide>
        {!detail?.leads ? (
          <Spinner label="Chargement des leads…" />
        ) : detail.leads.length === 0 ? (
          <Empty>{detail.kind === "closed" ? "Aucune vente sur la période (avec ces filtres)." : detail.kind === "shows" ? "Aucun show sur la période." : detail.kind === "noshows" ? "Aucun no-show sur la période." : "Aucun lead."}</Empty>
        ) : detail.kind === "closed" ? (
          <div className="flex flex-col gap-4">
            {/* Le bilan par closer, puis chaque vente. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {closedByCloser.map((c) => (
                <div key={c.name} className="card-flat px-3.5 py-2.5">
                  <div className="text-[13px] font-semibold truncate">{c.name}</div>
                  <div className="dim text-[11.5px] num mt-0.5">
                    {c.n} vente{c.n > 1 ? "s" : ""} · {fmtMoney(c.revenue, currency)} de contrats
                  </div>
                  <div className="text-[12.5px] num font-medium" style={{ color: GOOD }}>
                    {fmtMoney(c.cash, currency)} encaissés
                  </div>
                </div>
              ))}
            </div>
            <div className="scroll-x">
              <table className="table">
                <thead>
                  <tr>
                    <th>Lead</th>
                    <th>Provenance</th>
                    <th>Closé le</th>
                    <th>Closé par</th>
                    <th>Offre</th>
                    <th className="!text-right">Contrat</th>
                    <th className="!text-right">Cash encaissé</th>
                    <th className="!text-right">Reste</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.leads.map((l) => (
                    <tr key={l.leadId}>
                      <td>
                        <Link href={`/sales/rendez-vous?view=closed&q=${encodeURIComponent(l.name)}`} className="text-[13px] font-medium link" title="Ouvrir dans le CRM">
                          {l.name}
                        </Link>
                        {l.mock && <span className="dim text-[10px]"> démo</span>}
                        <div className="dim text-[11px]">{l.handle || l.email || l.phone}</div>
                      </td>
                      <td className="text-[12px]">
                        <SourceChip channel={l.sourceChannel} />
                        <div className="dim text-[11px]">{funnelLabel(l.funnelSource)}</div>
                        {(l.campaignName || l.adName) && (
                          <div className="dim text-[10.5px] truncate max-w-[220px]" title={[l.campaignName, l.adsetName, l.adName].filter(Boolean).join(" · ")}>
                            {[l.campaignName, l.adName].filter(Boolean).join(" · ")}
                          </div>
                        )}
                        {l.setterName && <div className="text-[10.5px]" style={{ color: "var(--accent)" }}>setting {l.setterName}</div>}
                      </td>
                      <td className="num text-[12px] whitespace-nowrap">{l.soldAt ? fmtDate(l.soldAt) : "—"}</td>
                      <td className="text-[12.5px] font-medium whitespace-nowrap">{l.closerName || <span className="dim">Sans closer</span>}</td>
                      <td className="text-[12px]">{l.offer || "—"}</td>
                      <td className="text-right num font-semibold">{fmtMoney(l.revenue, l.currency)}</td>
                      <td className="text-right num" style={{ color: l.cashCollected ? GOOD : undefined }}>{l.cashCollected ? fmtMoney(l.cashCollected, l.currency) : "—"}</td>
                      <td className="text-right num" style={{ color: l.remaining ? WARN : undefined }}>{l.remaining ? fmtMoney(l.remaining, l.currency) : "soldé ✓"}</td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={5} className="text-[12px] font-semibold">
                      Total · {detail.leads.length} vente{detail.leads.length > 1 ? "s" : ""}
                    </td>
                    <td className="text-right num font-semibold">{fmtMoney(detail.leads.reduce((n, l) => n + l.revenue, 0), currency)}</td>
                    <td className="text-right num font-semibold" style={{ color: GOOD }}>{fmtMoney(detail.leads.reduce((n, l) => n + l.cashCollected, 0), currency)}</td>
                    <td className="text-right num font-semibold">{fmtMoney(detail.leads.reduce((n, l) => n + l.remaining, 0), currency)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th>Lead</th>
                  <th>Arrivé</th>
                  <th>Source</th>
                  <th>Call</th>
                  <th>Closer</th>
                  <th>Vente</th>
                  <th className="!text-right">CA</th>
                  <th className="!text-right">Cash</th>
                </tr>
              </thead>
              <tbody>
                {detail.leads.map((l) => (
                  <tr key={l.leadId}>
                    <td>
                      <Link href={`/sales/rendez-vous?q=${encodeURIComponent(l.name)}`} className="text-[13px] font-medium link" title="Ouvrir dans le CRM">
                        {l.name}
                      </Link>
                      {l.mock && <span className="dim text-[10px]"> démo</span>}
                      <div className="dim text-[11px]">{l.handle || l.email || l.phone}</div>
                      {l.setterName && <div className="text-[10.5px]" style={{ color: "var(--accent)" }}>setting {l.setterName}</div>}
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
                    <td className="text-[12px] whitespace-nowrap">{l.closerName || <span className="dim">—</span>}</td>
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
