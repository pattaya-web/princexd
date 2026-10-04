"use client";

/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useCollection } from "@/lib/client";
import { fmtDateTime, relative } from "@/lib/format";
import { formatBytes } from "@/lib/upload-client";
import { ThumbImg, VideoThumb } from "@/components/MediaThumb";
import { DropZone, ProgressBar, uploadMany, type Progress } from "./upload-ui";
import { Card, Empty, ErrorNote, Field, Modal, Spinner, useToast } from "./ui";
import type { BrollItem } from "@/lib/types";

/**
 * Bibliotheque de B-roll, partagee entre moi et le monteur.
 *
 * Les plans de coupe ne dependent d'aucun dossier : je les depose au fil de
 * l'eau (tournages, lifestyle, captures d'ecran…), le monteur pioche dedans
 * pour les reels comme pour les pubs. L'enjeu principal est qu'il SACHE
 * qu'il y a du nouveau : la bibliotheque expose un compteur de pieces jamais
 * vues, affiche sur l'onglet du drive et dans son menu.
 */

const ACCEPT = "video/*,image/*,.mkv,.m4v,.mov";

/**
 * Repere du dernier passage du monteur dans la bibliotheque, garde dans le
 * navigateur. Il n'y a qu'un monteur : un badge qui reapparait sur un autre
 * appareil n'est pas un probleme, il rappelle juste qu'il y a de la matiere.
 */
const SEEN_KEY = "broll:seen";
const SEEN_EVENT = "broll:seen";

function kindOf(name: string, type: string): BrollItem["kind"] {
  if (type.startsWith("video/") || /\.(mp4|mov|webm|m4v|mkv|avi)$/i.test(name)) return "video";
  return "image";
}

/**
 * Nombre de B-roll ajoutes depuis le dernier passage, et de quoi marquer
 * le passage. Plusieurs ecrans l'utilisent en meme temps (menu, onglet,
 * bibliotheque) : ils se tiennent au courant par un evenement fenetre.
 */
export function useBrollFresh(role: "owner" | "editor") {
  const { rows } = useCollection<BrollItem>("broll");
  // null tant que le navigateur n'a pas ete lu : evite un badge qui clignote.
  const [seen, setSeen] = useState<string | null>(null);

  useEffect(() => {
    const read = () => {
      try {
        setSeen(window.localStorage.getItem(SEEN_KEY) ?? "");
      } catch {
        setSeen("");
      }
    };
    read();
    window.addEventListener(SEEN_EVENT, read);
    return () => window.removeEventListener(SEEN_EVENT, read);
  }, []);

  const latest = useMemo(() => rows.reduce((m, b) => (b.addedAt > m ? b.addedAt : m), ""), [rows]);
  const fresh = role === "editor" && seen !== null ? rows.filter((b) => b.addedAt > seen).length : 0;

  const markSeen = useCallback(() => {
    if (!latest || latest === seen) return;
    try {
      window.localStorage.setItem(SEEN_KEY, latest);
    } catch {
      // Navigation privee : le badge reviendra, ce n'est qu'un rappel.
    }
    window.dispatchEvent(new Event(SEEN_EVENT));
  }, [latest, seen]);

  return { rows, fresh, seen, markSeen };
}

