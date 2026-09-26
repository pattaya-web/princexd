"use client";

/* eslint-disable @next/next/no-img-element */

import { useMemo, useState } from "react";
import { useCollection } from "@/lib/client";
import { formatBytes } from "@/lib/upload-client";
import { DropZone, ProgressBar, uploadMany, type Progress } from "./upload-ui";
import { Card, Empty, ErrorNote, Field, Modal, Spinner, Tabs, useToast } from "./ui";
import { relative } from "@/lib/format";
import type { EditJob, EditStatus, MediaRef } from "@/lib/types";

/**
 * Drive de montage, partage entre moi et le monteur.
 *
 * Un dossier = une video a produire : mes rushs, l'inspiration (lien et
 * video de reference), les consignes, puis le montage livre. Trois onglets
 * suivent la vie du dossier : a monter, livre, termine.
 */

type Tab = "rushs" | "livrees" | "terminees";

const STATUS_LABEL: Record<EditStatus, string> = {
  "rush-a-deposer": "Brouillon",
  "a-monter": "À monter",
  "en-cours": "En cours",
  livre: "Livrée",
  retouches: "Retouches",
  poste: "Postée",
};

const STATUS_COLOR: Record<EditStatus, string> = {
  "rush-a-deposer": "var(--text-3)",
  "a-monter": "var(--s4)",
  "en-cours": "var(--s1)",
  livre: "var(--good)",
  retouches: "var(--warning)",
  poste: "var(--s6)",
};

const TAB_OF: Record<EditStatus, Tab> = {
  "rush-a-deposer": "rushs",
  "a-monter": "rushs",
  "en-cours": "rushs",
  retouches: "rushs",
  livre: "livrees",
  poste: "terminees",
};

const isVideo = (url: string) => /\.(mp4|mov|webm|m4v|mkv|avi)(\?|$)/i.test(url);
const isImage = (url: string) => /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url);
const isLocal = (url: string) => url.startsWith("/api/media/");

/** Envoie plusieurs fichiers l'un apres l'autre en les typant pour le dossier. */
async function uploadAll(
  files: File[],
  kind: MediaRef["kind"],
  addedBy: MediaRef["addedBy"],
  onProgress: (p: Progress | null) => void,
): Promise<MediaRef[]> {
  const ups = await uploadMany(files, onProgress);
  return ups.map((up) => ({ name: up.name, url: up.url, size: up.size, kind, addedBy, addedAt: new Date().toISOString() }));
}

/* ------------------------------ Vignettes ------------------------------ */

function MediaTile({ m, onRemove }: { m: MediaRef; onRemove?: () => void }) {
  const local = isLocal(m.url);
  return (
    <div className="card-flat overflow-hidden flex flex-col">
      <div className="relative" style={{ background: "#000", aspectRatio: "9 / 12" }}>
        {isVideo(m.url) ? (
          <video src={m.url} controls playsInline preload="metadata" className="w-full h-full object-contain" />
        ) : isImage(m.url) ? (
          <img src={m.url} alt={m.name} className="w-full h-full object-contain" loading="lazy" />
        ) : (
          <a href={m.url} target="_blank" rel="noreferrer" className="absolute inset-0 grid place-items-center text-[12px] px-3 text-center" style={{ color: "#fff" }}>
            Ouvrir le lien ↗
          </a>
        )}
      </div>
      <div className="px-2 py-1.5 flex items-center gap-1.5">
        <span className="text-[11.5px] flex-1 min-w-0 truncate" title={m.name}>{m.name}</span>
        {m.size > 0 && <span className="dim text-[10.5px] shrink-0">{formatBytes(m.size)}</span>}
        {local ? (
          <a href={`${m.url}?download=1&name=${encodeURIComponent(m.name)}`} download={m.name} className="btn btn-sm shrink-0" title="Télécharger">↓</a>
        ) : (
          <a href={m.url} target="_blank" rel="noreferrer" className="btn btn-sm shrink-0" title="Ouvrir">↗</a>
        )}
        {onRemove && (
          <button className="btn btn-sm btn-danger shrink-0" onClick={onRemove} aria-label="Retirer">✕</button>
        )}
      </div>
    </div>
  );
}

function MediaGrid({ items, onRemove }: { items: MediaRef[]; onRemove?: (url: string) => void }) {
  if (!items.length) return null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
      {items.map((m) => (
        <MediaTile key={m.url} m={m} onRemove={onRemove ? () => onRemove(m.url) : undefined} />
      ))}
    </div>
  );
}

/* ------------------------------ Dossier ------------------------------ */

