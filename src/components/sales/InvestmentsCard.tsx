"use client";

import { useMemo, useState } from "react";
import { useCollection } from "@/lib/client";
import { fmtDate, fmtMoney } from "@/lib/format";
import { Card, Empty, Field, useToast } from "@/components/ui";
import type { BusinessInvestment } from "@/lib/types";

const CATEGORIES: { key: BusinessInvestment["category"]; label: string }[] = [
  { key: "accompagnement", label: "Accompagnement / coaching" },
  { key: "contenu", label: "Création de contenu" },
  { key: "outils", label: "Outils / logiciels" },
  { key: "equipe", label: "Équipe / freelances" },
  { key: "pub", label: "Publicité" },
  { key: "autre", label: "Autre" },
];

/**
 * Investissements business (2026-10-16) : ce que le proprietaire met dans
 * le business pour le faire grandir (accompagnement, contenu, outils…), a
 * part du cout des pubs qui vit dans Meta Ads. Une liste datee avec un
 * total, pour mettre les depenses en face du cash encaisse.
 */
export function InvestmentsCard({ currency = "EUR" }: { currency?: string }) {
  const { rows, loading, create, destroy } = useCollection<BusinessInvestment>("investments");
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<BusinessInvestment["category"]>("accompagnement");
  const [at, setAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const sorted = useMemo(() => [...rows].sort((a, b) => b.at.localeCompare(a.at)), [rows]);
  const total = rows.reduce((a, r) => a + (r.amount || 0), 0);
  const monthKey = new Date().toISOString().slice(0, 7);
  const thisMonth = rows.filter((r) => r.at.slice(0, 7) === monthKey).reduce((a, r) => a + (r.amount || 0), 0);

  const add = async () => {
    const value = Number(amount);
    if (!label.trim()) return toast("Dis à quoi sert cet investissement.", "err");
    if (!(value > 0)) return toast("Indique un montant supérieur à 0.", "err");
    setSaving(true);
    try {
      await create({ label: label.trim(), amount: value, currency, category, at, notes: notes.trim() });
      toast(`${fmtMoney(value, currency)} ajoutés aux investissements.`);
      setLabel("");
      setAmount("");
      setNotes("");
      setAdding(false);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (r: BusinessInvestment) => {
    if (!window.confirm(`Supprimer « ${r.label} » (${fmtMoney(r.amount, r.currency)}) ?`)) return;
    try {
      await destroy(r.id);
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  return (
    <Card
      padded={false}
      title={
        <span className="flex items-center gap-2 !text-[14px]">
          <span className="w-[8px] h-[8px] rounded-full" style={{ background: "#a855f7" }} />
          Investissements business
          <span className="badge !text-[10.5px] !py-0 num">{rows.length}</span>
        </span>
      }
      subtitle={rows.length ? `${fmtMoney(total, currency)} investis au total · ${fmtMoney(thisMonth, currency)} ce mois` : "Accompagnements, contenu, outils : ce que tu mets dans le business pour le faire grandir."}
      actions={
        <button className="btn btn-sm btn-primary" onClick={() => setAdding((v) => !v)}>
          {adding ? "Fermer" : "+ Ajouter"}
        </button>
      }
    >
      {adding && (
        <div className="px-3.5 pt-3.5 pb-3 flex flex-wrap items-end gap-2.5" style={{ borderBottom: "1px solid var(--border)" }}>
          <Field label="Quoi">
            <input className="input !w-[300px]" value={label} placeholder="Ex. Accompagnement création de contenu" onChange={(e) => setLabel(e.target.value)} autoFocus />
          </Field>
          <Field label={`Montant (${currency})`}>
            <input className="input num !w-[110px]" type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Catégorie">
            <select className="select select-sm" value={category} onChange={(e) => setCategory(e.target.value as BusinessInvestment["category"])}>
              {CATEGORIES.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Date">
            <input className="input !w-[150px]" type="date" value={at} onChange={(e) => setAt(e.target.value)} />
          </Field>
          <Field label="Note (optionnel)">
            <input className="input !w-[260px]" value={notes} placeholder="Pour quoi, avec qui" onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <button className="btn btn-primary" disabled={saving} onClick={() => void add()}>
            {saving ? <span className="spinner" /> : "Enregistrer"}
          </button>
        </div>
      )}
      {loading && !rows.length ? (
        <div className="dim text-[12.5px] px-3.5 py-4">Chargement…</div>
      ) : !sorted.length ? (
        <div className="px-3.5 py-4">
          <Empty>Aucun investissement noté pour l&apos;instant.</Empty>
        </div>
      ) : (
        <ul>
          {sorted.map((r, i) => (
            <li key={r.id} className="px-3.5 py-2.5 flex items-center gap-3 flex-wrap" style={{ borderTop: i ? "1px solid var(--border)" : undefined }}>
              <span className="num dim text-[12px] w-[82px] shrink-0">{fmtDate(r.at)}</span>
              <span className="min-w-0 flex-1">
                <span className="text-[13px] font-medium block truncate">{r.label}</span>
                <span className="dim text-[11.5px]">
                  {CATEGORIES.find((c) => c.key === r.category)?.label ?? r.category}
                  {r.notes ? ` · ${r.notes}` : ""}
                </span>
              </span>
              <span className="num font-semibold text-[13px]">{fmtMoney(r.amount, r.currency)}</span>
              <button className="btn btn-sm btn-ghost !h-[26px]" title="Supprimer" onClick={() => void remove(r)}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
