"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { ErrorNote, Spinner, useToast } from "@/components/ui";
import { SectionLabel } from "@/components/formation/portal";
import { LAUNCH_CHECKLIST, checklistProgress, type ChecklistItem } from "@/lib/formation-checklist";
import type { ChecklistPayload } from "@/app/api/formation/checklist/route";

/**
 * Checklist avant de lancer (Scale X) : tous les points à cocher à la main
 * avant la première campagne. Tant qu'un point obligatoire manque : on ne lance pas.
 */
export default function ChecklistPage() {
  const toast = useToast();
  const [data, setData] = useState<ChecklistPayload | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await api<ChecklistPayload>("/api/formation/checklist"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const tick = async (item: ChecklistItem, done: boolean) => {
    if (!data) return;
    if (!data.student) {
      toast("Tu es admin : la checklist se coche côté élève.");
      return;
    }
    setBusyId(item.id);
    try {
      const r = await api<{ checked: string[]; readyAt: string; preview: boolean }>("/api/formation/checklist", {
        method: "POST",
        body: JSON.stringify({ id: item.id, done: !done }),
      });
      if (r.preview) toast("Aperçu : la checklist de l'élève n'est pas modifiée.");
      else setData((d) => (d ? { ...d, checked: r.checked, readyAt: r.readyAt } : d));
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusyId("");
    }
  };

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Spinner label="Chargement de ta checklist…" />;

  const checked = new Set(data.checked);
  const progress = checklistProgress(checked);
  const percent = Math.round((progress.done / progress.total) * 100);
  const tone = progress.ready ? "var(--good)" : "var(--critical)";

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-[28px] sm:text-[34px] font-semibold leading-tight" style={{ letterSpacing: "-0.03em" }}>
          Checklist avant de lancer
        </h1>
        <p className="muted text-[14px] mt-1">Tout ce qui doit être prêt avant ta première campagne et ta première boutique. Coche chaque point toi-même, honnêtement.</p>
      </header>

      {data.preview && <div className="badge badge-warn w-fit !text-[11.5px]">Aperçu : tu vois Scale X comme {data.student?.name}. Rien n&apos;est enregistré.</div>}

      <section
        className="rounded-[14px] px-4 py-4 flex flex-col gap-3"
        style={{ background: `color-mix(in srgb, ${tone} 10%, transparent)`, border: `1px solid color-mix(in srgb, ${tone} 45%, transparent)` }}
      >
        <div className="flex items-start gap-3">
          <span aria-hidden className="shrink-0 w-[14px] h-[14px] rounded-full mt-[5px]" style={{ background: tone, boxShadow: `0 0 12px ${tone}` }} />
          <div className="min-w-0">
            {progress.ready ? (
              <>
                <div className="text-[15.5px] font-semibold">Feu vert : tu peux lancer 🚀</div>
                <p className="text-[13.5px] mt-0.5">
                  Tous les points sont au vert. Va sur{" "}
                  <Link href="/formation/meta" className="link font-medium">
                    Campagnes Meta
                  </Link>{" "}
                  et lance ta première campagne.
                </p>
              </>
            ) : (
              <>
                <div className="text-[15.5px] font-semibold">Tant que la checklist n&apos;est pas complète, tu ne lances pas.</div>
                <p className="text-[13.5px] mt-0.5">
                  Tous les points doivent être opérationnels, feu vert. Il en reste {progress.total - progress.done} à faire. Seul le dernier point (l&apos;avis d&apos;un proche) est facultatif.
                </p>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex-1 h-[8px] rounded-full overflow-hidden" style={{ background: "var(--surface-3)" }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${percent}%`, background: tone }} />
          </div>
          <span className="text-[13px] font-medium num shrink-0">
            {progress.done} / {progress.total} points
          </span>
        </div>
      </section>

      {LAUNCH_CHECKLIST.map((g, gi) => (
        <section key={g.key} className="card p-5">
          <SectionLabel n={String(gi + 1).padStart(2, "0")} title={g.title} />
          <div className="mt-2">
            {g.items.map((it) => {
              const done = checked.has(it.id);
              return (
                <div key={it.id} className="flex items-start gap-3 py-2.5 border-b last:border-b-0" style={{ borderColor: "var(--border)" }}>
                  <button
                    type="button"
                    onClick={() => void tick(it, done)}
                    disabled={busyId === it.id}
                    aria-label={done ? "Décocher" : "Cocher"}
                    className="shrink-0 mt-[1px] w-[22px] h-[22px] rounded-[6px] border flex items-center justify-center text-[12px] font-bold transition-colors"
                    style={{ borderColor: done ? "var(--good)" : "var(--border-strong)", background: done ? "var(--good)" : "transparent", color: "#fff" }}
                  >
                    {done ? "✓" : ""}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <button type="button" className="text-left text-[14px] font-medium leading-snug" onClick={() => void tick(it, done)} disabled={busyId === it.id}>
                        {it.label}
                      </button>
                      {it.optional && <span className="badge !text-[10px] !py-0">facultatif</span>}
                    </div>
                    {it.detail && <p className="muted text-[13px] mt-1 leading-snug">{it.detail}</p>}
                    {it.link && (
                      <Link href={it.link.href} className="btn btn-sm mt-1.5">
                        {it.link.label} →
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
