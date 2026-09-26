"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState, type DragEvent } from "react";
import { api, useCollection, useDebouncedSave } from "@/lib/client";
import { formatBytes } from "@/lib/upload-client";
import { relative } from "@/lib/format";
import { Card, CopyButton, Empty, ErrorNote, Field, Modal, Spinner, Tabs, useToast } from "./ui";
import { DropZone, ProgressBar, uploadMany, type Progress } from "./upload-ui";
import type { AdFolder, AdInspiration, AdScript, AdScriptStatus } from "@/lib/types";
import { thumbUrl, VideoThumb } from "@/components/MediaThumb";

/**
 * Drive Ads & Scripts.
 *
 * Un dossier = un angle, une offre ou une campagne. Dedans : les pubs qui
 * m'ont inspire (mp4 glisses-deposes ou liens), leur transcription, et les
 * scripts a tourner — ecrits a la main ou sortis d'une pub par l'IA.
 */

type View = "dossiers" | "a-tourner" | "inspirations";

const STATUS_LABEL: Record<AdScriptStatus, string> = {
  "a-tourner": "À tourner",
  tournee: "Tournée",
  "en-ligne": "En ligne",
  archive: "Archivé",
};

const STATUS_COLOR: Record<AdScriptStatus, string> = {
  "a-tourner": "var(--s4)",
  tournee: "var(--s1)",
  "en-ligne": "var(--good)",
  archive: "var(--text-3)",
};

const STATUS_ORDER: AdScriptStatus[] = ["a-tourner", "tournee", "en-ligne", "archive"];

const isVideo = (url: string) => /\.(mp4|mov|webm|m4v|mkv|avi)(\?|$)/i.test(url);
const isLocal = (url: string) => url.startsWith("/api/media/");
const ACCEPT = "video/*,.mp4,.mov,.m4v,.webm,.mkv";

const now = () => new Date().toISOString();
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

function blankScript(title = "Nouveau script"): AdScript {
  const t = now();
  return {
    id: uid(),
    title,
    status: "a-tourner",
    angle: "",
    hook: "",
    hooks: [],
    duree: "",
    plans: [],
    cta: "",
    text: "",
    pourquoiCaMarche: [],
    notes: "",
    fromInspiration: "",
    createdAt: t,
    updatedAt: t,
  };
}

function toInspiration(up: { name: string; url: string; size: number }): AdInspiration {
  return { ...up, addedAt: now(), note: "", transcript: "", transcribedAt: "", language: "" };
}

/* ------------------------------ Carte dossier ------------------------------ */

function FolderCard({ folder, onOpen }: { folder: AdFolder; onOpen: () => void }) {
  const cover = folder.inspirations.find((i) => isVideo(i.url) && isLocal(i.url)) ?? null;
  const toShoot = folder.scripts.filter((s) => s.status === "a-tourner").length;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="card-flat text-left overflow-hidden transition-colors hover:border-[var(--border-strong)]"
    >
      <div className="relative" style={{ background: "var(--surface-3)", aspectRatio: "16 / 10" }}>
        {cover ? (
          <VideoThumb src={cover.url} />
        ) : (
          <span className="absolute inset-0 grid place-items-center text-[30px]">📁</span>
        )}
        {toShoot > 0 && (
          <span className="absolute top-2 left-2 badge !text-[10.5px]" style={{ background: "var(--surface)", color: "var(--s4)", borderColor: "var(--s4)" }}>
            {toShoot} à tourner
          </span>
        )}
      </div>
      <div className="px-3 py-2.5">
        <p className="text-[13px] font-medium leading-snug truncate" title={folder.title}>{folder.title}</p>
        <p className="dim text-[11px] mt-1 flex flex-wrap gap-x-2.5">
          <span>{relative(folder.createdAt)}</span>
          <span>🎬 {folder.inspirations.length} inspi{folder.inspirations.length > 1 ? "s" : ""}</span>
          <span>📝 {folder.scripts.length} script{folder.scripts.length > 1 ? "s" : ""}</span>
        </p>
      </div>
    </button>
  );
}

/* ------------------------------ Inspiration ------------------------------ */

