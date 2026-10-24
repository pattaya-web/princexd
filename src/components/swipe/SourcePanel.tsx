"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { CopyButton, ErrorNote, Field, useToast } from "@/components/ui";
import type { Swipe } from "@/lib/types";

/**
 * Onglet Source : d'où vient la transcription, et comment l'obtenir.
 *
 * Trois voies, toujours proposées, jamais mélangées : récupération
 * automatique de l'audio (quand la plateforme le permet), import d'un
 * fichier vidéo ou audio, ou texte collé à la main. La légende n'est jamais
 * prise pour une transcription. Dès qu'un texte exploitable existe, le
 * bouton « Lancer l'analyse » classe le Reel.
 */
export function SourcePanel({
  s,
  busy,
  onPatch,
  onAnalyze,
}: {
  s: Swipe;
  /** Phase en cours pour cette fiche (transcription, analyse…) pilotée par la page. */
  busy: string;
  onPatch: (p: Partial<Swipe>) => Promise<void>;
  onAnalyze: () => Promise<void>;
}) {
  const toast = useToast();
  const [transcript, setTranscript] = useState(s.transcriptInput ?? "");
  const [screenText, setScreenText] = useState(s.screenTextInput ?? "");
  const [transcribing, setTranscribing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const loadedFor = useRef(s.id);

  useEffect(() => {
    if (loadedFor.current === s.id) return;
    loadedFor.current = s.id;
    setTranscript(s.transcriptInput ?? "");
    setScreenText(s.screenTextInput ?? "");
    setError("");
  }, [s.id, s.transcriptInput, s.screenTextInput]);

  // Texte reçu d'ailleurs (transcription auto lancée par la page) : on l'affiche.
  useEffect(() => {
    if (s.transcriptInput && s.transcriptInput !== transcript && !transcript.trim()) setTranscript(s.transcriptInput);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.transcriptInput]);

  const saveManual = async () => {
    const changed = transcript !== (s.transcriptInput ?? "") || screenText !== (s.screenTextInput ?? "");
    if (!changed) return;
    await onPatch({
      transcriptInput: transcript,
      screenTextInput: screenText,
      transcriptSource: transcript.trim() ? (s.transcriptSource && transcript === s.transcriptInput ? s.transcriptSource : "manual") : "",
      transcriptNeeded: !transcript.trim(),
    });
  };

  const transcribeAuto = async () => {
    setTranscribing(true);
    setError("");
    try {
      const r = await api<{ transcript: string }>("/api/ai/transcribe-url", { job: true, method: "POST", body: JSON.stringify({ url: s.url }), timeoutMs: 300_000 });
      setTranscript(r.transcript);
      await onPatch({ transcriptInput: r.transcript, transcriptSource: "auto", transcriptNeeded: false });
      toast("Transcription récupérée. Relis-la, puis lance l'analyse.");
    } catch (e) {
      await onPatch({ transcriptNeeded: true });
      setError(`Récupération automatique impossible : ${(e as Error).message} Importe la vidéo (fichier) ou colle le texte des paroles.`);
    } finally {
      setTranscribing(false);
    }
  };

  const uploadFile = async (file: File) => {
    setUploading(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file, file.name);
      form.append("swipeId", s.id);
      const res = await fetch("/api/ai/transcribe-file", { method: "POST", body: form });
      const body = (await res.json().catch(() => ({}))) as { transcript?: string; error?: string };
      if (!res.ok || !body.transcript) throw new Error(body.error ?? `Erreur ${res.status}`);
      setTranscript(body.transcript);
      await onPatch({ transcriptInput: body.transcript, transcriptSource: "file", transcriptNeeded: false });
      toast("Fichier transcrit. Relis, puis lance l'analyse.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const translate = async () => {
    if (!transcript.trim()) return;
    setTranslating(true);
    setError("");
    try {
      // La traduction tourne en fond sur le serveur : on l'interroge toutes les 2 s
      // (aucune requete longue, donc le proxy ne peut plus la couper en 502).
      const { jobId } = await api<{ jobId: string }>("/api/swipe/translate", { method: "POST", body: JSON.stringify({ swipeId: s.id, text: transcript }), timeoutMs: 30_000 });
      const deadline = Date.now() + 4 * 60_000;
      let r: { fr: string; language: string } | null = null;
      while (!r) {
        await new Promise((res) => setTimeout(res, 2_000));
        if (Date.now() > deadline) throw new Error("La traduction n'a pas abouti en 4 minutes. Réessaie dans un instant.");
        let st: { state: string; fr?: string; language?: string };
        try {
          st = await api<typeof st>(`/api/swipe/translate?job=${jobId}`, { timeoutMs: 20_000 });
        } catch (e) {
          // Coupure passagere (reseau, proxy) : on continue d'interroger, le job tourne toujours.
          if (/serveur a été interrompu|Connexion au serveur impossible|n'a pas répondu/.test((e as Error).message)) continue;
          throw e;
        }
        if (st.state === "done" && st.fr) r = { fr: st.fr, language: st.language ?? "" };
      }
      const original = s.transcriptSourceInput || transcript;
      setTranscript(r.fr);
      await onPatch({ transcriptInput: r.fr, transcriptSourceInput: r.fr !== original ? original : s.transcriptSourceInput, transcriptLang: r.language });
      toast(r.language && !r.language.startsWith("fr") ? `Traduit depuis « ${r.language} ». L'original reste sous le texte.` : "Déjà en français : juste nettoyé.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTranslating(false);
    }
  };

  const sourceLabel = s.transcriptSource === "auto" ? "récupérée automatiquement" : s.transcriptSource === "file" ? "transcrite depuis ton fichier" : s.transcriptSource === "manual" ? "collée à la main" : "";
  const locked = Boolean(busy) || transcribing || uploading || translating;

  return (
    <div className="flex flex-col gap-4">
      {!transcript.trim() && (
        <div className="card-flat p-3.5" style={{ borderColor: "color-mix(in srgb, var(--warning) 45%, transparent)" }}>
          <div className="text-[13.5px] font-semibold" style={{ color: "var(--warning)" }}>
            Transcription nécessaire
          </div>
          <p className="dim text-[12.5px] mt-1 leading-relaxed">
            Pour classer et scripter ce Reel, il faut ses paroles. La légende Instagram ne compte pas. Trois façons de l&apos;obtenir :
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            <button className="btn btn-sm btn-primary" disabled={locked} onClick={() => void transcribeAuto()} title="Tente de récupérer l'audio du Reel et de le transcrire (Instagram bloque souvent depuis le serveur)">
              {transcribing ? <span className="spinner" /> : "≡"} {transcribing ? "Transcription…" : "Récupérer automatiquement"}
            </button>
            <button className="btn btn-sm" disabled={locked} onClick={() => fileRef.current?.click()}>
              {uploading ? <span className="spinner" /> : "⬆"} {uploading ? "Transcription du fichier…" : "Importer la vidéo ou l'audio"}
            </button>
            <span className="dim text-[12px] self-center">ou colle le texte ci-dessous</span>
          </div>
        </div>
      )}
      <input ref={fileRef} type="file" accept=".mp4,.mov,.m4a,.mp3,.wav,.webm,video/*,audio/*" className="hidden" onChange={(e) => e.target.files?.[0] && void uploadFile(e.target.files[0])} />

      {s.caption && (
        <details className="card-flat px-3 py-2">
          <summary className="cursor-pointer text-[12.5px] dim">Légende du post (pour info, ce n&apos;est pas la transcription)</summary>
          <p className="prose-sm mt-2 whitespace-pre-line">{s.caption}</p>
        </details>
      )}

      <Field label={`Transcription${sourceLabel ? ` · ${sourceLabel}` : ""}`} hint="Les paroles telles quelles, même avec les hésitations. Relis et corrige si besoin : rien n'est modifié en douce.">
        <textarea className="textarea" style={{ minHeight: 200 }} value={transcript} onChange={(e) => setTranscript(e.target.value)} onBlur={() => void saveManual()} placeholder="Colle ici tout ce qui est dit dans la vidéo…" />
      </Field>
      <div className="flex items-center gap-2 flex-wrap -mt-1.5">
        {transcript.trim() && <CopyButton text={transcript} label="Copier le texte" />}
        {transcript.trim() && (
          <button className="btn btn-sm" disabled={locked} onClick={() => void transcribeAuto()} title="Retente la récupération automatique (remplace le texte)">
            Récupérer à nouveau
          </button>
        )}
        {transcript.trim() && (
          <button className="btn btn-sm" disabled={locked} onClick={() => fileRef.current?.click()}>
            Importer un fichier
          </button>
        )}
        <button className="btn btn-sm" disabled={locked || !transcript.trim()} onClick={() => void translate()} title="Contenu dans une autre langue : traduction fidèle en français, l'original reste accessible">
          {translating ? <span className="spinner" /> : "🌐"} Traduire en français
        </button>
        {s.transcriptSourceInput && (
          <details className="text-[12px]">
            <summary className="cursor-pointer dim">Original{s.transcriptLang ? ` (${s.transcriptLang})` : ""}</summary>
            <p className="prose-sm mt-2 whitespace-pre-line">{s.transcriptSourceInput}</p>
          </details>
        )}
      </div>

      <Field label="Texte à l'écran (optionnel)" hint="Les textes incrustés, s'il y en a : ils aident le classement.">
        <textarea className="textarea" style={{ minHeight: 60 }} value={screenText} onChange={(e) => setScreenText(e.target.value)} onBlur={() => void saveManual()} placeholder="Ex. « 3 erreurs qui tuent ton ROAS »" />
      </Field>

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="dim text-[12px]">{s.analysis ? "Déjà analysé : relance si tu as corrigé la transcription." : "L'analyse classe le Reel (TOFU / MOFU / BOFU) et explique pourquoi."}</span>
        <button
          className="btn btn-primary"
          disabled={locked || !transcript.trim()}
          onClick={async () => {
            await saveManual();
            await onAnalyze();
          }}
        >
          {busy === "Analyse…" ? <span className="spinner" /> : "✦"} {busy === "Analyse…" ? "Analyse en cours…" : s.analysis ? "Relancer l'analyse" : "Lancer l'analyse"}
        </button>
      </div>
    </div>
  );
}
