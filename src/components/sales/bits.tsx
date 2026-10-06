"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { api } from "@/lib/client";
import { label } from "@/lib/format";
import { PERIODS, type PeriodKey } from "@/lib/sales/period";
import { CONFIRMATION_LABEL, CONFIRMATIONS, statusTone } from "@/lib/sales/constants";
import { Empty, useToast } from "@/components/ui";
import type { AppointmentConfirmation, AppointmentStatus } from "@/lib/types";

/* ------------------------------- Badges -------------------------------- */

/**
 * Badge de statut, adosse aux classes du design system existant.
 *
 * Les couleurs viennent d'une seule fonction (`statusTone`) pour qu'un
 * « closed-won » soit vert partout : tableau, fiche et dashboard.
 */
export function StatusBadge({ status }: { status: AppointmentStatus }) {
  const tone = statusTone(status);
  return <span className={`badge ${tone ? `badge-${tone}` : ""}`}>{label(status)}</span>;
}

export function Pill({ children, tone }: { children: ReactNode; tone?: "good" | "warn" | "danger" | "accent" }) {
  return <span className={`badge ${tone ? `badge-${tone}` : ""} !text-[10.5px] !py-0`}>{children}</span>;
}

/* ---------------------------- Confirmation ------------------------------ */

/** Couleur d'une confirmation : vert confirme, rouge pas de reponse, orange en attente. */
export function confirmationColor(c: AppointmentConfirmation): string {
  return c === "confirmed" ? "var(--emerald)" : c === "no-answer" ? "var(--critical)" : "var(--warning)";
}

/**
 * Menu « Confirmation » d'un rendez-vous : À confirmer / Confirmé / Pas de
 * réponse. Il enregistre tout de suite, sans ouvrir la fiche : le setter
 * passe sa liste du lendemain en quelques clics. Colore selon la valeur pour
 * que les calls a risque sautent aux yeux dans un tableau.
 */
