"use client";

/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, useCollection } from "@/lib/client";
import { Card, CopyButton, Empty, ErrorNote, Field, InfoNote, Modal, PageHeader, Tabs } from "@/components/ui";
import { fmtCompact, PROD_FOLDERS } from "@/lib/format";
import type { ProdFolder, SavedItem } from "@/lib/types";
import { SkPage } from "@/components/Skeleton";

const FOLDER_TABS = [{ value: "", label: "Tous" }, ...PROD_FOLDERS.map((f) => ({ ...f }))];

/**
 * Script d'une reference.
 *
 * Pour mes propres reels, la transcription est automatique. Pour un createur,
 * Meta ne livre pas le fichier : c'est yt-dlp qui le recupere depuis le lien.
 */
function ScriptModal({
  item,
  position,
  total,
  onStep,
  onClose,
  onSave,
  onDone,
}: {
  item: SavedItem | null;
  position: number;
  total: number;
  onStep: (delta: number) => void;
  onClose: () => void;
  onSave: (id: string, transcript: string) => void;
  onDone: (id: string, done: boolean) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setText(item?.transcript ?? "");
    setError(null);
  }, [item]);

  const run = useCallback(
    async (job: string, fn: () => Promise<string>) => {
      setBusy(job);
      setError(null);
      try {
        const out = await fn();
        setText(out);
        if (item) onSave(item.id, out);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [item, onSave],
  );

  // Flèches gauche/droite : on enchaîne sans lâcher le clavier.
  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      if (e.key === "ArrowLeft") onStep(-1);
      if (e.key === "ArrowRight") onStep(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [item, onStep]);

  if (!item) return null;
  const mine = item.source === "mine" && Boolean(item.postId);

  const transcribe = () =>
    void run("t", async () => {
      const r = mine
        ? await api<{ transcript: string }>("/api/ai/transcribe", {
            method: "POST",
            body: JSON.stringify({ postId: item.postId }),
          })
        : await api<{ transcript: string }>("/api/ai/transcribe-url", {
            method: "POST",
            body: JSON.stringify({ url: item.permalink, savedId: item.id }),
          });
      return r.transcript;
    });

  return (
    <Modal open onClose={onClose} title="Script" wide>
      <div className="flex flex-col gap-3">
        <div
          className="flex items-center gap-2 flex-wrap pb-2.5"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <button className="btn btn-sm" onClick={() => onStep(-1)} disabled={total < 2} title="Précédente (←)">‹</button>
          <span className="text-[12px] num font-semibold">{position + 1} / {total}</span>
          <button className="btn btn-sm" onClick={() => onStep(1)} disabled={total < 2} title="Suivante (→)">›</button>

          <span className="dim text-[11.5px] truncate min-w-0 flex-1">
            {item.source === "mine" ? "Moi" : item.author} · {item.folder}
          </span>

          <button
            className="btn btn-sm"
            onClick={() => onDone(item.id, !item.done)}
            style={item.done ? { borderColor: "var(--emerald)", color: "var(--emerald)" } : undefined}
          >
            {item.done ? "✓ Fait" : "Marquer fait"}
          </button>
          <a className="btn btn-sm" href={item.permalink || undefined} target="_blank" rel="noreferrer">Voir</a>
        </div>

        <div className="flex gap-2 flex-wrap">
          <button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={transcribe}>
            {busy === "t" ? "Transcription…" : text ? "↻ Retranscrire" : "🎙 Transcrire"}
          </button>
          <button
            className="btn btn-sm"
            disabled={Boolean(busy) || !text.trim()}
            onClick={() =>
              void run("fr", async () => {
                const r = await api<{ text: string }>("/api/ai/translate", {
                  method: "POST",
                  body: JSON.stringify({ text }),
                });
                return r.text;
              })
            }
          >
            {busy === "fr" ? "Traduction…" : "Traduire en français"}
          </button>
          {text.trim() && <CopyButton text={text} label="Copier" />}
        </div>

        {error && <ErrorNote>{error}</ErrorNote>}

        <Field label="Script">
          <textarea
            className="input"
            rows={12}
            style={{ lineHeight: 1.65, fontSize: 13.5 }}
            placeholder="Aucun script pour l'instant."
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => onSave(item.id, text)}
          />
        </Field>

        {!mine && !text && (
          <InfoNote>
            Meta ne livre pas le fichier des créateurs : le tool le télécharge lui-même depuis le lien, puis le
            supprime aussitôt transcrit.
          </InfoNote>
        )}
      </div>
    </Modal>
  );
}

