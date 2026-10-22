"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { ErrorNote, Spinner, useToast } from "@/components/ui";
import { PortalFooter, PortalStepRow, SectionLabel } from "@/components/formation/portal";
import type { StepsPayload } from "@/app/api/formation/steps/route";

/**
 * Mes étapes (Scale X) : la marche à suivre complète, avec les consignes,
 * et les étapes que Mady a assignées à cet élève. L'élève coche, Mady voit.
 */
export default function MesEtapesPage() {
  const toast = useToast();
  const [data, setData] = useState<StepsPayload | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await api<StepsPayload>("/api/formation/steps"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const tick = async (item: { id: string; kind: "step" | "task"; done: boolean }) => {
    if (!data?.student) {
      toast("Tu es admin : les coches sont celles des élèves. Gère les étapes dans Parcours & étapes.");
      return;
    }
    setBusyId(item.id);
    try {
      const r = await api<{ preview: boolean }>("/api/formation/steps/progress", {
        method: "POST",
        body: JSON.stringify(item.kind === "task" ? { taskId: item.id, done: !item.done } : { stepId: item.id, done: !item.done }),
      });
      if (r.preview) toast("Aperçu : la progression de l'élève n'est pas modifiée.");
      await load();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusyId("");
    }
  };

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Spinner label="Chargement de tes étapes…" />;

  const all = [...data.tasks, ...data.steps];
  const done = all.filter((s) => s.done).length;
  const percent = all.length ? Math.round((done / all.length) * 100) : 0;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] sm:text-[34px] font-semibold leading-tight" style={{ letterSpacing: "-0.03em" }}>
            Mes étapes
          </h1>
          <p className="muted text-[14px] mt-1">La marche à suivre pour lancer ta boutique et tes premières pubs. Coche chaque étape quand elle est faite.</p>
        </div>
        {data.isAdmin && !data.student && (
          <Link href="/formation/parcours" className="btn btn-sm">
            Gérer le parcours
          </Link>
        )}
      </header>

      {data.preview && <div className="badge badge-warn w-fit !text-[11.5px]">Aperçu : tu vois Scale X comme {data.student?.name}. Rien n&apos;est enregistré.</div>}

      {all.length > 0 && (
        <div className="card-flat px-4 py-3 flex items-center gap-4">
          <div className="flex-1 h-[8px] rounded-full overflow-hidden" style={{ background: "var(--surface-3)" }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${percent}%`, background: "var(--good)" }} />
          </div>
          <span className="text-[13px] font-medium num shrink-0">
            {done} / {all.length} étapes faites
          </span>
        </div>
      )}

      {data.tasks.length > 0 && (
        <section className="card p-5">
          <SectionLabel n="A" title="Assignées par Mady" />
          <div className="mt-2">
            {data.tasks.map((t) => (
              <PortalStepRow key={t.id} item={t} busy={busyId === t.id} onToggle={() => void tick(t)} />
            ))}
          </div>
        </section>
      )}

      <section className="card p-5">
        <SectionLabel n={data.tasks.length ? "B" : "01"} title="La marche à suivre" />
        {data.steps.length === 0 ? (
          <p className="dim text-[13.5px] mt-3">Aucune étape publiée pour l&apos;instant.</p>
        ) : (
          <div className="mt-2">
            {data.steps.map((s, i) => (
              <PortalStepRow key={s.id} item={s} index={i + 1} busy={busyId === s.id} onToggle={() => void tick(s)} />
            ))}
          </div>
        )}
      </section>

      <PortalFooter quote={data.portal.quote} author={data.portal.quoteAuthor} />
    </div>
  );
}