export function ConfirmationSelect({
  id,
  value,
  onSaved,
  className = "",
}: {
  id: string;
  value: AppointmentConfirmation;
  onSaved?: () => void;
  className?: string;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const save = async (next: AppointmentConfirmation) => {
    if (next === value) return;
    setBusy(true);
    try {
      await api(`/api/sales/appointments/${id}`, { method: "PATCH", body: JSON.stringify({ confirmation: next }) });
      toast(
        next === "confirmed"
          ? "Rendez-vous confirmé."
          : next === "no-answer"
            ? "Pas de réponse notée. Relance le lead avant le call."
            : "Confirmation remise à zéro.",
      );
      onSaved?.();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <select
      className={`select select-xs !w-auto !text-[12px] font-semibold ${className}`}
      style={{ color: confirmationColor(value) }}
      value={value}
      disabled={busy}
      title="Le lead a-t-il confirmé sa présence ?"
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => void save(e.target.value as AppointmentConfirmation)}
    >
      {CONFIRMATIONS.map((c) => (
        <option key={c} value={c}>
          {CONFIRMATION_LABEL[c]}
        </option>
      ))}
    </select>
  );
}

/* ------------------------------ Instagram ------------------------------- */

/**
 * Pseudo Instagram cliquable.
 *
 * C'est la donnee d'identification numero un de l'acquisition : elle merite
 * d'etre reperable d'un coup d'oeil et d'ouvrir le profil sans copier-coller.
 */
export function IgHandle({ username, muted = false }: { username: string; muted?: boolean }) {
  if (!username) return <span className="dim">—</span>;
  const clean = username.replace(/^@+/, "");
  return (
    <a
      href={`https://instagram.com/${clean}`}
      target="_blank"
      rel="noreferrer"
      className="text-[12.5px] font-medium"
      style={{ color: muted ? "var(--text-2)" : "var(--accent)" }}
      onClick={(e) => e.stopPropagation()}
      title={`Ouvrir le profil de @${clean}`}
    >
      @{clean}
    </a>
  );
}

/* ----------------------------- Selecteur de periode --------------------- */

export interface PeriodState {
  period: PeriodKey;
  from: string;
  to: string;
}

/**
 * Choix de la fenetre d'analyse.
 *
 * Le mode personnalise n'apparait qu'une fois choisi : garder deux champs de
 * date affiches en permanence alourdit une barre de filtres qu'on manipule
 * plusieurs fois par jour.
 */
export function PeriodPicker({
  value,
  onChange,
}: {
  value: PeriodState;
  onChange: (v: PeriodState) => void;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap min-w-0 max-w-full">
      {/* Sur téléphone, les périodes défilent horizontalement au lieu d'élargir la page. */}
      <div className="flex gap-1 p-1 rounded-[10px] max-w-full overflow-x-auto scroll-x" style={{ background: "var(--surface-3)" }}>
        {PERIODS.map((p) => {
          const active = p.key === value.period;
          return (
            <button
              key={p.key}
              onClick={() => onChange({ ...value, period: p.key })}
              className="px-2.5 h-[26px] rounded-[7px] text-[12px] font-medium whitespace-nowrap transition-colors"
              style={{
                background: active ? "var(--surface)" : "transparent",
                color: active ? "var(--text)" : "var(--text-2)",
                boxShadow: active ? "var(--shadow)" : "none",
              }}
            >
              {p.label}
            </button>
          );
        })}
        <button
          onClick={() => onChange({ ...value, period: "custom" })}
          className="px-2.5 h-[26px] rounded-[7px] text-[12px] font-medium whitespace-nowrap transition-colors"
          style={{
            background: value.period === "custom" ? "var(--surface)" : "transparent",
            color: value.period === "custom" ? "var(--text)" : "var(--text-2)",
            boxShadow: value.period === "custom" ? "var(--shadow)" : "none",
          }}
        >
          Sur mesure
        </button>
      </div>

      {value.period === "custom" && (
        <div className="flex items-center gap-1.5">
          <input
            className="input !w-[140px] !h-[30px]"
            type="date"
            value={value.from}
            onChange={(e) => onChange({ ...value, from: e.target.value })}
          />
          <span className="dim text-[12px]">→</span>
          <input
            className="input !w-[140px] !h-[30px]"
            type="date"
            value={value.to}
            onChange={(e) => onChange({ ...value, to: e.target.value })}
          />
        </div>
      )}
    </div>
  );
}

/* -------------------------------- Funnel -------------------------------- */

export function Funnel({
  steps,
}: {
  steps: { key: string; label: string; value: number; fromPrevious: number; fromStart: number }[];
}) {
  const max = Math.max(...steps.map((s) => s.value), 1);

  return (
    <div className="flex flex-col gap-2">
      {steps.map((step, i) => {
        const width = Math.max((step.value / max) * 100, step.value > 0 ? 6 : 1.5);
        return (
          <div key={step.key}>
            <div className="flex items-baseline justify-between gap-3 mb-1">
              <span className="text-[12.5px] font-medium">{step.label}</span>
              <span className="flex items-baseline gap-2">
                <span className="num text-[13px] font-semibold">{step.value.toLocaleString("fr-FR")}</span>
                {i > 0 && (
                  <span
                    className="num text-[11.5px] font-medium"
                    style={{ color: step.fromPrevious >= 50 ? "var(--emerald)" : "var(--text-2)" }}
                  >
                    {step.fromPrevious.toFixed(1).replace(".", ",")} %
                  </span>
                )}
              </span>
            </div>
            <div className="rounded-[6px] overflow-hidden" style={{ height: 8, background: "var(--surface-3)" }}>
              <div
                className="h-full rounded-[6px] transition-[width]"
                style={{ width: `${width}%`, background: "var(--grad-accent)" }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------ Lien membre ----------------------------- */

export function MemberLink({ id, name }: { id: string; name: string }) {
  if (!id) return <span className="dim">Non assigné</span>;
  return (
    <Link
      href={`/sales/membre/${id}`}
      className="text-[12.5px] hover:underline"
      onClick={(e) => e.stopPropagation()}
    >
      {name}
    </Link>
  );
}

/* ------------------------------- Ratio ---------------------------------- */

/** Pourcentage lisible, avec un tiret quand le denominateur est nul. */
export function Ratio({ value, digits = 1 }: { value: number; digits?: number }) {
  if (!Number.isFinite(value) || value === 0) return <span className="dim">—</span>;
  return <span className="num">{value.toFixed(digits).replace(".", ",")} %</span>;
}

/* ------------------------------- Variation ------------------------------ */

/**
 * Variation d'un indicateur par rapport a la periode precedente.
 *
 * Vert quand ca va dans le bon sens, rouge sinon ; `invert` sert aux compteurs
 * ou une baisse est une bonne nouvelle (no-shows). Sans base de comparaison
 * (periode « Tout », periode precedente a zero) on n'affiche rien plutot
 * qu'un « +∞ % ».
 */
export function Delta({ now, prev, invert = false }: { now: number; prev: number | undefined; invert?: boolean }) {
  if (prev === undefined || !Number.isFinite(prev)) return null;
  if (prev === 0) {
    if (now === 0) return null;
    return (
      <span className="num text-[11.5px] font-medium" style={{ color: invert ? "var(--critical)" : "var(--good)" }}>
        nouveau · préc. 0
      </span>
    );
  }
  const pct = ((now - prev) / Math.abs(prev)) * 100;
  if (Math.abs(pct) < 0.5) return <span className="dim num text-[11.5px]">= période préc.</span>;
  const up = pct > 0;
  const good = invert ? !up : up;
  return (
    <span
      className="num text-[11.5px] font-medium"
      style={{ color: good ? "var(--good)" : "var(--critical)" }}
      title={`Période précédente : ${prev.toLocaleString("fr-FR")}`}
    >
      {up ? "▲" : "▼"} {Math.abs(pct) >= 100 ? Math.round(Math.abs(pct)) : Math.abs(pct).toFixed(0)} % vs préc.
    </span>
  );
}

/* ------------------------------ Tendance -------------------------------- */

export interface TrendPoint {
  date: string;
  appointments: number;
  shows: number;
  sales: number;
  cash: number;
}

/**
 * Histogramme jour par jour : calls honores et ventes, cote a cote.
 *
 * Les jours sans activite sont dessines a zero pour que l'axe reste continu :
 * un trou dans la semaine doit se voir. Au-dela de 60 jours, les barres
 * s'agregent par semaine, sinon elles deviennent des traits illisibles. Les
 * deux series sont nommees dans la legende et chaque jour porte une infobulle
 * avec ses valeurs exactes.
 */
export function TrendChart({ points, from, to }: { points: TrendPoint[]; from: string; to: string }) {
  const start = new Date(from);
  const end = new Date(to);
  const dayMs = 86_400_000;
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / dayMs));
  const weekly = days > 60;

  // AAAA-MM-JJ en heure locale : `toISOString` basculerait au jour d'avant
  // des minuit passe dans un fuseau a l'est de Greenwich.
  const localKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  // Clef de regroupement : le jour (AAAA-MM-JJ) ou le lundi de la semaine.
  const bucketOf = (day: string) => {
    if (!weekly) return day;
    const d = new Date(`${day}T00:00:00`);
    const shift = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - shift);
    return localKey(d);
  };

  const byKey = new Map<string, { shows: number; sales: number; appointments: number }>();
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const stop = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  for (let guard = 0; cursor <= stop && guard < 800; guard++) {
    const key = bucketOf(localKey(cursor));
    if (!byKey.has(key)) byKey.set(key, { shows: 0, sales: 0, appointments: 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  for (const p of points) {
    const key = bucketOf(p.date.slice(0, 10));
    const b = byKey.get(key) ?? { shows: 0, sales: 0, appointments: 0 };
    b.shows += p.shows;
    b.sales += p.sales;
    b.appointments += p.appointments;
    byKey.set(key, b);
  }
  const buckets = [...byKey.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  if (buckets.length < 2) return <Empty>Tendance disponible à partir de deux jours.</Empty>;

  const W = 640;
  const H = 180;
  const padL = 28;
  const padB = 22;
  const padT = 8;
  const plotW = W - padL - 8;
  const plotH = H - padT - padB;
  const max = Math.max(1, ...buckets.map(([, b]) => Math.max(b.shows, b.sales)));
  const yTicks = max <= 4 ? [...Array(max + 1).keys()] : [0, Math.round(max / 2), max];
  const slot = plotW / buckets.length;
  const gap = 2;
  const barW = Math.max(2, (slot - gap * 3) / 2);
  const y = (v: number) => padT + plotH - (v / max) * plotH;
  const labelEvery = Math.max(1, Math.ceil(buckets.length / 8));
  const fmt = (key: string) =>
    new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short" }).format(new Date(`${key}T00:00:00`));

  return (
    <div>
      <div className="flex items-center gap-4 mb-2 text-[11.5px]" style={{ color: "var(--text-2)" }}>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-[10px] h-[10px] rounded-[3px]" style={{ background: "var(--s1)" }} />
          Calls honorés
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-[10px] h-[10px] rounded-[3px]" style={{ background: "var(--s2)" }} />
          Ventes
        </span>
        {weekly && <span className="dim ml-auto">par semaine</span>}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Calls honorés et ventes par jour">
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - 8} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={1} />
            <text x={padL - 6} y={y(t) + 3.5} textAnchor="end" fontSize={10} fill="var(--text-3)" className="num">
              {t}
            </text>
          </g>
        ))}
        {buckets.map(([key, b], i) => {
          const x0 = padL + i * slot + gap;
          const title = `${fmt(key)}${weekly ? " (semaine)" : ""} · ${b.appointments} rdv posés · ${b.shows} honorés · ${b.sales} vente${b.sales > 1 ? "s" : ""}`;
          return (
            <g key={key}>
              <title>{title}</title>
              <rect x={padL + i * slot} y={padT} width={slot} height={plotH} fill="transparent" />
              {b.shows > 0 && (
                <rect x={x0} y={y(b.shows)} width={barW} height={plotH - (y(b.shows) - padT)} rx={2} fill="var(--s1)" />
              )}
              {b.sales > 0 && (
                <rect x={x0 + barW + gap} y={y(b.sales)} width={barW} height={plotH - (y(b.sales) - padT)} rx={2} fill="var(--s2)" />
              )}
              {i % labelEvery === 0 && (
                <text x={padL + i * slot + slot / 2} y={H - 6} textAnchor="middle" fontSize={10} fill="var(--text-3)">
                  {fmt(key)}
                </text>
              )}
            </g>
          );
        })}
        <line x1={padL} x2={W - 8} y1={y(0)} y2={y(0)} stroke="var(--border-strong)" strokeWidth={1} />
      </svg>
    </div>
  );
}
