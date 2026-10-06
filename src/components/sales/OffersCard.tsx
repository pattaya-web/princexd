"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { fmtMoney } from "@/lib/format";
import { useSalesData } from "@/lib/sales/client";
import { Card, Empty, Field, Spinner, useToast } from "@/components/ui";
import type { SalesOffer } from "@/lib/types";

/**
 * Les offres, en grand, pour que le closer les ait sous les yeux.
 *
 * Lecture seule pour l'equipe ; l'admin les ecrit et les modifie ici meme
 * (nom, prix, description), dans l'ordre ou il veut qu'elles soient pitchees.
 */
export function OffersCard({ editable = false }: { editable?: boolean }) {
  const { data, loading, reload } = useSalesData<{ offers: SalesOffer[]; currency: string }>("/api/sales/offers");
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<SalesOffer[]>([]);
  const [saving, setSaving] = useState(false);

  const offers = data?.offers ?? [];
  const currency = data?.currency ?? "EUR";

  useEffect(() => {
    if (!editing) setDraft(offers.map((o) => ({ ...o })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, editing]);

  const uid = () => `offer-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const set = (i: number, p: Partial<SalesOffer>) => setDraft((d) => d.map((o, j) => (j === i ? { ...o, ...p } : o)));
  const move = (i: number, dir: -1 | 1) =>
    setDraft((d) => {
      const j = i + dir;
      if (j < 0 || j >= d.length) return d;
      const n = [...d];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });

  const save = async () => {
    setSaving(true);
    try {
      await api("/api/sales/offers", { method: "PUT", body: JSON.stringify({ offers: draft }) });
      await reload();
      setEditing(false);
      toast("Offres enregistrées. Ton closer les voit sur son accueil.");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      title="Nos offres"
      subtitle={editable ? "Ce que le closer voit sur son accueil et retrouve dans « Offre vendue »." : "Les offres à pitcher, dans l'ordre."}
      actions={
        editable ? (
          editing ? (
            <>
              <button className="btn btn-sm" onClick={() => setEditing(false)} disabled={saving}>Annuler</button>
              <button className="btn btn-sm btn-primary" onClick={() => void save()} disabled={saving}>
                {saving ? <span className="spinner" /> : "Enregistrer"}
              </button>
            </>
          ) : (
            <button className="btn btn-sm" onClick={() => setEditing(true)}>✎ Modifier les offres</button>
          )
        ) : undefined
      }
    >
      {loading && !data ? (
        <Spinner label="Chargement des offres…" />
      ) : editing ? (
        <div className="flex flex-col gap-3">
          {draft.map((o, i) => (
            <div key={o.id} className="card-flat p-3 grid sm:grid-cols-[1fr_140px_auto] gap-2 items-start">
              <Field label={`Offre ${i + 1}`}>
                <input className="input" value={o.name} placeholder="Ex. Coaching 1:1 e-commerce" onChange={(e) => set(i, { name: e.target.value })} />
              </Field>
              <Field label={`Prix (${currency})`}>
                <input className="input num" type="number" min={0} value={o.price || ""} placeholder="3000" onChange={(e) => set(i, { price: Number(e.target.value) || 0 })} />
              </Field>
              <div className="flex gap-1 sm:mt-[22px]">
                <button className="btn btn-sm" onClick={() => move(i, -1)} disabled={i === 0} title="Monter">↑</button>
                <button className="btn btn-sm" onClick={() => move(i, 1)} disabled={i === draft.length - 1} title="Descendre">↓</button>
                <button className="btn btn-sm btn-danger" onClick={() => setDraft((d) => d.filter((_, j) => j !== i))} title="Retirer">✕</button>
              </div>
              <Field label="Description" hint="Ce qu'elle contient, pour qui, les arguments clés." className="sm:col-span-3">
                <textarea className="input w-full" rows={3} value={o.description} onChange={(e) => set(i, { description: e.target.value })} />
              </Field>
            </div>
          ))}
          <button className="btn" onClick={() => setDraft((d) => [...d, { id: uid(), name: "", price: 0, description: "" }])}>+ Ajouter une offre</button>
        </div>
      ) : !offers.length ? (
        <Empty>{editable ? "Aucune offre pour l'instant. Clique « Modifier les offres » pour écrire la première." : "Aucune offre renseignée pour l'instant."}</Empty>
      ) : (
        <div className={`grid gap-3 ${offers.length > 1 ? "sm:grid-cols-2" : ""}`}>
          {offers.map((o, i) => (
            <div key={o.id} className="card-flat p-4 flex flex-col gap-2" style={{ borderTop: `3px solid ${i === 0 ? "var(--accent)" : "var(--s4)"}` }}>
              <div className="label-xs">Offre {i + 1}</div>
              <div className="text-[17px] font-semibold leading-tight">{o.name}</div>
              <div className="num text-[26px] font-bold leading-none" style={{ color: i === 0 ? "var(--accent)" : "var(--text)" }}>
                {o.price ? fmtMoney(o.price, currency) : "—"}
              </div>
              {o.description && <p className="text-[12.5px] leading-relaxed whitespace-pre-wrap" style={{ color: "var(--text-2)" }}>{o.description}</p>}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
