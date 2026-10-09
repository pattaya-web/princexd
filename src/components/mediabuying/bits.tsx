"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Modal } from "@/components/ui";
import { fmtMoney } from "@/lib/format";
import { deltaPct, fmtMetric, METRIC_BY_KEY, STATUS_LABEL } from "@/lib/mediabuying/metrics";
import { PHASE_LABEL, WINNER_LABEL, type EntityRow, type Health, type MetricKey, type Phase, type Recommendation, type UiStatus, type WinnerStatus } from "@/lib/mediabuying/types";

/* ------------------------------- Couleurs ------------------------------ */

export const STATUS_COLOR: Record<UiStatus, string> = { active: "#16a34a", paused: "#9297b3", pending: "#f59e0b", error: "#ef4444" };
export const HEALTH_COLOR: Record<Health, string> = { strong: "#16a34a", watch: "#f59e0b", weak: "#ef4444", none: "var(--text-3)" };
const HEALTH_LABEL: Record<Health, string> = { strong: "Strong", watch: "Watch", weak: "Weak", none: "—" };
const VERDICT_LABEL = { keep: "KEEP", watch: "WATCH", kill: "KILL", none: "—" } as const;
const VERDICT_COLOR = { keep: "#16a34a", watch: "#f59e0b", kill: "#ef4444", none: "var(--text-3)" } as const;
export const PHASE_COLOR: Record<Phase, string> = { testing: "#006dbc", "scaling-testing": "#7c3aed", "hyper-scaling": "#0f766e", unclassified: "#9297b3" };

/* -------------------------------- Badges ------------------------------- */

export function StatusDot({ status, label = true }: { status: UiStatus; label?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px]" title={STATUS_LABEL[status]}>
      <span className="inline-block w-2 h-2 rounded-full" style={{ background: STATUS_COLOR[status] }} />
      {label && <span style={{ color: status === "paused" ? "var(--text-2)" : "var(--text)" }}>{STATUS_LABEL[status]}</span>}
    </span>
  );
}

export function HealthBadge({ health }: { health: Health }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold" style={{ color: HEALTH_COLOR[health] }} title="Santé selon tes cibles (CTR, CPL, bookings, ventes)">
      <span className="inline-block w-2 h-2 rounded-full" style={{ background: HEALTH_COLOR[health] }} />
      {HEALTH_LABEL[health]}
    </span>
  );
}

export function VerdictBadge({ rec, compact }: { rec: Recommendation; compact?: boolean }) {
  const color = VERDICT_COLOR[rec.verdict];
  return (
    <span className="inline-flex flex-col leading-tight" title={rec.reason}>
      <span className="mono text-[10.5px] font-semibold tracking-wide" style={{ color }}>
        {VERDICT_LABEL[rec.verdict]}
      </span>
      {!compact && <span className="dim text-[11px] truncate max-w-[220px]">{rec.reason}</span>}
    </span>
  );
}

export function PhaseBadge({ phase }: { phase: Phase }) {
  return (
    <span className="badge !text-[10px] !py-0" style={{ color: PHASE_COLOR[phase], borderColor: `color-mix(in srgb, ${PHASE_COLOR[phase]} 35%, transparent)`, background: `color-mix(in srgb, ${PHASE_COLOR[phase]} 8%, var(--surface))` }}>
      {PHASE_LABEL[phase]}
    </span>
  );
}

const WINNER_COLOR: Record<WinnerStatus, string> = { "": "var(--text-3)", testing: "#006dbc", "potential-winner": "#f59e0b", winner: "#16a34a", loser: "#ef4444" };