function InspirationTile({
  insp,
  folderId,
  busy,
  onBusy,
  onPatch,
  onRemove,
  onScript,
}: {
  insp: AdInspiration;
  folderId: string;
  busy: string | null;
  onBusy: (v: string | null) => void;
  onPatch: (patch: Partial<AdInspiration>) => Promise<unknown>;
  onRemove: () => void;
  onScript: (script: AdScript) => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(insp.note);
  const [brief, setBrief] = useState("");
  const local = isLocal(insp.url);
  const mine = busy === insp.url;
  const hasTranscript = Boolean(insp.transcript.trim());

  const transcribe = async () => {
    onBusy(insp.url);
    try {
      const r = await api<{ transcript: string; cached?: boolean }>("/api/ads/transcribe", {
        method: "POST",
        body: JSON.stringify({ folderId, url: insp.url, force: hasTranscript }),
      });
      await onPatch({ transcript: r.transcript, transcribedAt: now() });
      setOpen(true);
      toast("Transcription terminée.");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      onBusy(null);
    }
  };

  const extract = async () => {
    onBusy(insp.url);
    try {
      if (!hasTranscript) {
        const r = await api<{ transcript: string }>("/api/ads/transcribe", {
          method: "POST",
          body: JSON.stringify({ folderId, url: insp.url }),
        });
        await onPatch({ transcript: r.transcript, transcribedAt: now() });
      }
      const r = await api<{ script: AdScript }>("/api/ads/script", {
        method: "POST",
        body: JSON.stringify({ folderId, url: insp.url, brief }),
      });
      onScript(r.script);
      setBrief("");
      toast(`Script « ${r.script.title} » ajouté au dossier.`);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      onBusy(null);
    }
  };

  return (
    <div className="card-flat overflow-hidden flex flex-col">
      <div className="relative" style={{ background: "#000", aspectRatio: "9 / 12" }}>
        {isVideo(insp.url) ? (
          <video src={insp.url} controls playsInline preload="none" poster={thumbUrl(insp.url)} className="w-full h-full object-contain" />
        ) : (
          <a href={insp.url} target="_blank" rel="noreferrer" className="absolute inset-0 grid place-items-center text-[12px] px-3 text-center" style={{ color: "#fff" }}>
            Ouvrir le lien ↗
          </a>
        )}
        {hasTranscript && (
          <span className="absolute top-2 left-2 badge badge-good !text-[10.5px]">Transcrite</span>
        )}
      </div>

      <div className="px-2.5 py-2 flex flex-col gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[11.5px] flex-1 min-w-0 truncate" title={insp.name}>{insp.name}</span>
          {insp.size > 0 && <span className="dim text-[10.5px] shrink-0">{formatBytes(insp.size)}</span>}
          {local ? (
            <a href={`${insp.url}?download=1&name=${encodeURIComponent(insp.name)}`} download={insp.name} className="btn btn-sm shrink-0" title="Télécharger">↓</a>
          ) : (
            <a href={insp.url} target="_blank" rel="noreferrer" className="btn btn-sm shrink-0" title="Ouvrir">↗</a>
          )}
          <button className="btn btn-sm btn-danger shrink-0" onClick={onRemove} aria-label="Retirer" disabled={mine}>✕</button>
        </div>

        <input
          className="input !h-[30px] text-[12px]"
          placeholder="Note : pourquoi elle marche, ce que je garde…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => { if (note !== insp.note) void onPatch({ note }); }}
        />

        {local ? (
          <div className="flex flex-wrap gap-1.5">
            <button className="btn btn-sm" onClick={() => void transcribe()} disabled={busy !== null} title={hasTranscript ? "Relancer la transcription" : "Extraire le texte dit dans la pub"}>
              {mine ? <span className="spinner" /> : hasTranscript ? "↻ Retranscrire" : "Transcrire"}
            </button>
            <button className="btn btn-sm btn-primary" onClick={() => void extract()} disabled={busy !== null}>
              {mine ? <span className="spinner" /> : "✦ Sortir un script"}
            </button>
            {hasTranscript && (
              <button className="btn btn-sm btn-ghost" onClick={() => setOpen((o) => !o)}>
                {open ? "Masquer le texte" : "Voir le texte"}
              </button>
            )}
          </div>
        ) : (
          <p className="dim text-[11px] leading-snug">
            Lien externe : enregistre la vidéo en mp4 et dépose-la pour pouvoir la transcrire.
          </p>
        )}

        {local && (
          <input
            className="input !h-[30px] text-[12px]"
            placeholder="Consigne pour le script (optionnel) : offre, angle, durée…"
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
          />
        )}

        {open && hasTranscript && (
          <div className="rounded-[8px] px-2.5 py-2" style={{ background: "var(--surface-2)" }}>
            <div className="flex items-center justify-between mb-1">
              <span className="label-xs">Transcription {insp.language && `· ${insp.language}`}</span>
              <CopyButton text={insp.transcript} />
            </div>
            <p className="text-[12px] leading-relaxed whitespace-pre-wrap max-h-[220px] overflow-y-auto">{insp.transcript}</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------ Script ------------------------------ */

function ScriptCard({
  script,
  folderTitle,
  inspiration,
  onPatch,
  onRemove,
}: {
  script: AdScript;
  folderTitle?: string;
  inspiration?: AdInspiration;
  onPatch: (patch: Partial<AdScript>) => Promise<unknown>;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState(script.title);
  const [text, setText] = useState(script.text);
  const [notes, setNotes] = useState(script.notes);

  // Le script peut etre remplace par une version serveur : on suit.
  useEffect(() => { setTitle(script.title); setText(script.text); setNotes(script.notes); }, [script.title, script.text, script.notes]);

  const saveText = useDebouncedSave<string>(async (v) => { await onPatch({ text: v, updatedAt: now() }); }, 700);
  const saveNotes = useDebouncedSave<string>(async (v) => { await onPatch({ notes: v, updatedAt: now() }); }, 700);

  const fullCopy = [
    script.title,
    script.hook && `HOOK : ${script.hook}`,
    text,
    script.cta && `CTA : ${script.cta}`,
  ].filter(Boolean).join("\n\n");

  const cycleStatus = () => {
    const i = STATUS_ORDER.indexOf(script.status);
    void onPatch({ status: STATUS_ORDER[(i + 1) % STATUS_ORDER.length], updatedAt: now() });
  };

  return (
    <div className="card-flat p-3.5 flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <input
            className="input !h-[32px] font-medium w-full"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => { if (title.trim() && title !== script.title) void onPatch({ title: title.trim(), updatedAt: now() }); }}
          />
          <p className="dim text-[11px] mt-1 flex flex-wrap gap-x-2.5">
            {folderTitle && <span>📁 {folderTitle}</span>}
            <span>{relative(script.updatedAt || script.createdAt)}</span>
            {script.duree && <span>⏱ {script.duree}</span>}
            {inspiration && <span title={inspiration.name}>✦ sorti de « {inspiration.name.slice(0, 28)} »</span>}
          </p>
        </div>
        <button
          className="badge shrink-0 cursor-pointer"
          style={{ color: STATUS_COLOR[script.status], borderColor: STATUS_COLOR[script.status] }}
          onClick={cycleStatus}
          title="Changer le statut"
        >
          {STATUS_LABEL[script.status]}
        </button>
      </div>

      {script.hook && (
        <p className="text-[13px] leading-snug">
          <span className="label-xs mr-1.5">Hook</span>
          <span className="font-medium">{script.hook}</span>
        </p>
      )}

      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="label-xs">Texte à lire</span>
          <CopyButton text={fullCopy} label="Copier le script" />
        </div>
        <textarea
          className="input w-full text-[13px] leading-relaxed"
          rows={expanded ? 14 : 5}
          placeholder="Écris ton script ici, ou sors-en un depuis une inspiration."
          value={text}
          onChange={(e) => { setText(e.target.value); saveText(e.target.value); }}
        />
      </div>

      {expanded && (
        <>
          {script.hooks.length > 0 && (
            <div>
              <span className="label-xs block mb-1">Variantes de hook</span>
              <ul className="flex flex-col gap-1">
                {script.hooks.map((h, i) => (
                  <li key={i} className="text-[12.5px] rounded-[7px] px-2.5 py-1.5 flex gap-2" style={{ background: "var(--surface-2)" }}>
                    <span className="flex-1">{h}</span>
                    <CopyButton text={h} label="Copier" />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {script.plans.length > 0 && (
            <div>
              <span className="label-xs block mb-1">Plan de tournage</span>
              <div className="flex flex-col gap-1.5">
                {script.plans.map((p) => (
                  <div key={p.n} className="rounded-[8px] px-3 py-2 text-[12.5px]" style={{ background: "var(--surface-2)" }}>
                    <div className="flex gap-2">
                      <span className="num font-semibold shrink-0" style={{ color: "var(--accent)" }}>{p.n}</span>
                      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                        <span>{p.visuel}</span>
                        {p.texteEcran && <span className="dim">Texte écran : {p.texteEcran}</span>}
                        {p.voix && <span className="italic">« {p.voix} »</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(script.angle || script.cta) && (
            <div className="grid sm:grid-cols-2 gap-2 text-[12.5px]">
              {script.angle && <p><span className="label-xs mr-1.5">Angle</span>{script.angle}</p>}
              {script.cta && <p><span className="label-xs mr-1.5">CTA</span>{script.cta}</p>}
            </div>
          )}

          {script.pourquoiCaMarche.length > 0 && (
            <div>
              <span className="label-xs block mb-1">Pourquoi la pub d&apos;origine marche</span>
              <ul className="list-disc pl-5 text-[12.5px] flex flex-col gap-0.5">
                {script.pourquoiCaMarche.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>
          )}

          <Field label="Notes de tournage">
            <textarea
              className="input w-full text-[12.5px]"
              rows={3}
              placeholder="Cadrage, rythme, tenue, lieu…"
              value={notes}
              onChange={(e) => { setNotes(e.target.value); saveNotes(e.target.value); }}
            />
          </Field>
        </>
      )}

      <div className="flex items-center gap-2">
        <button className="btn btn-sm btn-ghost" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Réduire" : "Détails · plans, variantes, notes"}
        </button>
        <button className="btn btn-sm btn-danger ml-auto" onClick={onRemove}>Supprimer</button>
      </div>
    </div>
  );
}

/* ------------------------------ Vue dossier ------------------------------ */

function FolderView({
  folder,
  onBack,
  onPatch,
  onDelete,
}: {
  folder: AdFolder;
  onBack: () => void;
  onPatch: (patch: Partial<AdFolder>) => Promise<unknown>;
  onDelete: () => Promise<void>;
}) {
  const toast = useToast();
  const [title, setTitle] = useState(folder.title);
  const [desc, setDesc] = useState(folder.description);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const [over, setOver] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState("");
  const [pastedBrief, setPastedBrief] = useState("");
  const [pasteBusy, setPasteBusy] = useState(false);

  useEffect(() => { setTitle(folder.title); setDesc(folder.description); }, [folder.title, folder.description]);

  const addFiles = async (files: File[]) => {
    const videos = files.filter((f) => /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(f.name));
    if (!videos.length) {
      toast("Dépose des vidéos (mp4, mov…).", "err");
      return;
    }
    try {
      const ups = await uploadMany(videos, setProgress);
      await onPatch({ inspirations: [...ups.map(toInspiration), ...folder.inspirations] });
      toast(`${ups.length} pub${ups.length > 1 ? "s" : ""} ajoutée${ups.length > 1 ? "s" : ""}.`);
    } catch (e) {
      setProgress(null);
      toast((e as Error).message, "err");
    }
  };

  const addLink = async () => {
    const url = link.trim();
    if (!url) return;
    await onPatch({
      inspirations: [
        { ...toInspiration({ name: url.replace(/^https?:\/\//, "").slice(0, 60), url, size: 0 }) },
        ...folder.inspirations,
      ],
    });
    setLink("");
  };

  const patchInsp = (url: string, patch: Partial<AdInspiration>) =>
    onPatch({ inspirations: folder.inspirations.map((i) => (i.url === url ? { ...i, ...patch } : i)) });

  const removeInsp = async (url: string) => {
    if (!window.confirm("Retirer cette pub du dossier ?")) return;
    await onPatch({ inspirations: folder.inspirations.filter((i) => i.url !== url) });
  };

  const patchScript = (id: string, patch: Partial<AdScript>) =>
    onPatch({ scripts: folder.scripts.map((s) => (s.id === id ? { ...s, ...patch } : s)) });

  const removeScript = async (id: string) => {
    if (!window.confirm("Supprimer ce script ?")) return;
    await onPatch({ scripts: folder.scripts.filter((s) => s.id !== id) });
  };

  const addScript = async () => {
    await onPatch({ scripts: [blankScript(), ...folder.scripts] });
  };

  /** Script sorti d'un texte colle (sous-titres, prompteur d'un concurrent…). */
  const fromPasted = async () => {
    if (!pasted.trim()) return;
    setPasteBusy(true);
    try {
      const r = await api<{ script: AdScript }>("/api/ads/script", {
        method: "POST",
        body: JSON.stringify({ folderId: folder.id, transcript: pasted, brief: pastedBrief }),
      });
      await onPatch({ scripts: [r.script, ...folder.scripts] });
      setPasted("");
      setPastedBrief("");
      setPasting(false);
      toast(`Script « ${r.script.title} » ajouté.`);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setPasteBusy(false);
    }
  };

  // Depot n'importe ou dans le dossier : pas besoin de viser la zone.
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length && progress === null) void addFiles(files);
  };

  const toShoot = folder.scripts.filter((s) => s.status === "a-tourner");
  const others = folder.scripts.filter((s) => s.status !== "a-tourner");

  return (
    <div
      className="flex flex-col gap-6 relative"
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setOver(false); }}
      onDrop={onDrop}
    >
      {over && (
        <div
          className="absolute inset-0 z-10 rounded-[14px] grid place-items-center pointer-events-none text-[15px] font-medium"
          style={{ border: "2px dashed var(--accent)", background: "color-mix(in srgb, var(--accent) 8%, var(--bg))", color: "var(--accent)" }}
        >
          Lâche pour ajouter aux inspirations
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-sm" onClick={onBack}>← Dossiers</button>
        <input
          className="input !h-[36px] text-[16px] font-semibold flex-1 min-w-[200px]"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => { if (title.trim() && title !== folder.title) void onPatch({ title: title.trim() }); }}
        />
        <button className="btn btn-sm btn-danger" onClick={() => void onDelete()}>Supprimer le dossier</button>
      </div>
      <input
        className="input w-full text-[12.5px] -mt-3"
        placeholder="Description : offre, cible, angle du dossier…"
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        onBlur={() => { if (desc !== folder.description) void onPatch({ description: desc }); }}
      />

      {progress && <ProgressBar p={progress} />}

      <Card
        title="Inspirations"
        subtitle="Les pubs qui tournent. Dépose les mp4, transcris-les, sors-en un script pour toi."
        actions={
          <div className="flex gap-2">
            <input
              className="input !h-[30px] text-[12px] w-[220px]"
              placeholder="Lien Meta Ad Library, TikTok…"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void addLink(); }}
            />
            <button className="btn btn-sm" onClick={() => void addLink()} disabled={!link.trim()}>Ajouter</button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <DropZone
            label={folder.inspirations.length ? "Ajouter des pubs" : "Glisse tes pubs en mp4 ici"}
            hint="Plusieurs fichiers à la fois. Tu peux aussi lâcher les fichiers n'importe où dans le dossier."
            accept={ACCEPT}
            compact={folder.inspirations.length > 0}
            disabled={progress !== null}
            onFiles={(f) => void addFiles(f)}
          />
          {folder.inspirations.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
              {folder.inspirations.map((i) => (
                <InspirationTile
                  key={i.url}
                  insp={i}
                  folderId={folder.id}
                  busy={busy}
                  onBusy={setBusy}
                  onPatch={(p) => patchInsp(i.url, p)}
                  onRemove={() => void removeInsp(i.url)}
                  onScript={(s) => void onPatch({ scripts: [s, ...folder.scripts] })}
                />
              ))}
            </div>
          )}
        </div>
      </Card>

      <Card
        title="Scripts"
        subtitle={`${toShoot.length} à tourner · ${folder.scripts.length} au total`}
        actions={
          <>
            <button className="btn btn-sm" onClick={() => setPasting(true)}>✦ Depuis un texte collé</button>
            <button className="btn btn-sm btn-primary" onClick={() => void addScript()}>+ Nouveau script</button>
          </>
        }
      >
        {!folder.scripts.length ? (
          <Empty action={<button className="btn btn-primary" onClick={() => void addScript()}>+ Écrire un script</button>}>
            Aucun script. Sors-en un depuis une inspiration, ou écris le tien.
          </Empty>
        ) : (
          <div className="flex flex-col gap-3">
            {[...toShoot, ...others].map((s) => (
              <ScriptCard
                key={s.id}
                script={s}
                inspiration={folder.inspirations.find((i) => i.url === s.fromInspiration)}
                onPatch={(p) => patchScript(s.id, p)}
                onRemove={() => void removeScript(s.id)}
              />
            ))}
          </div>
        )}
      </Card>

      {pasting && (
        <Modal
          open
          onClose={pasteBusy ? () => undefined : () => setPasting(false)}
          title="Sortir un script d'un texte"
          footer={
            <>
              <button className="btn" onClick={() => setPasting(false)} disabled={pasteBusy}>Annuler</button>
              <button className="btn btn-primary" onClick={() => void fromPasted()} disabled={pasteBusy || !pasted.trim()}>
                {pasteBusy ? <span className="spinner" /> : "✦ Sortir le script"}
              </button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <Field label="Texte de la pub" hint="Sous-titres, transcription faite ailleurs, script d'un concurrent… L'IA en reprend la mécanique pour ton business.">
              <textarea className="input w-full" rows={9} value={pasted} onChange={(e) => setPasted(e.target.value)} autoFocus />
            </Field>
            <Field label="Consigne (optionnel)">
              <input className="input w-full" placeholder="Offre à pousser, durée, angle…" value={pastedBrief} onChange={(e) => setPastedBrief(e.target.value)} />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ------------------------------ Nouveau dossier ------------------------------ */

function NewFolder({ onClose, onCreate }: { onClose: () => void; onCreate: (f: Partial<AdFolder>) => Promise<AdFolder> }) {
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const t = title.trim();
    if (!t) return;
    setBusy(true);
    try {
      const ups = await uploadMany(files, setProgress);
      await onCreate({ title: t, description: desc.trim(), inspirations: ups.map(toInspiration), scripts: [] });
      toast("Dossier créé.");
      onClose();
    } catch (e) {
      setProgress(null);
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={busy ? () => undefined : onClose}
      title="Nouveau dossier"
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Annuler</button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy || !title.trim()}>
            {busy ? <span className="spinner" /> : "Créer"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Nom" hint="Un angle, une offre, une campagne.">
          <input className="input w-full" placeholder="Ex. Objection prix · UGC témoignages" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus onKeyDown={(e) => { if (e.key === "Enter") void submit(); }} />
        </Field>
        <Field label="Description">
          <input className="input w-full" placeholder="Optionnel" value={desc} onChange={(e) => setDesc(e.target.value)} />
        </Field>
        <Field label="Pubs d'inspiration" hint="Optionnel, tu pourras en ajouter après.">
          <div className="flex flex-col gap-2">
            {files.length > 0 && (
              <ul className="flex flex-col gap-1">
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex items-center gap-2 text-[12px] rounded-[7px] px-2.5 py-1.5" style={{ background: "var(--surface-2)" }}>
                    <span className="flex-1 min-w-0 truncate">{f.name}</span>
                    <span className="dim shrink-0">{formatBytes(f.size)}</span>
                    <button className="btn btn-sm btn-ghost shrink-0" onClick={() => setFiles((r) => r.filter((_, j) => j !== i))} disabled={busy}>✕</button>
                  </li>
                ))}
              </ul>
            )}
            <DropZone label={files.length ? "Ajouter d'autres pubs" : "Glisse tes mp4 ici"} accept={ACCEPT} disabled={busy} onFiles={(f) => setFiles((r) => [...r, ...f])} />
          </div>
        </Field>
        {progress && <ProgressBar p={progress} />}
      </div>
    </Modal>
  );
}

/* ------------------------------ Drive ------------------------------ */

export function AdsDrive() {
  const { rows, loading, error, create, patch, destroy } = useCollection<AdFolder>("adFolders");
  const [view, setView] = useState<View>("dossiers");
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const folders = useMemo(() => [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [rows]);
  const folder = rows.find((f) => f.id === openId) ?? null;

  const allScripts = useMemo(
    () =>
      folders
        .flatMap((f) => f.scripts.map((s) => ({ s, f })))
        .filter(({ s }) => s.status === "a-tourner")
        .sort((a, b) => (b.s.updatedAt || b.s.createdAt).localeCompare(a.s.updatedAt || a.s.createdAt)),
    [folders],
  );
  const allInsp = useMemo(
    () => folders.flatMap((f) => f.inspirations.map((i) => ({ i, f }))).sort((a, b) => b.i.addedAt.localeCompare(a.i.addedAt)),
    [folders],
  );

  const patchScript = (f: AdFolder, id: string, p: Partial<AdScript>) =>
    patch(f.id, { scripts: f.scripts.map((s) => (s.id === id ? { ...s, ...p } : s)) });

  if (loading) return <Card><Spinner label="Chargement du drive…" /></Card>;
  if (error) return <ErrorNote>{error}</ErrorNote>;

  if (folder) {
    return (
      <FolderView
        folder={folder}
        onBack={() => setOpenId(null)}
        onPatch={(p) => patch(folder.id, p)}
        onDelete={async () => {
          if (!window.confirm(`Supprimer le dossier « ${folder.title} », ses pubs et ses scripts ?`)) return;
          await destroy(folder.id);
          setOpenId(null);
        }}
      />
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <Tabs
          value={view}
          onChange={setView}
          options={[
            { value: "dossiers", label: "Dossiers", count: folders.length },
            { value: "a-tourner", label: "À tourner", count: allScripts.length },
            { value: "inspirations", label: "Inspirations", count: allInsp.length },
          ]}
        />
        <button className="btn btn-primary" onClick={() => setCreating(true)}>+ Nouveau dossier</button>
      </div>

      {view === "dossiers" && (
        !folders.length ? (
          <Card>
            <Empty action={<button className="btn btn-primary" onClick={() => setCreating(true)}>+ Nouveau dossier</button>}>
              Crée un premier dossier : un angle ou une offre, avec les pubs qui t&apos;inspirent et les scripts à tourner.
            </Empty>
          </Card>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {folders.map((f) => <FolderCard key={f.id} folder={f} onOpen={() => setOpenId(f.id)} />)}
          </div>
        )
      )}

      {view === "a-tourner" && (
        !allScripts.length ? (
          <Card><Empty>Rien à tourner. Sors un script depuis une pub d&apos;inspiration, ou écris-en un dans un dossier.</Empty></Card>
        ) : (
          <div className="flex flex-col gap-3">
            {allScripts.map(({ s, f }) => (
              <ScriptCard
                key={s.id}
                script={s}
                folderTitle={f.title}
                inspiration={f.inspirations.find((i) => i.url === s.fromInspiration)}
                onPatch={(p) => patchScript(f, s.id, p)}
                onRemove={async () => {
                  if (!window.confirm("Supprimer ce script ?")) return;
                  await patch(f.id, { scripts: f.scripts.filter((x) => x.id !== s.id) });
                }}
              />
            ))}
          </div>
        )
      )}

      {view === "inspirations" && (
        !allInsp.length ? (
          <Card><Empty>Aucune pub déposée. Ouvre un dossier et glisse tes mp4.</Empty></Card>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5">
            {allInsp.map(({ i, f }) => (
              <button key={i.url} type="button" className="card-flat overflow-hidden text-left" onClick={() => setOpenId(f.id)} title={`Ouvrir « ${f.title} »`}>
                <div className="relative" style={{ background: "#000", aspectRatio: "9 / 12" }}>
                  {isVideo(i.url) ? (
                    <VideoThumb src={i.url} className="w-full h-full object-contain" />
                  ) : (
                    <span className="absolute inset-0 grid place-items-center text-[12px] px-3 text-center" style={{ color: "#fff" }}>Lien ↗</span>
                  )}
                  {i.transcript && <span className="absolute top-2 left-2 badge badge-good !text-[10.5px]">Transcrite</span>}
                </div>
                <div className="px-2.5 py-2">
                  <p className="text-[12px] truncate">{i.name}</p>
                  <p className="dim text-[11px] truncate">📁 {f.title}</p>
                </div>
              </button>
            ))}
          </div>
        )
      )}

      {creating && <NewFolder onClose={() => setCreating(false)} onCreate={(f) => create(f)} />}
    </>
  );
}
