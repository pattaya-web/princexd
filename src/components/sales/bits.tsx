"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { label } from "@/lib/format";
import { PERIODS, type PeriodKey } from "@/lib/sales/period";
import { statusTone } from "@/lib/sales/constants";
import type { AppointmentStatus } from "@/lib/types";

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
