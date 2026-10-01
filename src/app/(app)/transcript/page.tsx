"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { formatBytes, takeFiles, uploadFile } from "@/lib/upload-client";
import { Card, InfoNote, PageHeader, useToast } from "@/components/ui";

/**
 * Transcript.
 *
 * Une video deposee (mp4, mov, ou un simple audio) ressort en texte complet,
 * mot pour mot, mis en paragraphes. Si elle est en anglais, un bouton la
 * traduit en francais. Le dernier resultat reste dans le navigateur, pour ne
 * pas le perdre sur un rechargement.
 *
 * Tout ce qui est long (transcription, traduction) tourne en tache de fond
 * cote serveur ; la page suit l'avancement toutes les 3 s.
 */

const KEY = "princexd:transcript";

interface Result {
  text: string;
  language: "fr" | "en" | "autre";
  model: string;
  sizeMb: number;
}

interface Saved {
  name: string;
  result: Result;
  translation?: string;
}

const ACCEPT = /\.(mp4|mov|m4v|webm|mkv|avi|mp3|m4a|wav|aac|ogg)$/i;

/** Suit une tache de fond jusqu'au resultat ; tolere les 502 passagers de Cloudflare. */
async function followJob<T>(jobId: string, onStep: (step: string, elapsed: number) => void): Promise<T> {
  let failures = 0;
  for (;;) {
    await new Promise((r) => setTimeout(r, 3000));
    const res = await fetch(`/api/transcript?job=${encodeURIComponent(jobId)}`, { cache: "no-store" }).catch(() => null);
    const body = res ? ((await res.json().catch(() => null)) as { status?: string; step?: string; elapsed?: number; result?: T; error?: string } | null) : null;
    if (!res || (res.status >= 500 && body?.status !== "error")) {
      if (++failures > 10) throw new Error(res ? `Erreur ${res.status}` : "connexion perdue");
      continue;
    }
    if (!res.ok || !body) throw new Error(body?.error ?? `Erreur ${res.status}`);
    failures = 0;
    if (body.status === "done" && body.result) return body.result;
    onStep(body.step ?? "", body.elapsed ?? 0);
  }
}

