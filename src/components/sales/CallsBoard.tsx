"use client";

import { useMemo, useState } from "react";
import { fmtDate, fmtDualTime, fmtMoney } from "@/lib/format";
import { useSalesData } from "@/lib/sales/client";
import { Card, Empty, Spinner } from "@/components/ui";
import { LeadSheet } from "./LeadSheet";
import type { AppointmentRow } from "@/app/api/sales/appointments/route";

/**
 * Une liste de calls, comme sur iClosed : les calls a venir (avec le lien
 * pour rejoindre) ou les calls passes (presence, issue, compte-rendu Fathom).
 *
 * Un clic sur le nom ou « Statuer » ouvre la fiche du lead, ou tout se pose
 * en un clic (show, no-show, close, perdu, paiement) et ou le compte-rendu
 * complet se lit.
 */

export type CallsScope = "past" | "upcoming";
type Window = "7d" | "30d" | "all";

const ATTENDED = new Set(["completed", "follow-up", "closed-won", "closed-lost"]);

/** Presence : venu, pas venu, ou call passe sans issue posee. */
function Presence({ r }: { r: AppointmentRow }) {
  if (r.status === "cancelled") return <span className="dim">Annulé</span>;
  if (ATTENDED.has(r.status)) return <span className="font-semibold" style={{ color: "#a855f7" }}>✓ Show</span>;
  if (r.status === "no-show") return <span className="font-semibold" style={{ color: "var(--critical)" }}>No-show</span>;
  if (new Date(r.scheduledAt).getTime() > Date.now()) return <span className="dim">Planifié</span>;
  return <span className="font-semibold" style={{ color: "#f97316" }}>À statuer</span>;
}

/** Ce que le call a donne. */
function Outcome({ r }: { r: AppointmentRow }) {
  if (r.status === "closed-won") {
    return (
      <span className="font-semibold" style={{ color: "var(--good)" }}>
        Closé{r.contractValue ? ` · ${fmtMoney(r.contractValue, r.currency)}` : ""}
      </span>
    );
  }
  if (r.status === "closed-lost") {
    return (
      <span style={{ color: "var(--critical)" }} title={r.lostReason || undefined}>
        Pas closé{r.lostReason ? ` · ${r.lostReason}` : ""}
      </span>
    );
  }
  if (r.status === "follow-up") return <span style={{ color: "#3b82f6" }}>Follow-up · à relancer</span>;
  if (r.status === "completed") return <span className="dim">Pitché · à conclure</span>;
  return <span className="dim">—</span>;
}

/** Les premieres lignes du compte-rendu Fathom, le reste au survol et dans la fiche. */
function Summary({ r }: { r: AppointmentRow }) {
  if (!r.fathomSummary) return <span className="dim">—</span>;
  const first = r.fathomSummary.split("\n").filter(Boolean).slice(0, 2).join(" · ");
  return (
    <span className="text-[12px] leading-snug" title={r.fathomSummary}>
      {first.length > 160 ? `${first.slice(0, 160)}…` : first}
      {r.fathomUrl && (
        <>
          {" "}
          <a href={r.fathomUrl} target="_blank" rel="noreferrer" className="link" onClick={(e) => e.stopPropagation()} title="Ouvrir l'enregistrement Fathom">
            ↗
          </a>
        </>
      )}
    </span>
  );
}

