"use client";

import { label } from "@/lib/format";
import { COMMISSION_TYPES } from "@/lib/sales/constants";
import { Field } from "@/components/ui";
import type { CommissionType } from "@/lib/types";

/**
 * Etat d'une regle de remuneration en cours de saisie.
 *
 * Partage entre l'onboarding et la modification : les deux ecrans doivent
 * proposer exactement les memes options, sinon on finit par pouvoir configurer
 * a la creation quelque chose qu'on ne peut plus modifier ensuite.
 */
export interface CommissionDraft {
  type: CommissionType;
  pct: string;
  fixed: string;
  /** Fixe mensuel : seul montant du mode « Fixe mensuel », optionnel ailleurs. */
  monthly: string;
  basis: "cash" | "contract";
  onlyQualified: boolean;
  effectiveFrom: string;
}

export function blankCommission(role: "setter" | "closer"): CommissionDraft {
  return {
    // Defauts usuels du metier : un setter est paye au rendez-vous honore, un
    // closer au pourcentage de ce qu'il encaisse.
    type: role === "setter" ? "per-show" : "pct-cash",
    pct: role === "setter" ? "5" : "10",
    fixed: role === "setter" ? "30" : "0",
    monthly: "0",
    basis: "cash",
    onlyQualified: false,
    effectiveFrom: new Date().toISOString().slice(0, 10),
  };
}

const usesPct = (t: CommissionType) =>
  ["pct-revenue", "pct-cash", "fixed-plus-pct", "custom"].includes(t);
const usesFixed = (t: CommissionType) =>
  ["per-appointment", "per-show", "fixed-plus-pct", "custom"].includes(t);

/** Ce que le membre touchera, en une phrase, avant de valider. */
export function previewCommission(d: CommissionDraft, currency: string): string {
  const pct = Number(d.pct) || 0;
  const fixed = Number(d.fixed) || 0;
  const monthly = Number(d.monthly) || 0;
  const withMonthly = (s: string) => (monthly > 0 ? `${monthly} ${currency} par mois + ${s}` : s);
  switch (d.type) {
    case "monthly-fixed":
      return monthly > 0 ? `${monthly} ${currency} par mois, quel que soit le résultat` : "un fixe mensuel à définir";
    case "per-appointment":
      return withMonthly(`${fixed} ${currency} par rendez-vous${d.onlyQualified ? " qualifié" : ""} posé`);
    case "per-show":
      return withMonthly(`${fixed} ${currency} par call réellement honoré`);
    case "pct-revenue":
      return withMonthly(`${pct} % de la valeur des contrats signés`);
    case "pct-cash":
      return withMonthly(`${pct} % du cash réellement encaissé`);
    case "fixed-plus-pct":
    case "custom":
      return withMonthly(`${fixed} ${currency} par vente + ${pct} % ${d.basis === "contract" ? "du contrat" : "du cash encaissé"}`);
    default:
      return "";
  }
}

/**
 * Champs de remuneration.
 *
 * Seuls les champs utiles au mode choisi sont affiches : montrer un
 * pourcentage a cote d'un « 20 $ par rendez-vous » invite a remplir les deux
 * et a se tromper sur ce qui sera reellement paye.
 */
export function CommissionFields({
  value,
  onChange,
  currency,
  showEffectiveFrom = true,
}: {
  value: CommissionDraft;
  onChange: (v: CommissionDraft) => void;
  currency: string;
  showEffectiveFrom?: boolean;
}) {
  const set = (patch: Partial<CommissionDraft>) => onChange({ ...value, ...patch });

  return (
    <>
      <Field label="Mode de rémunération" className="sm:col-span-2">
        <select
          className="select"
          value={value.type}
          onChange={(e) => set({ type: e.target.value as CommissionType })}
        >
          {COMMISSION_TYPES.map((t) => (
            <option key={t} value={t}>
              {label(t)}
            </option>
          ))}
        </select>
      </Field>

      {/* Fixe mensuel : le seul montant du mode « Fixe mensuel », un complement
          optionnel partout ailleurs (fixe + variable). */}
      <Field
        label={value.type === "monthly-fixed" ? `Fixe par mois (${currency})` : `Fixe mensuel, optionnel (${currency})`}
        hint={value.type === "monthly-fixed" ? undefined : "Versé chaque mois en plus du variable. 0 = aucun."}
      >
        <input
          className="input num"
          type="number"
          min={0}
          value={value.monthly}
          onChange={(e) => set({ monthly: e.target.value })}
        />
      </Field>

      {usesFixed(value.type) && (
        <Field
          label={
            value.type === "per-appointment"
              ? `Montant par rendez-vous (${currency})`
              : value.type === "per-show"
                ? `Montant par call honoré (${currency})`
                : `Fixe par vente (${currency})`
          }
        >
          <input
            className="input num"
            type="number"
            min={0}
            value={value.fixed}
            onChange={(e) => set({ fixed: e.target.value })}
          />
        </Field>
      )}

      {usesPct(value.type) && (
        <Field label="Pourcentage (%)">
          <input
            className="input num"
            type="number"
            min={0}
            max={100}
            value={value.pct}
            onChange={(e) => set({ pct: e.target.value })}
          />
        </Field>
      )}

      {(value.type === "fixed-plus-pct" || value.type === "custom") && (
        <Field label="Assiette du pourcentage">
          <select
            className="select"
            value={value.basis}
            onChange={(e) => set({ basis: e.target.value as "cash" | "contract" })}
          >
            <option value="cash">Cash encaissé</option>
            <option value="contract">Valeur de contrat</option>
          </select>
        </Field>
      )}

      {showEffectiveFrom && (
        <Field label="À partir du">
          <input
            className="input"
            type="date"
            value={value.effectiveFrom}
            onChange={(e) => set({ effectiveFrom: e.target.value })}
          />
        </Field>
      )}

      {value.type === "per-appointment" && (
        <label className="flex items-center gap-2 text-[12.5px] sm:col-span-2">
          <input
            type="checkbox"
            checked={value.onlyQualified}
            onChange={(e) => set({ onlyQualified: e.target.checked })}
          />
          Ne payer que les rendez-vous marqués « qualifiés »
        </label>
      )}
    </>
  );
}