export function WinnerSelect({ value, onChange, disabled }: { value: WinnerStatus; onChange: (v: WinnerStatus) => void; disabled?: boolean }) {
  return (
    <select
      className="select select-xs !w-auto"
      value={value}
      disabled={disabled}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value as WinnerStatus)}
      style={{ color: WINNER_COLOR[value], fontWeight: value ? 600 : 400 }}
      title="Tag interne : ne modifie pas Meta"
    >
      <option value="">— tag</option>
      <option value="testing">Testing</option>
      <option value="potential-winner">Potential winner</option>
      <option value="winner">⭐ Winner</option>
      <option value="loser">Loser</option>
    </select>
  );
}

export function WinnerTag({ value }: { value: WinnerStatus }) {
  if (!value) return null;
  return (
    <span className="text-[10.5px] font-semibold" style={{ color: WINNER_COLOR[value] }}>
      {value === "winner" ? "⭐ " : ""}
      {WINNER_LABEL[value]}
    </span>
  );
}

/* ------------------------------- Post ID ------------------------------- */

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function PostIdChip({ postId, onCopied, full }: { postId: string; onCopied?: () => void; full?: boolean }) {
  const [done, setDone] = useState(false);
  if (!postId) return <span className="dim text-[11px]">—</span>;
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1.5 mono text-[11px] px-1.5 h-[22px] rounded-[6px] transition-colors"
      style={{ background: done ? "color-mix(in srgb, var(--good) 12%, var(--surface))" : "var(--surface-2)", border: "1px solid var(--border)", color: done ? "var(--good)" : "var(--text-2)" }}
      title={`Copier le Post ID ${postId}`}
      onClick={async (e) => {
        e.stopPropagation();
        if (await copyText(postId)) {
          setDone(true);
          onCopied?.();
          setTimeout(() => setDone(false), 1500);
        }
      }}
    >
      {done ? "Copié ✓" : full ? postId : `…${postId.slice(-6)}`}
      {!done && <span className="opacity-60">⧉</span>}
    </button>
  );
}

/* ------------------------------ Metriques ------------------------------ */

export function MetricValue({ k, v, currency, strong }: { k: MetricKey; v: number | null | undefined; currency: string; strong?: boolean }) {
  const def = METRIC_BY_KEY.get(k);
  const text = fmtMetric(k, v, currency);
  const missing = v === null || v === undefined;
  return (
    <span className={`num ${strong ? "font-semibold" : ""}`} style={missing ? { color: "var(--text-3)" } : undefined} title={def?.label}>
      {text}
    </span>
  );
}

/** « ↓ 18 % vs période précédente », vert quand c'est une bonne nouvelle. */
export function Delta({ now, before, lowerIsBetter, suffix = "vs période précédente" }: { now: number | null; before: number | null; lowerIsBetter?: boolean; suffix?: string }) {
  const d = deltaPct(now, before);
  if (d === null || !Number.isFinite(d)) return <span className="dim text-[11px]">— {suffix}</span>;
  const good = lowerIsBetter ? d < 0 : d > 0;
  const neutral = Math.abs(d) < 0.5;
  return (
    <span className="text-[11px] num" style={{ color: neutral ? "var(--text-3)" : good ? "var(--good)" : "var(--critical)" }}>
      {d > 0 ? "↑" : d < 0 ? "↓" : "="} {Math.abs(d).toFixed(0)} % {suffix}
    </span>
  );
}

