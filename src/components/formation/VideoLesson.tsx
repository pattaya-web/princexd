"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { useToast } from "@/components/ui";
import { SectionLabel } from "./portal";
import { youtubeEmbedUrl, youtubeId } from "@/lib/formation";
import { parseVideoSteps } from "@/lib/formation-methode";
import type { MethodPayload } from "@/app/api/formation/methode/route";
import type { StudentMethodSettings } from "@/lib/types";

/** Une leçon vidéo de Scale X : le lien YouTube, un résumé replié, les étapes à suivre. */
export interface VideoLessonValue {
  url: string;
  summary: string;
  steps: string;
}

/** Les trois leçons vidéo portées par les réglages « méthode » : boutique, créatives, Meta. */
export type VideoLessonKey = "shop" | "creatives" | "meta";

const FIELDS: Record<VideoLessonKey, { url: keyof StudentMethodSettings; summary: keyof StudentMethodSettings; steps: keyof StudentMethodSettings }> = {
  shop: { url: "shopVideoUrl", summary: "shopVideoSummary", steps: "shopVideoSteps" },
  creatives: { url: "creativesVideoUrl", summary: "creativesVideoSummary", steps: "creativesVideoSteps" },
  meta: { url: "metaVideoUrl", summary: "metaVideoSummary", steps: "metaVideoSteps" },
};

export function lessonOf(m: StudentMethodSettings, key: VideoLessonKey): VideoLessonValue {
  const f = FIELDS[key];
  return { url: String(m[f.url] ?? ""), summary: String(m[f.summary] ?? ""), steps: String(m[f.steps] ?? "") };
}

/**
 * Bloc « vidéo + résumé + étapes » d'une page Scale X.
 *
 * La vidéo en grand, le résumé replié (un clic pour l'ouvrir), puis les
 * étapes numérotées comme Mady les dit dans la vidéo. L'admin modifie les
 * trois champs sur place (« Modifier la vidéo »). Un élève ne voit rien tant
 * qu'il n'y a ni vidéo ni texte, sauf si `placeholder` est donné : il voit
 * alors que la vidéo arrive.
 */