function download(name: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export default function TranscriptPage() {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [status, setStatus] = useState<{ text: string; error?: boolean; busy?: boolean } | null>(null);
  const [translating, setTranslating] = useState(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setSaved(JSON.parse(raw) as Saved);
    } catch {
      /* navigateur sans stockage : on repart de zero */
    }
  }, []);

  const persist = (next: Saved | null) => {
    setSaved(next);
    try {
      if (next) localStorage.setItem(KEY, JSON.stringify(next));
      else localStorage.removeItem(KEY);
    } catch {
      /* sans consequence */
    }
  };

  const handle = async (file: File) => {
    if (!ACCEPT.test(file.name) && !file.type.startsWith("video/") && !file.type.startsWith("audio/")) {
      setStatus({ text: "Dépose une vidéo (mp4, mov, webm…) ou un audio (mp3, m4a, wav).", error: true });
      return;
    }
    try {
      setStatus({ text: `Envoi de ${file.name} (${formatBytes(file.size)})… 0 %`, busy: true });
      const up = await uploadFile(file, (f) => setStatus({ text: `Envoi de ${file.name} (${formatBytes(file.size)})… ${Math.round(f * 100)} %`, busy: true }));
      setStatus({ text: "Vidéo reçue, lancement de la transcription…", busy: true });
      const { jobId } = await api<{ jobId: string }>("/api/transcript", { method: "POST", body: JSON.stringify({ url: up.url }) });
      const result = await followJob<Result>(jobId, (step, s) => setStatus({ text: `${step} ${s} s`, busy: true }));
      persist({ name: file.name, result });
      setStatus({ text: `Transcript prêt (${result.model}, ${result.text.split(/\s+/).length} mots).` });
      toast("Transcript prêt.");
    } catch (e) {
      setStatus({ text: `Échec : ${(e as Error).message}`, error: true });
    }
  };

  const translate = async () => {
    if (!saved) return;
    setTranslating(true);
    setStatus({ text: "Traduction en français…", busy: true });
    try {
      const { jobId } = await api<{ jobId: string }>("/api/transcript", { method: "POST", body: JSON.stringify({ action: "translate", text: saved.result.text }) });
      const out = await followJob<{ text: string }>(jobId, (step, s) => setStatus({ text: `${step} ${s} s`, busy: true }));
      persist({ ...saved, translation: out.text });
      setStatus({ text: "Traduction prête, en dessous du transcript." });
      toast("Traduction prête.");
    } catch (e) {
      setStatus({ text: `Traduction impossible : ${(e as Error).message}`, error: true });
    } finally {
      setTranslating(false);
    }
  };

  // Ctrl+V d'une video copiee depuis l'explorateur.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("video/") || f.type.startsWith("audio/"));
      if (!files.length) return;
      e.preventDefault();
      void handle(files[0]);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copié.");
    } catch {
      toast("Copie impossible : sélectionne le texte à la main.");
    }
  };

  const busy = Boolean(status?.busy);
  const baseName = saved ? saved.name.replace(/\.[^.]+$/, "") : "transcript";

  return (
    <>
      <PageHeader title="Transcript" subtitle="Dépose une vidéo : tu récupères tout ce qui est dit, mot pour mot. En anglais ? Un clic pour la traduire en français." />

      <div className="flex flex-col gap-4">
        <Card title="Vidéo" subtitle="mp4, mov, webm ou un audio. Les gros fichiers passent aussi : seul le son est envoyé à la transcription.">
          <div
            className="rounded-[12px] p-6 sm:p-8 text-center cursor-pointer"
            style={{
              border: `2px dashed ${dragging ? "var(--accent)" : "var(--border)"}`,
              background: dragging ? "color-mix(in srgb, var(--accent) 8%, transparent)" : "var(--surface-2)",
            }}
            onClick={() => !busy && inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const f = Array.from(e.dataTransfer.files)[0];
              if (f && !busy) void handle(f);
            }}
          >
            <div className="text-[15px] font-medium">Glisse ta vidéo ici, clique pour la choisir, ou Ctrl+V</div>
            <div className="dim text-[12.5px] mt-1.5">Transcription mot pour mot avec le modèle le plus précis d&apos;OpenAI. Compte 1 à 3 minutes selon la durée.</div>
            <input
              ref={inputRef}
              type="file"
              accept="video/*,audio/*,.mp4,.mov,.m4v,.webm,.mkv,.avi,.mp3,.m4a,.wav"
              className="hidden"
              onChange={async (e) => {
                const [f] = await takeFiles(e.currentTarget);
                if (f) void handle(f);
              }}
            />
          </div>

          {status && (
            <div
              className="rounded-[10px] px-3.5 py-2.5 mt-3 text-[13px] flex items-center gap-2"
              style={{
                background: status.error ? "color-mix(in srgb, var(--critical) 10%, transparent)" : "color-mix(in srgb, var(--accent) 10%, transparent)",
                border: `1px solid ${status.error ? "color-mix(in srgb, var(--critical) 40%, transparent)" : "color-mix(in srgb, var(--accent) 35%, transparent)"}`,
              }}
            >
              {status.busy && <span className="spinner" />}
              {status.text}
            </div>
          )}
        </Card>

        {saved && (
          <Card
            title={
              <span className="flex items-center gap-2 flex-wrap">
                Transcript
                <span className="text-[11px] font-medium rounded-full px-2 py-0.5" style={{ background: "var(--surface-3)", border: "1px solid var(--border)", color: "var(--text-2)" }}>
                  {saved.result.language === "en" ? "anglais" : saved.result.language === "fr" ? "français" : "langue à vérifier"}
                </span>
              </span>
            }
            subtitle={`${saved.name} · ${saved.result.text.split(/\s+/).length} mots`}
            actions={
              <>
                <button className="btn" onClick={() => void copy(saved.result.text)}>Copier</button>
                <button className="btn" onClick={() => download(`${baseName}-transcript.txt`, saved.result.text)}>⬇ .txt</button>
                {saved.result.language !== "fr" && (
                  <button className="btn btn-primary" onClick={() => void translate()} disabled={translating || busy}>
                    {translating ? <span className="spinner" /> : "Traduire en français"}
                  </button>
                )}
                {saved.result.language === "fr" && !saved.translation && (
                  <button className="btn btn-ghost" onClick={() => void translate()} disabled={translating || busy} title="Si la langue a été mal détectée">
                    Traduire quand même
                  </button>
                )}
                <button className="btn btn-ghost" onClick={() => persist(null)} disabled={busy}>Effacer</button>
              </>
            }
          >
            <textarea className="input w-full text-[14px] leading-relaxed" readOnly value={saved.result.text} style={{ minHeight: 320, resize: "vertical", whiteSpace: "pre-wrap" }} />
          </Card>
        )}

        {saved?.translation && (
          <Card
            title="Traduction française"
            actions={
              <>
                <button className="btn" onClick={() => void copy(saved.translation!)}>Copier</button>
                <button className="btn" onClick={() => download(`${baseName}-traduction.txt`, saved.translation!)}>⬇ .txt</button>
              </>
            }
          >
            <textarea className="input w-full text-[14px] leading-relaxed" readOnly value={saved.translation} style={{ minHeight: 320, resize: "vertical", whiteSpace: "pre-wrap" }} />
          </Card>
        )}

        {!saved && (
          <InfoNote>
            Le transcript garde les tics de langage et les hésitations : c&apos;est voulu, il est fidèle à ce qui est dit. Pour une vidéo muette ou seulement musicale, tu auras un message « aucune parole détectée ».
          </InfoNote>
        )}
      </div>
    </>
  );
}
