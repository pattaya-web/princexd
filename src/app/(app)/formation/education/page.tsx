"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { ErrorNote, Spinner, useToast } from "@/components/ui";
import { PortalFooter, SectionLabel } from "@/components/formation/portal";
import { LESSON_GROUPS, type Lesson } from "@/lib/formation-education";
import type { EducationPayload } from "@/app/api/formation/education/route";

/**
 * Education (Scale X) : les guides PDF du cours, dans l'ordre, avec une case
 * à cocher par guide. Pas de vidéo pour l'instant : tout est dans les PDF.
 */
const GROUP_INTRO: Record<string, string> = {
  Fondations: "À lire avant ton premier call, dans l'ordre. C'est la base : la méthode, le produit, la boutique, la page produit, les médias.",
  Lancement: "Quand ton produit est validé : créatives, Meta, première campagne, lecture des chiffres.",
  Bonus: "Pour aller plus loin : organique IA, logistique et service client.",
};

export default function EducationPage() {
  const toast = useToast();
  const [data, setData] = useState<EducationPayload | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await api<EducationPayload>("/api/formation/education"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const tick = async (l: Lesson, done: boolean) => {
    if (!data?.student) {
      toast("Tu es admin : les coches sont celles des élèves.");
      return;
    }
    setBusyId(l.id);
    try {
      const r = await api<{ preview: boolean; completed: string[] }>("/api/formation/education", { method: "PATCH", body: JSON.stringify({ lessonId: l.id, done }) });
      if (r.preview) toast("Aperçu : la progression de l'élève n'est pas modifiée.");
      else if (done) toast("Guide terminé. Au suivant.");
      await load();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusyId("");
    }
  };

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Spinner label="Chargement…" />;

  const done = new Set(data.completed);
  const next = data.lessons.find((l) => !done.has(l.id)) ?? null;

  return (
    <div className="flex flex-col gap-5">
      <header>
        <div className="label-xs" style={{ letterSpacing: "0.12em" }}>
          Scale X / Education 🎓
        </div>
        <h1 className="text-[28px] sm:text-[34px] font-semibold leading-tight mt-2" style={{ letterSpacing: "-0.03em" }}>
          Les guides, dans l&apos;ordre.
        </h1>
        <p className="muted text-[14px] mt-1 max-w-[64ch]">Tout le cours est en PDF, très détaillé, à lire et à appliquer. Ouvre un guide, applique-le, coche-le quand c&apos;est fait : c&apos;est comme ça que Mady suit ton avancement.</p>
        {data.preview && <div className="badge badge-warn w-fit !text-[11.5px] mt-3">Aperçu : tu vois Scale X comme {data.student?.name}. Rien n&apos;est enregistré.</div>}
      </header>

      <section className="card p-5">
        <div className="flex items-center justify-between gap-3">
          <SectionLabel n="00" title="Où tu en es" />
          <span className="label-xs num">
            {data.progress.done} / {data.progress.total} guides terminés
          </span>
        </div>
        <div className="flex items-center gap-3 mt-4">
          <div className="flex-1 h-[6px] rounded-full overflow-hidden" style={{ background: "var(--surface-3)" }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${data.progress.percent}%`, background: "var(--good)" }} />
          </div>
          <span className="text-[12px] num dim">{data.progress.percent}%</span>
        </div>
        {next ? (
          <div className="flex flex-wrap items-center gap-3 mt-4">
            <div className="min-w-0 flex-1">
              <div className="label-xs">À lire maintenant</div>
              <div className="text-[16px] font-semibold leading-snug mt-0.5">
                {String(next.order).padStart(2, "0")} · {next.title}
              </div>
            </div>
            <a href={next.file} target="_blank" rel="noreferrer" className="btn btn-primary btn-sm">
              Ouvrir le PDF
            </a>
          </div>
        ) : (
          <div className="text-[15px] font-semibold mt-4">Tous les guides sont terminés. Bravo.</div>
        )}
        {data.videoModules > 0 && (
          <div className="mt-3">
            <Link href="/formation/cours" className="text-[13px] font-medium hover:underline">
              Les vidéos ({data.videoModules}) →
            </Link>
          </div>
        )}
      </section>

      {LESSON_GROUPS.map((g, gi) => {
        const items = data.lessons.filter((l) => l.group === g);
        if (!items.length) return null;
        return (
          <section key={g} className="card p-5">
            <SectionLabel n={String(gi + 1).padStart(2, "0")} title={g} />
            <p className="muted text-[13.5px] mt-2 leading-relaxed max-w-[64ch]">{GROUP_INTRO[g]}</p>
            <div className="flex flex-col mt-3">
              {items.map((l) => {
                const isDone = done.has(l.id);
                return (
                  <div key={l.id} className="flex items-start gap-3 py-3 border-b last:border-b-0" style={{ borderColor: "var(--border)", opacity: isDone ? 0.7 : 1 }}>
                    <button
                      type="button"
                      onClick={() => void tick(l, !isDone)}
                      disabled={busyId === l.id}
                      aria-label={isDone ? "Décocher" : "Marquer comme terminé"}
                      className="shrink-0 mt-[2px] w-[22px] h-[22px] rounded-full border flex items-center justify-center text-[12px] font-bold transition-colors"
                      style={{ borderColor: isDone ? "var(--good)" : "var(--border-strong)", background: isDone ? "var(--good)" : "transparent", color: "#fff" }}
                    >
                      {isDone ? "✓" : ""}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="label-xs num">{String(l.order).padStart(2, "0")}</span>
                        <span className="text-[15px] font-semibold leading-snug" style={{ textDecoration: isDone ? "line-through" : "none" }}>
                          {l.title}
                        </span>
                        <span className="dim text-[12px]">· {l.minutes} min</span>
                      </div>
                      <p className="muted text-[13px] mt-1 leading-relaxed">{l.summary}</p>
                      <div className="flex flex-wrap items-center gap-2 mt-2">
                        <a href={l.file} target="_blank" rel="noreferrer" className="btn btn-sm">
                          Ouvrir le PDF
                        </a>
                        <a href={l.file} download className="btn btn-sm btn-ghost">
                          Télécharger
                        </a>
                        {!isDone && (
                          <button type="button" className="text-[13px] font-medium hover:underline" onClick={() => void tick(l, true)} disabled={busyId === l.id}>
                            Marquer terminé
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      <PortalFooter quote="Plus vite tu lances, plus vite tu apprends. Le reste, c'est de l'optimisation." author="Mady" />
    </div>
  );
}
