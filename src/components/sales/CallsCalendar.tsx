"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { fmtDateTime, fmtTime, isoToParisInput, label as statusLabel, parisDay, parisToIso, SECOND_TZ } from "@/lib/format";
import { Card } from "@/components/ui";
import { canConfirm, CONFIRMATION_LABEL } from "@/lib/sales/constants";
import type { AppointmentRow } from "@/app/api/sales/appointments/route";
import type { PublicMember } from "@/lib/sales/repo";

const DAY_NAMES = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];

/** Couleur d'une carte selon l'etat du call. */
function toneOf(r: AppointmentRow): string {
  if (r.status === "closed-won") return "#16a34a";
  if (r.status === "closed-lost" || r.status === "no-show") return "#ef4444";
  if (r.status === "completed" || r.status === "follow-up") return "#8b8cf8";
  if (!r.closerId) return "#f59e0b"; // orange : personne pour le prendre
  if (r.confirmation === "no-answer") return "#ef4444"; // rouge : le lead ne repond pas, call a risque
  if (r.status === "confirmed") return "#22c55e";
  if (r.status === "rescheduled") return "#3b82f6";
  return "var(--emerald)";
}

/** Call deja passe (ou deja conclu) : il reste affiche, en retrait, avec son resultat. */
function isPast(r: AppointmentRow, now: number): boolean {
  return r.status === "completed" || r.status === "no-show" || r.status === "follow-up" || r.status === "closed-won" || r.status === "closed-lost" || Date.parse(r.scheduledAt) < now;
}

/** Jusqu'ou on peut remonter : trois mois, ce que l'agenda charge. */
const MIN_WEEK = -13;

