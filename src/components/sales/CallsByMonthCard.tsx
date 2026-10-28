"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, ErrorNote, Spinner } from "@/components/ui";
import { api, useLocalState } from "@/lib/client";
import { fmtMoney } from "@/lib/format";
import type { CallsMonthsReport, MonthCalls } from "@/lib/sales/calls-months";

/**
 * « Mes calls par mois » (Sales Dashboard) : pour chaque mois de la plage
 * choisie, combien de calls ont eu lieu, combien sont venus, combien ont
 * close, et combien ca a rapporte. Un call est compte au mois ou il s'est
 * tenu (pas au mois d'arrivee du lead). Plage : presets ou dates libres.
 */

type Preset = "3m" | "6m" | "12m" | "year" | "all" | "custom";
const PRESETS: { key: Preset; label: string }[] = [
  { key: "3m", label: "3 derniers mois" },
  { key: "6m", label: "6 derniers mois" },
  { key: "12m", label: "12 derniers mois" },
  { key: "year", label: "Cette année" },
  { key: "all", label: "Depuis le début" },
  { key: "custom", label: "Personnalisé" },
];

const pad = (n: number) => String(n).padStart(2, "0");
const dayOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function presetRange(p: Preset, now = new Date()): { from: string; to: string } {
  const to = dayOf(now);
  const firstOfMonthsAgo = (n: number) => dayOf(new Date(now.getFullYear(), now.getMonth() - n, 1));
  if (p === "3m") return { from: firstOfMonthsAgo(2), to };
  if (p === "6m") return { from: firstOfMonthsAgo(5), to };
  if (p === "12m") return { from: firstOfMonthsAgo(11), to };
  if (p === "year") return { from: `${now.getFullYear()}-01-01`, to };
  return { from: "2020-01-01", to };
}

const pct = (v: number | null) => (v === null ? "—" : `${v.toFixed(0)} %`);
const int = (v: number) => new Intl.NumberFormat("fr-FR").format(v);

