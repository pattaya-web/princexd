"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Empty, Modal } from "@/components/ui";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import type { CallRow, CallsReport, CallsTotals } from "@/lib/sales/calls-months";

/**
 * La section « Calls » du Sales Dashboard : les tuiles (calls, ventes), le
 * mois par mois quand la periode couvre plusieurs mois, et la liste des
 * calls derriere chaque tuile. Tout vient d'un seul calcul (callsReport),
 * a la date du call : les chiffres se recoupent forcement.
 */

const GOOD = "var(--good)";
const WARN = "var(--warning)";
const BAD = "var(--critical)";

type Kind = "calls" | "shows" | "noshows" | "pending" | "upcoming" | "won" | "lost" | "followup";
const KIND_TITLE: Record<Kind, string> = {
  calls: "Calls passés sur la période",
  shows: "Venus au call",
  noshows: "No-shows",
  pending: "À statuer · calls passés sans issue saisie",
  upcoming: "À venir · rendez-vous planifiés",
  won: "Closés",
  lost: "Perdus",
  followup: "Suite à donner",
};
const STATUS_LABEL: Record<CallRow["status"], string> = { show: "Venu", noshow: "No-show", pending: "À statuer" };
const OUTCOME_LABEL: Record<CallRow["outcome"], string> = { won: "Closé", lost: "Perdu", followup: "Suite à donner", "": "" };

const pct = (v: number | null) => (v === null ? "—" : `${v.toFixed(0)} %`);
const int = (v: number) => new Intl.NumberFormat("fr-FR").format(v);