export function BrollLibrary({ role }: { role: "owner" | "editor" }) {
  const { rows, loading, error, create, patch, destroy } = useCollection<BrollItem>("broll");
  const { seen, markSeen } = useBrollFresh(role);
  const toast = useToast();
  const [progress, setProgress] = useState<Progress | null>(null);
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("");
  const [open, setOpen] = useState<BrollItem | null>(null);
  const [note, setNote] = useState("");
  const [tags, setTags] = useState("");
  const [saving, setSaving] = useState(false);

  /*
   * Le monteur ouvre la bibliotheque : on fige le repere « nouveau » pour
   * cette visite (les pieces fraiches restent marquees pendant qu'il les
   * regarde), puis on enregistre le passage pour que le badge retombe.
   */
  const [newSince, setNewSince] = useState<string | null>(null);
  useEffect(() => {
    if (role !== "editor" || seen === null || newSince !== null || loading) return;
    setNewSince(seen);
    markSeen();
  }, [role, seen, newSince, loading, markSeen]);
  const isNew = (b: BrollItem) => role === "editor" && newSince !== null && b.addedAt > newSince;

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
      toast(`${uploaded.length} B-roll ajouté${uploaded.length > 1 ? "s" : ""}. Ton monteur verra le badge « nouveau ».`);
    } catch (e) {
      setProgress(null);
      toast((e as Error).message, "err");
    }
  };

  const allTags = useMemo(() => [...new Set(rows.flatMap((r) => r.tags ?? []))].sort(), [rows]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows
      .filter((r) => !tag || (r.tags ?? []).includes(tag))
      .filter((r) => !needle || `${r.name} ${r.note} ${(r.tags ?? []).join(" ")}`.toLowerCase().includes(needle))
      .sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  }, [rows, q, tag]);

  const openOne = (b: BrollItem) => {
    setOpen(b);
    setNote(b.note ?? "");
    setTags((b.tags ?? []).join(", "));
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

  const remove = async (b: BrollItem) => {
    if (!window.confirm(`Supprimer « ${b.name} » de la bibliothèque ?`)) return;
    try {
      await destroy(b.id);
      setOpen(null);
      toast("Supprimé.");
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  const downloadHref = (b: BrollItem) => `${b.url}?download=1&name=${encodeURIComponent(b.name)}`;

  if (loading && !rows.length) return <Card><Spinner label="Chargement des B-roll…" /></Card>;
  if (error) return <ErrorNote>{error}</ErrorNote>;

  return (
    <div className="flex flex-col gap-3">
      {role === "owner" ? (
        <div>
          <DropZone
            label="Glisse tes B-roll ici, ou clique pour choisir"
            hint="Plans de coupe, lifestyle, captures d'écran… Vidéos et images, plusieurs à la fois, jusqu'à 2 Go chacun."
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
      ) : (
        <p className="text-[12.5px] leading-relaxed" style={{ color: "var(--text-2)" }}>
          Des plans de coupe à utiliser librement dans tes montages, reels comme pubs. Clique sur un élément pour le
          voir en grand et lire la note, ou télécharge-le directement avec <strong>↓</strong>. Ceux marqués{" "}
          <strong>Nouveau</strong> ont été ajoutés depuis ta dernière visite.
        </p>
      )}

      {rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
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

      {!rows.length ? (
        <Card>
          <Empty>
            {role === "owner"
              ? "Aucun B-roll pour l'instant. Dépose tes premiers plans de coupe ci-dessus : ton monteur les verra apparaître avec un badge « nouveau »."
              : "Aucun B-roll pour l'instant. Mady en déposera au fil des tournages."}
          </Empty>
        </Card>
      ) : !shown.length ? (
        <Card>
          <Empty>Rien ne correspond à cette recherche.</Empty>
        </Card>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {shown.map((b) => (
            <article
              key={b.id}
              className="tile card-flat relative overflow-hidden cursor-pointer"
              style={{
                aspectRatio: "4 / 5",
                background: "var(--surface-3)",
                ...(isNew(b) ? { outline: "2px solid var(--accent)", outlineOffset: -2 } : {}),
              }}
              onClick={() => openOne(b)}
              title={b.note || b.name}
            >
              {b.kind === "video" ? <VideoThumb src={b.url} /> : <ThumbImg src={b.url} />}
              {b.kind === "video" && (
                <span
                  className="absolute top-1.5 left-1.5 rounded-full grid place-items-center text-[11px] pointer-events-none"
                  style={{ width: 22, height: 22, background: "rgb(0 0 0 / 0.55)", color: "#fff" }}
                >
                  ▶
                </span>
              )}
              {isNew(b) && (
                <span
                  className="absolute top-1.5 right-1.5 rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold pointer-events-none"
                  style={{ background: "var(--accent)", color: "var(--accent-on)" }}
                >
                  Nouveau
                </span>
              )}
              <a
                href={downloadHref(b)}
                download={b.name}
                onClick={(e) => e.stopPropagation()}
                className="absolute bottom-9 right-1.5 rounded-full grid place-items-center text-[13px]"
                style={{ width: 28, height: 28, background: "rgb(0 0 0 / 0.6)", color: "#fff" }}
                title="Télécharger"
              >
                ↓
              </a>
              <div
                className="absolute inset-x-0 bottom-0 px-2 py-1.5 text-[11px] leading-snug pointer-events-none"
                style={{ background: "linear-gradient(transparent, rgb(0 0 0 / 0.75))", color: "#fff" }}
              >
                <div className="truncate font-medium">{b.note || b.name}</div>
                <div className="truncate opacity-80">
                  {(b.tags ?? []).length > 0 ? b.tags.join(" · ") : relative(b.addedAt)}
                </div>
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
              {role === "owner" && (
                <button className="btn mr-auto" style={{ color: "var(--critical)" }} onClick={() => void remove(open)}>
                  Supprimer
                </button>
              )}
              <a className="btn" href={downloadHref(open)} download={open.name}>
                ↓ Télécharger
              </a>
              {role === "owner" ? (
                <button className="btn btn-primary" onClick={() => void save()} disabled={saving}>
                  {saving ? <span className="spinner" /> : "Enregistrer"}
                </button>
              ) : (
                <button className="btn btn-primary" onClick={() => setOpen(null)}>Fermer</button>
              )}
            </>
          ) : null
        }
      >
        {open && (
          <div className="grid lg:grid-cols-5 gap-4">
            <div className="lg:col-span-3 rounded-[10px] overflow-hidden" style={{ background: "var(--surface-3)" }}>
              {open.kind === "video" ? (
                <video src={open.url} controls playsInline className="w-full max-h-[70vh]" />
              ) : (
                <img src={open.url} alt={open.name} className="w-full max-h-[70vh] object-contain" />
              )}
            </div>
            <div className="lg:col-span-2 flex flex-col gap-3">
              {role === "owner" ? (
                <>
                  <Field label="Note" hint="Ce que montre le plan, où l'utiliser.">
                    <textarea className="textarea w-full" rows={5} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex. Plan drone Dubaï, pour les intros lifestyle" />
                  </Field>
                  <Field label="Étiquettes" hint="Séparées par des virgules : lifestyle, écran, produit, drone…">
                    <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} />
                  </Field>
                </>
              ) : (
                <>
                  {open.note && <p className="text-[13px] leading-relaxed">{open.note}</p>}
                  {(open.tags ?? []).length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {open.tags.map((t) => <span key={t} className="badge">{t}</span>)}
                    </div>
                  )}
                </>
              )}
              <div className="dim text-[11.5px]">
                {formatBytes(open.size)} · ajouté le {fmtDateTime(open.addedAt)}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
