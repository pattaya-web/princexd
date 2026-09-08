"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { fmtCompact, fmtInt } from "@/lib/format";

export const SERIES = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)", "var(--s5)", "var(--s6)", "var(--s7)", "var(--s8)"];

function niceTicks(min: number, max: number, count = 4) {
  if (max <= min) return [min, min + 1];
  const span = max - min;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.5; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return ticks;
}

function Tooltip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  // Bascule le tooltip du côté opposé quand on approche du bord droit.
  const flip = x > width * 0.62;
  return (
    <div
      className="pointer-events-none absolute z-20 card px-2.5 py-2 text-[12px] leading-snug"
      style={{
        left: flip ? undefined : x + 12,
        right: flip ? width - x + 12 : undefined,
        top: Math.max(y - 12, 4),
        minWidth: 128,
      }}
    >
      {children}
    </div>
  );
}

/* ------------------------------ Line chart ----------------------------- */

export interface LinePoint {
  label: string;
  values: number[];
}

export function LineChart({
  points,
  series,
  height = 210,
  format = fmtCompact,
  area = true,
}: {
  points: LinePoint[];
  series: { name: string; color?: string }[];
  height?: number;
  format?: (n: number) => string;
  area?: boolean;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  const [w, setW] = useState(640);

  const pad = { top: 12, right: 14, bottom: 24, left: 44 };

  const { ticks, min, max } = useMemo(() => {
    const all = points.flatMap((p) => p.values).filter((v) => Number.isFinite(v));
    const lo = all.length ? Math.min(...all) : 0;
    const hi = all.length ? Math.max(...all) : 1;
    // On ne force pas le zéro : sur une courbe d'abonnés, partir de 0 écrase le signal.
    const padding = (hi - lo) * 0.12 || Math.max(hi * 0.05, 1);
    const t = niceTicks(lo - padding, hi + padding);
    return { ticks: t, min: t[0], max: t[t.length - 1] };
  }, [points]);

  if (!points.length) {
    return <div className="dim text-[13px] py-10 text-center">Pas encore de données.</div>;
  }

  const innerW = Math.max(w - pad.left - pad.right, 10);
  const innerH = height - pad.top - pad.bottom;
  const xOf = (i: number) => pad.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const yOf = (v: number) => pad.top + innerH - ((v - min) / (max - min || 1)) * innerH;

  const labelEvery = Math.max(1, Math.ceil(points.length / 7));

  return (
    <div
      ref={(el) => {
        wrap.current = el;
        if (el && el.clientWidth && Math.abs(el.clientWidth - w) > 4) setW(el.clientWidth);
      }}
      className="relative w-full"
      onMouseLeave={() => setHover(null)}
    >
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${w} ${height}`}
        preserveAspectRatio="none"
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const rel = ((e.clientX - rect.left) / rect.width) * w;
          const i = Math.round(((rel - pad.left) / innerW) * (points.length - 1));
          const clamped = Math.min(Math.max(i, 0), points.length - 1);
          setHover({ i: clamped, x: xOf(clamped), y: yOf(points[clamped].values[0] ?? min) });
        }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={w - pad.right} y1={yOf(t)} y2={yOf(t)} stroke="var(--grid)" strokeWidth={1} />
            <text x={pad.left - 8} y={yOf(t) + 3.5} textAnchor="end" fontSize={10.5} fill="var(--text-3)" className="num">
              {format(t)}
            </text>
          </g>
        ))}

        {series.map((s, si) => {
          const color = s.color ?? SERIES[si % SERIES.length];
          const d = points
            .map((p, i) => `${i === 0 ? "M" : "L"}${xOf(i)},${yOf(p.values[si] ?? min)}`)
            .join(" ");
          return (
            <g key={s.name}>
              {area && si === 0 && (
                <path
                  d={`${d} L${xOf(points.length - 1)},${pad.top + innerH} L${xOf(0)},${pad.top + innerH} Z`}
                  fill={color}
                  opacity={0.09}
                />
              )}
              <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {points.length <= 30 &&
                points.map((p, i) => (
                  <circle
                    key={i}
                    cx={xOf(i)}
                    cy={yOf(p.values[si] ?? min)}
                    r={hover?.i === i ? 4.5 : 2.5}
                    fill={color}
                    stroke="var(--surface)"
                    strokeWidth={2}
                  />
                ))}
            </g>
          );
        })}

        {hover && (
          <line
            x1={xOf(hover.i)}
            x2={xOf(hover.i)}
            y1={pad.top}
            y2={pad.top + innerH}
            stroke="var(--text-3)"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}

        {points.map((p, i) =>
          i % labelEvery === 0 ? (
            <text key={p.label + i} x={xOf(i)} y={height - 6} textAnchor="middle" fontSize={10.5} fill="var(--text-3)">
              {p.label}
            </text>
          ) : null,
        )}
      </svg>

      {hover && (
        <Tooltip x={hover.x} y={hover.y} width={w}>
          <div className="font-semibold mb-1">{points[hover.i].label}</div>
          {series.map((s, si) => (
            <div key={s.name} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 muted">
                <span
                  className="inline-block rounded-full"
                  style={{ width: 7, height: 7, background: s.color ?? SERIES[si % SERIES.length] }}
                />
                {s.name}
              </span>
              <span className="num font-semibold">{format(points[hover.i].values[si] ?? 0)}</span>
            </div>
          ))}
        </Tooltip>
      )}

      {series.length >= 2 && (
        <div className="flex flex-wrap gap-3 mt-2 pl-11">
          {series.map((s, si) => (
            <span key={s.name} className="flex items-center gap-1.5 text-[11.5px] muted">
              <span
                className="inline-block rounded-full"
                style={{ width: 7, height: 7, background: s.color ?? SERIES[si % SERIES.length] }}
              />
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------ Bar chart ------------------------------ */

export interface BarRow {
  label: string;
  value: number;
  color?: string;
  meta?: string;
}

export function BarChart({
  rows,
  format = fmtCompact,
  maxRows = 10,
  unit,
}: {
  rows: BarRow[];
  format?: (n: number) => string;
  maxRows?: number;
  unit?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = rows.slice(0, maxRows);
  const max = Math.max(...shown.map((r) => r.value), 1);

  if (!shown.length) return <div className="dim text-[13px] py-8 text-center">Pas encore de données.</div>;

  return (
    <div className="flex flex-col gap-2.5">
      {shown.map((r, i) => (
        <div
          key={r.label + i}
          onMouseEnter={() => setHover(i)}
          onMouseLeave={() => setHover(null)}
          className="grid items-center gap-3"
          style={{ gridTemplateColumns: "minmax(80px, 150px) 1fr auto" }}
        >
          <span className="text-[12.5px] truncate" title={r.label}>
            {r.label}
          </span>
          <div className="relative h-[18px] rounded-[4px]" style={{ background: "var(--surface-3)" }}>
            <div
              className="absolute inset-y-0 left-0 rounded-[4px] transition-[width]"
              style={{
                width: `${Math.max((r.value / max) * 100, r.value > 0 ? 2 : 0)}%`,
                background: r.color ?? SERIES[i % SERIES.length],
                opacity: hover === null || hover === i ? 1 : 0.55,
              }}
            />
          </div>
          <span className="num text-[12.5px] font-semibold tabular-nums text-right" style={{ minWidth: 54 }}>
            {format(r.value)}
            {unit && <span className="dim font-normal ml-0.5">{unit}</span>}
          </span>
        </div>
      ))}
      {hover !== null && shown[hover].meta && (
        <p className="dim text-[11.5px] pt-1">{shown[hover].meta}</p>
      )}
    </div>
  );
}

/* ------------------------------ Goal gauge ----------------------------- */

export function GoalGauge({
  current,
  goal,
  start,
  caption,
}: {
  current: number;
  goal: number;
  start: number;
  caption?: ReactNode;
}) {
  const pct = goal > start ? Math.min(Math.max((current - start) / (goal - start), 0), 1) : 0;
  const size = 150;
  const stroke = 12;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  // Arc ouvert de 260° : plus lisible qu'un cercle plein pour une progression.
  const arc = 0.72;

  return (
    <div className="flex items-center gap-5 flex-wrap">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: "rotate(140deg)" }}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--surface-3)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${circ * arc} ${circ}`}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${circ * arc * pct} ${circ}`}
            style={{ transition: "stroke-dasharray 0.5s ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[26px] font-semibold num tracking-tight">{fmtInt(current)}</span>
          <span className="dim text-[11.5px]">sur {fmtInt(goal)}</span>
          <span className="badge badge-accent mt-1.5">{Math.round(pct * 100)} %</span>
        </div>
      </div>
      {caption && <div className="text-[13px] leading-relaxed flex-1 min-w-[180px]">{caption}</div>}
    </div>
  );
}

/* -------------------------------- Funnel ------------------------------- */

export function Funnel({ steps }: { steps: { label: string; value: number; rate?: number }[] }) {
  const max = Math.max(...steps.map((s) => s.value), 1);
  return (
    <div className="flex flex-col gap-1.5">
      {steps.map((s, i) => (
        <div key={s.label}>
          <div className="flex items-baseline justify-between gap-2 mb-1">
            <span className="text-[12.5px]">{s.label}</span>
            <span className="num text-[13px] font-semibold">{fmtInt(s.value)}</span>
          </div>
          <div className="h-[10px] rounded-[4px]" style={{ background: "var(--surface-3)" }}>
            <div
              className="h-full rounded-[4px]"
              style={{
                width: `${Math.max((s.value / max) * 100, s.value > 0 ? 1.5 : 0)}%`,
                background: SERIES[i % SERIES.length],
              }}
            />
          </div>
          {i < steps.length - 1 && (
            <div className="dim text-[11px] mt-1 pl-0.5">
              ↳ {steps[i + 1].rate !== undefined
                ? `${(steps[i + 1].rate! * 100).toFixed(1).replace(".", ",")} % passent à « ${steps[i + 1].label} »`
                : "—"}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------ Sparkline ------------------------------ */

export function Sparkline({ values, color = "var(--s1)", height = 30 }: { values: number[]; color?: string; height?: number }) {
  if (values.length < 2) return null;
  const w = 90;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const d = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = height - ((v - min) / (max - min || 1)) * (height - 4) - 2;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={w} height={height} className="shrink-0" aria-hidden>
      <path d={d} fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
