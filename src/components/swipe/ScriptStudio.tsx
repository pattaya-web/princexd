"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, useCollection, useDebouncedSave } from "@/lib/client";
import { fmtDateTime } from "@/lib/format";
import { CopyButton, Field, useToast } from "@/components/ui";
import { SWIPE_PROD_LABEL, swipeProdStatus, swipeStage, type EditJob, type Swipe, type SwipeProdStatus, type SwipeScript } from "@/lib/types";
import { Block } from "./panels";
import { editJobFromSwipe } from "@/lib/swipe-edit-job";

const EMPTY_SCRIPT: SwipeScript = { hook: "", bullets: [], cta: "", message: "", broll: [], mode: "adapt", screenText: [], durationSec: 30, speakers: "solo", generatedAt: "", updatedAt: "" };

/**
 * « Générer mon script » : A. la transcription source (jamais modifiée en
 * douce), B. pourquoi ce Reel est intéressant, C. mon script Scale X,
 * éditable et sauvegardé tout seul. « Ajouter à mon tournage » envoie la
 * fiche dans Mes prochains tournages ; le dossier de montage se crée ici
 * avec la référence et le brief, pour que le monteur n'ait rien à chercher.
 */
export function ScriptStudio({
  s,
  onPatch,
  onGenerated,
  onStatus,
}: {
  s: Swipe;
  onPatch: (patch: Partial<Swipe>) => Promise<void>;
  onGenerated: (script: SwipeScript, status: SwipeProdStatus, dates: Swipe["prodDates"]) => void;
  onStatus: (status: SwipeProdStatus) => Promise<void>;
}) {
  const toast = useToast();
  const edits = useCollection<EditJob>("edits");
  const [script, setScript] = useState<SwipeScript>(s.script ?? EMPTY_SCRIPT);
  const [bulletsText, setBulletsText] = useState((s.script?.bullets ?? []).join("\n"));
  const [brollText, setBrollText] = useState((s.script?.broll ?? []).join("\n"));
  const [screenTextRaw, setScreenTextRaw] = useState((s.script?.screenText ?? []).join("\n"));
  const [mode, setMode] = useState<"adapt" | "verbatim">(s.script?.mode ?? "adapt");
  const [generating, setGenerating] = useState(false);
  const [savedAt, setSavedAt] = useState("");
  const [creatingJob, setCreatingJob] = useState(false);
  const [sending, setSending] = useState(false);
  const loadedFor = useRef(s.id);

  useEffect(() => {
    if (loadedFor.current === s.id) return;
    loadedFor.current = s.id;
    const sc = s.script ?? EMPTY_SCRIPT;
    setScript(sc);
    setBulletsText((sc.bullets ?? []).join("\n"));
    setBrollText((sc.broll ?? []).join("\n"));
    setScreenTextRaw((sc.screenText ?? []).join("\n"));
    setMode(sc.mode ?? "adapt");
    setSavedAt("");
  }, [s.id, s.script]);

  const save = useDebouncedSave<SwipeScript>(async (value) => {
    await onPatch({ script: value });
    setSavedAt(new Date().toISOString());
  }, 700);

  const update = (patch: Partial<SwipeScript>, raw?: { bullets?: string; broll?: string; screen?: string }) => {
    const lines = (t: string) => t.split("\n").map((x) => x.trim()).filter(Boolean);
    const next: SwipeScript = {
      ...script,
      ...patch,
      bullets: raw?.bullets !== undefined ? lines(raw.bullets) : (patch.bullets ?? script.bullets),
      broll: raw?.broll !== undefined ? lines(raw.broll) : (patch.broll ?? script.broll ?? []),
      screenText: raw?.screen !== undefined ? lines(raw.screen) : (patch.screenText ?? script.screenText),
      updatedAt: new Date().toISOString(),
    };
    setScript(next);
    save(next);
  };

  const generate = async () => {
    setGenerating(true);
    try {
      const r = await api<{ script: SwipeScript; prodStatus: SwipeProdStatus; prodDates: Swipe["prodDates"] }>("/api/swipe/script", { method: "POST", body: JSON.stringify({ swipeId: s.id, mode }), timeoutMs: 120_000 });
      setScript(r.script);
      setBulletsText(r.script.bullets.join("\n"));
      setBrollText((r.script.broll ?? []).join("\n"));
      setScreenTextRaw(r.script.screenText.join("\n"));
      onGenerated(r.script, r.prodStatus, r.prodDates);
      window.dispatchEvent(new Event("swipes:changed"));
      toast(mode === "adapt" ? "Script Scale X généré. Relis, corrige : tout est sauvegardé." : "Script mis en forme mot pour mot.");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setGenerating(false);
    }
  };

  const toShoot = async () => {
    if (!script.hook.trim()) {
      toast("Écris ou génère d'abord le hook.", "err");
      return;
    }
    setSending(true);
    try {
      await onPatch({ script });
      await onStatus("a-tourner");
      toast("Ajouté à Mes prochains tournages.");
    } finally {
      setSending(false);
    }
  };

  const job = s.editJobId ? edits.rows.find((j) => j.id === s.editJobId) : undefined;
  const createJob = async () => {
    setCreatingJob(true);
    try {
      const created = await edits.create(editJobFromSwipe({ ...s, script }));
      await onPatch({ editJobId: created.id });
      toast("Dossier de montage créé avec la référence et le brief.");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setCreatingJob(false);
    }
  };

  const a = s.analysis;
  const source = (a?.transcriptFr || a?.transcriptOriginal || s.transcriptInput || "").trim();
  const copyAll = [script.hook, "", ...script.bullets.map((b) => `• ${b}`), "", script.cta].join("\n").trim();
  const words = `${script.hook} ${script.bullets.join(" ")} ${script.cta}`.trim().split(/\s+/).filter(Boolean).length;
  const estSec = Math.round(words / 2.5);
  const prod = swipeProdStatus(s);

  return (
    <div className="flex flex-col gap-5">
      {/* A */}
      <details className="card-flat px-3.5 py-2.5" open={!script.hook}>
        <summary className="cursor-pointer text-[13px] font-semibold">A · Transcription source{source ? "" : " (manquante)"}</summary>
        {source ? (
          <div className="mt-2">
            <div className="flex justify-end mb-1">
              <CopyButton text={source} />
            </div>
            <p className="prose-sm whitespace-pre-line leading-[1.8] text-[13px]">{source}</p>
          </div>
        ) : (
          <p className="dim text-[12.5px] mt-2">Onglet Source : importe la vidéo ou colle les paroles, puis lance l&apos;analyse.</p>
        )}
      </details>

      {/* B */}
      <div className="card-flat px-3.5 py-3">
        <div className="text-[13px] font-semibold mb-2">B · Pourquoi ce Reel est intéressant</div>
        {a ? (
          <div className="grid sm:grid-cols-2 gap-2.5 text-[12.5px]">
            <div>
              <span className="label-xs">Hook</span>
              <p className="mt-0.5 font-medium">{a.hook || "—"}</p>
            </div>
            <div>
              <span className="label-xs">Mécanique de rétention</span>
              <p className="mt-0.5">{a.whyItWorks?.[0] || a.hookType || "—"}</p>
            </div>
            <div>
              <span className="label-xs">Structure</span>
              <p className="mt-0.5">{a.structure || "—"}</p>
            </div>
            <div>
              <span className="label-xs">Émotion / objection</span>
              <p className="mt-0.5">{a.emotion || a.promise || "—"}</p>
            </div>
            <div>
              <span className="label-xs">Démonstration ou preuve</span>
              <p className="mt-0.5">{a.proof || "—"}</p>
            </div>
            <div>
              <span className="label-xs">CTA</span>
              <p className="mt-0.5">{a.cta || "aucun"}</p>
            </div>
          </div>
        ) : (
          <p className="dim text-[12.5px]">Lance l&apos;analyse (onglet Source) pour voir la mécanique du Reel.</p>
        )}
      </div>

      {/* C */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[13px] font-semibold">C · Mon script Scale X</span>
        <select className="select select-sm !w-auto" value={mode} onChange={(e) => setMode(e.target.value as "adapt" | "verbatim")} title="Adapté : mes mots, même mécanique. Mot pour mot : la vidéo est à moi, on remet juste en forme.">
          <option value="adapt">Adapté à mon positionnement</option>
          <option value="verbatim">Mot pour mot (vidéo à moi)</option>
        </select>
        <button className="btn btn-sm btn-primary" disabled={generating || !source} onClick={() => void generate()}>
          {generating ? <span className="spinner" /> : "✦"} {script.generatedAt || script.hook ? "Regénérer mon script" : "Générer mon script"}
        </button>
        {copyAll && <CopyButton text={copyAll} label="Copier tout" />}
        <span className="dim text-[12px] ml-auto">
          {savedAt ? `Enregistré ${fmtDateTime(savedAt).slice(-5)}` : script.generatedAt ? `Généré le ${fmtDateTime(script.generatedAt)}` : "Sauvegarde automatique"}
          {words ? ` · ${words} mots ≈ ${estSec} s` : ""}
        </span>
      </div>

      <div>
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <span className="label-xs">Hook</span>
          {script.hook && <CopyButton text={script.hook} />}
        </div>
        <textarea className="textarea w-full text-[14px] font-medium leading-relaxed" rows={2} value={script.hook} onChange={(e) => update({ hook: e.target.value })} placeholder="Les premières secondes : ce qui arrête le scroll." />
      </div>

      <div>
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <span className="label-xs">Corps · une idée par ligne{(script.speakers ?? a?.speakers) === "dialogue" ? " · A : / B :" : ""}</span>
          {script.bullets.length > 0 && <CopyButton text={script.bullets.map((b) => `• ${b}`).join("\n")} />}
        </div>
        <textarea
          className="textarea w-full leading-[1.9]"
          rows={Math.max(4, bulletsText.split("\n").length + 1)}
          value={bulletsText}
          onChange={(e) => {
            setBulletsText(e.target.value);
            update({}, { bullets: e.target.value });
          }}
          placeholder={"Naturel, parlé, une idée par ligne."}
        />
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Message central" hint="Ce que le spectateur doit retenir, en une phrase.">
          <input className="input" value={script.message ?? ""} onChange={(e) => update({ message: e.target.value })} />
        </Field>
        <Field label="CTA" hint={swipeStage(s) === "TOFU" ? "TOFU : pas de CTA commercial." : swipeStage(s) === "MOFU" ? "MOFU : question ou ressource." : swipeStage(s) === "BOFU" ? "BOFU : un seul appel à l'action." : "Adapté à la catégorie."}>
          <input className="input" value={script.cta} onChange={(e) => update({ cta: e.target.value })} />
        </Field>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="B-roll et preuves à afficher" hint="Une indication par ligne : écran, capture, chiffre, coulisses.">
          <textarea
            className="textarea w-full"
            rows={4}
            value={brollText}
            onChange={(e) => {
              setBrollText(e.target.value);
              update({}, { broll: e.target.value });
            }}
          />
        </Field>
        <div className="flex flex-col gap-3">
          <Field label="Texte écran" hint="Un texte par ligne, court.">
            <textarea
              className="textarea w-full"
              rows={2}
              value={screenTextRaw}
              onChange={(e) => {
                setScreenTextRaw(e.target.value);
                update({}, { screen: e.target.value });
              }}
            />
          </Field>
          <Field label="Durée cible (s)">
            <input className="input num" type="number" min={5} max={180} value={script.durationSec} onChange={(e) => update({ durationSec: Math.max(5, Math.round(Number(e.target.value) || 0)) })} />
          </Field>
        </div>
      </div>

      {script.message && <Block title="Aperçu lecture" text={[script.hook, "", ...script.bullets, "", script.cta].join("\n").trim()} />}

      <div className="card-flat p-3 flex items-center gap-2 flex-wrap">
        {prod === "source" || prod === "scripte" ? (
          <button className="btn btn-primary btn-sm" disabled={sending || !script.hook.trim()} onClick={() => void toShoot()}>
            {sending ? <span className="spinner" /> : "🎬"} Ajouter à mon tournage
          </button>
        ) : (
          <span className="badge badge-accent">{SWIPE_PROD_LABEL[prod]}</span>
        )}
        <Link href="/swipe/tournage" className="btn btn-sm btn-ghost">
          Mes prochains tournages
        </Link>
        <span className="flex-1" />
        <span className="label-xs">Dossier de montage</span>
        {job ? (
          <>
            <Link href="/montage" className="link text-[12.5px]">
              📁 {job.title}
            </Link>
            <span className="dim text-[12px]">· {job.status.replace(/-/g, " ")}</span>
            <button className="btn btn-sm btn-ghost" onClick={() => void onPatch({ editJobId: "" })}>
              Détacher
            </button>
          </>
        ) : (
          <button className="btn btn-sm" disabled={creatingJob || !script.hook.trim()} onClick={() => void createJob()} title="Crée le dossier avec la référence et le brief ; les rushs se déposent ensuite dans Espace monteur">
            {creatingJob ? <span className="spinner" /> : "+ Dossier monteur"}
          </button>
        )}
      </div>
    </div>
  );
}