export function CallsBoard({ scope, refreshKey = 0, onChanged }: { scope: CallsScope; refreshKey?: number; onChanged?: () => void }) {
  const [win, setWin] = useState<Window>("30d");
  const [q, setQ] = useState("");
  const [openLead, setOpenLead] = useState<string | null>(null);

  const url = scope === "upcoming" ? `/api/sales/appointments?period=upcoming&limit=300&v=${refreshKey}` : `/api/sales/appointments?period=${win}&limit=500&v=${refreshKey}`;
  const { data, loading, reload } = useSalesData<{ rows: AppointmentRow[]; total: number }>(url);

  const rows = useMemo(() => {
    const now = Date.now();
    let list = (data?.rows ?? []).filter((r) => r.status !== "cancelled");
    // Passes : uniquement ce qui est deja arrive, du plus recent au plus ancien. A venir : du plus proche au plus loin.
    list = scope === "past" ? list.filter((r) => new Date(r.scheduledAt).getTime() <= now) : [...list].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
    const needle = q.trim().toLowerCase();
    if (needle) list = list.filter((r) => [r.leadName, r.setterName, r.closerName, r.email, r.phone].join(" ").toLowerCase().includes(needle));
    return list;
  }, [data, scope, q]);

  const pending = scope === "past" ? rows.filter((r) => !ATTENDED.has(r.status) && r.status !== "no-show").length : 0;

  const changed = () => {
    void reload();
    onChanged?.();
  };

  const chip = (w: Window, text: string) => (
    <button className={`btn btn-sm ${win === w ? "" : "btn-ghost dim"}`} onClick={() => setWin(w)}>
      {text}
    </button>
  );

  return (
    <>
      <Card padded={false}>
        <div className="p-3 flex flex-wrap items-center gap-2" style={{ borderBottom: "1px solid var(--border)" }}>
          {scope === "past" && (
            <span className="flex items-center gap-1">
              {chip("7d", "7 jours")}
              {chip("30d", "30 jours")}
              {chip("all", "Tout")}
            </span>
          )}
          <input className="input !w-[220px] !h-[30px]" placeholder="Prénom, nom, setter, closer…" value={q} onChange={(e) => setQ(e.target.value)} />
          <span className="dim text-[11.5px] num ml-auto">
            {loading && !data ? "…" : `${rows.length} call${rows.length > 1 ? "s" : ""}`}
            {pending ? <span style={{ color: "#f97316" }}> · {pending} à statuer</span> : null}
          </span>
        </div>

        {loading && !data ? (
          <div className="p-4">
            <Spinner label="Chargement des calls…" />
          </div>
        ) : !rows.length ? (
          <Empty>{scope === "past" ? "Aucun call passé sur cette fenêtre." : "Aucun call à venir."}</Empty>
        ) : (
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Prénom nom</th>
                  <th>Setter</th>
                  <th>Closer</th>
                  <th>Présence</th>
                  <th>Résultat</th>
                  <th>Compte-rendu du call</th>
                  <th style={{ width: 90 }} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="cursor-pointer" onClick={() => setOpenLead(r.leadId)}>
                    <td className="whitespace-nowrap">
                      <span className="num">{fmtDate(r.scheduledAt)}</span>
                      <span className="dim num ml-1.5 text-[11.5px]" title="Heure de Paris, puis heure de Dubaï">
                        {fmtDualTime(r.scheduledAt)}
                      </span>
                    </td>
                    <td className="font-medium max-w-[180px] truncate" title={[r.leadName, r.phone, r.email].filter(Boolean).join(" · ")}>
                      {r.leadName}
                    </td>
                    <td className="text-[12.5px]">{r.setterName}</td>
                    <td className="text-[12.5px]">{r.closerName || <span className="dim">—</span>}</td>
                    <td className="whitespace-nowrap">
                      <Presence r={r} />
                    </td>
                    <td className="max-w-[220px] truncate">
                      <Outcome r={r} />
                    </td>
                    <td className="max-w-[420px]">
                      <Summary r={r} />
                    </td>
                    <td className="text-right" onClick={(e) => e.stopPropagation()}>
                      {scope === "upcoming" && r.iclosedUrl ? (
                        <a href={r.iclosedUrl} target="_blank" rel="noreferrer" className="btn btn-sm btn-primary !h-[24px] !px-2.5 !text-[11px]" title="Rejoindre le call">
                          Rejoindre ↗
                        </a>
                      ) : (
                        <button className="btn btn-sm !h-[24px] !px-2.5 !text-[11px]" onClick={() => setOpenLead(r.leadId)} title="Ouvrir la fiche : statuer, lire le compte-rendu, relancer">
                          {ATTENDED.has(r.status) || r.status === "no-show" ? "Fiche" : "Statuer"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <LeadSheet id={openLead} onClose={() => setOpenLead(null)} onChanged={changed} />
    </>
  );
}
