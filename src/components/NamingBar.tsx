"use client";

import { useMemo } from "react";
import {
  buildCreativeName,
  isoWeek,
  MIX_OPTIONS,
  nextIteration,
  nextVariante,
  parseCreativeName,
  slugToken,
} from "@/lib/creative-naming";

/**
 * Nom de la créa au lancement (2026-11-05) : S45_MIX1_HEMIOS_NAVY sans le
 * taper. MIX, CONCEPT et VARIANTE restent d'une génération à l'autre ; la
 * semaine ISO se calcule seule (modifiable) ; VARIANTE vide = V1, V2, V3 à la
 * suite des noms déjà pris ; « Itération de » reprend une créa et ajoute _IT2,
 * _IT3. Sans CONCEPT, pas de nom : la créa garde l'ancien nom tiré du prompt.
 */

export interface NamingState {
  mix: string;
  concept: string;
  variante: string;
}

export const DEFAULT_NAMING: NamingState = { mix: "MIX1", concept: "", variante: "" };

/** Le nom que portera la prochaine créa, ou "" si rien n'est renseigné. */
export function resolveCreativeName(opts: { naming: NamingState; week: number; iterOf: string; taken: string[] }): string {
  const { naming, week, iterOf, taken } = opts;
  if (iterOf) {
    const origin = parseCreativeName(iterOf);
    if (!origin) return "";
    return buildCreativeName({ week, mix: origin.mix, concept: origin.concept, variante: origin.variante, iteration: nextIteration(iterOf, taken) });
  }
  const concept = slugToken(naming.concept);
  if (!concept) return "";
  const prefix = `S${String(week).padStart(2, "0")}_${naming.mix}_${concept}`;
  const variante = slugToken(naming.variante) || nextVariante(prefix, taken);
  return buildCreativeName({ week, mix: naming.mix, concept, variante });
}

export function NamingBar({
  naming,
  onNaming,
  week,
  weekOverride,
  onWeekOverride,
  iterOf,
  onIterOf,
  taken,
  preview,
}: {
  naming: NamingState;
  onNaming: (n: NamingState) => void;
  week: number;
  /** "" = semaine du jour. */
  weekOverride: string;
  onWeekOverride: (v: string) => void;
  iterOf: string;
  onIterOf: (v: string) => void;
  /** Noms déjà portés par les créas de la galerie. */
  taken: string[];
  preview: string;
}) {
  // Créas d'origine possibles pour une itération : une entrée par MIX_CONCEPT_VARIANTE, la plus récente d'abord.
  const origins = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of taken) {
      const p = parseCreativeName(t);
      if (!p || p.iteration || seen.has(p.base)) continue;
      seen.add(p.base);
      out.push(t);
    }
    return out.slice(0, 80);
  }, [taken]);

  const small = "!h-[30px] !text-[12px] !py-0";
  const iterating = Boolean(iterOf);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="label-xs mr-0.5" title="Nom de la créa : fichier téléchargé, zip, puis nom de la pub dans Meta">
        Nom
      </span>
      <label className="inline-flex items-center gap-1" title="Semaine ISO (calculée à la date du jour)">
        <span className="dim text-[11.5px]">S</span>
        <input
          className={`input ${small} !w-[46px] !px-1.5 text-center`}
          inputMode="numeric"
          value={weekOverride || String(isoWeek()).padStart(2, "0")}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, "").slice(0, 2);
            onWeekOverride(v && Number(v) !== isoWeek() ? v : "");
          }}
          data-nodraft
        />
      </label>
      <select
        className={`select ${small} !w-auto`}
        value={naming.mix}
        disabled={iterating}
        onChange={(e) => onNaming({ ...naming, mix: e.target.value })}
        title="MIX"
      >
        {MIX_OPTIONS.map((m) => (
          <option key={m} value={m}>
            {m === "VIDEO" ? "VIDEO" : `MIX ${m.slice(3)}`}
          </option>
        ))}
      </select>
      <input
        className={`input ${small} !w-[120px] uppercase`}
        placeholder="CONCEPT"
        value={naming.concept}
        disabled={iterating}
        onChange={(e) => onNaming({ ...naming, concept: e.target.value.toUpperCase() })}
        maxLength={30}
        data-nodraft
      />
      <input
        className={`input ${small} !w-[110px] uppercase`}
        placeholder="VARIANTE"
        title="Vide : V1, V2, V3… à la suite des noms déjà pris"
        value={naming.variante}
        disabled={iterating}
        onChange={(e) => onNaming({ ...naming, variante: e.target.value.toUpperCase() })}
        maxLength={30}
        data-nodraft
      />
      <select
        className={`select ${small} !w-auto`}
        style={{ maxWidth: 190 }}
        value={iterOf}
        onChange={(e) => onIterOf(e.target.value)}
        title="Itération d'une créa existante : ajoute _IT2, _IT3…"
      >
        <option value="">Itération de…</option>
        {origins.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <span
        className="mono text-[11.5px] font-semibold truncate"
        style={{ color: preview ? "var(--accent)" : "var(--text-3)" }}
        title={preview ? "Nom de la prochaine créa" : "Tape un CONCEPT pour nommer la créa"}
      >
        {preview || "sans nom"}
      </span>
    </div>
  );
}