export function GoalBar({ value, goal, label }: { value: number; goal: number; label?: string }) {
  const pct = goal > 0 ? Math.min(100, (value / goal) * 100) : 0;
  const color = pct >= 100 ? "var(--good)" : pct >= 50 ? "var(--accent)" : "var(--warning)";
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 text-[11.5px]">
        <span className="num font-semibold">
          {value} / {goal} {label ?? "leads"}
        </span>
        <span className="dim num">{Math.round(goal > 0 ? (value / goal) * 100 : 0)} %</span>
      </div>
      <div className="h-[6px] rounded-full mt-1 overflow-hidden" style={{ background: "var(--surface-3)" }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

export function KpiCard({ label, value, sub, accent, notConnected, action }: { label: string; value: ReactNode; sub?: ReactNode; accent?: string; notConnected?: boolean; action?: ReactNode }) {
  return (
    <div className="card px-3.5 py-3 min-w-0">
      <div className="label-xs truncate">{label}</div>
      {notConnected ? (
        <>
          <div className="text-[15px] font-medium mt-1.5" style={{ color: "var(--text-3)" }}>
            Non connecté
          </div>
          {action && <div className="mt-1.5">{action}</div>}
        </>
      ) : (
        <>
          <div className="text-[22px] sm:text-[24px] font-semibold num leading-none mt-1.5" style={{ letterSpacing: "-0.03em", color: accent }}>
            {value}
          </div>
          {sub && <div className="mt-1.5 min-h-[14px]">{sub}</div>}
        </>
      )}
    </div>
  );
}

/* -------------------------------- Modales ------------------------------ */

export function ConfirmModal({
  open,
  title,
  children,
  confirmLabel = "Confirmer",
  danger,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Annuler
          </button>
          <button className={`btn ${danger ? "btn-danger" : "btn-primary"}`} onClick={onConfirm} disabled={busy}>
            {busy ? <span className="spinner" /> : confirmLabel}
          </button>
        </>
      }
    >
      <div className="text-[13.5px] leading-relaxed">{children}</div>
    </Modal>
  );
}

/** Modification d'un budget : saisie, raccourcis +10/20/30/50 %, puis confirmation explicite. */
export function BudgetModal({ row, currency, open, onClose, onApply }: { row: EntityRow | null; currency: string; open: boolean; onClose: () => void; onApply: (amount: number) => Promise<void> }) {
  const current = row?.budget?.amount ?? 0;
  const [value, setValue] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setValue(current ? String(current) : "");
      setConfirm(false);
    }
  }, [open, current]);
  const next = Number(value.replace(",", "."));
  const valid = Number.isFinite(next) && next > 0 && next !== current;
  const type = row?.budget?.type === "lifetime" ? "total" : "/ jour";
  const level = row?.budget?.level === "campaign" ? "campagne (CBO)" : "ad set (ABO)";
  if (!row) return null;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Budget · ${row.name}`}
      footer={
        confirm ? (
          <>
            <button className="btn" onClick={() => setConfirm(false)} disabled={busy}>
              Annuler
            </button>
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onApply(next);
                  onClose();
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? <span className="spinner" /> : "Confirmer"}
            </button>
          </>
        ) : (
          <>
            <button className="btn" onClick={onClose}>
              Annuler
            </button>
            <button className="btn btn-primary" disabled={!valid} onClick={() => setConfirm(true)}>
              Appliquer
            </button>
          </>
        )
      }
    >
      {confirm ? (
        <p className="text-[14px]">
          Passer le budget {type} de la {level} <strong>{row.name}</strong> de <strong className="num">{fmtMoney(current, currency)}</strong> à <strong className="num">{fmtMoney(next, currency)}</strong> ?
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="text-[12.5px] dim">
            Budget actuel : <strong className="num" style={{ color: "var(--text)" }}>{current ? fmtMoney(current, currency) : "—"}</strong> {type} · niveau {level}
          </div>
          <label className="block">
            <span className="label-xs block mb-1.5">Nouveau budget ({currency})</span>
            <input className="input num text-[18px] font-semibold" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
          </label>
          <div className="flex flex-wrap gap-1.5">
            {[10, 20, 30, 50].map((p) => (
              <button key={p} type="button" className="btn btn-sm" onClick={() => setValue(String(Math.round(current * (1 + p / 100))))} disabled={!current}>
                +{p} %
              </button>
            ))}
            <button type="button" className="btn btn-sm" onClick={() => setValue(String(Math.round(current * 2)))} disabled={!current}>
              ×2
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Apercu d'une creative : video jouable ou image grand format, textes, Post ID, metriques. */
export function CreativeModal({ row, open, onClose, currency, campaignName, adsetName, onCopied }: { row: EntityRow | null; open: boolean; onClose: () => void; currency: string; campaignName: string; adsetName: string; onCopied?: () => void }) {
  if (!row) return null;
  const c = row.creative;
  const keys: MetricKey[] = ["spend", "leads", "cpl", "bookings", "costPerBooking", "shows", "showRate", "sales", "cac", "roas", "ctrLink", "cpcLink", "lpv", "costPerLpv", "cpm", "frequency"];
  return (
    <Modal open={open} onClose={onClose} title={`${row.name} · créative`} wide>
      <div className="grid md:grid-cols-[minmax(0,360px)_1fr] gap-5">
        <div className="rounded-[10px] overflow-hidden" style={{ background: "#000", aspectRatio: "4 / 5", maxHeight: 520 }}>
          {c?.kind === "video" && c.videoUrl ? (
            <video src={c.videoUrl} poster={c.thumbnailUrl || undefined} controls playsInline className="w-full h-full object-contain" />
          ) : c?.imageUrl || c?.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={c.imageUrl || c.thumbnailUrl} alt={row.name} className="w-full h-full object-contain" />
          ) : (
            <div className="w-full h-full flex items-center justify-center dim text-[12.5px] px-6 text-center" style={{ color: "#aaa" }}>
              Aperçu indisponible (la créative n&apos;a pas pu être lue chez Meta).
            </div>
          )}
        </div>
        <div className="min-w-0 flex flex-col gap-3 text-[13px]">
          <div className="flex flex-wrap items-center gap-2">
            <StatusDot status={row.status} />
            <PhaseBadge phase={row.phase} />
            <WinnerTag value={row.winnerStatus} />
            <HealthBadge health={row.health} />
          </div>
          <div className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
            <span className="label-xs">Post ID</span>
            <span>
              <PostIdChip postId={row.postId} full onCopied={onCopied} />
            </span>
            <span className="label-xs">Ad ID</span>
            <span className="mono num">{row.id}</span>
            <span className="label-xs">Ad set</span>
            <span className="truncate">{adsetName}</span>
            <span className="label-xs">Campagne</span>
            <span className="truncate">{campaignName}</span>
            <span className="label-xs">Format</span>
            <span>{c?.kind === "video" ? "Vidéo" : c?.kind === "image" ? "Image" : c?.kind === "carousel" ? "Carrousel" : "—"}</span>
            <span className="label-xs">CTA</span>
            <span>{c?.cta || "—"}</span>
          </div>
          {c?.primaryText && (
            <div>
              <div className="label-xs mb-1">Texte principal</div>
              <p className="whitespace-pre-wrap leading-relaxed text-[12.5px]" style={{ color: "var(--text-2)" }}>
                {c.primaryText}
              </p>
            </div>
          )}
          {(c?.headline || c?.description) && (
            <div className="card-flat px-3 py-2">
              <div className="font-semibold text-[13px]">{c?.headline}</div>
              <div className="dim text-[12px]">{c?.description}</div>
            </div>
          )}
          {row.notes && (
            <div className="text-[12px]" style={{ color: "var(--text-2)" }}>
              <span className="label-xs">Note interne · </span>«&nbsp;{row.notes}&nbsp;»
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-2 pt-2" style={{ borderTop: "1px solid var(--border)" }}>
            {keys.map((k) => (
              <div key={k} className="min-w-0">
                <div className="label-xs truncate">{METRIC_BY_KEY.get(k)?.short}</div>
                <div className="text-[13.5px] font-semibold">
                  <MetricValue k={k} v={row.metrics[k]} currency={currency} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

/** Jusqu'a cinq creatives cote a cote, miniature comprise. */
export function CompareModal({ rows, open, onClose, currency }: { rows: EntityRow[]; open: boolean; onClose: () => void; currency: string }) {
  const keys: MetricKey[] = ["spend", "leads", "cpl", "bookings", "costPerBooking", "shows", "showRate", "sales", "cac", "revenue", "roas", "ctrLink", "cpcLink", "lpv", "costPerLpv", "cpm", "frequency"];
  const best = useMemo(() => {
    const m = new Map<MetricKey, string>();
    for (const k of keys) {
      const def = METRIC_BY_KEY.get(k);
      let bestRow: EntityRow | null = null;
      for (const r of rows) {
        const v = r.metrics[k];
        if (v === null || v === undefined) continue;
        const bv = bestRow?.metrics[k] ?? null;
        if (bv === null || (def?.lowerIsBetter ? v < bv : v > bv)) bestRow = r;
      }
      if (bestRow) m.set(k, bestRow.id);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);
  return (
    <Modal open={open} onClose={onClose} title={`Comparer ${rows.length} créatives`} wide>
      <div className="scroll-x">
        <table className="table" style={{ minWidth: 520 }}>
          <thead>
            <tr>
              <th />
              {rows.map((r) => (
                <th key={r.id} className="!normal-case !tracking-normal !font-sans !text-[12px] !text-[color:var(--text)]">
                  <div className="flex flex-col items-start gap-1.5">
                    {r.creative?.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.creative.thumbnailUrl} alt="" className="w-[64px] h-[80px] object-cover rounded-[6px]" />
                    ) : (
                      <div className="w-[64px] h-[80px] rounded-[6px]" style={{ background: "var(--surface-3)" }} />
                    )}
                    <span className="font-semibold">{r.name}</span>
                    <WinnerTag value={r.winnerStatus} />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k}>
                <td className="label-xs whitespace-nowrap">{METRIC_BY_KEY.get(k)?.short}</td>
                {rows.map((r) => (
                  <td key={r.id} className="num" style={best.get(k) === r.id ? { color: "var(--good)", fontWeight: 600 } : undefined}>
                    <MetricValue k={k} v={r.metrics[k]} currency={currency} />
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <td className="label-xs">Verdict</td>
              {rows.map((r) => (
                <td key={r.id}>
                  <VerdictBadge rec={r.recommendation} />
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

/** Duplication : destination (meme parent, autre parent) et nom. */
export function DuplicateModal({
  row,
  open,
  onClose,
  parents,
  onSubmit,
}: {
  row: EntityRow | null;
  open: boolean;
  onClose: () => void;
  /** Parents possibles (campagnes pour un ad set, ad sets pour une ad). */
  parents: { id: string; name: string }[];
  onSubmit: (target: { parentId: string; name: string; keepPostId: boolean }) => Promise<void>;
}) {
  const [parentId, setParentId] = useState("same");
  const [name, setName] = useState("");
  const [keepPostId, setKeep] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open && row) {
      setParentId("same");
      setName(`${row.name} — copie`);
      setKeep(true);
    }
  }, [open, row]);
  if (!row) return null;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Dupliquer · ${row.name}`}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Annuler
          </button>
          <button
            className="btn btn-primary"
            disabled={busy || !name.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await onSubmit({ parentId, name: name.trim(), keepPostId });
                onClose();
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <span className="spinner" /> : "Dupliquer (en pause)"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {row.level !== "campaign" && (
          <label className="block">
            <span className="label-xs block mb-1.5">Destination</span>
            <select className="select" value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="same">{row.level === "ad" ? "Même ad set" : "Même campagne"}</option>
              {parents
                .filter((p) => p.id !== row.parentId)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </label>
        )}
        <label className="block">
          <span className="label-xs block mb-1.5">Nom de la copie</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {row.level === "ad" && row.postId && (
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={keepPostId} onChange={(e) => setKeep(e.target.checked)} />
            Garder le Post ID (conserve les likes et commentaires)
          </label>
        )}
        <p className="dim text-[12px]">La copie est créée en pause : rien ne diffuse tant que tu ne l&apos;actives pas.</p>
      </div>
    </Modal>
  );
}
