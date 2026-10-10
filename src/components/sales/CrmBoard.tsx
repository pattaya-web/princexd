"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/client";
import { fmtDate, fmtDateTime, fmtDualDateTime, fmtMoney, label as statusLabel, relative } from "@/lib/format";
import { useSalesData } from "@/lib/sales/client";
import { FOLLOWUP_BUCKET_LABEL, PAYMENT_LABEL, QUICK_VIEWS, TODO_LABEL, type CrmPayload, type CrmRow, type FollowUpBucket, type QuickView } from "@/lib/sales/crm-types";
import { Card, Empty, ErrorNote, Spinner, useToast } from "@/components/ui";
import { AppointmentDetail } from "./AppointmentDetail";
import { LeadSheet } from "./LeadSheet";
import { SourceChip } from "./AttributionBlock";
import type { PublicMember } from "@/lib/sales/repo";
import type { Session } from "@/lib/types";

/* --------------------------------- Couleurs ------------------------------ */

const GOOD = "var(--good)";
const WARN = "var(--warning)";
const BAD = "var(--critical)";

const PAY_COLOR = { paid: GOOD, partial: WARN, pending: WARN } as const;
const BUCKET_COLOR: Record<FollowUpBucket, string> = { overdue: BAD, today: WARN, tomorrow: "var(--accent)", later: "var(--text-3)" };

/** Normalise pour la recherche : minuscules, sans accents, chiffres seuls pour un numero. */
const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
const digits = (s: string) => s.replace(/\D/g, "");

interface Filters {
  source: string;
  funnel: string;
  campaignId: string;
  adsetId: string;
  adId: string;
  closerId: string;
  setterId: string;
  show: "" | "SHOWED" | "NO_SHOW" | "PENDING";
  qualified: "" | "yes" | "no";
  saleStatus: "" | "WON" | "LOST" | "FOLLOW_UP" | "PENDING";
  payment: "" | "paid" | "partial" | "pending";
  followUp: "" | "pending" | "overdue" | "none";
  from: string;
  to: string;
}
const NO_FILTERS: Filters = { source: "", funnel: "", campaignId: "", adsetId: "", adId: "", closerId: "", setterId: "", show: "", qualified: "", saleStatus: "", payment: "", followUp: "", from: "", to: "" };

async function copyText(t: string) {
  try {
    await navigator.clipboard.writeText(t);
    return true;
  } catch {
    return false;
  }
}

/**
 * Le CRM : recherche instantanee, vues rapides avec compteurs, cartes
 * epurees, filtres avances replies. Une carte ouvre la fiche existante
 * (rendez-vous, ou fiche contact s'il n'y a pas encore de rendez-vous).
 */
