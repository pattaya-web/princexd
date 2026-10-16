"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/client";
import { fmtDateTime, fmtMoney, relative } from "@/lib/format";
import { useSalesData } from "@/lib/sales/client";
import { FOLLOWUP_BUCKET_LABEL, QUICK_VIEWS, TODO_LABEL, type CrmPayload, type CrmRow, type FollowUpBucket, type QuickView } from "@/lib/sales/crm-types";
import { PAYMENT_STATE_LABEL, type PaymentState } from "@/lib/sales/installments";
import { Card, Empty, ErrorNote, Spinner, useToast } from "@/components/ui";
import { AppointmentDetail } from "./AppointmentDetail";
import { LeadSheet } from "./LeadSheet";
import { SourceChip } from "./AttributionBlock";
import { TONE_COLOR } from "./OutcomePanel";
import type { PublicMember } from "@/lib/sales/repo";
import type { Session } from "@/lib/types";

/* --------------------------------- Couleurs ------------------------------ */

const GOOD = "var(--good)";
const WARN = "var(--warning)";
const BAD = "var(--critical)";
const BUCKET_COLOR: Record<FollowUpBucket, string> = { overdue: BAD, today: WARN, tomorrow: "var(--accent)", later: "var(--text-3)" };

/** Normalise pour la recherche : minuscules, sans accents, chiffres seuls pour un numero. */
const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
const digits = (s: string) => s.replace(/\D/g, "");
const fmtDay = (day: string) => day.slice(0, 10).split("-").reverse().slice(0, 2).join("/");

interface Filters {
  source: string;
  funnel: string;
  campaignId: string;
  adsetId: string;
  adId: string;
  closerId: string;
  setterId: string;
  from: string;
  to: string;
}
const NO_FILTERS: Filters = { source: "", funnel: "", campaignId: "", adsetId: "", adId: "", closerId: "", setterId: "", from: "", to: "" };
const VIEW_KEYS = new Set<string>(QUICK_VIEWS.map((v) => v.key));

async function copyText(t: string) {
  try {
    await navigator.clipboard.writeText(t);
    return true;
  } catch {
    return false;
  }
}

/**
 * Le CRM : tous les leads, une ligne chacun, avec LE statut qui compte et
 * ce qu'il faut faire. Recherche instantanee, vues rapides avec compteurs
 * (a traiter, calls a venir, a relancer, paiements, closes, no-shows,
 * perdus, tous), filtres avances replies.
 *
 * « Statuer » ouvre la fiche du lead, ou tout se pose en un clic : show,
 * en attente, reprogramme, no-show, perdu, close (montant, encaisse, en N
 * fois, paiement attendu), echeance encaissee, paiement precise, vente
 * annulee faute de paiement. La fiche detaillee du call reste a un clic.
 */