function FolderCard({ job, onOpen }: { job: EditJob; onOpen: () => void }) {
  const rushes = job.media.filter((m) => m.kind === "rush");
  const refs = job.media.filter((m) => m.kind === "reference");
  const livrables = job.media.filter((m) => m.kind === "livrable");
  const cover = (livrables[0] ?? rushes[0]) ?? null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="card-flat text-left overflow-hidden transition-colors hover:border-[var(--border-strong)]"
    >
      <div className="relative" style={{ background: "var(--surface-3)", aspectRatio: "16 / 10" }}>
        {cover && isVideo(cover.url) ? (
          <video src={cover.url} muted playsInline preload="metadata" className="w-full h-full object-cover" />
        ) : cover && isImage(cover.url) ? (
          <img src={cover.url} alt="" className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <span className="absolute inset-0 grid place-items-center text-[28px]">🎬</span>
        )}
        <span
          className="absolute top-2 left-2 badge !text-[10.5px]"
          style={{ background: "var(--surface)", color: STATUS_COLOR[job.status], borderColor: STATUS_COLOR[job.status] }}
        >
          {STATUS_LABEL[job.status]}
        </span>
      </div>
      <div className="px-3 py-2.5">
        <p className="text-[13px] font-medium leading-snug truncate" title={job.title}>{job.title}</p>
        <p className="dim text-[11px] mt-1 flex flex-wrap gap-x-2.5">
          <span>{relative(job.createdAt)}</span>
          <span>🎞 {rushes.length} rush{rushes.length > 1 ? "s" : ""}</span>
          {refs.length > 0 && <span>✨ inspiration</span>}
          {livrables.length > 0 && <span style={{ color: "var(--good)" }}>✓ {livrables.length} livrée{livrables.length > 1 ? "s" : ""}</span>}
          {job.comments.length > 0 && <span>💬 {job.comments.length}</span>}
        </p>
      </div>
    </button>
  );
}

function Section({ title, hint, action, children }: { title: string; hint?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <h4 className="text-[13px] font-semibold">
          {title}
          {hint && <span className="dim font-normal text-[11.5px] ml-2">{hint}</span>}
        </h4>
        {action}
      </div>
      {children}
    </section>
  );
}

