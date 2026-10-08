"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/client";
import { Card, Empty, ErrorNote, Spinner, useToast } from "@/components/ui";
import { Annex } from "@/components/formation/Annex";
import { youtubeEmbedUrl, type CourseModuleRow } from "@/lib/formation";
import type { FormationPayload } from "@/app/api/formation/modules/route";

/**
 * La plateforme de formation, vue par l'eleve.
 *
 * Une seule page : la liste des modules dans l'ordre a gauche, le module
 * ouvert a droite (video YouTube, annexe, objections frequentes). L'eleve
 * coche « terminé » quand il a fini ; la barre d'avancement suit.
 *
 * L'admin voit exactement la meme page, avec en plus les brouillons marques
 * comme tels et un raccourci vers la gestion des modules.
 */

const MODULE_KEY = "formation:module";

export default function FormationPage() {
  const toast = useToast();
  const [data, setData] = useState<FormationPayload | null>(null);
  const [error, setError] = useState("");
  const [current, setCurrent] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<FormationPayload>("/api/formation/modules");
      setData(r);
      setError("");
      return r;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  }, []);

  useEffect(() => {
    void load().then((r) => {
      if (!r || !r.modules.length) return;
      // On rouvre le module ou l'eleve s'etait arrete ; sinon le premier non termine.
      let remembered = "";
      try {
        remembered = new URLSearchParams(window.location.search).get("m") || window.localStorage.getItem(MODULE_KEY) || "";
      } catch {
        // Stockage indisponible : on ouvre le premier module non termine.
      }
      const firstOpen = r.modules.find((m) => !r.completed.includes(m.id)) ?? r.modules[0];
      setCurrent((cur) => cur || (r.modules.some((m) => m.id === remembered) ? remembered : firstOpen.id));
    });
  }, [load]);

  useEffect(() => {
    if (!current) return;
    try {
      window.localStorage.setItem(MODULE_KEY, current);
    } catch {
      // Sans stockage, on repartira du premier module non termine.
    }
  }, [current]);

  const modules = data?.modules ?? [];
  const completed = useMemo(() => new Set(data?.completed ?? []), [data]);
  const published = modules.filter((m) => m.published);
  const done = published.filter((m) => completed.has(m.id)).length;
  const module = modules.find((m) => m.id === current) ?? null;
  const index = module ? modules.indexOf(module) : -1;
  const next = index >= 0 ? modules[index + 1] : undefined;
  const prev = index > 0 ? modules[index - 1] : undefined;

  const toggleDone = async (m: CourseModuleRow) => {
    if (!data) return;
    if (data.isAdmin && !data.student) {
      toast("Tu es admin : la progression est celle des élèves, pas la tienne.");
      return;
    }
    const wasDone = completed.has(m.id);
    setBusy(true);
    try {
      const r = await api<{ completed: string[]; preview: boolean }>("/api/formation/progress", {
        method: "POST",
        body: JSON.stringify({ moduleId: m.id, done: !wasDone }),
      });
      if (r.preview) {
        toast("Aperçu : la progression de l'élève n'est pas modifiée.");
      } else {
        setData((d) => (d ? { ...d, completed: r.completed } : d));
        if (!wasDone) {
          toast(next ? "Module terminé. Le suivant t'attend." : "Bravo, tu as terminé tous les modules !");
          if (next) setCurrent(next.id);
        }
      }
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Spinner label="Chargement de ta formation…" />;

  return (
    <div className="flex flex-col gap-5">
      {/* En-tete : qui, et ou il en est. */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="grad-text text-[30px] sm:text-[38px] font-semibold leading-[1.08] pb-0.5" style={{ letterSpacing: "-0.035em" }}>
            {data.student ? `Bienvenue ${data.student.name.split(" ")[0]}` : "Plateforme élèves"}
          </h1>
          <p className="muted text-[14px] sm:text-[15px] mt-2 leading-relaxed">
            {data.student
              ? "Suis les modules dans l'ordre, et coche chacun quand tu l'as terminé."
              : "Ce que voient tes élèves. Les brouillons n'apparaissent que pour toi."}
          </p>
        </div>
        {data.isAdmin && !data.student && (
          <div className="flex items-center gap-2">
            <Link href="/formation/modules" className="btn btn-sm">
              Gérer les modules
            </Link>
            <Link href="/formation/eleves" className="btn btn-sm btn-ghost">
              Accès élèves
            </Link>
          </div>
        )}
      </header>

      {data.preview && (
        <div className="badge badge-warn w-fit !text-[11.5px]">Aperçu : tu vois la plateforme comme {data.student?.name}. Rien n&apos;est enregistré.</div>
      )}

      {/* Avancement : une barre, un chiffre. */}
      {published.length > 0 && (
        <div className="card-flat px-4 py-3 flex items-center gap-4">
          <div className="flex-1 h-[8px] rounded-full overflow-hidden" style={{ background: "var(--surface-3)" }}>
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${published.length ? Math.round((done / published.length) * 100) : 0}%`, background: "var(--emerald)" }}
            />
          </div>
          <span className="text-[13px] font-medium num shrink-0">
            {done} / {published.length} module{published.length > 1 ? "s" : ""} terminé{done > 1 ? "s" : ""}
          </span>
        </div>
      )}

      {!modules.length ? (
        <Empty
          action={
            data.isAdmin ? (
              <Link href="/formation/modules" className="btn btn-primary btn-sm">
                Ajouter le premier module
              </Link>
            ) : undefined
          }
        >
          {data.isAdmin ? "Aucun module pour l'instant." : "Ta formation arrive bientôt : aucun module n'est encore disponible."}
        </Empty>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)] items-start">
          {/* Liste des modules, dans l'ordre. */}
          <nav className="card p-2 flex flex-col gap-[2px] lg:sticky lg:top-[76px]">
            {modules.map((m, i) => {
              const active = m.id === current;
              const isDone = completed.has(m.id);
              return (
                <button
                  key={m.id}
                  onClick={() => setCurrent(m.id)}
                  className="flex items-start gap-3 px-3 py-2.5 rounded-[10px] text-left transition-colors"
                  style={{ background: active ? "var(--accent-soft)" : "transparent" }}
                >
                  <span
                    className="shrink-0 w-[24px] h-[24px] rounded-full flex items-center justify-center text-[11.5px] font-semibold num mt-[1px]"
                    style={{
                      background: isDone ? "var(--emerald)" : active ? "var(--accent)" : "var(--surface-3)",
                      color: isDone || active ? "#fff" : "var(--text-2)",
                    }}
                  >
                    {isDone ? "✓" : i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13.5px] leading-snug" style={{ fontWeight: active ? 600 : 500, color: active ? "var(--accent)" : "var(--text)" }}>
                      {m.title}
                    </span>
                    {!m.published && <span className="badge badge-warn !text-[9.5px] !py-0 mt-1">Brouillon</span>}
                  </span>
                </button>
              );
            })}
          </nav>

          {/* Le module ouvert. */}
          {module && (
            <div className="flex flex-col gap-4 min-w-0">
              <div className="card overflow-hidden">
                {module.youtubeId ? (
                  <div className="relative w-full" style={{ aspectRatio: "16 / 9", background: "#000" }}>
                    <iframe
                      key={module.youtubeId}
                      className="absolute inset-0 w-full h-full"
                      src={youtubeEmbedUrl(module.youtubeId)}
                      title={module.title}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      allowFullScreen
                    />
                  </div>
                ) : (
                  <div className="p-6 dim text-[13px]">La vidéo de ce module n&apos;est pas disponible.</div>
                )}
                <div className="p-4 sm:p-5 flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="label-xs mb-1">Module {index + 1}</div>
                    <h2 className="text-[20px] font-semibold leading-tight">{module.title}</h2>
                    {module.summary && <p className="muted text-[13.5px] mt-1.5 leading-relaxed">{module.summary}</p>}
                  </div>
                  {(data.student || !data.isAdmin) && (
                    <button
                      className={`btn btn-sm shrink-0 ${completed.has(module.id) ? "" : "btn-primary"}`}
                      disabled={busy}
                      onClick={() => void toggleDone(module)}
                      style={completed.has(module.id) ? { color: "var(--emerald)", borderColor: "var(--emerald)" } : undefined}
                    >
                      {completed.has(module.id) ? "✓ Terminé" : "Marquer comme terminé"}
                    </button>
                  )}
                  {data.isAdmin && !data.student && (
                    <Link href={`/formation/modules?edit=${module.id}`} className="btn btn-sm btn-ghost shrink-0">
                      Modifier ce module
                    </Link>
                  )}
                </div>
              </div>

              {module.annex.trim() && (
                <Card title="Annexe du module">
                  <Annex text={module.annex} />
                </Card>
              )}

              {module.objections.length > 0 && (
                <Card title="Objections qui reviennent souvent" subtitle="Ce que tes clients vont te dire, et comment y répondre.">
                  <div className="flex flex-col gap-2">
                    {module.objections.map((o) => (
                      <details key={o.id} className="card-flat px-4 py-3 group">
                        <summary className="cursor-pointer text-[14px] font-medium flex items-start gap-2 list-none">
                          <span className="shrink-0 mt-[2px] text-[12px]" style={{ color: "var(--text-3)" }}>
                            ▸
                          </span>
                          <span>« {o.question} »</span>
                        </summary>
                        {o.answer ? (
                          <div className="mt-2 pl-5">
                            <Annex text={o.answer} />
                          </div>
                        ) : (
                          <div className="mt-2 pl-5 dim text-[13px]">Réponse à venir.</div>
                        )}
                      </details>
                    ))}
                  </div>
                </Card>
              )}

              {/* Navigation entre modules, sous le contenu : la ou l'on arrive en fin de lecture. */}
              <div className="flex items-center justify-between gap-2">
                <button className="btn btn-sm btn-ghost" disabled={!prev} onClick={() => prev && setCurrent(prev.id)}>
                  ← {prev ? prev.title : "Précédent"}
                </button>
                <button className="btn btn-sm" disabled={!next} onClick={() => next && setCurrent(next.id)}>
                  {next ? next.title : "Suivant"} →
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