/** Lecture ou telechargement, selon la provenance de la reference. */
function mediaUrl(r: SavedItem, download = false): string {
  const suffix = download ? "&download=1" : "";
  return r.source === "mine" && r.postId
    ? `/api/instagram/media?postId=${r.postId}${suffix}`
    : `/api/creators/media?url=${encodeURIComponent(r.permalink)}${suffix}`;
}

/** Le script part en .txt, sans passer par le serveur. */
function downloadScript(r: SavedItem) {
  const blob = new Blob([r.transcript ?? ""], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(r.author || "script").replace(/[^\p{L}\p{N}_-]/gu, "") || "script"}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

function PlayerModal({ item, onClose }: { item: SavedItem | null; onClose: () => void }) {
  if (!item) return null;
  return (
    <Modal open onClose={onClose} title={item.source === "mine" ? "Ma vidéo" : item.author || "Vidéo"}>
      <div className="flex flex-col gap-3">
        <video
          src={mediaUrl(item)}
          controls
          autoPlay
          playsInline
          className="w-full rounded-[9px]"
          style={{ maxHeight: "70vh", background: "#000" }}
        />
        <div className="flex items-center gap-2 flex-wrap">
          <a className="btn btn-sm btn-primary" href={mediaUrl(item, true)}>Télécharger la vidéo</a>
          <a className="btn btn-sm" href={item.permalink || undefined} target="_blank" rel="noreferrer">
            Instagram
          </a>
          <span className="dim text-[11.5px] num ml-auto">
            {fmtCompact(item.likes)} likes · {fmtCompact(item.comments)} comm.
          </span>
        </div>
      </div>
    </Modal>
  );
}

export default function ProductionPage() {
  const saved = useCollection<SavedItem>("saved");
  const [folder, setFolder] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [cursor, setCursor] = useState<number | null>(null);
  const [playing, setPlaying] = useState<SavedItem | null>(null);
  // Tout est ouvert par defaut : on ne stocke que ce que l'utilisateur replie.
  const [closed, setClosed] = useState<Set<string>>(new Set());

  const shown = useMemo(
    () =>
      saved.rows.filter((r) => {
        if (folder && r.folder !== folder) return false;
        if (!showDone && r.done) return false;
        return true;
      }),
    [saved.rows, folder, showDone],
  );

  /** Compteurs par dossier, sur ce qui reste à faire. */
  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const r of saved.rows) if (!r.done) out[r.folder] = (out[r.folder] ?? 0) + 1;
    return out;
  }, [saved.rows]);

  const doneCount = saved.rows.filter((r) => r.done).length;

  /** Sections affichees : un dossier par bloc quand aucun filtre n'est actif. */
  const sections = useMemo(() => {
    if (folder) {
      const one = PROD_FOLDERS.find((f) => f.value === folder);
      return one ? [{ key: one.value, label: one.label, rows: shown }] : [];
    }
    return PROD_FOLDERS.map((f) => ({
      key: f.value,
      label: f.label,
      rows: shown.filter((r) => r.folder === f.value),
    })).filter((sec) => sec.rows.length > 0);
  }, [folder, shown]);

  if (saved.loading) return <SkPage />;

  return (
    <>
      <PageHeader
        title="Production"
      />

      <PlayerModal item={playing} onClose={() => setPlaying(null)} />

      <ScriptModal
        item={cursor === null ? null : shown[cursor] ?? null}
        position={cursor ?? 0}
        total={shown.length}
        onStep={(d) =>
          setCursor((c) => (c === null || !shown.length ? c : (c + d + shown.length) % shown.length))
        }
        onClose={() => setCursor(null)}
        onSave={(id, transcript) => void saved.patch(id, { transcript })}
        onDone={(id, done) => void saved.patch(id, { done })}
      />

      {!saved.rows.length ? (
        <Card>
          <Empty>
            Rien en production. Depuis Content ou le dashboard, clique le <strong>＋</strong> d&apos;une vignette
            et choisis un dossier.
          </Empty>
        </Card>
      ) : (
        <>
          <div className="flex gap-2 flex-wrap items-center mb-4">
            <Tabs
              value={folder}
              onChange={setFolder}
              options={FOLDER_TABS.map((f) => ({
                value: f.value,
                label: f.label,
                count: f.value ? counts[f.value] ?? 0 : saved.rows.filter((r) => !r.done).length,
              }))}
            />
            <button
              className="btn btn-sm"
              onClick={() => setShowDone((v) => !v)}
              style={showDone ? { borderColor: "var(--emerald)", color: "var(--emerald)" } : undefined}
            >
              {showDone ? "✓ Faites affichées" : `Faites (${doneCount})`}
            </button>
          </div>

          {!shown.length ? (
            <Card><Empty>Rien dans ce filtre.</Empty></Card>
          ) : (
            <div className="flex flex-col gap-4">
              {sections.map((sec) => {
                const open = !closed.has(sec.key);
                return (
                  <Card key={sec.key} padded={false}>
                    <button
                      className="row-hover w-full px-4 py-3 flex items-center gap-2.5 text-left"
                      onClick={() =>
                        setClosed((prev) => {
                          const next = new Set(prev);
                          if (next.has(sec.key)) next.delete(sec.key);
                          else next.add(sec.key);
                          return next;
                        })
                      }
                    >
                      <span className="dim text-[12px]" style={{ width: 12 }}>{open ? "▾" : "▸"}</span>
                      <span className="text-[13px] font-semibold">{sec.label}</span>
                      <span className="dim text-[11.5px] num">{sec.rows.length}</span>
                    </button>

                    {open && (
                      <ul style={{ borderTop: "1px solid var(--border)" }}>
                        {sec.rows.map((r, i) => (
                          <li
                            key={r.id}
                            className="row-hover px-3 py-2.5 flex items-center gap-3"
                            style={{
                              borderBottom: i < sec.rows.length - 1 ? "1px solid var(--border)" : "none",
                              opacity: r.done ? 0.5 : 1,
                            }}
                          >
                            <button
                              onClick={() => void saved.patch(r.id, { done: !r.done })}
                              className="rounded-[6px] grid place-items-center text-[12px] font-bold shrink-0"
                              style={{
                                width: 22,
                                height: 22,
                                background: r.done ? "var(--emerald)" : "var(--surface-3)",
                                color: r.done ? "#fff" : "var(--text-3)",
                                border: r.done ? "none" : "1px solid var(--border-strong)",
                              }}
                              title={r.done ? "Marquer à faire" : "Marquer fait"}
                            >
                              {r.done ? "✓" : ""}
                            </button>

                            <button
                              onClick={() => setPlaying(r)}
                              className="shrink-0 rounded-[8px] overflow-hidden"
                              style={{ width: 46, height: 58, background: "var(--surface-3)" }}
                              title="Lire la vidéo"
                            >
                              {r.thumbnail && (
                                <img src={r.thumbnail} alt="" className="w-full h-full object-cover" loading="lazy" />
                              )}
                            </button>

                            <div className="min-w-0 flex-1">
                              <div className="flex items-baseline gap-2 flex-wrap">
                                <span className="text-[12.5px] font-semibold truncate">
                                  {r.source === "mine" ? "Moi" : r.author || "—"}
                                </span>
                                <span className="dim text-[11px] num">
                                  {fmtCompact(r.likes)} likes · {fmtCompact(r.comments)} comm.
                                </span>
                              </div>
                              <p className="dim text-[11.5px] leading-snug line-clamp-1">
                                {r.caption || "Sans légende"}
                              </p>
                            </div>

                            <span className="flex items-center gap-1.5 shrink-0">
                              <button
                                className="btn btn-sm !px-1.5"
                                onClick={() => setCursor(shown.findIndex((x) => x.id === r.id))}
                                title="Voir ou obtenir le script"
                              >
                                {r.transcript ? "✓ Script" : "Script"}
                              </button>
                              {r.transcript && (
                                <button
                                  className="btn btn-sm !px-1.5"
                                  onClick={() => downloadScript(r)}
                                  title="Télécharger le script en .txt"
                                >
                                  ⬇ txt
                                </button>
                              )}
                              <a
                                className="btn btn-sm !px-1.5"
                                href={mediaUrl(r, true)}
                                title="Télécharger la vidéo"
                              >
                                ⬇ mp4
                              </a>
                              <select
                                className="select !py-1 !text-[11.5px]"
                                style={{ width: 108 }}
                                value={r.folder}
                                onChange={(e) => void saved.patch(r.id, { folder: e.target.value as ProdFolder })}
                              >
                                {PROD_FOLDERS.map((f) => (
                                  <option key={f.value} value={f.value}>{f.label}</option>
                                ))}
                              </select>
                              <button
                                className="btn btn-danger btn-sm !px-1.5"
                                onClick={() => void saved.destroy(r.id)}
                                title="Retirer"
                              >
                                ✕
                              </button>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}
    </>
  );
}