function FolderDetail({
  job,
  role,
  onClose,
  onPatch,
  onDelete,
}: {
  job: EditJob;
  role: "owner" | "editor";
  onClose: () => void;
  onPatch: (patch: Partial<EditJob>) => Promise<unknown>;
  onDelete: () => Promise<void>;
}) {
  const toast = useToast();
  const author: MediaRef["addedBy"] = role === "owner" ? "moi" : "monteur";
  const [progress, setProgress] = useState<Progress | null>(null);
  const [refLink, setRefLink] = useState("");
  const [brief, setBrief] = useState(job.brief);
  const [comment, setComment] = useState("");

  const rushes = job.media.filter((m) => m.kind === "rush");
  const refs = job.media.filter((m) => m.kind === "reference");
  const livrables = job.media.filter((m) => m.kind === "livrable");

  const addFiles = async (files: File[], kind: MediaRef["kind"]) => {
    try {
      const added = await uploadAll(files, kind, author, setProgress);
      const extra: Partial<EditJob> =
        kind === "livrable" && job.status !== "poste"
          ? { status: "livre", deliveredAt: new Date().toISOString() }
          : {};
      await onPatch({ media: [...job.media, ...added], ...extra });
      toast(kind === "livrable" ? "Montage déposé. Le dossier passe en « Livrée »." : `${added.length} fichier${added.length > 1 ? "s" : ""} ajouté${added.length > 1 ? "s" : ""}.`);
    } catch (e) {
      setProgress(null);
      toast((e as Error).message, "err");
    }
  };

  const addRefLink = async () => {
    const url = refLink.trim();
    if (!url) return;
    await onPatch({
      media: [...job.media, { name: url.replace(/^https?:\/\//, "").slice(0, 60), url, size: 0, kind: "reference", addedBy: author, addedAt: new Date().toISOString() }],
    });
    setRefLink("");
  };

  const removeMedia = async (url: string) => {
    if (!window.confirm("Retirer ce fichier du dossier ?")) return;
    await onPatch({ media: job.media.filter((m) => m.url !== url) });
  };

  const postComment = async (text: string, extra: Partial<EditJob> = {}) => {
    const t = text.trim();
    if (!t && !Object.keys(extra).length) return;
    await onPatch({
      ...(t ? { comments: [...job.comments, { author, text: t, at: new Date().toISOString() }] } : {}),
      ...extra,
    });
    setComment("");
  };

  const askChanges = async () => {
    const t = comment.trim();
    if (!t) {
      toast("Écris d'abord ce qu'il faut retoucher dans le commentaire.", "err");
      return;
    }
    await postComment(t, { status: "retouches" });
    toast("Retouches demandées.");
  };

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={job.title}
      footer={
        <>
          {role === "owner" && (
            <button className="btn btn-danger mr-auto" onClick={() => void onDelete()}>Supprimer</button>
          )}
          <button className="btn" onClick={onClose}>Fermer</button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <span className="badge" style={{ color: STATUS_COLOR[job.status], borderColor: STATUS_COLOR[job.status] }}>
            {STATUS_LABEL[job.status]}
          </span>
          <span className="dim">Créé {relative(job.createdAt)}</span>
          {job.deliveredAt && <span className="dim">· Livré {relative(job.deliveredAt)}</span>}
          {role === "editor" && job.status === "a-monter" && (
            <button className="btn btn-sm ml-auto" onClick={() => void onPatch({ status: "en-cours" })}>
              Je commence le montage
            </button>
          )}
          {role === "owner" && job.status === "livre" && (
            <span className="ml-auto flex gap-2">
              <button className="btn btn-sm" onClick={() => void askChanges()}>Demander des retouches</button>
              <button className="btn btn-sm btn-primary" onClick={() => void onPatch({ status: "poste", postedAt: new Date().toISOString() })}>
                ✓ Validée · postée
              </button>
            </span>
          )}
          {role === "owner" && job.status === "poste" && (
            <button className="btn btn-sm ml-auto" onClick={() => void onPatch({ status: "livre" })}>Remettre en livrée</button>
          )}
        </div>

        {progress && <ProgressBar p={progress} />}

        <Section title="Rushs" hint={`${rushes.length} fichier${rushes.length > 1 ? "s" : ""}`}>
          <div className="flex flex-col gap-2">
            <MediaGrid items={rushes} onRemove={role === "owner" ? removeMedia : undefined} />
            {role === "owner" && (
              <DropZone
                label="Ajouter des rushs"
                hint="Glisse tes vidéos ici, ou clique pour choisir. Plusieurs fichiers possibles."
                accept="video/*,image/*,.mkv,.m4v,.mov"
                disabled={progress !== null}
                onFiles={(f) => void addFiles(f, "rush")}
              />
            )}
            {role === "editor" && !rushes.length && <p className="dim text-[12px]">Aucun rush pour l&apos;instant.</p>}
          </div>
        </Section>

        <Section title="Inspiration" hint="ce que le montage doit reproduire">
          <div className="flex flex-col gap-2">
            {refs.length > 0 ? (
              <MediaGrid items={refs} onRemove={role === "owner" ? removeMedia : undefined} />
            ) : (
              <p className="dim text-[12px]">{role === "owner" ? "Pas encore d'inspiration. Ajoute un lien ou une vidéo de référence." : "Pas d'inspiration précise : montage libre."}</p>
            )}
            {role === "owner" && (
              <div className="grid sm:grid-cols-2 gap-2">
                <div className="flex gap-2">
                  <input
                    className="input flex-1"
                    placeholder="Lien Instagram, TikTok, YouTube…"
                    value={refLink}
                    onChange={(e) => setRefLink(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void addRefLink(); }}
                  />
                  <button className="btn" onClick={() => void addRefLink()} disabled={!refLink.trim()}>Ajouter</button>
                </div>
                <DropZone
                  label="Vidéo de référence"
                  hint="Un fichier que tu as enregistré"
                  accept="video/*,image/*,.mkv,.m4v,.mov"
                  disabled={progress !== null}
                  onFiles={(f) => void addFiles(f, "reference")}
                />
              </div>
            )}
          </div>
        </Section>

        <Section title="Consignes">
          {role === "owner" ? (
            <textarea
              className="input w-full"
              rows={3}
              placeholder="Durée visée, sous-titres, musique, ton, ce qu'il faut couper…"
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              onBlur={() => { if (brief !== job.brief) void onPatch({ brief }); }}
            />
          ) : (
            <p className="text-[12.5px] whitespace-pre-wrap leading-relaxed">{job.brief || <span className="dim">Aucune consigne particulière.</span>}</p>
          )}
        </Section>

        <Section title="Montage livré" hint={livrables.length ? `${livrables.length} version${livrables.length > 1 ? "s" : ""}` : undefined}>
          <div className="flex flex-col gap-2">
            <MediaGrid items={livrables} onRemove={role === "editor" ? removeMedia : undefined} />
            {role === "editor" ? (
              <DropZone
                label={livrables.length ? "Déposer une nouvelle version" : "Déposer le montage terminé"}
                hint="Le dossier passe automatiquement en « Livrée »"
                accept="video/*,.mkv,.m4v,.mov"
                disabled={progress !== null}
                onFiles={(f) => void addFiles(f, "livrable")}
              />
            ) : (
              !livrables.length && <p className="dim text-[12px]">Le monteur n&apos;a rien déposé pour l&apos;instant.</p>
            )}
          </div>
        </Section>

        <Section title="Commentaires">
          <div className="flex flex-col gap-2">
            {job.comments.map((c, i) => (
              <div key={i} className="rounded-[8px] px-3 py-2 text-[12.5px]" style={{ background: c.author === "moi" ? "var(--surface-2)" : "color-mix(in srgb, var(--accent) 10%, transparent)" }}>
                <span className="font-semibold">{c.author === "moi" ? "Mady" : "Monteur"}</span>
                <span className="dim text-[11px] ml-2">{relative(c.at)}</span>
                <p className="mt-0.5 whitespace-pre-wrap">{c.text}</p>
              </div>
            ))}
            <div className="flex gap-2">
              <input
                className="input flex-1"
                placeholder="Écrire un commentaire…"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void postComment(comment); }}
              />
              <button className="btn" onClick={() => void postComment(comment)} disabled={!comment.trim()}>Envoyer</button>
            </div>
          </div>
        </Section>
      </div>
    </Modal>
  );
}

/* ------------------------------ Nouveau dossier ------------------------------ */

function NewFolder({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (job: Partial<EditJob>) => Promise<EditJob>;
  }) {
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [refLink, setRefLink] = useState("");
  const [rushes, setRushes] = useState<File[]>([]);
  const [refFile, setRefFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const t = title.trim() || (rushes[0]?.name.replace(/\.[^.]+$/, "") ?? "");
    if (!t) return;
    setBusy(true);
    try {
      const media: MediaRef[] = [];
      if (refLink.trim()) {
        media.push({ name: refLink.trim().replace(/^https?:\/\//, "").slice(0, 60), url: refLink.trim(), size: 0, kind: "reference", addedBy: "moi", addedAt: new Date().toISOString() });
      }
      const uploadedRushes = await uploadAll(rushes, "rush", "moi", setProgress);
      const uploadedRef = refFile ? await uploadAll([refFile], "reference", "moi", setProgress) : [];
      await onCreate({
        title: t,
        status: "a-monter",
        style: "rapide",
        brief: brief.trim(),
        subtitles: true,
        music: "",
        aspectRatio: "9:16",
        targetDurationSec: 30,
        priority: "P2",
        dueAt: "",
        assignee: "",
        postId: "",
        media: [...uploadedRushes, ...uploadedRef, ...media],
        deliveryUrl: "",
        comments: [],
        deliveredAt: "",
        postedAt: "",
      });
      toast("Dossier créé. Ton monteur le voit dès maintenant.");
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
      wide
      title="Nouveau dossier de montage"
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Annuler</button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy || (!title.trim() && !rushes.length)}>
            {busy ? <span className="spinner" /> : "Créer le dossier"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Titre" hint="Ce que le monteur verra en premier. Sans titre, le nom du premier rush est repris.">
          <input className="input w-full" placeholder="Ex. Reel dashboard Shopify · 3 000 € en 30 jours" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </Field>

        <Field label="Rushs">
          <div className="flex flex-col gap-2">
            {rushes.length > 0 && (
              <ul className="flex flex-col gap-1">
                {rushes.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex items-center gap-2 text-[12px] rounded-[7px] px-2.5 py-1.5" style={{ background: "var(--surface-2)" }}>
                    <span className="flex-1 min-w-0 truncate">{f.name}</span>
                    <span className="dim shrink-0">{formatBytes(f.size)}</span>
                    <button className="btn btn-sm btn-ghost shrink-0" onClick={() => setRushes((r) => r.filter((_, j) => j !== i))} disabled={busy}>✕</button>
                  </li>
                ))}
              </ul>
            )}
            <DropZone
              label={rushes.length ? "Ajouter d'autres rushs" : "Glisse tes vidéos ici"}
              hint="Depuis ton téléphone ou ton PC. Plusieurs fichiers à la fois, jusqu'à 2 Go chacun."
              accept="video/*,image/*,.mkv,.m4v,.mov"
              disabled={busy}
              onFiles={(f) => setRushes((r) => [...r, ...f])}
            />
          </div>
        </Field>

        <Field label="Inspiration" hint="Optionnel. Un lien vers la vidéo qui t'a plu, et/ou le fichier si tu l'as enregistré.">
          <div className="grid sm:grid-cols-2 gap-2">
            <input className="input" placeholder="Lien Instagram, TikTok, YouTube…" value={refLink} onChange={(e) => setRefLink(e.target.value)} />
            {refFile ? (
              <div className="flex items-center gap-2 text-[12px] rounded-[7px] px-2.5" style={{ background: "var(--surface-2)" }}>
                <span className="flex-1 min-w-0 truncate">{refFile.name}</span>
                <button className="btn btn-sm btn-ghost" onClick={() => setRefFile(null)} disabled={busy}>✕</button>
              </div>
            ) : (
              <DropZone label="Vidéo de référence" multiple={false} accept="video/*,image/*,.mkv,.m4v,.mov" disabled={busy} onFiles={(f) => setRefFile(f[0] ?? null)} />
            )}
          </div>
        </Field>

        <Field label="Consignes" hint="Optionnel. Durée visée, sous-titres, musique, ce qu'il faut garder ou couper.">
          <textarea className="input w-full" rows={3} value={brief} onChange={(e) => setBrief(e.target.value)} />
        </Field>

        {progress && <ProgressBar p={progress} />}
      </div>
    </Modal>
  );
}

/* ------------------------------ Drive ------------------------------ */

export function MontageDrive({ role }: { role: "owner" | "editor" }) {
  const { rows, loading, error, create, patch, destroy } = useCollection<EditJob>("edits");
  const [tab, setTab] = useState<Tab>("rushs");
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Le monteur ne voit pas les brouillons : un dossier sans rush ne lui sert a rien.
  const visible = useMemo(
    () => (role === "editor" ? rows.filter((j) => j.status !== "rush-a-deposer") : rows),
    [rows, role],
  );
  const byTab = useMemo(() => {
    const m: Record<Tab, EditJob[]> = { rushs: [], livrees: [], terminees: [] };
    for (const j of visible) m[TAB_OF[j.status]].push(j);
    for (const k of Object.keys(m) as Tab[]) m[k].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    // Monteur : les retouches demandées passent devant, c'est ce qui bloque Mady.
    if (role === "editor") {
      const rank = (j: EditJob) => (j.status === "retouches" ? 0 : j.status === "en-cours" ? 1 : 2);
      m.rushs.sort((a, b) => rank(a) - rank(b) || b.createdAt.localeCompare(a.createdAt));
    }
    return m;
  }, [visible, role]);

  const job = rows.find((j) => j.id === openId) ?? null;
  const list = byTab[tab];

  if (loading) return <Card><Spinner label="Chargement du drive…" /></Card>;
  if (error) return <ErrorNote>{error}</ErrorNote>;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <Tabs
          value={tab}
          onChange={setTab}
          options={[
            { value: "rushs", label: role === "editor" ? "À monter" : "Rushs", count: byTab.rushs.length },
            { value: "livrees", label: "Vidéos livrées", count: byTab.livrees.length },
            { value: "terminees", label: "Postées", count: byTab.terminees.length },
          ]}
        />
        {role === "owner" && (
          <button className="btn btn-primary" onClick={() => setCreating(true)}>+ Nouveau dossier</button>
        )}
      </div>

      {!list.length ? (
        <Card>
          <Empty action={role === "owner" && tab === "rushs" ? <button className="btn btn-primary" onClick={() => setCreating(true)}>+ Nouveau dossier</button> : undefined}>
            {tab === "rushs"
              ? role === "owner"
                ? "Crée un dossier avec tes rushs : ton monteur le verra apparaître de son côté."
                : "Rien à monter pour l'instant. Reviens plus tard."
              : tab === "livrees"
                ? role === "owner"
                  ? "Aucune vidéo livrée en attente. Elles apparaîtront ici dès que le monteur déposera un montage."
                  : "Aucune vidéo livrée. Dépose ton montage depuis le dossier concerné."
                : "Aucune vidéo postée pour l'instant."}
          </Empty>
        </Card>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {list.map((j) => (
            <FolderCard key={j.id} job={j} onOpen={() => setOpenId(j.id)} />
          ))}
        </div>
      )}

      {creating && <NewFolder onClose={() => setCreating(false)} onCreate={(j) => create(j)} />}

      {job && (
        <FolderDetail
          job={job}
          role={role}
          onClose={() => setOpenId(null)}
          onPatch={(p) => patch(job.id, p)}
          onDelete={async () => {
            if (!window.confirm(`Supprimer le dossier « ${job.title} » et ses fichiers de la liste ?`)) return;
            await destroy(job.id);
            setOpenId(null);
          }}
        />
      )}
    </>
  );
}