export function CrmBoard({ session, members, refreshKey, onChanged }: { session: Session; members: PublicMember[]; refreshKey: number; onChanged: () => void }) {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [view, setView] = useState<QuickView>("todo");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [openAppt, setOpenAppt] = useState<string | null>(null);
  const [openLead, setOpenLead] = useState<string | null>(null);
  const [busy, setBusy] = useState("");

  const { data, loading, error, reload } = useSalesData<CrmPayload>(`/api/sales/crm?v=${refreshKey}`, { every: 60_000 });

  // ?open=<rendez-vous> : la cloche et le dashboard arrivent ici.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("open");
    if (id) setOpenAppt(id);
  }, []);
  useEffect(() => {
    const on = () => void reload(true);
    window.addEventListener("sales:changed", on);
    return () => window.removeEventListener("sales:changed", on);
  }, [reload]);

  const changed = () => {
    void reload(true);
    onChanged();
    window.dispatchEvent(new Event("sales:changed"));
  };

  const rows = data?.rows ?? [];
  const activeFilters = Object.values(filters).filter(Boolean).length;

  const shown = useMemo(() => {
    const nq = norm(q.trim());
    const dq = digits(q);
    return rows.filter((r) => {
      if (!r.views.includes(view)) return false;
      if (nq) {
        const hay = norm(`${r.name} ${r.handle} ${r.email}`);
        const phoneHit = dq.length >= 3 && digits(r.phone).includes(dq);
        if (!hay.includes(nq) && !phoneHit) return false;
      }
      const f = filters;
      if (f.source && r.sourceChannel !== f.source) return false;
      if (f.funnel && r.funnelSource !== f.funnel) return false;
      if (f.campaignId && r.campaignId !== f.campaignId) return false;
      if (f.adsetId && r.adsetId !== f.adsetId) return false;
      if (f.adId && r.adId !== f.adId) return false;
      if (f.closerId && r.closerId !== f.closerId) return false;
      if (f.setterId && r.setterId !== f.setterId) return false;
      if (f.show && r.showStatus !== f.show) return false;
      if (f.qualified === "yes" && !r.qualified) return false;
      if (f.qualified === "no" && r.qualified) return false;
      if (f.saleStatus && r.saleStatus !== f.saleStatus) return false;
      if (f.payment && r.sale?.paymentStatus !== f.payment) return false;
      if (f.followUp === "pending" && !r.followUp) return false;
      if (f.followUp === "overdue" && r.followUp?.bucket !== "overdue") return false;
      if (f.followUp === "none" && r.followUp) return false;
      const day = (r.appointmentAt || r.createdAt).slice(0, 10);
      if (f.from && day < f.from) return false;
      if (f.to && day > f.to) return false;
      return true;
    });
  }, [rows, view, q, filters]);

  // Recherche : quand on tape, on cherche dans TOUT, pas seulement la vue courante.
  const searching = q.trim().length > 0;
  const searched = useMemo(() => {
    if (!searching) return shown;
    const nq = norm(q.trim());
    const dq = digits(q);
    return rows.filter((r) => norm(`${r.name} ${r.handle} ${r.email}`).includes(nq) || (dq.length >= 3 && digits(r.phone).includes(dq)));
  }, [rows, q, searching, shown]);
  const list = searching ? searched : shown;

  const open = (r: CrmRow) => (r.appointmentId ? setOpenAppt(r.appointmentId) : setOpenLead(r.leadId));

  const fuAction = async (r: CrmRow, body: Record<string, unknown>, ok: string) => {
    if (!r.followUp) return;
    setBusy(r.leadId);
    try {
      await api(`/api/sales/followups/${r.followUp.id}`, { method: "PATCH", body: JSON.stringify(body) });
      toast(ok);
      changed();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy("");
    }
  };

  /** Relance de paiement : programmee demain sur le rendez-vous de la vente. */
  const planPaymentFollowUp = async (r: CrmRow) => {
    const apptId = r.sale?.appointmentId || r.appointmentId;
    if (!apptId) return toast("Pas de rendez-vous rattaché à cette vente.", "err");
    setBusy(r.leadId);
    try {
      const d = new Date(Date.now() + 86_400_000);
      d.setHours(10, 0, 0, 0);
      await api("/api/sales/followups", { method: "POST", body: JSON.stringify({ appointmentId: apptId, dueAt: d.toISOString(), notes: `Relance paiement : reste ${fmtMoney(r.sale?.remaining ?? 0, data?.currency ?? "EUR")}` }) });
      toast("Relance paiement programmée demain 10 h.");
      changed();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy("");
    }
  };

  const currency = data?.currency ?? "EUR";
  const Sel = ({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) => (
    <label className="flex flex-col gap-1 min-w-0">
      <span className="label-xs">{label}</span>
      <select className="select select-sm" value={value} onChange={(e) => onChange(e.target.value)}>
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
        } as React.CSSProperties
      }
    >
      {/* Recherche */}
      <div className="flex items-center gap-2 mb-3">
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 dim text-[14px]">⌕</span>
          <input className="input !pl-9 !h-[40px] !text-[14px]" value={q} placeholder="Rechercher un lead… (prénom, nom, pseudo, email, téléphone)" onChange={(e) => setQ(e.target.value)} autoComplete="off" />
          {q && (
            <button className="btn btn-ghost btn-sm absolute right-1.5 top-1/2 -translate-y-1/2 !h-[28px]" onClick={() => setQ("")}>
              ✕
            </button>
          )}
        </div>
        <button className={`btn !h-[40px] ${filtersOpen || activeFilters ? "btn-primary" : ""}`} onClick={() => setFiltersOpen((v) => !v)}>
          Filtres{activeFilters ? ` (${activeFilters})` : ""}
        </button>
      </div>

      {/* Filtres avances, replies par defaut */}
      {filtersOpen && data && (
        <Card className="mb-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <Sel label="Source" value={filters.source} onChange={(v) => setFilters({ ...filters, source: v, funnel: "", campaignId: "", adsetId: "", adId: "" })}>
              <option value="">Toutes</option>
              {data.options.sources.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </Sel>
            <Sel label="Funnel" value={filters.funnel} onChange={(v) => setFilters({ ...filters, funnel: v })}>
              <option value="">Tous</option>
              {data.options.funnels.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </Sel>
            <Sel label="Campaign" value={filters.campaignId} onChange={(v) => setFilters({ ...filters, campaignId: v, adsetId: "", adId: "" })}>
              <option value="">Toutes</option>
              {data.options.campaigns.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Sel>
            <Sel label="Ad set" value={filters.adsetId} onChange={(v) => setFilters({ ...filters, adsetId: v, adId: "" })}>
              <option value="">Tous</option>
              {data.options.adsets.filter((a) => !filters.campaignId || a.campaignId === filters.campaignId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Sel>
            <Sel label="Creative" value={filters.adId} onChange={(v) => setFilters({ ...filters, adId: v })}>
              <option value="">Toutes</option>
              {data.options.ads.filter((a) => !filters.adsetId || a.adsetId === filters.adsetId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Sel>
            <Sel label="Closer" value={filters.closerId} onChange={(v) => setFilters({ ...filters, closerId: v })}>
              <option value="">Tous</option>
              {data.options.closers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Sel>
            <Sel label="Setter" value={filters.setterId} onChange={(v) => setFilters({ ...filters, setterId: v })}>
              <option value="">Tous</option>
              {data.options.setters.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Sel>
            <Sel label="Show" value={filters.show} onChange={(v) => setFilters({ ...filters, show: v as Filters["show"] })}>
              <option value="">—</option>
              <option value="SHOWED">Show</option>
              <option value="NO_SHOW">No-show</option>
              <option value="PENDING">Call à venir</option>
            </Sel>
            <Sel label="Qualification" value={filters.qualified} onChange={(v) => setFilters({ ...filters, qualified: v as Filters["qualified"] })}>
              <option value="">—</option>
              <option value="yes">Qualifié</option>
              <option value="no">Non qualifié</option>
            </Sel>
            <Sel label="Sale status" value={filters.saleStatus} onChange={(v) => setFilters({ ...filters, saleStatus: v as Filters["saleStatus"] })}>
              <option value="">—</option>
              <option value="WON">Closé</option>
              <option value="FOLLOW_UP">Follow-up</option>
              <option value="LOST">Perdu</option>
              <option value="PENDING">En cours</option>
            </Sel>
            <Sel label="Payment status" value={filters.payment} onChange={(v) => setFilters({ ...filters, payment: v as Filters["payment"] })}>
              <option value="">—</option>
              <option value="paid">Payé</option>
              <option value="partial">Partiel</option>
              <option value="pending">En attente</option>
            </Sel>
            <Sel label="Follow-up" value={filters.followUp} onChange={(v) => setFilters({ ...filters, followUp: v as Filters["followUp"] })}>
              <option value="">—</option>
              <option value="pending">Relance en cours</option>
              <option value="overdue">Relance en retard</option>
              <option value="none">Sans relance</option>
            </Sel>
            <label className="flex flex-col gap-1">
              <span className="label-xs">Du</span>
              <input className="input !h-[30px] !text-[12.5px]" type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="label-xs">Au</span>
              <input className="input !h-[30px] !text-[12.5px]" type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
            </label>
            <div className="flex items-end">
              <button className="btn btn-sm" onClick={() => setFilters(NO_FILTERS)} disabled={!activeFilters}>
                Réinitialiser
              </button>
            </div>
          </div>
        </Card>
      )}

      {/* Vues rapides */}
      {!searching && (
        <div className="flex flex-wrap items-center gap-1.5 mb-4">
          {QUICK_VIEWS.map((v) => {
            const n = data?.counts[v.key] ?? 0;
            const active = view === v.key;
            const urgent = v.key === "todo" || v.key === "payment";
            return (
              <button
                key={v.key}
                type="button"
                onClick={() => setView(v.key)}
                className="h-[32px] px-3.5 rounded-full text-[12.5px] font-medium transition-colors"
                style={{ background: active ? "var(--accent)" : "var(--surface)", color: active ? "#fff" : "var(--text-2)", border: `1px solid ${active ? "var(--accent)" : "var(--border)"}` }}
                title={v.hint}
              >
                {v.label}
                <span className="num ml-1.5" style={{ opacity: active ? 0.9 : 0.7, color: !active && urgent && n ? BAD : undefined }}>
                  {n}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {error && <div className="mb-3"><ErrorNote>{error}</ErrorNote></div>}
      {loading && !data ? (
        <Spinner label="Chargement du CRM…" />
      ) : list.length === 0 ? (
        <Card>
          <Empty>{searching ? `Aucun lead pour « ${q} ».` : view === "todo" ? "Rien à traiter maintenant. Tout est à jour ✓" : "Aucun lead dans cette vue."}</Empty>
        </Card>
      ) : view === "followup" && !searching ? (
        <FollowUpGroups rows={list} currency={currency} busy={busy} onOpen={open} onDone={(r) => fuAction(r, { status: "done" }, "Relance faite.")} onContact={(r) => fuAction(r, { contact: true }, "Relance notée.")} />
      ) : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {list.map((r) => (
            <LeadCard key={r.leadId} r={r} view={searching ? "all" : view} currency={currency} busy={busy === r.leadId} onOpen={() => open(r)} onFuDone={() => fuAction(r, { status: "done" }, "Relance faite.")} onFuContact={() => fuAction(r, { contact: true }, "Relance notée.")} onPlanPayment={() => planPaymentFollowUp(r)} />
          ))}
        </div>
      )}
      {!loading && list.length > 0 && (
        <div className="dim text-[11.5px] mt-3">
          {list.length} lead{list.length > 1 ? "s" : ""}
          {searching ? " trouvés" : ""} · {view === "todo" && !searching ? "classés par priorité" : "dernière action en premier"}
        </div>
      )}

      <AppointmentDetail
        id={openAppt}
        open={openAppt !== null}
        onClose={() => setOpenAppt(null)}
        onChanged={changed}
        session={session}
        members={members}
      />
      <LeadSheet id={openLead} onClose={() => setOpenLead(null)} onChanged={changed} />
    </div>
  );
}

/* --------------------------------- Carte --------------------------------- */

function Stat({ label, value, color }: { label: string; value: React.ReactNode; color?: string }) {
  return (
    <div className="min-w-0">
      <div className="label-xs !text-[9.5px]">{label}</div>
      <div className="text-[14px] font-semibold num truncate" style={{ color }}>
        {value}
      </div>
    </div>
  );
}

function headline(r: CrmRow): { text: string; color: string } {
  if (r.todo) return { text: TODO_LABEL[r.todo.rank], color: r.todo.rank <= 2 ? BAD : WARN };
  if (r.sale) return { text: PAYMENT_LABEL[r.sale.paymentStatus], color: PAY_COLOR[r.sale.paymentStatus] };
  if (r.followUp) return { text: `Relance ${FOLLOWUP_BUCKET_LABEL[r.followUp.bucket].toLowerCase()}`, color: BUCKET_COLOR[r.followUp.bucket] };
  if (r.saleStatus === "LOST") return { text: "Perdu", color: "var(--text-3)" };
  if (r.showStatus === "NO_SHOW") return { text: "No-show", color: BAD };
  if (r.showStatus === "SHOWED") return { text: "Show", color: GOOD };
  if (r.appointmentStatus) return { text: statusLabel(r.appointmentStatus), color: "var(--accent)" };
  if (r.callStatus === "cold") return { text: "Lead froid", color: "var(--text-3)" };
  return { text: statusLabel(r.stage), color: "var(--text-2)" };
}

function LeadCard({ r, view, currency, busy, onOpen, onFuDone, onFuContact, onPlanPayment }: { r: CrmRow; view: QuickView; currency: string; busy: boolean; onOpen: () => void; onFuDone: () => void; onFuContact: () => void; onPlanPayment: () => void }) {
  const [copied, setCopied] = useState(false);
  const h = headline(r);
  const showPayment = view === "payment" || view === "closed" || (view === "todo" && r.todo?.rank === 1) || (view === "all" && r.sale);
  const showFollowUp = (view === "followup" || view === "todo" || view === "all" || view === "reschedule" || view === "noshow") && r.followUp;
  return (
    <div className="card p-4 flex flex-col gap-3 cursor-pointer card-hover" onClick={onOpen} style={{ borderTop: `3px solid ${h.color}` }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[15px] font-semibold truncate">{r.name}</div>
          <div className="text-[12px] font-medium" style={{ color: h.color }}>
            {h.text}
          </div>
        </div>
        <SourceChip channel={r.sourceChannel} />
      </div>

      {r.todo && view === "todo" && <div className="text-[12.5px]" style={{ color: "var(--text-2)" }}>{r.todo.reason}</div>}

      {showPayment && r.sale && (
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Contrat" value={fmtMoney(r.sale.contractValue, currency)} />
          <Stat label="Cash" value={fmtMoney(r.sale.cashCollected, currency)} color={r.sale.cashCollected > 0 ? GOOD : undefined} />
          <Stat label="Reste" value={fmtMoney(r.sale.remaining, currency)} color={r.sale.remaining > 0 ? (r.sale.overdueAmount > 0 ? BAD : WARN) : GOOD} />
        </div>
      )}
      {view === "closed" && r.sale && (
        <div className="grid grid-cols-2 gap-2 text-[12px]">
          <Stat label="Call" value={r.appointmentAt ? fmtDate(r.appointmentAt) : "—"} />
          <Stat label="Closer" value={r.closerName || "—"} />
          <Stat label="Offre" value={r.sale.offer || "—"} />
          <Stat label="Paiement" value={PAYMENT_LABEL[r.sale.paymentStatus]} color={PAY_COLOR[r.sale.paymentStatus]} />
        </div>
      )}
      {(view === "payment" || (view === "todo" && r.todo?.rank === 1)) && r.sale && (
        <div className="text-[12px] flex flex-col gap-0.5" style={{ color: "var(--text-2)" }}>
          {r.sale.nextDueAt && (
            <span>
              Prochaine échéance : <strong className="num" style={{ color: r.sale.nextDueAt < new Date().toISOString().slice(0, 10) ? BAD : undefined }}>{fmtDate(`${r.sale.nextDueAt}T12:00:00Z`)}</strong> · {fmtMoney(r.sale.nextDueAmount, currency)}
            </span>
          )}
          <span>Dernière action : {relative(r.lastActionAt)} — {r.lastActionSummary}</span>
          <span>
            Prochaine relance : {r.followUp ? <strong className="num" style={{ color: BUCKET_COLOR[r.followUp.bucket] }}>{fmtDate(r.followUp.dueAt)}</strong> : <span className="dim">aucune</span>}
          </span>
        </div>
      )}

      {(view === "show" || view === "noshow" || view === "reschedule" || view === "qualified" || view === "lost" || view === "all") && !r.sale && (
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Call" value={r.appointmentAt ? fmtDateTime(r.appointmentAt) : "—"} />
          <Stat label={r.closerName ? "Closer" : "Setter"} value={r.closerName || r.setterName || "—"} />
        </div>
      )}

      {showFollowUp && r.followUp && (
        <div className="card-flat px-3 py-2 text-[12px] flex flex-col gap-0.5" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold num" style={{ color: BUCKET_COLOR[r.followUp.bucket] }}>
              Relance {fmtDualDateTime(r.followUp.dueAt)}
            </span>
            {r.followUp.step && <span className="badge !text-[10px] !py-0">{r.followUp.step === 2 ? "Dernière" : "1/2"}</span>}
          </div>
          {r.followUp.notes && <span style={{ color: "var(--text-2)" }}>{r.followUp.notes}</span>}
          {r.followUp.lastMessage && <span className="dim truncate">Dernier message : {r.followUp.lastMessage}</span>}
          {r.followUp.lastContactAt && <span className="dim">Dernière relance : {fmtDateTime(r.followUp.lastContactAt)}</span>}
        </div>
      )}

      <div className="flex items-center gap-1.5 flex-wrap mt-auto pt-1" onClick={(e) => e.stopPropagation()}>
        {r.phone && (
          <button
            type="button"
            className="btn btn-sm !h-[28px]"
            style={copied ? { borderColor: GOOD, color: GOOD } : { borderColor: "#25d366", color: "#128c7e" }}
            onClick={async () => {
              if (await copyText(r.phone)) {
                setCopied(true);
                setTimeout(() => setCopied(false), 1400);
              }
            }}
            title={`Copier ${r.phone} pour WhatsApp`}
          >
            {copied ? "Copié ✓" : "WhatsApp"}
          </button>
        )}
        {r.followUp && (
          <>
            <button className="btn btn-sm !h-[28px]" disabled={busy} onClick={onFuContact} title="Noter que tu as relancé maintenant">
              ✉ Relancé
            </button>
            <button className="btn btn-sm !h-[28px]" disabled={busy} onClick={onFuDone} title="Relance faite, le prospect a répondu">
              ✓ Relance faite
            </button>
          </>
        )}
        {!r.followUp && r.sale && r.sale.remaining > 0 && (
          <button className="btn btn-sm !h-[28px]" disabled={busy} onClick={onPlanPayment}>
            Programmer la relance
          </button>
        )}
        <button className="btn btn-sm btn-primary !h-[28px] ml-auto" onClick={onOpen}>
          Ouvrir la fiche
        </button>
      </div>
    </div>
  );
}

/* ----------------------------- Vue À relancer ---------------------------- */

function FollowUpGroups({ rows, currency, busy, onOpen, onDone, onContact }: { rows: CrmRow[]; currency: string; busy: string; onOpen: (r: CrmRow) => void; onDone: (r: CrmRow) => void; onContact: (r: CrmRow) => void }) {
  const buckets: FollowUpBucket[] = ["overdue", "today", "tomorrow", "later"];
  return (
    <div className="flex flex-col gap-4">
      {buckets.map((b) => {
        const items = rows.filter((r) => r.followUp?.bucket === b).sort((x, y) => (x.followUp!.dueAt < y.followUp!.dueAt ? -1 : 1));
        if (!items.length) return null;
        return (
          <section key={b}>
            <div className="flex items-center gap-2 mb-2">
              <span className="w-[8px] h-[8px] rounded-full" style={{ background: BUCKET_COLOR[b] }} />
              <h3 className="text-[13px] font-semibold">{FOLLOWUP_BUCKET_LABEL[b]}</h3>
              <span className="badge !text-[10px] !py-0 num">{items.length}</span>
            </div>
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {items.map((r) => (
                <LeadCard key={r.leadId} r={r} view="followup" currency={currency} busy={busy === r.leadId} onOpen={() => onOpen(r)} onFuDone={() => onDone(r)} onFuContact={() => onContact(r)} onPlanPayment={() => undefined} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