export function VideoLesson({
  n,
  title,
  intro,
  value,
  isAdmin,
  onSave,
  placeholder,
}: {
  n: string;
  title: string;
  intro: string;
  value: VideoLessonValue;
  isAdmin: boolean;
  onSave?: (v: VideoLessonValue) => Promise<void>;
  placeholder?: string;
}) {
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState<VideoLessonValue>(value);
  const [saving, setSaving] = useState(false);
  const vid = youtubeId(value.url);
  const steps = parseVideoSteps(value.steps);
  const paras = value.summary.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const empty = !value.url && paras.length === 0 && steps.length === 0;

  if (empty && !isAdmin && !placeholder) return null;

  const save = async () => {
    if (!onSave) return;
    setSaving(true);
    try {
      await onSave({ url: draft.url.trim(), summary: draft.summary.trim(), steps: draft.steps.trim() });
      setEdit(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionLabel n={n} title={title} />
        {isAdmin && onSave && !edit && (
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              setDraft(value);
              setEdit(true);
            }}
          >
            Modifier la vidéo
          </button>
        )}
      </div>
      {intro && <p className="muted text-[13.5px] mt-3 leading-relaxed max-w-[64ch]">{intro}</p>}

      {edit && (
        <div className="mt-4 flex flex-col gap-3 rounded-md p-3.5" style={{ background: "var(--surface-2)" }}>
          <label className="flex flex-col gap-1">
            <span className="label-xs">Lien YouTube (vide = pas de vidéo)</span>
            <input className="input" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} placeholder="https://youtu.be/…" inputMode="url" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="label-xs">Résumé (replié sous la vidéo ; une ligne vide = nouveau paragraphe)</span>
            <textarea className="input" rows={6} value={draft.summary} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} placeholder="Ce que Mady explique dans la vidéo, en quelques phrases." />
          </label>
          <label className="flex flex-col gap-1">
            <span className="label-xs">Les étapes de la vidéo (une par ligne, « Titre : détail »)</span>
            <textarea className="input" rows={10} value={draft.steps} onChange={(e) => setDraft({ ...draft, steps: e.target.value })} placeholder={"Ouvre le gestionnaire de publicités : …\nCrée ta campagne : …"} style={{ fontFamily: "inherit" }} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving}>
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setEdit(false)} disabled={saving}>
              Annuler
            </button>
          </div>
        </div>
      )}

      {vid ? (
        <div className="relative w-full mt-4 rounded-md overflow-hidden" style={{ aspectRatio: "16 / 9", background: "#000" }}>
          <iframe
            key={vid}
            className="absolute inset-0 w-full h-full"
            src={youtubeEmbedUrl(vid)}
            title={title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        </div>
      ) : value.url ? (
        <a href={value.url} target="_blank" rel="noreferrer" className="btn btn-primary btn-sm mt-4">
          Voir la vidéo ↗
        </a>
      ) : (
        <div className="mt-4 rounded-md px-4 py-6 text-center dim text-[13px]" style={{ background: "var(--surface-2)" }}>
          {isAdmin ? "Pas encore de vidéo : « Modifier la vidéo » pour coller le lien YouTube." : placeholder || "La vidéo arrive bientôt."}
        </div>
      )}

      {paras.length > 0 && (
        <details className="mt-4 rounded-md" style={{ border: "1px solid var(--border)" }}>
          <summary className="cursor-pointer list-none px-3.5 py-2.5 flex items-center gap-2 text-[13.5px] font-medium select-none">
            <span className="label-xs">En résumé</span>
            <span className="dim text-[12px] font-normal">ce que Mady explique dans la vidéo</span>
            <span className="ml-auto dim text-[12px]">▾ ouvrir</span>
          </summary>
          <div className="flex flex-col gap-2 px-3.5 pb-3.5 text-[13.5px] leading-relaxed max-w-[70ch]">
            {paras.map((p, i) => (
              <p key={i} className="whitespace-pre-wrap">
                {p}
              </p>
            ))}
          </div>
        </details>
      )}

      {steps.length > 0 && (
        <div className="mt-4">
          <div className="label-xs">Les étapes à suivre, comme dans la vidéo</div>
          <div className="flex flex-col mt-1">
            {steps.map((s, i) => (
              <div key={`${i}-${s.title}`} className="flex gap-3.5 py-3 border-b last:border-b-0" style={{ borderColor: "var(--border)" }}>
                <div className="shrink-0 w-[28px] h-[28px] rounded-md flex items-center justify-center text-[12.5px] font-bold" style={{ background: "var(--accent)", color: "var(--accent-on)" }}>
                  {i + 1}
                </div>
                <div className="min-w-0">
                  <div className="text-[14px] font-semibold leading-snug">{s.title}</div>
                  {s.text && <div className="muted text-[13px] mt-0.5 leading-relaxed">{s.text}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * La même chose, branchée sur les réglages « méthode » : charge la leçon
 * (`/api/formation/methode`), et l'admin l'enregistre sans quitter la page.
 */
export function MethodVideoLesson({ lesson, n, title, intro, placeholder }: { lesson: VideoLessonKey; n: string; title: string; intro: string; placeholder?: string }) {
  const toast = useToast();
  const [data, setData] = useState<MethodPayload | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<MethodPayload>("/api/formation/methode"));
    } catch {
      /* la page principale affiche deja son erreur */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!data) return null;
  const f = FIELDS[lesson];

  const save = async (v: VideoLessonValue) => {
    try {
      const r = await api<{ method: StudentMethodSettings }>("/api/formation/methode", {
        method: "PATCH",
        body: JSON.stringify({ ...data.method, [f.url]: v.url, [f.summary]: v.summary, [f.steps]: v.steps }),
      });
      setData({ ...data, method: r.method });
      toast("Vidéo enregistrée : les élèves la voient.");
    } catch (e) {
      toast((e as Error).message, "err");
      throw e;
    }
  };

  return <VideoLesson n={n} title={title} intro={intro} value={lessonOf(data.method, lesson)} isAdmin={data.isAdmin} onSave={save} placeholder={placeholder} />;
}
