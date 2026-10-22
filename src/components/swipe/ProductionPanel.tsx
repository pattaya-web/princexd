"use client";

import { useEffect, useRef, useState } from "react";
import { useDebouncedSave } from "@/lib/client";
import { Field } from "@/components/ui";
import { ProdStepper } from "@/components/SwipeProduction";
import { swipeProdStatus, type Swipe, type SwipeMetrics, type SwipeProdStatus } from "@/lib/types";

const METRICS: { key: keyof SwipeMetrics; label: string }[] = [
  { key: "views", label: "Vues" },
  { key: "reach", label: "Reach" },
  { key: "followers", label: "Abonnés gagnés" },
  { key: "comments", label: "Commentaires" },
  { key: "dms", label: "DM reçus" },
  { key: "leads", label: "Leads qualifiés" },
  { key: "calls", label: "Calls réservés" },
  { key: "sales", label: "Ventes attribuées" },
];

type Fields = Pick<Swipe, "shootAt" | "publishAt" | "assignee" | "shootNotes" | "notes" | "publishedUrl" | "metrics" | "title">;

/**
 * Onglet Production : où en est le Reel dans le pipeline, qui s'en occupe,
 * quand il se tourne et se publie, et, une fois publié, ses résultats (saisis
 * à la main, jamais inventés). La référence, le script et la publication
 * restent liés sur la même fiche.
 */
export function ProductionPanel({ s, onPatch, onStatusChange }: { s: Swipe; onPatch: (p: Partial<Swipe>) => Promise<void>; onStatusChange: (status: SwipeProdStatus, dates: Swipe["prodDates"]) => void }) {
  const [f, setF] = useState<Fields>(pick(s));
  const loadedFor = useRef(s.id);
  useEffect(() => {
    if (loadedFor.current === s.id) return;
    loadedFor.current = s.id;
    setF(pick(s));
  }, [s.id, s]);

  const save = useDebouncedSave<Fields>(async (v) => {
    await onPatch(v);
  }, 700);
  const set = (p: Partial<Fields>) => {
    const next = { ...f, ...p };
    setF(next);
    save(next);
  };
  const setMetric = (k: keyof SwipeMetrics, v: string) => set({ metrics: { ...(f.metrics ?? {}), [k]: Math.max(0, Math.round(Number(v) || 0)) } });

  const prod = swipeProdStatus(s);
  const published = prod === "publie" || prod === "programme";

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="label-xs mb-2">Pipeline</div>
        <ProdStepper s={s} onChange={onStatusChange} />
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <Field label="Titre de la fiche">
          <input className="input" value={f.title} onChange={(e) => set({ title: e.target.value })} />
        </Field>
        <Field label="Date de tournage">
          <input className="input" type="date" value={f.shootAt ?? ""} onChange={(e) => set({ shootAt: e.target.value })} />
        </Field>
        <Field label="Date de publication">
          <input className="input" type="date" value={f.publishAt ?? ""} onChange={(e) => set({ publishAt: e.target.value })} />
        </Field>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Responsable" hint="Qui tourne ou qui monte.">
          <input className="input" value={f.assignee ?? ""} onChange={(e) => set({ assignee: e.target.value })} placeholder="Mady, monteur…" />
        </Field>
        <Field label="Notes de tournage" hint="Lieu, tenue, accessoires, plans à ne pas oublier.">
          <textarea className="textarea" rows={2} value={f.shootNotes ?? ""} onChange={(e) => set({ shootNotes: e.target.value })} />
        </Field>
      </div>
      <Field label="Mes notes personnelles">
        <textarea className="textarea" rows={2} value={f.notes ?? ""} onChange={(e) => set({ notes: e.target.value })} placeholder="Pourquoi je l'ai gardé, ce que je veux en faire…" />
      </Field>

      <details className="card-flat px-3.5 py-3" open={published}>
        <summary className="cursor-pointer text-[13px] font-semibold">Ma publication et ses résultats</summary>
        <div className="mt-3 flex flex-col gap-3">
          <Field label="Lien de ma vidéo publiée">
            <input className="input" value={f.publishedUrl ?? ""} onChange={(e) => set({ publishedUrl: e.target.value })} placeholder="https://www.instagram.com/reel/…" inputMode="url" />
          </Field>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {METRICS.map((m) => (
              <Field key={m.key} label={m.label}>
                <input className="input num" type="number" min={0} value={f.metrics?.[m.key] ?? ""} onChange={(e) => setMetric(m.key, e.target.value)} placeholder="0" />
              </Field>
            ))}
          </div>
          <p className="dim text-[12px]">Saisis ce que tu vois dans tes statistiques Instagram. Le lien entre ce Reel de référence, ton script et ta publication reste sur cette fiche.</p>
        </div>
      </details>
    </div>
  );
}

function pick(s: Swipe): Fields {
  return { title: s.title, shootAt: s.shootAt ?? "", publishAt: s.publishAt ?? "", assignee: s.assignee ?? "", shootNotes: s.shootNotes ?? "", notes: s.notes ?? "", publishedUrl: s.publishedUrl ?? "", metrics: s.metrics ?? {} };
}