/** « dans 12 min », « dans 1 h 05 », « dans 2 j ». */
function inDelay(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 1) return "maintenant";
  if (min < 60) return `dans ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `dans ${h} h${min % 60 ? ` ${String(min % 60).padStart(2, "0")}` : ""}`;
  return `dans ${Math.round(h / 24)} j`;
}

/** Position de la ligne « maintenant » dans la liste du jour : avant le premier call pas encore passe. */
function nowIndex(items: AppointmentRow[], now: number): number {
  const i = items.findIndex((r) => Date.parse(r.scheduledAt) >= now);
  return i === -1 ? items.length : i;
}

/**
 * La ligne rouge « maintenant ».
 *
 * L'agenda n'est pas une grille horaire : les calls sont empiles. La ligne se
 * glisse donc entre les calls passes et ceux a venir, avance d'elle-meme
 * (l'heure se met a jour toutes les 30 s) et dit tout de suite ou on en est :
 * l'heure locale, l'heure de Paris si elle differe, et le prochain call.
 */
function NowLine({ now, next, compact }: { now: number; next: AppointmentRow | null; compact?: boolean }) {
  const d = new Date(now);
  const local = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const paris = fmtTime(d.toISOString());
  const nextText = next ? `${next.leadName} ${inDelay(Date.parse(next.scheduledAt) - now)}` : "plus aucun call";
  return (
    <div className={compact ? "px-3.5 py-1.5" : "py-1"} aria-label={`Maintenant ${local}`} style={{ color: "#ef4444" }} title={`Heure locale ${local} · Paris ${paris} · prochain : ${nextText}`}>
      <div className="flex items-center gap-1.5">
        <span className="w-[8px] h-[8px] rounded-full shrink-0" style={{ background: "#ef4444", boxShadow: "0 0 0 3px color-mix(in srgb, #ef4444 25%, transparent)" }} />
        <span className="flex-1 h-[2px] rounded-full" style={{ background: "#ef4444" }} />
        <span className="num text-[11px] font-semibold whitespace-nowrap">
          {local}
          {paris !== local && <span className="font-normal opacity-80"> · {paris} FR</span>}
        </span>
      </div>
      <div className="text-[10.5px] leading-snug mt-0.5 pl-[14px] opacity-85 truncate">{next ? `→ ${nextText}` : nextText}</div>
    </div>
  );
}


/** Un call encore a venir, qu'on peut deplacer (un call conclu garde sa date). */
function canMove(r: AppointmentRow, now: number): boolean {
  if (r.status === "no-show") return true;
  return (r.status === "booked" || r.status === "confirmed" || r.status === "rescheduled") && Date.parse(r.scheduledAt) >= now - 3_600_000;
}

/** Meme heure de Paris, un autre jour : l'ISO du call deplace. */
function sameTimeOn(iso: string, day: string): string {
  return parisToIso(`${day}T${isoToParisInput(iso).slice(11, 16)}`);
}

/**
 * Mini-fenetre « Reprogrammer » sur une carte de l'agenda.
 *
 * Avant, changer l'heure obligeait a ouvrir la fiche ou, pire, a passer par
 * iClosed. Ici : des raccourcis (+1 h, +1 jour, +1 semaine) et un champ
 * date-heure (heure de Paris), puis « Déplacer ». Rien n'est envoye a
 * iClosed : l'agenda du CRM fait foi, a toi de prevenir le lead.
 */
function ReschedulePopover({ row, onDone, onClose }: { row: AppointmentRow; onDone: (iso: string) => Promise<void>; onClose: () => void }) {
  const [value, setValue] = useState(() => isoToParisInput(row.scheduledAt));
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [onClose]);
  const shift = (ms: number) => setValue(isoToParisInput(new Date(Date.parse(parisToIso(value) || row.scheduledAt) + ms)));
  const submit = async () => {
    const iso = parisToIso(value);
    if (!iso) return;
    setBusy(true);
    try {
      await onDone(iso);
      onClose();
    } finally {
      setBusy(false);
    }
  };
  const quick: { label: string; ms: number }[] = [
    { label: "+1 h", ms: 3_600_000 },
    { label: "+1 jour", ms: 86_400_000 },
    { label: "+2 jours", ms: 2 * 86_400_000 },
    { label: "+1 semaine", ms: 7 * 86_400_000 },
  ];
  return (
    <div
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      className="absolute z-30 left-0 top-full mt-1 p-2.5 rounded-[9px] shadow-lg flex flex-col gap-2"
      style={{ background: "var(--surface)", border: "1px solid var(--border)", minWidth: 236, cursor: "default" }}
    >
      <div className="text-[11.5px] font-semibold truncate">Reprogrammer {row.leadName}</div>
      <div className="dim text-[10.5px] -mt-1.5">Actuellement {fmtDateTime(row.scheduledAt)} FR</div>
      <div className="flex flex-wrap gap-1">
        {quick.map((q) => (
          <button key={q.label} type="button" className="btn btn-sm !h-[24px] !px-2 !text-[11px]" onClick={() => shift(q.ms)}>
            {q.label}
          </button>
        ))}
      </div>
      <input
        type="datetime-local"
        className="input !h-[32px] !text-[12.5px]"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void submit()}
        data-nodraft
      />
      <div className="dim text-[10.5px]">Heure de Paris{value && parisToIso(value) ? ` · ${fmtTime(parisToIso(value), SECOND_TZ)} DXB` : ""}</div>
      <div className="flex gap-1 justify-end">
        <button type="button" className="btn btn-sm" onClick={onClose} disabled={busy}>
          Annuler
        </button>
        <button type="button" className="btn btn-sm btn-primary" onClick={() => void submit()} disabled={busy || !value || parisToIso(value) === row.scheduledAt}>
          {busy ? <span className="spinner" /> : "Déplacer"}
        </button>
      </div>
    </div>
  );
}

/**
 * Semaine de calls, sept colonnes, heure de Paris.
 *
 * Le closer voit les calls qui lui sont attribues, le setter les rendez-vous
 * qu'il a poses, l'admin tout le monde avec, sur chaque carte, le closer a
 * qui le call revient (modifiable). Un clic ouvre la fiche ; « Rejoindre »
 * part en visio sans l'ouvrir. La semaine courante commence aujourd'hui ;
 * les calls deja passes restent affiches (en retrait, avec leur resultat) et
 * les fleches remontent les semaines precedentes.
 */
export function CallsCalendar({
  rows,
  role,
  onOpen,
  closers,
  onAssign,
  onAdd,
  onReschedule,
  title,
}: {
  rows: AppointmentRow[];
  role: "setter" | "closer" | "admin";
  onOpen: (id: string) => void;
  /** Admin : closers proposes sur chaque carte. */
  closers?: PublicMember[];
  onAssign?: (id: string, closerId: string) => void;
  /** Un « + » sur chaque jour : creer un rendez-vous a cette date. */
  onAdd?: (day: string) => void;
  /**
   * Reprogrammer sans ouvrir la fiche : bouton horloge sur chaque carte a
   * venir, et glisser-deposer d'une carte vers un autre jour (meme heure).
   */
  onReschedule?: (id: string, iso: string) => Promise<void>;
  title?: string;
}) {
  const [week, setWeek] = useState(0);
  const [busy, setBusy] = useState("");
  /** Carte dont la mini-fenetre « Reprogrammer » est ouverte. */
  const [moving, setMoving] = useState("");
  /** Carte en cours de glisser-deposer, et jour survole. */
  const [dragId, setDragId] = useState("");
  const [overDay, setOverDay] = useState("");
  const days = Array.from({ length: 7 }, (_, i) => parisDay(week * 7 + i));
  // L'heure avance toute seule : la ligne « maintenant » suit sans recharger.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  // Prochain call a venir, toutes semaines confondues : ce que la ligne annonce.
  const next =
    rows
      .filter((r) => r.status !== "cancelled" && Date.parse(r.scheduledAt) >= now)
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))[0] ?? null;
  const byDay = new Map<string, AppointmentRow[]>();
  for (const r of rows) {
    // Seul un call annule disparait : un no-show ou un call perdu reste une trace utile.
    if (r.status === "cancelled") continue;
    const key = isoToParisInput(r.scheduledAt).slice(0, 10);
    byDay.set(key, [...(byDay.get(key) ?? []), r]);
  }
  const total = days.reduce((a, d) => a + (byDay.get(d)?.length ?? 0), 0);
  const unassigned = days.reduce((a, d) => a + (byDay.get(d) ?? []).filter((r) => !r.closerId).length, 0);
  const label = (key: string) => {
    const d = new Date(`${key}T12:00:00Z`);
    return `${DAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()}`;
  };
  const dropOn = async (day: string) => {
    const r = rows.find((x) => x.id === dragId);
    setDragId("");
    setOverDay("");
    if (!r || !onReschedule) return;
    const iso = sameTimeOn(r.scheduledAt, day);
    if (!iso || iso === r.scheduledAt) return;
    setBusy(r.id);
    try {
      await onReschedule(r.id, iso);
    } finally {
      setBusy("");
    }
  };
  const moveButton = (r: AppointmentRow, small: boolean) =>
    onReschedule && canMove(r, now) ? (
      <button
        type="button"
        className={small ? "btn btn-ghost btn-sm !h-[20px] !px-1.5 !text-[11px]" : "btn btn-sm !h-[32px] !px-2 shrink-0"}
        onClick={(e) => {
          e.stopPropagation();
          setMoving((m) => (m === r.id ? "" : r.id));
        }}
        disabled={busy === r.id}
        title="Reprogrammer ce call (sans passer par iClosed)"
        aria-label="Reprogrammer"
      >
        {busy === r.id ? <span className="spinner" /> : "🕐"}
      </button>
    ) : null;

  return (
    <Card
      title={title ?? (role === "closer" ? "Mes calls de la semaine" : role === "setter" ? "Mes rendez-vous de la semaine" : "Agenda des calls")}
      subtitle={`${total} sur ces 7 jours${role === "admin" && unassigned ? ` · ${unassigned} sans closer` : ""} · heures FR puis DXB`}
      padded={false}
      actions={
        <div className="flex gap-1">
          <button className="btn btn-sm" onClick={() => setWeek((w) => Math.max(MIN_WEEK, w - 1))} disabled={week <= MIN_WEEK} title="Semaine précédente">
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
      {/* Telephone : une liste, un jour = un titre, un call = une ligne pleine largeur. */}
      <ul className="sm:hidden">
        {total === 0 && <li className="dim text-[12.5px] px-3.5 py-4">Aucun call sur ces 7 jours.</li>}
        {days.map((d, i) => {
          const items = (byDay.get(d) ?? []).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
          const isToday = i === 0 && week === 0;
          // Aujourd'hui reste affiche meme sans call : la ligne « maintenant » y vit.
          if (!items.length && !isToday) return null;
          const nowAt = nowIndex(items, now);
          return (
            <li key={d} style={{ borderBottom: "1px solid var(--border)" }}>
              <div
                className="label-xs px-3.5 py-1.5"
                style={{ background: isToday ? "color-mix(in srgb, var(--accent) 10%, transparent)" : "var(--surface-2)", color: isToday ? "var(--accent)" : undefined }}
              >
                {isToday ? "Aujourd'hui · " : ""}
                {label(d)} · {items.length}
                {onAdd && (
                  <button type="button" className="btn btn-ghost btn-sm !h-[22px] !px-1.5 ml-2" onClick={() => onAdd(d)} title="Ajouter un rendez-vous ce jour">
                    +
                  </button>
                )}
              </div>
              {isToday && nowAt === 0 && <NowLine now={now} next={next} compact />}
              {items.map((r, idx) => {
                const tone = toneOf(r);
                const past = isPast(r, now);
                return (
                  <Fragment key={r.id}>
                  <div
                    onClick={() => onOpen(r.id)}
                    className="px-3.5 py-2.5 flex items-center gap-3 cursor-pointer relative"
                    style={{ borderLeft: `4px solid ${tone}`, borderTop: "1px solid var(--border)", opacity: past ? 0.7 : 1, zIndex: moving === r.id ? 20 : undefined }}
                  >
                    <div className="num text-[14px] font-semibold shrink-0 w-[52px]">{fmtTime(r.scheduledAt)}</div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13.5px] font-medium truncate">{r.leadName}</div>
                      <div className="dim text-[11px] truncate">
                        {past ? `${statusLabel(r.status)} · ` : ""}
                        {!past && canConfirm(r.status) ? `${CONFIRMATION_LABEL[r.confirmation]} · ` : ""}
                        {fmtTime(r.scheduledAt, SECOND_TZ)} DXB
                        {role !== "setter" && r.setterName && r.setterName !== "—" ? ` · par ${r.setterName}` : ""}
                        {role === "setter" ? ` · ${r.closerName ? `closer ${r.closerName}` : "closer à attribuer"}` : ""}
                        {role === "closer" && !r.closerName ? " · closer à attribuer" : ""}
                      </div>
                    </div>
                    {r.iclosedUrl && !past && (
                      <a
                        href={r.iclosedUrl}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="btn btn-sm btn-primary !h-[32px] shrink-0"
                      >
                        Rejoindre
                      </a>
                    )}
                    {moveButton(r, false)}
                    {moving === r.id && onReschedule && <ReschedulePopover row={r} onDone={(iso) => onReschedule(r.id, iso)} onClose={() => setMoving("")} />}
                  </div>
                  {isToday && nowAt === idx + 1 && <NowLine now={now} next={next} compact />}
                  </Fragment>
                );
              })}
            </li>
          );
        })}
      </ul>

      {/* Ordinateur : la semaine en sept colonnes. */}
      <div className="hidden sm:grid sm:grid-cols-4 lg:grid-cols-7" style={{ minHeight: 100 }}>
        {days.map((d, i) => {
          const items = (byDay.get(d) ?? []).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
          const isToday = i === 0 && week === 0;
          const nowAt = nowIndex(items, now);
          return (
            <div
              key={d}
              className="px-2 py-2 min-w-0"
              onDragOver={(e) => {
                if (!dragId || !onReschedule) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (overDay !== d) setOverDay(d);
              }}
              onDragLeave={() => overDay === d && setOverDay("")}
              onDrop={(e) => {
                e.preventDefault();
                void dropOn(d);
              }}
              style={{
                borderRight: i < 6 ? "1px solid var(--border)" : "none",
                borderBottom: "1px solid var(--border)",
                background: dragId && overDay === d ? "color-mix(in srgb, var(--accent) 16%, transparent)" : isToday ? "color-mix(in srgb, var(--accent) 6%, transparent)" : undefined,
                outline: dragId && overDay === d ? "2px dashed var(--accent)" : undefined,
                outlineOffset: -2,
                transition: "background 120ms",
              }}
            >
              <div className="label-xs mb-1.5 flex items-center justify-between">
                <span style={isToday ? { color: "var(--accent)" } : undefined}>{label(d)}</span>
                <span className="flex items-center gap-1">
                  {items.length > 0 && <span className="num">{items.length}</span>}
                  {onAdd && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm !h-[20px] !px-1.5 !text-[12px]"
                      onClick={() => onAdd(d)}
                      title="Ajouter un rendez-vous ce jour"
                    >
                      +
                    </button>
                  )}
                </span>
              </div>
              {isToday && nowAt === 0 && <NowLine now={now} next={next} />}
              {items.length === 0 ? (
                <div className="dim text-[11px]">—</div>
              ) : (
                <ul className="flex flex-col gap-1">
                  {items.map((r, idx) => {
                    const tone = toneOf(r);
                    const past = isPast(r, now);
                    return (
                      <Fragment key={r.id}>
                      <li
                        onClick={() => onOpen(r.id)}
                        className="rounded-[7px] px-2 py-1.5 cursor-pointer relative"
                        draggable={Boolean(onReschedule) && canMove(r, now) && moving !== r.id}
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", r.id);
                          setDragId(r.id);
                        }}
                        onDragEnd={() => {
                          setDragId("");
                          setOverDay("");
                        }}
                        style={{
                          background: `color-mix(in srgb, ${tone} 14%, var(--surface))`,
                          borderLeft: `3px solid ${tone}`,
                          opacity: dragId === r.id ? 0.4 : past ? 0.72 : 1,
                          zIndex: moving === r.id ? 20 : undefined,
                        }}
                        title={`${r.leadName} · ${fmtDateTime(r.scheduledAt)}${past ? ` · ${statusLabel(r.status)}` : ""}${onReschedule && canMove(r, now) ? " · glisser vers un autre jour pour déplacer" : ""}`}
                      >
                        <div className="num text-[12px] font-semibold flex items-center justify-between gap-1">
                          <span>
                            {fmtTime(r.scheduledAt)} <span className="dim font-normal text-[10.5px]">FR</span>
                            <span className="dim font-normal text-[10.5px]"> · {fmtTime(r.scheduledAt, SECOND_TZ)} DXB</span>
                          </span>
                          {moveButton(r, true)}
                        </div>
                        {moving === r.id && onReschedule && <ReschedulePopover row={r} onDone={(iso) => onReschedule(r.id, iso)} onClose={() => setMoving("")} />}
                        <div className="text-[12px] truncate">{r.leadName}</div>
                        {past && <div className="text-[10.5px] font-medium truncate" style={{ color: tone }}>{statusLabel(r.status)}</div>}
                        {!past && canConfirm(r.status) && (
                          <div className="text-[10.5px] font-medium truncate" style={{ color: r.confirmation === "confirmed" ? "#16a34a" : r.confirmation === "no-answer" ? "#ef4444" : r.confirmation === "awaiting" ? "#3b82f6" : "#f59e0b" }}>
                            {r.confirmation === "confirmed" ? "✓ " : r.confirmation === "no-answer" ? "✗ " : r.confirmation === "awaiting" ? "… " : "? "}
                            {CONFIRMATION_LABEL[r.confirmation]}
                          </div>
                        )}
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
                        {r.iclosedUrl && !past && (
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
                      {isToday && nowAt === idx + 1 && <NowLine now={now} next={next} />}
                      </Fragment>
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
