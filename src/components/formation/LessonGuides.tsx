"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { ErrorNote, Spinner, useToast } from "@/components/ui";
import { SectionLabel } from "./portal";
import { LESSON_GROUPS, type Lesson } from "@/lib/formation-education";
import type { EducationPayload } from "@/app/api/formation/education/route";

const GROUP_INTRO: Record<string, string> = {
  Fondations: "La base, dans l'ordre : la méthode, le produit, la boutique, la page produit, les médias.",
  Lancement: "Quand ton produit est validé : créatives, Meta, première campagne, lecture des chiffres.",
  Bonus: "Pour aller plus loin : organique IA, logistique et service client.",
};

/**
 * Les guides PDF du cours (Scale X), étape par étape, avec une case à cocher
 * par guide. Affichés dans Ressources, sous les vidéos : l'élève a la vidéo
 * de chaque temps du parcours, et les étapes détaillées en PDF. La coche
 * sert à Mady pour suivre l'avancement.
 */
export function LessonGuides() {
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
  if (!data) return <Spinner label="Chargement des guides…" />;

  const done = new Set(data.completed);
  const next = data.lessons.find((l) => !done.has(l.id)) ?? null;

  return (
    <>
      <section className="card p-5">
        <div className="flex items-center justify-between gap-3">
          <SectionLabel n="01" title="Les guides PDF, étape par étape" />
          <span className="label-xs num">
            {data.progress.done} / {data.progress.total} terminés
          </span>
        </div>
        <p className="muted text-[13.5px] mt-2 leading-relaxed max-w-[64ch]">Chaque temps du parcours a sa vidéo ; ici, les étapes détaillées à lire et à appliquer. Ouvre un guide, applique-le, coche-le quand c&apos;est fait.</p>
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
      </section>

      {LESSON_GROUPS.map((g) => {
        const items = data.lessons.filter((l) => l.group === g);
        if (!items.length) return null;
        return (
          <section key={g} className="card p-5">
            <div className="label-xs" style={{ letterSpacing: "0.12em" }}>
              {g.toUpperCase()}
            </div>
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
    </>
  );
}
