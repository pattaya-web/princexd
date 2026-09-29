"use client";

import { useEffect, useMemo, useState } from "react";
import { useCollection } from "@/lib/client";
import { fmtDateTime } from "@/lib/format";
import { clipboardFiles, formatBytes } from "@/lib/upload-client";
import { ThumbImg, VideoThumb } from "@/components/MediaThumb";
import { DropZone, ProgressBar, uploadMany, type Progress } from "@/components/upload-ui";
import { Card, Empty, ErrorNote, Field, Modal, PageHeader, Spinner, useToast } from "@/components/ui";
import type { Testimonial } from "@/lib/types";

const ACCEPT = "image/*,video/*,audio/*,.pdf,.mp3,.m4a,.wav";

function kindOf(name: string, type: string): Testimonial["kind"] {
  if (type.startsWith("image/") || /\.(png|jpe?g|webp|gif|heic|heif|avif|jfif)$/i.test(name)) return "image";
  if (type.startsWith("video/") || /\.(mp4|mov|webm|m4v|mkv|avi)$/i.test(name)) return "video";
  if (type.startsWith("audio/") || /\.(mp3|m4a|wav|aac)$/i.test(name)) return "audio";
  return "file";
}

/**
 * Temoignages clients.
 *
 * Un endroit ou tout jeter : captures de DM, videos, vocaux, PDF. Glisser-
 * deposer, coller (Ctrl+V), ou choisir des fichiers ; ils sont stockes sur le
 * serveur comme les rushs du monteur. Une note et des etiquettes par
 * temoignage pour les retrouver au moment de monter une pub ou une page.
 */
