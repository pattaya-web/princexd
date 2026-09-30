"use client";

import { useState } from "react";
import { fmtDateTime, fmtTime, isoToParisInput, parisDay, SECOND_TZ } from "@/lib/format";
import { Card } from "@/components/ui";
import type { AppointmentRow } from "@/app/api/sales/appointments/route";
import type { PublicMember } from "@/lib/sales/repo";

const DAY_NAMES = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];

/** Couleur d'une carte selon l'etat du call. */
function toneOf(r: AppointmentRow): string {
  if (!r.closerId) return "#f59e0b"; // orange : personne pour le prendre
  if (r.status === "confirmed") return "#22c55e";
  if (r.status === "rescheduled") return "#3b82f6";
  return "var(--emerald)";
}

/**
 * Semaine de calls, sept colonnes, heure de Paris.
 *
 * Le closer voit les calls qui lui sont attribues, le setter les rendez-vous
 * qu'il a poses, l'admin tout le monde avec, sur chaque carte, le closer a
 * qui le call revient (modifiable). Un clic ouvre la fiche ; « Rejoindre »
 * part en visio sans l'ouvrir. La semaine courante commence aujourd'hui pour
 * ne pas afficher des jours deja passes.
 */
export function CallsCalendar({
  rows,
  role,
  onOpen,
  closers,
  onAssign,
  title,
}: {
  rows: AppointmentRow[];
  role: "setter" | "closer" | "admin";
  onOpen: (id: string) => void;
  /** Admin : closers proposes sur chaque carte. */
  closers?: PublicMember[];
  onAssign?: (id: string, closerId: string) => void;
  title?: string;
}) {
  const [week, setWeek] = useState(0);
  const [busy, setBusy] = useState("");
  const days = Array.from({ length: 7 }, (_, i) => parisDay(week * 7 + i));
  const byDay = new Map<string, AppointmentRow[]>();
  for (const r of rows) {
    if (r.status === "cancelled" || r.status === "closed-lost" || r.status === "no-show") continue;
    const key = isoToParisInput(r.scheduledAt).slice(0, 10);
    byDay.set(key, [...(byDay.get(key) ?? []), r]);
  }
  const total = days.reduce((a, d) => a + (byDay.get(d)?.length ?? 0), 0);
  const unassigned = days.reduce((a, d) => a + (byDay.get(d) ?? []).filter((r) => !r.closerId).length, 0);
  const label = (key: string) => {
    const d = new Date(`${key}T12:00:00Z`);
    return `${DAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()}`;
  };

  return (
    <Card
      title={title ?? (role === "closer" ? "Mes calls de la semaine" : role === "setter" ? "Mes rendez-vous de la semaine" : "Agenda des calls")}
      subtitle={`${total} sur ces 7 jours${role === "admin" && unassigned ? ` · ${unassigned} sans closer` : ""} · heures FR puis DXB`}
      padded={false}
      actions={
        <div className="flex gap-1">
          <button className="btn btn-sm" onClick={() => setWeek((w) => Math.max(0, w - 1))} disabled={week === 0}>
            ‹
          </button>
          <button className="btn btn-sm" onClick={() => setWeek(0)} disabled={week === 0}>
            Aujourd&apos;hui
          </button>
          <button className="btn btn-sm" onClick={() => setWeek((w) => Math.min(8, w + 1))}>
            ›
          </button>
        </div>
      }
    >
      {/* Telephone : les jours s'empilent, et seuls ceux qui ont un call (ou aujourd'hui) s'affichent. */}
      <div className="grid grid-cols-1 sm:grid-cols-4 lg:grid-cols-7" style={{ minHeight: 100 }}>
        {days.map((d, i) => {
          const items = (byDay.get(d) ?? []).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
          const isToday = i === 0 && week === 0;
          return (
            <div
              key={d}
              className={`px-2 py-2 min-w-0 ${items.length === 0 && !isToday ? "hidden sm:block" : ""}`}
              style={{
                borderRight: i < 6 ? "1px solid var(--border)" : "none",
                borderBottom: "1px solid var(--border)",
                background: isToday ? "color-mix(in srgb, var(--accent) 6%, transparent)" : undefined,
              }}
            >
              <div className="label-xs mb-1.5 flex items-center justify-between">
                <span style={isToday ? { color: "var(--accent)" } : undefined}>{label(d)}</span>
                {items.length > 0 && <span className="num">{items.length}</span>}
              </div>
              {items.length === 0 ? (
                <div className="dim text-[11px]">—</div>
              ) : (
                <ul className="flex flex-col gap-1">
                  {items.map((r) => {
                    const tone = toneOf(r);
                    return (
                      <li
                        key={r.id}
                        onClick={() => onOpen(r.id)}
                        className="rounded-[7px] px-2 py-1.5 cursor-pointer"
                        style={{ background: `color-mix(in srgb, ${tone} 14%, var(--surface))`, borderLeft: `3px solid ${tone}` }}
                        title={`${r.leadName} · ${fmtDateTime(r.scheduledAt)}`}
                      >
                        <div className="num text-[12px] font-semibold">
                          {fmtTime(r.scheduledAt)} <span className="dim font-normal text-[10.5px]">FR</span>
                          <span className="dim font-normal text-[10.5px]"> · {fmtTime(r.scheduledAt, SECOND_TZ)} DXB</span>
                        </div>
                        <div className="text-[12px] truncate">{r.leadName}</div>
                        {role !== "setter" && r.setterName && r.setterName !== "—" && (
                          <div className="dim text-[10.5px] truncate">par {r.setterName}</div>
                        )}
                        {role === "setter" && <div className="dim text-[10.5px] truncate">{r.closerName ? `closer ${r.closerName}` : "closer à attribuer"}</div>}
                        {role === "admin" && closers && onAssign ? (
                          <select
                            className="select select-xs mt-1 !w-full"
                            value={r.closerId}
                            disabled={busy === r.id}
                            onClick={(e) => e.stopPropagation()}
                            onChange={async (e) => {
                              e.stopPropagation();
                              setBusy(r.id);
                              try {
                                await onAssign(r.id, e.target.value);
                              } finally {
                                setBusy("");
                              }
                            }}
                            style={r.closerId ? undefined : { borderColor: tone, color: tone }}
                            title="Closer qui prend ce call"
                          >
                            <option value="">Sans closer</option>
                            {closers.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          role === "closer" && !r.closerName && <div className="text-[10.5px]" style={{ color: tone }}>closer à attribuer</div>
                        )}
                        {r.iclosedUrl && (
                          <a
                            href={r.iclosedUrl}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="btn btn-sm btn-primary !h-[20px] !px-2 !text-[10.5px] mt-1"
                          >
                            Rejoindre ↗
                          </a>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
