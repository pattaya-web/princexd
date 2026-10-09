/**
 * Templates de nommage : une campagne bien nommee se classe toute seule.
 *
 *   [TESTING] | {offer} | ABO
 *   [SCALING-TESTING] | {offer} | ABO
 *   [HYPER-SCALING] | {offer} | CBO
 *   Ad sets : {FORMAT} | BROAD | {COUNTRY}  ou  BROAD | FR | BATCH 01
 *   Ads : V1, V2, V3…
 */

import { PHASE_PREFIX, type Phase } from "./types";

export function campaignName(phase: Exclude<Phase, "unclassified">, offer: string, suffix = ""): string {
  const structure = phase === "hyper-scaling" ? "CBO" : "ABO";
  const parts = [PHASE_PREFIX[phase], offer.trim().toUpperCase() || "OFFRE", suffix.trim().toUpperCase(), structure].filter(Boolean);
  return parts.join(" | ");
}

export function adsetName(opts: { format?: string; country?: string; batch?: number; audience?: string }): string {
  const audience = (opts.audience || "BROAD").toUpperCase();
  const country = (opts.country || "FR").toUpperCase();
  const parts = [opts.format?.trim().toUpperCase(), audience, country, opts.batch ? `BATCH ${String(opts.batch).padStart(2, "0")}` : ""].filter(Boolean);
  return parts.join(" | ");
}

/** Prochain nom de creative libre : V1, V2… au-dela du plus grand numero existant. */
export function nextAdName(existing: string[]): string {
  let max = 0;
  for (const n of existing) {
    const m = /^V(\d+)/i.exec(n.trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `V${max + 1}`;
}
