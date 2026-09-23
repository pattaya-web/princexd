"use client";

import { useRef, useState } from "react";
import { useCollection } from "@/lib/client";
import { Card, CopyButton, Empty, ErrorNote, Field, Modal, Spinner, Toggle, useToast } from "./ui";
import { fmtDate, label, relative } from "@/lib/format";
import type { EditJob, EditStatus, MediaRef } from "@/lib/types";

const COLUMNS: EditStatus[] = ["rush-a-deposer", "a-monter", "en-cours", "livre", "retouches", "poste"];

/** Le monteur ne peut pas envoyer un job en « posté » : c'est ma décision. */
const EDITOR_STATUSES: EditStatus[] = ["a-monter", "en-cours", "livre"];

const STATUS_COLOR: Record<EditStatus, string> = {
  "rush-a-deposer": "var(--text-3)",
  "a-monter": "var(--s4)",
  "en-cours": "var(--s1)",
  livre: "var(--s3)",
  retouches: "var(--s2)",
  poste: "var(--s6)",
};

function blankJob(): Partial<EditJob> {
  return {
    title: "",
    status: "rush-a-deposer",
    style: "rapide",
    brief: "",
    subtitles: true,
    music: "",
    aspectRatio: "9:16",
    targetDurationSec: 30,
    priority: "P2",
    dueAt: "",
    assignee: "",
    postId: "",
    media: [],
    deliveryUrl: "",
    comments: [],
    deliveredAt: "",
    postedAt: "",
  };
}

function bytes(n: number) {
  if (n > 1e9) return `${(n / 1e9).toFixed(1)} Go`;
  if (n > 1e6) return `${Math.round(n / 1e6)} Mo`;
  return `${Math.round(n / 1e3)} Ko`;
}