/** Une case : un chiffre, un libelle, une ligne d'explication. */
function Tile({ label, value, sub, color, big, onClick }: { label: string; value: ReactNode; sub?: ReactNode; color?: string; big?: boolean; onClick?: () => void }) {
  return (
    <div
      className={`card px-4 py-3.5 min-w-0 ${onClick ? "cursor-pointer hover:bg-[var(--surface-2)] transition-colors" : ""}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => (e.key === "Enter" || e.key === " ") && onClick() : undefined}
      title={onClick ? "Voir la liste" : undefined}
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

export function CallsSection({ report, closer, onCloser }: { report: CallsReport; closer: string; onCloser: (v: string) => void }) {
  const t = report.totals;
  const cur = report.currency;
  const [open, setOpen] = useState<Kind | null>(null);
  const rows: CallRow[] = !open
    ? []
    : open === "upcoming"
      ? report.upcoming
      : report.calls.filter((c) => (open === "calls" ? true : open === "shows" ? c.status === "show" : open === "noshows" ? c.status === "noshow" : open === "pending" ? c.status === "pending" : open === "won" ? c.outcome === "won" : open === "lost" ? c.outcome === "lost" : c.outcome === "followup"));
  const multiMonth = report.months.filter((m) => m.calls > 0).length > 1;
  const who = closer === "all" ? "toute l'équipe" : closer === "me" ? "moi" : (report.closers.find((c) => c.id === closer)?.name ?? "ce closer");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap -mt-1">
        <select className="select select-sm !w-auto" value={closer} onChange={(e) => onCloser(e.target.value)} title="Quels calls : toute l'équipe, les miens, ou ceux d'un closer">
          <option value="all">Toute l&apos;équipe</option>
          <option value="me">Mes calls</option>
          {report.closers.filter((c) => c.id !== report.meId).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <span className="dim text-[11.5px]">
          Calls de {who}, comptés à la date du call · un rendez-vous = un call · annulés et déplacés exclus{closer === "me" ? " · sans closer attribué = moi" : ""}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <Tile label="Calls passés" value={int(t.calls)} sub={`${int(t.shows)} venus · ${int(t.noShows)} no-show${t.pending ? ` · ${int(t.pending)} à statuer` : ""}`} big onClick={() => setOpen("calls")} />
        <Tile label="Venus" value={int(t.shows)} color={t.shows ? GOOD : undefined} sub="le lead était là" onClick={() => setOpen("shows")} />
        <Tile label="No-shows" value={int(t.noShows)} color={t.noShows ? BAD : undefined} sub="pas venus" onClick={() => setOpen("noshows")} />
        <Tile label="Show rate" value={pct(t.showRate)} color={t.showRate === null ? undefined : t.showRate >= 70 ? GOOD : t.showRate >= 50 ? WARN : BAD} sub="venus / (venus + no-show)" />
        <Tile label="À statuer" value={int(t.pending)} color={t.pending ? WARN : undefined} sub="passés, issue pas saisie" onClick={() => setOpen("pending")} />
        <Tile label="À venir" value={int(report.upcoming.length)} sub={report.upcoming[0] ? `prochain : ${fmtDateTime(report.upcoming[0].at)}` : "rien de planifié"} onClick={() => setOpen("upcoming")} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <Tile label="Closés" value={int(t.won)} color={t.won ? GOOD : undefined} sub={`${int(t.lost)} perdus${t.followUp ? ` · ${int(t.followUp)} suite à donner` : ""}`} big onClick={() => setOpen("won")} />
        <Tile label="Close rate" value={pct(t.closeRate)} color={t.closeRate === null ? undefined : t.closeRate >= 30 ? GOOD : t.closeRate >= 15 ? WARN : BAD} sub="closés / venus" />
        <Tile label="Généré (contrats)" value={fmtMoney(t.revenue, cur)} color={t.revenue ? GOOD : undefined} sub="contrats signés sur ces calls" />
        <Tile label="Encaissé" value={fmtMoney(t.cash, cur)} sub="reçu à ce jour sur ces ventes" />
        <Tile label="CA par call venu" value={t.revenuePerShow === null ? "—" : fmtMoney(t.revenuePerShow, cur)} sub="généré / venus" />
        <Tile label="Perdus" value={int(t.lost)} color={t.lost ? BAD : undefined} sub="venus, pas closés" onClick={() => setOpen("lost")} />
      </div>

      {multiMonth && <MonthsTable report={report} />}

      <Modal open={open !== null} onClose={() => setOpen(null)} title={open ? `${KIND_TITLE[open]} · ${rows.length}` : ""} wide>
        {rows.length === 0 ? (
          <Empty>Aucun call ici sur la période.</Empty>
        ) : (
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th>Lead</th>
                  <th>Call</th>
                  <th>Closer</th>
                  <th>Présence</th>
                  <th>Issue</th>
                  <th className="!text-right">Contrat</th>
                  <th className="!text-right">Encaissé</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.appointmentId}>
                    <td>
                      <Link href={`/sales/rendez-vous?open=${c.appointmentId}`} className="text-[13px] font-medium link" title="Ouvrir le rendez-vous dans le CRM">
                        {c.leadName}
                      </Link>
                      {c.sourceLabel && <div className="dim text-[10.5px]">{c.sourceLabel}</div>}
                    </td>
                    <td className="num text-[12px] whitespace-nowrap">{fmtDateTime(c.at)}</td>
                    <td className="text-[12px] whitespace-nowrap">{c.closerName || <span className="dim">—</span>}</td>
                    <td className="text-[12px] font-medium" style={{ color: c.status === "show" ? GOOD : c.status === "noshow" ? BAD : WARN }}>
                      {open === "upcoming" ? "planifié" : STATUS_LABEL[c.status]}
                    </td>
                    <td className="text-[12px]" style={{ color: c.outcome === "won" ? GOOD : c.outcome === "lost" ? BAD : undefined }}>
                      {OUTCOME_LABEL[c.outcome] || <span className="dim">—</span>}
                      {c.offer && <div className="dim text-[10.5px]">{c.offer}</div>}
                    </td>
                    <td className="text-right num">{c.revenue ? fmtMoney(c.revenue, cur) : "—"}</td>
                    <td className="text-right num" style={{ color: c.cash ? GOOD : undefined }}>
                      {c.cash ? fmtMoney(c.cash, cur) : "—"}
                    </td>
                  </tr>
                ))}
                {(open === "won" || open === "calls" || open === "shows") && (
                  <tr>
                    <td colSpan={5} className="text-[12px] font-semibold">
                      Total · {rows.length} call{rows.length > 1 ? "s" : ""} · {rows.filter((c) => c.outcome === "won").length} closé{rows.filter((c) => c.outcome === "won").length > 1 ? "s" : ""}
                    </td>
                    <td className="text-right num font-semibold">{fmtMoney(rows.reduce((n, c) => n + c.revenue, 0), cur)}</td>
                    <td className="text-right num font-semibold" style={{ color: GOOD }}>
                      {fmtMoney(rows.reduce((n, c) => n + c.cash, 0), cur)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </div>
  );
}

/** Mois par mois, quand la periode en couvre plusieurs : memes regles que les tuiles. */
function MonthsTable({ report }: { report: CallsReport }) {
  const t = report.totals;
  const cur = report.currency;
  const shown = report.months.filter((m) => m.calls > 0);
  const best = shown.reduce<CallsTotals & { month: string } | null>((acc, m) => (acc === null || m.revenue > acc.revenue ? m : acc), null);
  return (
    <div className="card overflow-x-auto" style={{ padding: 0 }}>
      <div className="px-4 py-2.5 flex items-center justify-between" style={{ borderBottom: "1px solid var(--border)" }}>
        <span className="text-[13px] font-semibold">Mois par mois</span>
        <span className="dim text-[11.5px]">mêmes règles que les tuiles · les mois sans call sont grisés</span>
      </div>
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
          {report.months.map((m) => {
            const share = t.revenue > 0 ? (m.revenue / t.revenue) * 100 : 0;
            return (
              <tr key={m.month} className={m.calls === 0 ? "dim" : ""}>
                <td className="whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{m.label}</span>
                    {best && best.month === m.month && shown.length > 1 && (
                      <span className="badge !text-[10.5px]" style={{ color: GOOD }}>
                        meilleur mois
                      </span>
                    )}
                  </div>
                  {m.revenue > 0 && (
                    <div className="h-[3px] rounded-full mt-1.5 max-w-[140px]" style={{ background: "var(--surface-3)" }}>
                      <div className="h-full rounded-full" style={{ width: `${Math.max(4, share)}%`, background: GOOD }} />
                    </div>
                  )}
                </td>
                <td className="text-right num font-semibold">{m.calls || "—"}</td>
                <td className="text-right num">{m.shows || "—"}</td>
                <td className="text-right num" style={{ color: m.noShows ? BAD : undefined }}>
                  {m.noShows || "—"}
                </td>
                <td className="text-right num">{pct(m.showRate)}</td>
                <td className="text-right num font-semibold" style={{ color: m.won ? GOOD : undefined }}>
                  {m.won || "—"}
                  {m.pending > 0 && (
                    <span className="dim font-normal text-[11px]" title="calls passés sans issue saisie">
                      {" "}
                      +{m.pending} ?
                    </span>
                  )}
                </td>
                <td className="text-right num">{pct(m.closeRate)}</td>
                <td className="text-right num font-semibold" style={{ color: m.revenue ? GOOD : undefined }}>
                  {m.revenue ? fmtMoney(m.revenue, cur) : "—"}
                </td>
                <td className="text-right num">{m.cash ? fmtMoney(m.cash, cur) : "—"}</td>
                <td className="text-right num">{m.revenuePerShow === null ? "—" : fmtMoney(m.revenuePerShow, cur)}</td>
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
            <td className="text-right num" style={{ color: t.won ? GOOD : undefined }}>
              {int(t.won)}
            </td>
            <td className="text-right num">{pct(t.closeRate)}</td>
            <td className="text-right num" style={{ color: t.revenue ? GOOD : undefined }}>
              {fmtMoney(t.revenue, cur)}
            </td>
            <td className="text-right num">{fmtMoney(t.cash, cur)}</td>
            <td className="text-right num">{t.revenuePerShow === null ? "—" : fmtMoney(t.revenuePerShow, cur)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
