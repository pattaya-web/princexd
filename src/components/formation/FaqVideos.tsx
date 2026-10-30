"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { ErrorNote, Spinner, useToast } from "@/components/ui";
import { SectionLabel } from "./portal";
import { youtubeEmbedUrl } from "@/lib/formation";
import type { FaqPayload, FaqVideoRow } from "@/app/api/formation/faq/route";

/**
 * Questions rapides en vidéo (Ressources, Scale X) : la question telle que
 * les élèves la posent, et la vidéo de 5-10 min qui y répond, en taille
 * normale. Mady gère tout sur place : titre de la section, question, lien,
 * ordre, ajout, suppression. L'élève ne voit que les vidéos.
 */
export function FaqVideos() {
  const toast = useToast();
  const [data, setData] = useState<FaqPayload | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editTitle, setEditTitle] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; question: string; youtubeUrl: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ question: "", youtubeUrl: "" });

  const load = useCallback(async () => {
    try {
      setData(await api<FaqPayload>("/api/formation/faq"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (fn: () => Promise<FaqPayload>, ok?: string) => {
    setBusy(true);
    try {
      setData(await fn());
      if (ok) toast(ok);
      return true;
    } catch (e) {
      toast((e as Error).message, "err");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveTitle = async () => {
    if (editTitle === null) return;
    if (await run(() => api<FaqPayload>("/api/formation/faq", { method: "PATCH", body: JSON.stringify({ title: editTitle }) }), "Titre enregistré.")) setEditTitle(null);
  };

  const saveItem = async () => {
    if (!editing) return;
    if (await run(() => api<FaqPayload>("/api/formation/faq", { method: "PATCH", body: JSON.stringify(editing) }), "Question enregistrée.")) setEditing(null);
  };

  const add = async () => {
    if (await run(() => api<FaqPayload>("/api/formation/faq", { method: "POST", body: JSON.stringify(draft) }), "Vidéo ajoutée : les élèves la voient dès maintenant.")) {
      setAdding(false);
      setDraft({ question: "", youtubeUrl: "" });
    }
  };

  const move = (f: FaqVideoRow, dir: "up" | "down") => run(() => api<FaqPayload>("/api/formation/faq", { method: "PATCH", body: JSON.stringify({ id: f.id, move: dir }) }));

  const remove = async (f: FaqVideoRow) => {
    if (!window.confirm(`Retirer « ${f.question} » des ressources des élèves ?`)) return;
    await run(() => api<FaqPayload>("/api/formation/faq", { method: "DELETE", body: JSON.stringify({ id: f.id }) }), "Vidéo retirée.");
  };

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Spinner label="Chargement des questions rapides…" />;
  const { isAdmin } = data;
  if (!isAdmin && data.items.length === 0) return null;

  const form = (value: { question: string; youtubeUrl: string }, set: (v: { question: string; youtubeUrl: string }) => void, onSubmit: () => void, onCancel: () => void, submitLabel: string) => (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <input className="input text-[14px]" placeholder="La question, comme l'élève la pose (ex. Comment je fais pour créer des avis ?)" value={value.question} maxLength={200} autoFocus onChange={(e) => set({ ...value, question: e.target.value })} />
      <input className="input text-[14px]" placeholder="Lien YouTube de la vidéo (youtube.com/watch?v=… ou youtu.be/…)" value={value.youtubeUrl} onChange={(e) => set({ ...value, youtubeUrl: e.target.value })} />
      <div className="flex items-center gap-2">
        <button type="submit" className="btn btn-sm btn-primary" disabled={busy}>
          {submitLabel}
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel} disabled={busy}>
          Annuler
        </button>
      </div>
    </form>
  );

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {editTitle !== null ? (
          <form
            className="flex items-center gap-2 flex-1 min-w-[240px]"
            onSubmit={(e) => {
              e.preventDefault();
              void saveTitle();
            }}
          >
            <input className="input !h-[34px] flex-1 text-[14px]" value={editTitle} maxLength={80} autoFocus onChange={(e) => setEditTitle(e.target.value)} />
            <button type="submit" className="btn btn-sm btn-primary" disabled={busy}>
              Enregistrer
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditTitle(null)}>
              Annuler
            </button>
          </form>
        ) : (
          <SectionLabel n="01" title={data.title} />
        )}
        {isAdmin && editTitle === null && (
          <div className="flex items-center gap-1.5">
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditTitle(data.title)} title="Changer le titre de cette section">
              Renommer la section
            </button>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => setAdding(true)}>
              + Ajouter une vidéo
            </button>
          </div>
        )}
      </div>
      <p className="muted text-[13.5px] mt-2 leading-relaxed max-w-[64ch]">Les questions qui reviennent le plus souvent, et la réponse de Mady en vidéo, en 5 à 10 minutes. Regarde avant de poser la question.</p>

      {isAdmin && adding && (
        <div className="mt-4 p-4 rounded-[12px]" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
          {form(draft, setDraft, () => void add(), () => setAdding(false), "Ajouter")}
        </div>
      )}

      {data.items.length === 0 ? (
        <p className="dim text-[13px] mt-4">Aucune vidéo pour l&apos;instant. Ajoute la première : une question, un lien YouTube.</p>
      ) : (
        <ul className="flex flex-col gap-6 mt-5">
          {data.items.map((f, i) => (
            <li key={f.id} className="flex flex-col gap-2.5">
              {editing?.id === f.id ? (
                form(editing, (v) => setEditing({ id: f.id, ...v }), () => void saveItem(), () => setEditing(null), "Enregistrer")
              ) : (
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 className="text-[17px] sm:text-[19px] font-semibold leading-snug" style={{ letterSpacing: "-0.02em" }}>
                    {f.question}
                  </h3>
                  {isAdmin && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => void move(f, "up")} disabled={busy || i === 0} title="Monter">
                        ↑
                      </button>
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => void move(f, "down")} disabled={busy || i === data.items.length - 1} title="Descendre">
                        ↓
                      </button>
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing({ id: f.id, question: f.question, youtubeUrl: f.youtubeUrl })} disabled={busy}>
                        Modifier
                      </button>
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => void remove(f)} disabled={busy}>
                        Retirer
                      </button>
                    </div>
                  )}
                </div>
              )}
              {f.youtubeId ? (
                <div className="rounded-[12px] overflow-hidden w-full max-w-[720px]" style={{ aspectRatio: "16 / 9", background: "#000" }}>
                  <iframe
                    src={youtubeEmbedUrl(f.youtubeId)}
                    title={f.question}
                    className="w-full h-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                  />
                </div>
              ) : (
                <p className="dim text-[13px]">Lien YouTube non reconnu.</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