export function CrmBoard({ session, members, refreshKey, onChanged }: { session: Session; members: PublicMember[]; refreshKey: number; onChanged: () => void }) {
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const urlView = params.get("view");
  const [q, setQ] = useState("");
  const [view, setView] = useState<QuickView>(urlView && VIEW_KEYS.has(urlView) ? (urlView as QuickView) : "todo");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [openAppt, setOpenAppt] = useState<string | null>(null);
  const [openLead, setOpenLead] = useState<string | null>(null);
  const [busy, setBusy] = useState("");

  const { data, loading, error, reload } = useSalesData<CrmPayload>(`/api/sales/crm?v=${refreshKey}`, { every: 60_000 });

  // ?open=<rendez-vous> : la cloche et le dashboard arrivent ici ; ?lead=<id> ouvre la fiche du lead.
  useEffect(() => {
    const open = params.get("open");
    const lead = params.get("lead");
    if (open) setOpenAppt(open);
    if (lead) setOpenLead(lead);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (urlView && VIEW_KEYS.has(urlView)) setView(urlView as QuickView);
  }, [urlView]);
  useEffect(() => {
    const on = () => void reload(true);
    window.addEventListener("sales:changed", on);
    return () => window.removeEventListener("sales:changed", on);
  }, [reload]);

  const pickView = (v: QuickView) => {
    setView(v);
    router.replace(`${pathname}?view=${v}`, { scroll: false });
  };

  const changed = () => {
    void reload(true);
    onChanged();
    window.dispatchEvent(new Event("sales:changed"));
  };

  const rows = data?.rows ?? [];
  const activeFilters = Object.values(filters).filter(Boolean).length;
  const searching = q.trim().length > 0;

  const list = useMemo(() => {
    const nq = norm(q.trim());
    const dq = digits(q);
    const f = filters;
    const out = rows.filter((r) => {
      // Quand on tape, on cherche dans TOUT, pas seulement la vue courante.
      if (!searching && !r.views.includes(view)) return false;
      if (nq) {
        const hay = norm(`${r.name} ${r.handle} ${r.email}`);
        const phoneHit = dq.length >= 3 && digits(r.phone).includes(dq);
        if (!hay.includes(nq) && !phoneHit) return false;
      }
      if (f.source && r.sourceChannel !== f.source) return false;
      if (f.funnel && r.funnelSource !== f.funnel) return false;
      if (f.campaignId && r.campaignId !== f.campaignId) return false;
      if (f.adsetId && r.adsetId !== f.adsetId) return false;
      if (f.adId && r.adId !== f.adId) return false;
      if (f.closerId && r.closerId !== f.closerId) return false;
      if (f.setterId && r.setterId !== f.setterId) return false;
      const day = (r.appointmentAt || r.createdAt).slice(0, 10);
      if (f.from && day < f.from) return false;
      if (f.to && day > f.to) return false;
      return true;
    });
    if (!searching && view === "upcoming") out.sort((a, b) => a.appointmentAt.localeCompare(b.appointmentAt));
    if (!searching && view === "closed") out.sort((a, b) => (b.sale?.soldAt ?? "").localeCompare(a.sale?.soldAt ?? ""));
    return out;
  }, [rows, view, q, filters, searching]);

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

  const currency = data?.currency ?? "EUR";
  const Sel = ({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) => (
    <label className="flex flex-col gap-1 min-w-0">
      <span className="label-xs">{label}</span>
      <select className="select select-sm" value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
    </label>
  );

  const rowProps = (r: CrmRow) => ({
    r,
    view: searching ? ("all" as QuickView) : view,
    currency,
    busy: busy === r.leadId,
    onStatus: () => setOpenLead(r.leadId),
    onCall: () => (r.appointmentId ? setOpenAppt(r.appointmentId) : setOpenLead(r.leadId)),
    onFuDone: () => fuAction(r, { status: "done" }, "Relance faite."),
    onFuContact: () => fuAction(r, { contact: true }, "Relance notée."),
  });

  /* Regroupements : les paiements par etat, les relances par echeance. */
  const groups = useMemo((): { key: string; title: string; color: string; items: CrmRow[] }[] | null => {
    if (searching) return null;
    if (view === "payment") {
      const order: PaymentState[] = ["overdue", "due", "unspecified", "awaiting", "open", "scheduled"];
      const color: Record<PaymentState, string> = { overdue: BAD, due: WARN, unspecified: WARN, awaiting: "var(--accent)", open: WARN, scheduled: "var(--text-3)", paid: GOOD };
      return order.map((k) => ({ key: k, title: PAYMENT_STATE_LABEL[k], color: color[k], items: list.filter((r) => r.sale?.paymentState === k).sort((a, b) => (a.sale?.nextDueAt ?? "").localeCompare(b.sale?.nextDueAt ?? "")) })).filter((g) => g.items.length);
    }
    if (view === "followup") {
      const order: FollowUpBucket[] = ["overdue", "today", "tomorrow", "later"];
      return order.map((k) => ({ key: k, title: FOLLOWUP_BUCKET_LABEL[k], color: BUCKET_COLOR[k], items: list.filter((r) => r.followUp?.bucket === k).sort((a, b) => a.followUp!.dueAt.localeCompare(b.followUp!.dueAt)) })).filter((g) => g.items.length);
    }
    if (view === "todo") {
      const kinds = Object.keys(TODO_LABEL) as (keyof typeof TODO_LABEL)[];
      const color: Record<string, string> = { "payment-overdue": BAD, "followup-overdue": BAD, outcome: WARN, "payment-due": WARN, "payment-unspecified": WARN, noshow: WARN, unconfirmed: "var(--accent)" };
      return kinds.map((k) => ({ key: k, title: TODO_LABEL[k], color: color[k], items: list.filter((r) => r.todo?.kind === k) })).filter((g) => g.items.length);
    }
    return null;
  }, [list, view, searching]);

  /* Totaux de la vue paiements : ce qui reste a rentrer, et ce qui est en retard. */
  const payTotals = useMemo(() => {
    if (view !== "payment" || searching) return null;
    const remaining = list.reduce((n, r) => n + (r.sale?.remaining ?? 0), 0);
    const overdue = list.reduce((n, r) => n + (r.sale?.paymentState === "overdue" ? r.sale.remaining : 0), 0);
    const soon = list.reduce((n, r) => n + (r.sale?.paymentState === "due" ? r.sale.nextDueAmount : 0), 0);
    return { remaining, overdue, soon };
  }, [list, view, searching]);

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
            <Sel label="Campagne" value={filters.campaignId} onChange={(v) => setFilters({ ...filters, campaignId: v, adsetId: "", adId: "" })}>
              <option value="">Toutes</option>
              {data.options.campaigns.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Sel>
            <Sel label="Ad set" value={filters.adsetId} onChange={(v) => setFilters({ ...filters, adsetId: v, adId: "" })}>
              <option value="">Tous</option>
              {data.options.adsets.filter((a) => !filters.campaignId || a.campaignId === filters.campaignId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Sel>
            <Sel label="Créative" value={filters.adId} onChange={(v) => setFilters({ ...filters, adId: v })}>
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
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          {QUICK_VIEWS.map((v) => {
            const n = data?.counts[v.key] ?? 0;
            const active = view === v.key;
            const urgent = v.key === "todo";
            return (
              <button
                key={v.key}
                type="button"
                onClick={() => pickView(v.key)}
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
          <span className="dim text-[11.5px] ml-auto hidden sm:inline">{QUICK_VIEWS.find((v) => v.key === view)?.hint}</span>
        </div>
      )}

      {payTotals && list.length > 0 && (
        <div className="flex items-center gap-4 flex-wrap mb-3 text-[12.5px] card-flat px-3.5 py-2">
          <span>
            <span className="dim">Reste à encaisser : </span>
            <strong className="num">{fmtMoney(payTotals.remaining, currency)}</strong>
          </span>
          <span>
            <span className="dim">En retard : </span>
            <strong className="num" style={{ color: payTotals.overdue ? BAD : GOOD }}>{payTotals.overdue ? fmtMoney(payTotals.overdue, currency) : "rien ✓"}</strong>
          </span>
          <span>
            <span className="dim">À encaisser sous 3 jours : </span>
            <strong className="num" style={{ color: payTotals.soon ? WARN : undefined }}>{payTotals.soon ? fmtMoney(payTotals.soon, currency) : "rien"}</strong>
          </span>
        </div>
      )}

      {error && <div className="mb-3"><ErrorNote>{error}</ErrorNote></div>}
      {loading && !data ? (
        <Spinner label="Chargement du CRM…" />
      ) : list.length === 0 ? (
        <Card>
          <Empty>
            {searching ? `Aucun lead pour « ${q} ».` : view === "todo" ? "Rien à traiter maintenant. Tout est à jour ✓" : view === "payment" ? "Tout est soldé ✓" : "Aucun lead dans cette vue."}
          </Empty>
        </Card>
      ) : groups ? (
        <div className="flex flex-col gap-4">
          {groups.map((g) => (
            <section key={g.key}>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="w-[8px] h-[8px] rounded-full" style={{ background: g.color }} />
                <h3 className="text-[13px] font-semibold">{g.title}</h3>
                <span className="badge !text-[10px] !py-0 num">{g.items.length}</span>
              </div>
              <div className="card overflow-hidden">
                {g.items.map((r, i) => (
                  <LeadRow key={r.leadId} {...rowProps(r)} last={i === g.items.length - 1} />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="card overflow-hidden">
          {list.map((r, i) => (
            <LeadRow key={r.leadId} {...rowProps(r)} last={i === list.length - 1} />
          ))}
        </div>
      )}
      {!loading && list.length > 0 && (
        <div className="dim text-[11.5px] mt-3">
          {list.length} lead{list.length > 1 ? "s" : ""}
          {searching ? " trouvés" : ""} · {view === "todo" && !searching ? "classés par priorité" : view === "upcoming" && !searching ? "prochain call en premier" : "dernière action en premier"}
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

/* --------------------------------- Ligne --------------------------------- */

/**
 * Une ligne = un lead. De gauche a droite : qui, le statut qui compte, ce
 * qu'il faut faire ou savoir (echeance, relance, call), qui s'en occupe,
 * derniere action, et les boutons. Tout est lisible sans ouvrir la fiche.
 */
function LeadRow({ r, view, currency, busy, last, onStatus, onCall, onFuDone, onFuContact }: { r: CrmRow; view: QuickView; currency: string; busy: boolean; last: boolean; onStatus: () => void; onCall: () => void; onFuDone: () => void; onFuContact: () => void }) {
  const [copied, setCopied] = useState(false);
  const color = TONE_COLOR[r.tone];

  /* La ligne de detail : ce qui aide a agir, selon la situation. */
  const detail: { text: string; color?: string }[] = [];
  if (view === "todo" && r.todo) detail.push({ text: r.todo.reason, color: r.todo.rank <= 2 ? BAD : undefined });
  if (r.sale && (view === "payment" || view === "closed" || view === "all" || (view === "todo" && r.todo?.kind.startsWith("payment")))) {
    if (!(view === "todo" && r.todo?.kind.startsWith("payment"))) detail.push({ text: r.sale.paymentSummary, color: r.sale.paymentState === "overdue" ? BAD : undefined });
  }
  if (r.followUp && view !== "payment") {
    const d = r.followUp.bucket === "overdue" ? "en retard" : r.followUp.bucket === "today" ? "aujourd'hui" : r.followUp.bucket === "tomorrow" ? "demain" : `le ${fmtDay(r.followUp.dueAt.slice(0, 10))}`;
    if (!(view === "todo" && r.todo?.kind === "followup-overdue")) detail.push({ text: `Relance ${d}${r.followUp.notes ? ` · ${r.followUp.notes}` : ""}`, color: BUCKET_COLOR[r.followUp.bucket] });
  }
  if (r.appointmentAt && (view === "upcoming" || view === "noshow" || view === "all" || view === "lost") && !r.sale) {
    detail.push({ text: `Call ${fmtDateTime(r.appointmentAt)}${r.confirmation === "confirmed" ? " · confirmé" : r.confirmation === "awaiting" ? " · message envoyé, pas de réponse" : r.confirmation === "no-answer" ? " · pas de réponse" : view === "upcoming" ? " · à confirmer" : ""}` });
  }
  if (!detail.length) detail.push({ text: `${r.lastActionSummary} · ${relative(r.lastActionAt)}` });

  return (
    <div
      className="px-3.5 py-2.5 flex items-center gap-3 flex-wrap hover:bg-[var(--surface-2)] transition-colors cursor-pointer"
      style={{ borderBottom: last ? "none" : "1px solid var(--border)", borderLeft: `3px solid ${color}` }}
      onClick={onStatus}
    >
      {/* Qui */}
      <div className="min-w-[160px] flex-1 basis-[180px]">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[13.5px] font-semibold truncate">{r.name}</span>
          <SourceChip channel={r.sourceChannel} />
        </div>
        <div className="dim text-[11.5px] truncate num">
          {r.phone || r.handle || r.email || "—"}
          {r.closerName ? ` · ${r.closerName}` : r.setterName ? ` · ${r.setterName}` : ""}
        </div>
        {r.utm && (
          <div className="text-[11px] truncate" style={{ color: "var(--accent)" }} title={`UTM du lien : ${r.utm}`}>
            UTM · {r.utm}
          </div>
        )}
      </div>

      {/* Le statut */}
      <div className="min-w-[170px] flex-1 basis-[200px]">
        <div className="text-[12.5px] font-semibold truncate" style={{ color }}>
          {r.headline}
        </div>
        {r.sale && view !== "payment" && (
          <div className="dim text-[11.5px] num truncate">
            {fmtMoney(r.sale.contractValue, currency)} · {fmtMoney(r.sale.cashCollected, currency)} encaissés{r.sale.remaining > 0 ? ` · reste ${fmtMoney(r.sale.remaining, currency)}` : ""}
          </div>
        )}
      </div>

      {/* Quoi faire / savoir */}
      <div className="min-w-[200px] flex-[2] basis-[260px] text-[12px] flex flex-col gap-0.5">
        {detail.map((d, i) => (
          <span key={i} className="truncate" style={{ color: d.color ?? "var(--text-2)" }} title={d.text}>
            {d.text}
          </span>
        ))}
        {view === "payment" && r.sale && r.sale.remaining > 0 && (
          <span className="dim text-[11.5px] num">
            {fmtMoney(r.sale.cashCollected, currency)} / {fmtMoney(r.sale.contractValue, currency)} encaissés · dernière action {relative(r.lastActionAt)}
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 shrink-0 ml-auto" onClick={(e) => e.stopPropagation()}>
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
        {r.followUp && (view === "followup" || view === "todo") && (
          <>
            <button className="btn btn-sm !h-[28px]" disabled={busy} onClick={onFuContact} title="Noter que tu as relancé maintenant">
              ✉ Relancé
            </button>
            <button className="btn btn-sm !h-[28px]" disabled={busy} onClick={onFuDone} title="Relance faite, le prospect a répondu">
              ✓ Faite
            </button>
          </>
        )}
        {r.appointmentId && (
          <button className="btn btn-sm !h-[28px]" onClick={onCall} title="Fiche détaillée du call : notes du setter, récap, historique">
            Fiche call
          </button>
        )}
        <button className="btn btn-sm btn-primary !h-[28px]" onClick={onStatus} title="Statuer : show, en attente, no-show, closé, perdu, paiement…">
          Statuer
        </button>
      </div>
    </div>
  );
}
