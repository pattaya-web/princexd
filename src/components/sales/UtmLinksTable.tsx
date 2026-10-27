"use client";

import { useState } from "react";
import Link from "next/link";
import { Empty, useToast } from "@/components/ui";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/format";
import { BOOKING_STATUS_LABEL, SALE_STATUS_LABEL } from "@/lib/sales/business-types";
import type { UtmLinkRow } from "@/lib/sales/utm-links";

/**
 * Tableau des liens UTM : un lien par ligne avec ses chiffres (leads, RDV,
 * shows, closés, CA), le dernier lead arrivé, et au clic la liste nominative
 * des leads venus par ce lien, avec le jour, comment (opt-in ou réservation)
 * et ce qu'ils sont devenus. Partagé par la page Liens UTM et le Sales Dashboard.
 */
export function UtmLinksTable({ rows, currency, onDelete }: { rows: UtmLinkRow[]; currency: string; onDelete?: (id: string) => void }) {
  const toast = useToast();
  const [open, setOpen] = useState<string | null>(null);
  const copy = async (v: string) => {
    try {
      await navigator.clipboard.writeText(v);
      toast("Lien copié.");
    } catch {
      toast("Copie impossible ici : sélectionne le lien et copie-le à la main.", "err");
    }
  };

  if (!rows.length) {
    return (
      <div className="card">
        <Empty
          action={
            <Link href="/sales/utm" className="btn btn-sm btn-primary">
              Créer mon premier lien
            </Link>
          }
        >
          Aucun lien UTM pour l&apos;instant. Crée-en un par vidéo YouTube, post, story ou newsletter : chaque lead qui passe par là te sera rattaché.
        </Empty>
      </div>
    );
  }

  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <div className="scroll-x">
        <table className="table">
          <thead>
            <tr>
              <th>Lien</th>
              <th className="!text-right">Leads</th>
              <th className="!text-right">RDV</th>
              <th className="!text-right">Shows</th>
              <th className="!text-right">Closés</th>
              <th className="!text-right">CA</th>
              <th>Dernier lead</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const expanded = open === r.id;
              return (
                <RowGroup key={r.id} row={r} expanded={expanded} currency={currency} onToggle={() => setOpen(expanded ? null : r.id)} onCopy={() => void copy(r.url)} onDelete={onDelete} />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RowGroup({ row: r, expanded, currency, onToggle, onCopy, onDelete }: { row: UtmLinkRow; expanded: boolean; currency: string; onToggle: () => void; onCopy: () => void; onDelete?: (id: string) => void }) {
  const s = r.stats;
  const days = Object.entries(s.byDay).sort((a, b) => b[0].localeCompare(a[0]));
  return (
    <>
      <tr className="cursor-pointer" onClick={onToggle} title={expanded ? "Replier" : "Voir les leads venus par ce lien"}>
        <td className="min-w-[220px] max-w-[420px]">
          <div className="text-[13px] font-medium truncate">{r.label}</div>
          <div className="dim text-[11px] truncate mono">
            {r.source}
            {r.medium ? ` · ${r.medium}` : ""} · {r.campaign}
            {r.content ? ` · ${r.content}` : ""}
            {r.term ? ` · ${r.term}` : ""}
          </div>
          {r.placement && <div className="dim text-[11px] truncate">📍 {r.placement}</div>}
        </td>
        <td className="num text-right font-semibold">{s.leads}</td>
        <td className="num text-right">{s.bookings}</td>
        <td className="num text-right">{s.shows}</td>
        <td className="num text-right font-semibold" style={s.sales ? { color: "var(--good)" } : undefined}>
          {s.sales}
        </td>
        <td className="num text-right whitespace-nowrap">{s.revenue ? fmtMoney(s.revenue, currency) : <span className="dim">—</span>}</td>
        <td className="num text-[12px] whitespace-nowrap">{s.lastLeadAt ? fmtDate(s.lastLeadAt) : <span className="dim">jamais</span>}</td>
        <td className="whitespace-nowrap text-right">
          <button type="button" className="btn btn-sm btn-ghost !h-[26px]" onClick={(e) => { e.stopPropagation(); onCopy(); }} title={r.url}>
            Copier
          </button>
          {onDelete && (
            <button
              type="button"
              className="btn btn-sm btn-ghost !h-[26px]"
              onClick={(e) => {
                e.stopPropagation();
                if (window.confirm(`Supprimer le lien « ${r.label} » ? Les leads déjà venus par ce lien gardent leurs utm, mais ne seront plus comptés ici.`)) onDelete(r.id);
              }}
              title="Supprimer"
            >
              ✕
            </button>
          )}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={8} className="!p-0" style={{ background: "var(--surface-2)" }}>
            <div className="px-4 py-3 flex flex-col gap-3">
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[12px]">
                <span className="mono dim truncate max-w-full" title={r.url}>
                  {r.url}
                </span>
                {s.firstLeadAt && (
                  <span className="dim">
                    Premier lead {fmtDate(s.firstLeadAt)} · dernier {fmtDate(s.lastLeadAt)}
                  </span>
                )}
                {r.notes && <span className="dim">· {r.notes}</span>}
              </div>
              {days.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {days.slice(0, 30).map(([d, n]) => (
                    <span key={d} className="badge !text-[10.5px] !py-0 num" title={`${n} lead${n > 1 ? "s" : ""} le ${fmtDate(`${d}T12:00:00Z`)}`}>
                      {fmtDate(`${d}T12:00:00Z`)} · {n}
                    </span>
                  ))}
                </div>
              )}
              {r.rows.length === 0 ? (
                <div className="dim text-[12.5px]">Aucun lead n&apos;est encore passé par ce lien. Dès qu&apos;un inscrit arrive avec ces utm (page d&apos;opt-in ou réservation iClosed), il apparaît ici.</div>
              ) : (
                <div className="scroll-x">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Quand</th>
                        <th>Lead</th>
                        <th>Comment</th>
                        <th>Funnel</th>
                        <th>RDV</th>
                        <th>Vente</th>
                        <th className="!text-right">CA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.rows.map((l) => (
                        <tr key={l.leadId}>
                          <td className="num text-[12px] whitespace-nowrap">{fmtDateTime(l.hit.at)}</td>
                          <td>
                            <Link href={`/sales/rendez-vous?q=${encodeURIComponent(l.name)}`} className="link text-[13px] font-medium" title="Ouvrir dans le CRM">
                              {l.name}
                            </Link>
                            <div className="dim text-[11px]">{[l.handle, l.phone, l.email].filter(Boolean).join(" · ")}</div>
                          </td>
                          <td className="text-[12px]">{l.hit.via === "opt-in" ? "Inscription (page d'opt-in)" : "Réservation iClosed"}</td>
                          <td className="text-[12px]">{l.funnelSource || "—"}</td>
                          <td className="text-[12px]">{l.bookingStatus ? BOOKING_STATUS_LABEL[l.bookingStatus] : <span className="dim">aucun</span>}</td>
                          <td className="text-[12px]" style={l.saleStatus === "WON" ? { color: "var(--good)", fontWeight: 600 } : undefined}>
                            {l.saleStatus === "WON" ? "Closé" : l.bookingStatus ? SALE_STATUS_LABEL[l.saleStatus] : <span className="dim">—</span>}
                          </td>
                          <td className="num text-right text-[12.5px]">{l.revenue ? fmtMoney(l.revenue, currency) : <span className="dim">—</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