export default function TestimonialsPage() {
  const { rows, loading, error, create, patch, destroy } = useCollection<Testimonial>("testimonials");
  const toast = useToast();
  const [progress, setProgress] = useState<Progress | null>(null);
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("");
  const [open, setOpen] = useState<Testimonial | null>(null);
  const [note, setNote] = useState("");
  const [tags, setTags] = useState("");
  const [saving, setSaving] = useState(false);

  const addFiles = async (files: File[]) => {
    if (!files.length) return;
    try {
      const uploaded = await uploadMany(files, setProgress);
      for (let i = 0; i < uploaded.length; i++) {
        const u = uploaded[i];
        await create({
          name: u.name,
          url: u.url,
          size: u.size,
          kind: kindOf(u.name, files[i]?.type ?? ""),
          note: "",
          tags: [],
          addedAt: new Date().toISOString(),
        });
      }
      toast(`${uploaded.length} témoignage${uploaded.length > 1 ? "s" : ""} ajouté${uploaded.length > 1 ? "s" : ""}.`);
    } catch (e) {
      setProgress(null);
      toast((e as Error).message, "err");
    }
  };

  // Ctrl+V d'une capture d'ecran : le cas le plus frequent pour un DM.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = clipboardFiles(e);
      if (files.length) {
        e.preventDefault();
        void addFiles(files);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allTags = useMemo(() => [...new Set(rows.flatMap((r) => r.tags ?? []))].sort(), [rows]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows
      .filter((r) => !tag || (r.tags ?? []).includes(tag))
      .filter((r) => !needle || `${r.name} ${r.note} ${(r.tags ?? []).join(" ")}`.toLowerCase().includes(needle))
      .sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  }, [rows, q, tag]);

  const openOne = (t: Testimonial) => {
    setOpen(t);
    setNote(t.note ?? "");
    setTags((t.tags ?? []).join(", "));
  };

  const save = async () => {
    if (!open) return;
    setSaving(true);
    try {
      await patch(open.id, {
        note: note.trim(),
        tags: tags.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
      });
      toast("Enregistré.");
      setOpen(null);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (t: Testimonial) => {
    if (!window.confirm(`Supprimer « ${t.name} » ?`)) return;
    try {
      await destroy(t.id);
      setOpen(null);
      toast("Supprimé.");
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  return (
    <>
      <PageHeader
        title="Témoignages"
        subtitle="Glisse tes captures de DM, vidéos et vocaux ici, ou colle une capture avec Ctrl+V. Tout est gardé au même endroit."
      />

      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      <div className="mb-4">
        <DropZone
          label="Glisse tes témoignages ici, ou clique pour choisir"
          hint="Images, vidéos, vocaux, PDF. Plusieurs à la fois, jusqu'à 2 Go chacun. Ctrl+V colle une capture."
          accept={ACCEPT}
          disabled={Boolean(progress)}
          onFiles={(files) => void addFiles(files)}
        />
        {progress && (
          <div className="mt-2">
            <ProgressBar p={progress} />
          </div>
        )}
      </div>

      {rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <input className="input !w-[240px]" placeholder="Rechercher (nom, note, étiquette)" value={q} onChange={(e) => setQ(e.target.value)} />
          {allTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <button className={`btn btn-sm ${!tag ? "btn-primary" : ""}`} onClick={() => setTag("")}>
                Tous · {rows.length}
              </button>
              {allTags.map((t) => (
                <button key={t} className={`btn btn-sm ${tag === t ? "btn-primary" : ""}`} onClick={() => setTag(tag === t ? "" : t)}>
                  {t} · {rows.filter((r) => (r.tags ?? []).includes(t)).length}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {loading && !rows.length ? (
        <Card>
          <Spinner label="Chargement…" />
        </Card>
      ) : !rows.length ? (
        <Card>
          <Empty>Aucun témoignage pour l&apos;instant. Dépose le premier ci-dessus.</Empty>
        </Card>
      ) : !shown.length ? (
        <Card>
          <Empty>Rien ne correspond à cette recherche.</Empty>
        </Card>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {shown.map((t) => (
            <article
              key={t.id}
              className="tile card-flat relative overflow-hidden cursor-pointer"
              style={{ aspectRatio: "4 / 5", background: "var(--surface-3)" }}
              onClick={() => openOne(t)}
              title={t.note || t.name}
            >
              {t.kind === "image" ? (
                <ThumbImg src={t.url} />
              ) : t.kind === "video" ? (
                <VideoThumb src={t.url} />
              ) : (
                <div className="w-full h-full grid place-items-center text-[34px]">{t.kind === "audio" ? "🎙" : "📄"}</div>
              )}
              {t.kind === "video" && (
                <span
                  className="absolute top-1.5 left-1.5 rounded-full grid place-items-center text-[11px] pointer-events-none"
                  style={{ width: 22, height: 22, background: "rgb(0 0 0 / 0.55)", color: "#fff" }}
                >
                  ▶
                </span>
              )}
              <div
                className="absolute inset-x-0 bottom-0 px-2 py-1.5 text-[11px] leading-snug"
                style={{ background: "linear-gradient(transparent, rgb(0 0 0 / 0.75))", color: "#fff" }}
              >
                <div className="truncate font-medium">{t.note || t.name}</div>
                {(t.tags ?? []).length > 0 && <div className="truncate opacity-80">{t.tags.join(" · ")}</div>}
              </div>
            </article>
          ))}
        </div>
      )}

      <Modal
        open={open !== null}
        onClose={() => setOpen(null)}
        wide
        title={open?.name ?? ""}
        footer={
          open ? (
            <>
              <button className="btn mr-auto" style={{ color: "var(--critical)" }} onClick={() => void remove(open)}>
                Supprimer
              </button>
              <a className="btn" href={open.url} download={open.name}>
                Télécharger
              </a>
              <button className="btn btn-primary" onClick={() => void save()} disabled={saving}>
                {saving ? <span className="spinner" /> : "Enregistrer"}
              </button>
            </>
          ) : null
        }
      >
        {open && (
          <div className="grid lg:grid-cols-5 gap-4">
            <div className="lg:col-span-3 rounded-[10px] overflow-hidden" style={{ background: "var(--surface-3)" }}>
              {open.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={open.url} alt={open.name} className="w-full max-h-[70vh] object-contain" />
              ) : open.kind === "video" ? (
                <video src={open.url} controls playsInline className="w-full max-h-[70vh]" />
              ) : open.kind === "audio" ? (
                <div className="p-6">
                  <audio src={open.url} controls className="w-full" />
                </div>
              ) : (
                <div className="p-6 text-center">
                  <a className="link" href={open.url} target="_blank" rel="noreferrer">
                    Ouvrir le fichier ↗
                  </a>
                </div>
              )}
            </div>
            <div className="lg:col-span-2 flex flex-col gap-3">
              <Field label="Note" hint="Qui, quel résultat, où l'utiliser.">
                <textarea className="textarea w-full" rows={5} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex. Léa, +12k en 30 jours, ok pour la story" />
              </Field>
              <Field label="Étiquettes" hint="Séparées par des virgules : avant/après, vocal, story…">
                <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} />
              </Field>
              <div className="dim text-[11.5px]">
                {formatBytes(open.size)} · ajouté le {fmtDateTime(open.addedAt)}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
