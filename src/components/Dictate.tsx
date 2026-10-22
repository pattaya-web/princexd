"use client";

import { useEffect, useRef, useState } from "react";
import { useToast } from "./ui";

/**
 * Dictée vocale pour les zones de prompt (Studio IA).
 *
 * Reconnaissance du navigateur (Chrome, Edge, Safari) en français, texte
 * inséré au fil de la parole. Si le navigateur ne sait pas faire, on
 * enregistre le micro et on transcrit côté serveur (OpenAI, même route que
 * l'import de fichier). Dans les deux cas rien n'est envoyé tant que tu
 * n'appuies pas, et le texte s'ajoute à ce qui est déjà écrit.
 */

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

function recognitionCtor(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function DictateButton({ onText, disabled, className = "", label = "Dicter" }: { onText: (text: string) => void; disabled?: boolean; className?: string; label?: string }) {
  const toast = useToast();
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const recRef = useRef<Recognition | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(
    () => () => {
      recRef.current?.stop();
      mediaRef.current?.stop();
    },
    [],
  );

  const stop = () => {
    if (recRef.current) {
      recRef.current.stop();
      recRef.current = null;
    }
    if (mediaRef.current && mediaRef.current.state !== "inactive") mediaRef.current.stop();
    setListening(false);
  };

  const startNative = (Ctor: new () => Recognition) => {
    const rec = new Ctor();
    rec.lang = "fr-FR";
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) {
          const t = r[0].transcript.trim();
          if (t) onText(t);
        }
      }
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed") toast("Micro refusé : autorise-le dans ton navigateur.", "err");
      else if (e.error !== "aborted" && e.error !== "no-speech") toast(`Dictée interrompue : ${e.error}`, "err");
      setListening(false);
      recRef.current = null;
    };
    rec.onend = () => {
      setListening(false);
      recRef.current = null;
    };
    recRef.current = rec;
    rec.start();
    setListening(true);
  };

  const startRecorder = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "";
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      mr.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
        if (!blob.size) return;
        setBusy(true);
        try {
          const form = new FormData();
          form.append("file", blob, mr.mimeType.includes("mp4") ? "dictee.mp4" : "dictee.webm");
          const res = await fetch("/api/ai/transcribe-file", { method: "POST", body: form });
          const body = (await res.json().catch(() => ({}))) as { transcript?: string; error?: string };
          if (!res.ok || !body.transcript) throw new Error(body.error ?? `Erreur ${res.status}`);
          onText(body.transcript.trim());
        } catch (e) {
          toast(`Transcription impossible : ${(e as Error).message}`, "err");
        } finally {
          setBusy(false);
        }
      };
      mediaRef.current = mr;
      mr.start();
      setListening(true);
    } catch {
      toast("Micro indisponible : autorise-le dans ton navigateur.", "err");
    }
  };

  const toggle = () => {
    if (listening) return stop();
    const Ctor = recognitionCtor();
    if (Ctor) startNative(Ctor);
    else void startRecorder();
  };

  return (
    <button
      type="button"
      className={`btn btn-sm ${listening ? "btn-primary" : ""} ${className}`}
      onClick={toggle}
      disabled={disabled || busy}
      title={listening ? "Arrêter la dictée" : "Dicter au lieu d'écrire (français)"}
      style={listening ? { animation: "pulse 1.2s ease-in-out infinite" } : undefined}
    >
      {busy ? <span className="spinner" /> : listening ? "■ Stop" : `🎤 ${label}`}
    </button>
  );
}