export function CallsByMonthCard() {
  const [preset, setPreset] = useLocalState<Preset>("sales.dash.months.preset", "6m");
  const [custom, setCustom] = useLocalState<{ from: string; to: string }>("sales.dash.months.custom", { from: "", to: "" });
  /** "me" = mes calls (defaut), "all" = toute l'equipe, sinon l'id d'un closer. */
  const [closer, setCloser] = useLocalState<string>("sales.dash.months.closer", "me");
  const [report, setReport] = useState<CallsMonthsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const range = useMemo(() => {
    if (preset !== "custom") return presetRange(preset);
    const d = presetRange("6m");
    return { from: custom.from || d.from, to: custom.to || d.to };
  }, [preset, custom]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api<CallsMonthsReport>(`/api/sales/calls-months?from=${range.from}&to=${range.to}&closer=${encodeURIComponent(closer)}`)
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
  }, [range, closer, tick]);

  useEffect(() => {
    const on = () => setTick((t) => t + 1);
    window.addEventListener("sales:changed", on);
    return () => window.removeEventListener("sales:changed", on);
  }, []);

  const currency = report?.currency ?? "EUR";
  const months = report?.months ?? [];
  const t = report?.totals;
  const shown = months.filter((m) => m.calls > 0);
  const best = shown.reduce<MonthCalls | null>((acc, m) => (acc === null || m.revenue > acc.revenue ? m : acc), null);

  return (
    <Card
      padded={false}
      title={closer === "me" ? "Mes calls : faits, closés, générés" : closer === "all" ? "Calls de l'équipe : faits, closés, générés" : `Calls de ${report?.closers.find((c) => c.id === closer)?.name ?? "ce closer"}`}
      subtitle={`un call compte au mois où il a eu lieu · annulés, déplacés et à venir exclus${closer === "me" ? " · les calls sans closer attribué sont les miens" : ""}`}
      actions={
        <div className="flex items-center gap-1.5 flex-wrap">
          <select className="select select-sm !w-auto" value={closer} onChange={(e) => setCloser(e.target.value)} title="Quels calls : les miens, ceux de toute l'équipe, ou d'un closer">
            <option value="me">Mes calls</option>
            <option value="all">Toute l'équipe</option>
            {(report?.closers ?? []).filter((c) => c.id !== report?.meId).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select className="select select-sm !w-auto" value={preset} onChange={(e) => setPreset(e.target.value as Preset)}>
            {PRESETS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
          {preset === "custom" && (
            <>
              <input className="input !h-[30px] !w-auto !text-[12.5px]" type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
              <span className="dim text-[12px]">→</span>
              <input className="input !h-[30px] !w-auto !text-[12.5px]" type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
            </>
          )}
          {loading && <span className="spinner" />}
        </div>
      }
    >
      {error && (
        <div className="p-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      {!report && loading && (
        <div className="p-4">
          <Spinner label="Calcul des mois…" />
        </div>
      )}
      {report && t && (
        <>
          {/* Les totaux de la plage, en une ligne lisible. */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-px" style={{ background: "var(--border)", borderBottom: "1px solid var(--border)" }}>
            <Stat label="Calls faits" value={int(t.calls)} sub={`${int(t.shows)} venus · ${int(t.noShows)} no-show`} />
            <Stat label="Show rate" value={pct(t.showRate)} sub="venus / calls passés" />
            <Stat label="Closés" value={int(t.won)} sub={`${int(t.lost)} perdus · ${int(t.pending)} à statuer`} color={t.won ? "var(--good)" : undefined} />
            <Stat label="Close rate" value={pct(t.closeRate)} sub="closés / venus" color={t.closeRate === null ? undefined : t.closeRate >= 30 ? "var(--good)" : t.closeRate >= 15 ? "var(--warning)" : "var(--critical)"} />
            <Stat label="Généré (contrats)" value={fmtMoney(t.revenue, currency)} sub={`${fmtMoney(t.cash, currency)} encaissés`} color={t.revenue ? "var(--good)" : undefined} />
            <Stat label="Par call venu" value={t.revenuePerShow === null ? "—" : fmtMoney(t.revenuePerShow, currency)} sub="CA / show" />
          </div>

          {shown.length === 0 ? (
            <div className="p-5 text-center muted text-[13px]">Aucun call passé sur cette plage.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table w-full text-[13px]">
                <thead>
                  <tr>
                    <th className="text-left">Mois</th>
                    <th className="text-right">Calls</th>
                    <th className="text-right">Venus</th>
                    <th className="text-right">No-show</th>
                    <th className="text-right">Show rate</th>
                    <th className="text-right">Closés</th>
                    <th className="text-right">Close rate</th>
                    <th className="text-right">Généré</th>
                    <th className="text-right">Encaissé</th>
                    <th className="text-right">CA / venu</th>
                  </tr>
                </thead>
                <tbody>
                  {months.map((m) => {
                    const share = t.revenue > 0 ? (m.revenue / t.revenue) * 100 : 0;
                    return (
                      <tr key={m.month} className={m.calls === 0 ? "dim" : ""}>
                        <td className="whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{m.label}</span>
                            {best && best.month === m.month && shown.length > 1 && (
                              <span className="badge !text-[10.5px]" style={{ color: "var(--good)" }}>
                                meilleur mois
                              </span>
                            )}
                          </div>
                          {m.revenue > 0 && (
                            <div className="h-[3px] rounded-full mt-1.5 max-w-[140px]" style={{ background: "var(--surface-3)" }}>
                              <div className="h-full rounded-full" style={{ width: `${Math.max(4, share)}%`, background: "var(--good)" }} />
                            </div>
                          )}
                        </td>
                        <td className="text-right num font-semibold">{m.calls || "—"}</td>
                        <td className="text-right num">{m.shows || "—"}</td>
                        <td className="text-right num" style={{ color: m.noShows ? "var(--critical)" : undefined }}>
                          {m.noShows || "—"}
                        </td>
                        <td className="text-right num">{pct(m.showRate)}</td>
                        <td className="text-right num font-semibold" style={{ color: m.won ? "var(--good)" : undefined }}>
                          {m.won || "—"}
                          {m.pending > 0 && (
                            <span className="dim font-normal text-[11px]" title="calls passés sans issue saisie">
                              {" "}
                              +{m.pending} ?
                            </span>
                          )}
                        </td>
                        <td className="text-right num">{pct(m.closeRate)}</td>
                        <td className="text-right num font-semibold" style={{ color: m.revenue ? "var(--good)" : undefined }}>
                          {m.revenue ? fmtMoney(m.revenue, currency) : "—"}
                        </td>
                        <td className="text-right num">{m.cash ? fmtMoney(m.cash, currency) : "—"}</td>
                        <td className="text-right num">{m.revenuePerShow === null ? "—" : fmtMoney(m.revenuePerShow, currency)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="font-semibold" style={{ borderTop: "2px solid var(--border)" }}>
                    <td>Total</td>
                    <td className="text-right num">{int(t.calls)}</td>
                    <td className="text-right num">{int(t.shows)}</td>
                    <td className="text-right num">{int(t.noShows)}</td>
                    <td className="text-right num">{pct(t.showRate)}</td>
                    <td className="text-right num" style={{ color: t.won ? "var(--good)" : undefined }}>
                      {int(t.won)}
                    </td>
                    <td className="text-right num">{pct(t.closeRate)}</td>
                    <td className="text-right num" style={{ color: t.revenue ? "var(--good)" : undefined }}>
                      {fmtMoney(t.revenue, currency)}
                    </td>
                    <td className="text-right num">{fmtMoney(t.cash, currency)}</td>
                    <td className="text-right num">{t.revenuePerShow === null ? "—" : fmtMoney(t.revenuePerShow, currency)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          {report.statsSince && report.from === report.statsSince && (
            <div className="px-4 py-2 dim text-[11.5px]" style={{ borderTop: "1px solid var(--border)" }}>
              Compté depuis le {report.statsSince.split("-").reverse().join("/")} (réglage « compter depuis le » du dashboard).
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="px-4 py-3 min-w-0" style={{ background: "var(--surface)" }}>
      <div className="label-xs truncate">{label}</div>
      <div className="text-[22px] font-semibold num leading-none mt-1.5" style={{ letterSpacing: "-0.03em", color }}>
        {value}
      </div>
      {sub && <div className="dim text-[11px] mt-1 truncate">{sub}</div>}
    </div>
  );
}