export function MontageBoard({ role }: { role: "owner" | "editor" }) {
  const { rows, loading, error, create, patch, destroy } = useCollection<EditJob>("edits");
  const toast = useToast();
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Partial<EditJob>>(blankJob());

  const job = rows.find((j) => j.id === openId) ?? null;
  const columns = role === "editor" ? COLUMNS.filter((c) => c !== "rush-a-deposer") : COLUMNS;

  const submit = async () => {
    if (!draft.title?.trim()) return;
    try {
      const created = await create(draft);
      setCreating(false);
      setDraft(blankJob());
      setOpenId(created.id);
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  if (loading) return <Card><Spinner label="Chargement du board…" /></Card>;
  if (error) return <ErrorNote>{error}</ErrorNote>;

  return (
    <>
      {role === "owner" && (
        <div className="flex justify-end mb-3">
          <button className="btn btn-primary" onClick={() => { setDraft(blankJob()); setCreating(true); }}>
            + Nouveau montage
          </button>
        </div>
      )}

      {!rows.length ? (
        <Card>
          <Empty
            action={
              role === "owner" ? (
                <button className="btn btn-primary" onClick={() => setCreating(true)}>+ Nouveau montage</button>
              ) : undefined
            }
          >
            {role === "owner"
              ? "Crée un job, dépose tes rushs, passe-le en « À monter » — ton monteur le verra apparaître de son côté."
              : "Aucun montage à traiter pour l'instant. Reviens plus tard."}
          </Empty>
        </Card>
      ) : (
        <div className="scroll-x pb-2">
          <div className="flex gap-3 min-w-min">
            {columns.map((col) => {
              const items = rows.filter((j) => j.status === col);
              return (
                <div key={col} className="w-[272px] shrink-0">
                  <div className="flex items-center justify-between px-1 mb-2">
                    <span className="text-[12.5px] font-semibold flex items-center gap-1.5">
                      <span className="w-[7px] h-[7px] rounded-full" style={{ background: STATUS_COLOR[col] }} />
                      {label(col)}
                    </span>
                    <span className="badge !text-[10.5px]">{items.length}</span>
                  </div>
                  <div
                    className="flex flex-col gap-2 p-2 rounded-[10px] min-h-[100px]"
                    style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const id = e.dataTransfer.getData("text/plain");
                      if (!id) return;
                      if (role === "editor" && !EDITOR_STATUSES.includes(col)) {
                        toast("Cette colonne est réservée au propriétaire du compte.", "err");
                        return;
                      }
                      const extra =
                        col === "livre" ? { deliveredAt: new Date().toISOString() } : col === "poste" ? { postedAt: new Date().toISOString() } : {};
                      void patch(id, { status: col, ...extra });
                    }}
                  >
                    {items.map((j) => (
                      <article
                        key={j.id}
                        draggable
                        onDragStart={(e) => e.dataTransfer.setData("text/plain", j.id)}
                        onClick={() => setOpenId(j.id)}
                        className="card-flat px-2.5 py-2 cursor-pointer transition-colors hover:border-[var(--border-strong)]"
                      >
                        <div className="flex items-start gap-2">
                          <span
                            className="text-[10px] font-bold num shrink-0 mt-0.5"
                            style={{
                              color: j.priority === "P1" ? "var(--critical)" : j.priority === "P2" ? "var(--warning)" : "var(--text-3)",
                            }}
                          >
                            {j.priority}
                          </span>
                          <span className="text-[12.5px] font-medium leading-snug flex-1">{j.title}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 mt-2">
                          <span className="badge !text-[10px] !py-0">{label(j.style)}</span>
                          <span className="badge !text-[10px] !py-0">{j.aspectRatio}</span>
                          {j.media.filter((m) => m.kind === "rush").length > 0 && (
                            <span className="dim text-[10.5px]">
                              🎞 {j.media.filter((m) => m.kind === "rush").length}
                            </span>
                          )}
                          {j.media.filter((m) => m.kind === "livrable").length > 0 && (
                            <span className="text-[10.5px]" style={{ color: "var(--good)" }}>
                              ✓ {j.media.filter((m) => m.kind === "livrable").length}
                            </span>
                          )}
                        </div>
                        {j.dueAt && (
                          <div
                            className="text-[10.5px] num mt-1.5"
                            style={{
                              color: j.dueAt < new Date().toISOString().slice(0, 10) && j.status !== "poste" ? "var(--critical)" : "var(--text-3)",
                            }}
                          >
                            Pour le {fmtDate(j.dueAt)}
                          </div>
                        )}
                      </article>
                    ))}
                    {!items.length && <p className="dim text-[11.5px] text-center py-3">Vide</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Création */}
      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Nouveau montage"
        wide
        footer={
          <>
            <button className="btn" onClick={() => setCreating(false)}>Annuler</button>
            <button className="btn btn-primary" onClick={() => void submit()} disabled={!draft.title?.trim()}>
              Créer
            </button>
          </>
        }
      >
        <JobForm draft={draft} setDraft={setDraft} />
      </Modal>

      {/* Détail */}
      {job && (
        <JobDetail
          job={job}
          role={role}
          onClose={() => setOpenId(null)}
          onPatch={(p) => patch(job.id, p)}
          onDelete={async () => {
            if (!window.confirm(`Supprimer le montage « ${job.title} » ?`)) return;
            await destroy(job.id);
            setOpenId(null);
          }}
        />
      )}
    </>
  );
}

/* ------------------------------ Formulaire ------------------------------ */

function JobForm({
  draft,
  setDraft,
}: {
  draft: Partial<EditJob>;
  setDraft: (fn: (d: Partial<EditJob>) => Partial<EditJob>) => void;
}) {
  const set = <K extends keyof EditJob>(k: K, v: EditJob[K]) => setDraft((d) => ({ ...d, [k]: v }));
  return (
    <div className="grid sm:grid-cols-2 gap-3.5">
      <Field label="Titre" className="sm:col-span-2">
        <input
          className="input"
          placeholder="Reel — 3 erreurs qui tuent une boutique Shopify"
          value={draft.title ?? ""}
          onChange={(e) => set("title", e.target.value)}
        />
      </Field>
      <Field label="Style de montage">
        <select className="select" value={draft.style} onChange={(e) => set("style", e.target.value as EditJob["style"])}>
          {(["rapide", "cinematique", "talking-head", "carrousel-video", "story"] as const).map((s) => (
            <option key={s} value={s}>{label(s)}</option>
          ))}
        </select>
      </Field>
      <Field label="Format">
        <select className="select" value={draft.aspectRatio} onChange={(e) => set("aspectRatio", e.target.value as EditJob["aspectRatio"])}>
          <option value="9:16">9:16 — Reel / Story</option>
          <option value="1:1">1:1 — Feed carré</option>
          <option value="16:9">16:9 — YouTube</option>
        </select>
      </Field>
      <Field label="Durée cible (s)">
        <input
          className="input num"
          type="number"
          value={draft.targetDurationSec ?? 30}
          onChange={(e) => set("targetDurationSec", Number(e.target.value))}
        />
      </Field>
      <Field label="Priorité">
        <select className="select" value={draft.priority} onChange={(e) => set("priority", e.target.value as EditJob["priority"])}>
          <option value="P1">P1 — urgent</option>
          <option value="P2">P2 — normal</option>
          <option value="P3">P3 — quand tu peux</option>
        </select>
      </Field>
      <Field label="À rendre pour le">
        <input className="input" type="date" value={draft.dueAt ?? ""} onChange={(e) => set("dueAt", e.target.value)} />
      </Field>
      <Field label="Monteur assigné">
        <input className="input" value={draft.assignee ?? ""} onChange={(e) => set("assignee", e.target.value)} />
      </Field>
      <Field label="Musique / ambiance" className="sm:col-span-2">
        <input
          className="input"
          placeholder="Trap sombre, ou lien vers le son Instagram à reprendre"
          value={draft.music ?? ""}
          onChange={(e) => set("music", e.target.value)}
        />
      </Field>
      <div className="sm:col-span-2">
        <Toggle
          checked={draft.subtitles ?? true}
          onChange={(v) => set("subtitles", v)}
          label="Sous-titres incrustés obligatoires"
        />
      </div>
      <Field label="Brief" className="sm:col-span-2">
        <textarea
          className="textarea"
          style={{ minHeight: 120 }}
          placeholder="Garde le hook des 3 premières secondes intact. Coupe tous les silences. Zoom sur le dashboard à 0:12…"
          value={draft.brief ?? ""}
          onChange={(e) => set("brief", e.target.value)}
        />
      </Field>
    </div>
  );
}

/* -------------------------------- Détail -------------------------------- */

function JobDetail({
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
  const [comment, setComment] = useState("");
  const [uploading, setUploading] = useState<MediaRef["kind"] | null>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [refLink, setRefLink] = useState("");
  const [delivery, setDelivery] = useState(job.deliveryUrl ?? "");
  const rushInput = useRef<HTMLInputElement>(null);
  const refInput = useRef<HTMLInputElement>(null);
  const deliverInput = useRef<HTMLInputElement>(null);

  const author = role === "owner" ? "moi" : "monteur";

  const upload = async (files: FileList | null, kind: MediaRef["kind"]) => {
    if (!files?.length) return;
    setUploading(kind);
    try {
      const added: MediaRef[] = [];
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body: form });
        const body = (await res.json()) as { name?: string; url?: string; size?: number; error?: string };
        if (!res.ok || !body.url) throw new Error(body.error ?? "Envoi impossible");
        added.push({
          name: body.name ?? file.name,
          url: body.url,
          size: body.size ?? file.size,
          kind,
          addedBy: author,
          addedAt: new Date().toISOString(),
        });
      }
      await onPatch({ media: [...job.media, ...added] });
      toast(`${added.length} fichier${added.length > 1 ? "s" : ""} ajouté${added.length > 1 ? "s" : ""}.`);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setUploading(null);
    }
  };

  const addLink = async (kind: MediaRef["kind"], raw: string) => {
    const url = raw.trim();
    if (!url) return;
    await onPatch({
      media: [
        ...job.media,
        {
          name: url.split("/").pop() || "Lien externe",
          url,
          size: 0,
          kind,
          addedBy: author,
          addedAt: new Date().toISOString(),
        },
      ],
    });
    if (kind === "reference") setRefLink("");
    else setLinkUrl("");
  };

  const removeMedia = async (url: string) => {
    if (!window.confirm("Retirer ce fichier du montage ?")) return;
    await onPatch({ media: job.media.filter((m) => m.url !== url) });
  };

  /**
   * Enregistrer le lien fait aussi basculer le job en « livré » : sans ça il
   * faut penser a changer la colonne a la main, et personne ne le fait.
   */
  const saveDelivery = async () => {
    const url = delivery.trim();
    await onPatch({
      deliveryUrl: url,
      ...(url && job.status !== "livre" && job.status !== "poste"
        ? { status: "livre" as EditStatus, deliveredAt: new Date().toISOString() }
        : {}),
    });
    toast(url ? "Livraison enregistrée." : "Lien retiré.");
  };

  const postComment = async () => {
    if (!comment.trim()) return;
    await onPatch({
      comments: [...job.comments, { author, text: comment.trim(), at: new Date().toISOString() }],
    });
    setComment("");
  };

  const rushes = job.media.filter((m) => m.kind === "rush");
  const references = job.media.filter((m) => m.kind === "reference");
  const livrables = job.media.filter((m) => m.kind === "livrable");
  const statuses = role === "editor" ? EDITOR_STATUSES : COLUMNS;

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
          <select
            className="select !w-[170px]"
            value={job.status}
            onChange={(e) => {
              const next = e.target.value as EditStatus;
              const extra =
                next === "livre" ? { deliveredAt: new Date().toISOString() } : next === "poste" ? { postedAt: new Date().toISOString() } : {};
              void onPatch({ status: next, ...extra });
            }}
          >
            {statuses.map((s) => (
              <option key={s} value={s}>{label(s)}</option>
            ))}
          </select>
          <button className="btn btn-primary" onClick={onClose}>Fermer</button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-1.5">
          <span className="badge" style={{ color: STATUS_COLOR[job.status] }}>{label(job.status)}</span>
          <span className="badge">{label(job.style)}</span>
          <span className="badge">{job.aspectRatio}</span>
          <span className="badge">{job.targetDurationSec} s</span>
          <span className="badge">{job.subtitles ? "Sous-titres ✓" : "Sans sous-titres"}</span>
          <span className="badge">{job.priority}</span>
          {job.dueAt && <span className="badge">Pour le {fmtDate(job.dueAt)}</span>}
        </div>

        {job.brief && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="label-xs">Brief</span>
              <CopyButton text={job.brief} />
            </div>
            <p className="prose-sm p-3 rounded-[8px]" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
              {job.brief}
            </p>
          </div>
        )}

        {job.music && (
          <div>
            <span className="label-xs block mb-1.5">Musique / ambiance</span>
            <p className="text-[13px] muted">{job.music}</p>
          </div>
        )}

        {/* Vidéo de référence — le montage à reproduire */}
        <div>
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="label-xs" style={{ color: references.length ? "var(--accent)" : undefined }}>
              Montage à reproduire ({references.length})
            </span>
            {role === "owner" && (
              <>
                <input
                  ref={refInput}
                  type="file"
                  multiple
                  accept="video/*"
                  className="hidden"
                  onChange={(e) => void upload(e.target.files, "reference")}
                />
                <button
                  className="btn btn-sm"
                  onClick={() => refInput.current?.click()}
                  disabled={uploading !== null}
                >
                  {uploading === "reference" ? <span className="spinner" /> : "＋"} Ajouter une référence
                </button>
              </>
            )}
          </div>
          <MediaList items={references} onRemove={role === "owner" ? removeMedia : undefined} />
          {role === "owner" && (
            <div className="flex gap-2 mt-2">
              <input
                className="input !text-[12px]"
                placeholder="…ou colle le lien du reel de référence"
                value={refLink}
                onChange={(e) => setRefLink(e.target.value)}
              />
              <button
                className="btn btn-sm"
                onClick={() => void addLink("reference", refLink)}
                disabled={!refLink.trim()}
              >
                Ajouter
              </button>
            </div>
          )}
        </div>

        {/* Rushs */}
        <div>
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="label-xs">Rushs ({rushes.length})</span>
            {role === "owner" && (
              <>
                <input
                  ref={rushInput}
                  type="file"
                  multiple
                  accept="video/*,image/*,audio/*"
                  className="hidden"
                  onChange={(e) => void upload(e.target.files, "rush")}
                />
                <button className="btn btn-sm" onClick={() => rushInput.current?.click()} disabled={uploading !== null}>
                  {uploading === "rush" ? <span className="spinner" /> : "＋"} Déposer des rushs
                </button>
              </>
            )}
          </div>
          <MediaList items={rushes} onRemove={role === "owner" ? removeMedia : undefined} />
        </div>

        {/* Livraison — le monteur rend son travail par lien */}
        <div>
          <span className="label-xs block mb-2" style={{ color: job.deliveryUrl ? "var(--good)" : undefined }}>
            Livraison du monteur
          </span>
          <p className="dim text-[11.5px] mb-2 leading-relaxed">
            Un montage fait plusieurs Go : il ne remonte pas par le formulaire. Le monteur colle ici son lien
            SwissTransfer (ou WeTransfer, ou Drive).
          </p>
          <div className="flex gap-2">
            <input
              className="input mono !text-[12px]"
              placeholder="https://www.swisstransfer.com/d/…"
              value={delivery}
              onChange={(e) => setDelivery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveDelivery();
              }}
            />
            <button
              className="btn btn-sm btn-primary"
              onClick={() => void saveDelivery()}
              disabled={delivery.trim() === (job.deliveryUrl ?? "").trim()}
            >
              Enregistrer
            </button>
          </div>
          {job.deliveryUrl && (
            <div className="flex items-center gap-2 mt-2">
              <a
                href={job.deliveryUrl}
                target="_blank"
                rel="noreferrer"
                className="btn btn-sm flex-1"
                style={{ justifyContent: "center" }}
              >
                Ouvrir la livraison ↗
              </a>
              <CopyButton text={job.deliveryUrl} label="Lien" />
            </div>
          )}

          <div className="flex items-center justify-between gap-2 mt-4 mb-2">
            <span className="label-xs">Fichiers déposés ici ({livrables.length})</span>
            <>
              <input
                ref={deliverInput}
                type="file"
                multiple
                accept="video/*"
                className="hidden"
                onChange={(e) => void upload(e.target.files, "livrable")}
              />
              <button
                className="btn btn-sm"
                onClick={() => deliverInput.current?.click()}
                disabled={uploading !== null}
              >
                {uploading === "livrable" ? <span className="spinner" /> : "↑"} Déposer un fichier
              </button>
            </>
          </div>
          <MediaList items={livrables} onRemove={removeMedia} />
          <div className="flex gap-2 mt-2">
            <input
              className="input !text-[12px]"
              placeholder="…ou un autre lien"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
            />
            <button
              className="btn btn-sm"
              onClick={() => void addLink("livrable", linkUrl)}
              disabled={!linkUrl.trim()}
            >
              Ajouter
            </button>
          </div>
        </div>

        {/* Échanges */}
        <div>
          <span className="label-xs block mb-2">Échanges</span>
          {job.comments.length > 0 && (
            <ul className="flex flex-col gap-2 mb-2.5">
              {job.comments.map((c, i) => (
                <li
                  key={i}
                  className="px-2.5 py-2 rounded-[8px] text-[12.5px] leading-relaxed"
                  style={{
                    background: c.author === author ? "var(--accent-soft)" : "var(--surface-2)",
                    border: "1px solid var(--border)",
                  }}
                >
                  <div className="flex items-baseline justify-between gap-2 mb-0.5">
                    <span className="font-semibold text-[11.5px]">{c.author === "moi" ? "Moi" : "Monteur"}</span>
                    <span className="dim text-[10.5px]">{relative(c.at)}</span>
                  </div>
                  {c.text}
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <input
              className="input"
              placeholder="Un mot pour l'autre…"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void postComment();
              }}
            />
            <button className="btn" onClick={() => void postComment()} disabled={!comment.trim()}>
              Envoyer
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function MediaList({ items, onRemove }: { items: MediaRef[]; onRemove?: (url: string) => void }) {
  if (!items.length) return <p className="dim text-[12px] py-2">Aucun fichier.</p>;
  return (
    <div className="grid sm:grid-cols-2 gap-2">
      {items.map((m) => {
        const isVideo = /\.(mp4|mov|webm|m4v|mkv|avi)$/i.test(m.url);
        const isImage = /\.(png|jpe?g|webp|gif)$/i.test(m.url);
        const local = m.url.startsWith("/api/media/");
        return (
          <div key={m.url} className="card-flat overflow-hidden">
            {isVideo ? (
              <video src={m.url} controls playsInline className="w-full" style={{ maxHeight: 180, background: "#000" }} />
            ) : isImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={m.url} alt={m.name} className="w-full object-cover" style={{ maxHeight: 180 }} loading="lazy" />
            ) : null}
            <div className="px-2.5 py-2 flex items-center gap-2">
              <span className="text-[11.5px] flex-1 min-w-0 truncate" title={m.name}>{m.name}</span>
              {m.size > 0 && <span className="dim text-[10.5px] shrink-0">{bytes(m.size)}</span>}
              {/* Un fichier stocké se télécharge sous son vrai nom ; un lien externe s'ouvre. */}
              {local ? (
                <a
                  href={`${m.url}?download=1&name=${encodeURIComponent(m.name)}`}
                  download={m.name}
                  className="btn btn-sm shrink-0"
                  title="Télécharger"
                >
                  ↓
                </a>
              ) : null}
              <a href={m.url} target="_blank" rel="noreferrer" className="btn btn-sm btn-ghost shrink-0" title="Ouvrir">↗</a>
              {onRemove && (
                <button className="btn btn-sm btn-danger shrink-0" onClick={() => onRemove(m.url)} aria-label="Retirer">
                  ✕
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
