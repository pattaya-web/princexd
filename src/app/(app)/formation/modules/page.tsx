"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { Card, Empty, ErrorNote, Field, Modal, PageHeader, Spinner, Toggle, useToast } from "@/components/ui";
import { Annex } from "@/components/formation/Annex";
import { youtubeId, youtubeThumb, type CourseModuleRow } from "@/lib/formation";
import type { FormationPayload } from "@/app/api/formation/modules/route";
import type { CourseObjection } from "@/lib/types";

/**
 * Gestion des modules de la formation (admin).
 *
 * La liste dans l'ordre de visionnage, avec monter/descendre, publier et
 * modifier. Le formulaire tient dans une fenetre : titre, lien YouTube (avec
 * apercu de la vignette des que le lien est reconnu), resume, annexe, et la
 * liste des objections frequentes avec leur reponse.
 */

interface Draft {
  title: string;
  youtubeUrl: string;
  summary: string;
  annex: string;
  objections: CourseObjection[];
  published: boolean;
}

const EMPTY: Draft = { title: "", youtubeUrl: "", summary: "", annex: "", objections: [], published: false };

let tmpId = 0;
const localId = () => `tmp-${++tmpId}`;

export default function ModulesAdminPage() {
  const toast = useToast();
  const [modules, setModules] = useState<CourseModuleRow[] | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<CourseModuleRow | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [showAnnexPreview, setShowAnnexPreview] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<FormationPayload>("/api/formation/modules");
      setModules(r.modules);
      setError("");
      return r.modules;
    } catch (e) {
      setError((e as Error).message);
      return [];
    }
  }, []);

  useEffect(() => {
    void load().then((ms) => {
      // Arrivee depuis la plateforme avec « Modifier ce module ».
      const wanted = new URLSearchParams(window.location.search).get("edit");
      const m = wanted ? ms.find((x) => x.id === wanted) : undefined;
      if (m) openEdit(m);
    });
  }, [load]);

  const openNew = () => {
    setDraft(EMPTY);
    setShowAnnexPreview(false);
    setEditing("new");
  };
  const openEdit = (m: CourseModuleRow) => {
    setDraft({ title: m.title, youtubeUrl: m.youtubeUrl, summary: m.summary, annex: m.annex, objections: m.objections, published: m.published });
    setShowAnnexPreview(false);
    setEditing(m);
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const body = JSON.stringify({ ...draft, objections: draft.objections.map(({ id, ...o }) => (id.startsWith("tmp-") ? o : { id, ...o })) });
      if (editing === "new") {
        await api("/api/formation/modules", { method: "POST", body });
        toast(draft.published ? "Module ajouté et publié." : "Module ajouté en brouillon.");
      } else {
        await api(`/api/formation/modules/${editing.id}`, { method: "PATCH", body });
        toast("Module enregistré.");
      }
      setEditing(null);
      await load();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setSaving(false);
    }
  };

  const togglePublished = async (m: CourseModuleRow) => {
    setBusyId(m.id);
    try {
      await api(`/api/formation/modules/${m.id}`, { method: "PATCH", body: JSON.stringify({ published: !m.published }) });
      toast(m.published ? "Module repassé en brouillon." : "Module publié : tes élèves le voient.");
      await load();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusyId("");
    }
  };

  const remove = async (m: CourseModuleRow) => {
    if (!window.confirm(`Supprimer « ${m.title} » ? Les élèves ne le verront plus.`)) return;
    setBusyId(m.id);
    try {
      await api(`/api/formation/modules/${m.id}`, { method: "DELETE" });
      toast("Module supprimé.");
      await load();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusyId("");
    }
  };

  const move = async (m: CourseModuleRow, dir: -1 | 1) => {
    if (!modules) return;
    const ids = modules.map((x) => x.id);
    const i = ids.indexOf(m.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    // Reordre optimiste : la liste bouge tout de suite, le serveur confirme.
    setModules(ids.map((id) => modules.find((x) => x.id === id)!));
    try {
      const r = await api<{ modules: CourseModuleRow[] }>("/api/formation/modules", { method: "PATCH", body: JSON.stringify({ order: ids }) });
      setModules(r.modules);
    } catch (e) {
      toast((e as Error).message, "err");
      await load();
    }
  };

  const setObjection = (id: string, patch: Partial<CourseObjection>) =>
    setDraft((d) => ({ ...d, objections: d.objections.map((o) => (o.id === id ? { ...o, ...patch } : o)) }));

  const ytId = youtubeId(draft.youtubeUrl);

  return (
    <div>
      <PageHeader
        title="Modules vidéo"
        subtitle="Les vidéos de la formation, dans l'ordre où tes élèves les suivent. Chaque module a sa vidéo YouTube, une annexe et ses objections fréquentes."
        actions={
          <>
            <Link href="/formation" className="btn btn-sm btn-ghost">
              Voir comme un élève
            </Link>
            <button className="btn btn-primary btn-sm" onClick={openNew}>
              + Nouveau module
            </button>
          </>
        }
      />

      {error && <ErrorNote>{error}</ErrorNote>}
      {!modules && !error && <Spinner label="Chargement…" />}

      {modules && !modules.length && (
        <Empty action={<button className="btn btn-primary btn-sm" onClick={openNew}>Ajouter le premier module</button>}>
          Aucun module pour l&apos;instant. Colle le lien d&apos;une vidéo YouTube (non répertoriée de préférence) pour commencer.
        </Empty>
      )}

      {modules && modules.length > 0 && (
        <div className="flex flex-col gap-2">
          {modules.map((m, i) => (
            <div key={m.id} className="card px-3 sm:px-4 py-3 flex items-center gap-3 sm:gap-4" style={{ opacity: busyId === m.id ? 0.6 : 1 }}>
              {/* Ordre : deux fleches suffisent, la liste reste courte. */}
              <div className="flex flex-col shrink-0">
                <button className="btn btn-ghost btn-sm !h-[22px] !px-1.5" disabled={i === 0} onClick={() => void move(m, -1)} title="Monter">
                  ▲
                </button>
                <button className="btn btn-ghost btn-sm !h-[22px] !px-1.5" disabled={i === modules.length - 1} onClick={() => void move(m, 1)} title="Descendre">
                  ▼
                </button>
              </div>
              <div
                className="shrink-0 rounded-[8px] overflow-hidden hidden sm:block"
                style={{ width: 96, aspectRatio: "16 / 9", background: "var(--surface-3)" }}
              >
                {m.youtubeId && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={youtubeThumb(m.youtubeId)} alt="" className="w-full h-full object-cover" loading="lazy" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="label-xs num">Module {i + 1}</span>
                  {!m.published && <span className="badge badge-warn !text-[10px] !py-0">Brouillon</span>}
                </div>
                <div className="text-[14.5px] font-semibold truncate">{m.title}</div>
                <div className="dim text-[12px] truncate">
                  {m.objections.length} objection{m.objections.length > 1 ? "s" : ""}
                  {m.annex.trim() ? " · annexe" : " · pas d'annexe"}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Toggle checked={m.published} onChange={() => void togglePublished(m)} label={m.published ? "Publié" : "Brouillon"} />
                <button className="btn btn-sm" onClick={() => openEdit(m)}>
                  Modifier
                </button>
                <button className="btn btn-sm btn-ghost" onClick={() => void remove(m)} title="Supprimer" style={{ color: "var(--critical)" }}>
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "Nouveau module" : "Modifier le module"}
        wide
        footer={
          <>
            <Toggle checked={draft.published} onChange={(v) => setDraft((d) => ({ ...d, published: v }))} label={draft.published ? "Publié : visible par les élèves" : "Brouillon : visible par toi seul"} />
            <span className="flex-1" />
            <button className="btn btn-sm btn-ghost" onClick={() => setEditing(null)} disabled={saving}>
              Annuler
            </button>
            <button className="btn btn-sm btn-primary" onClick={() => void save()} disabled={saving || !draft.title.trim() || !ytId}>
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
          </>
        }
      >
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_200px]">
          <div className="flex flex-col gap-3">
            <Field label="Titre du module">
              <input className="input" value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} placeholder="Module 1 · Trouver un produit gagnant" autoFocus />
            </Field>
            <Field
              label="Lien YouTube"
              hint={draft.youtubeUrl && !ytId ? "Lien non reconnu : colle l'adresse de la vidéo (youtube.com/watch?v=… ou youtu.be/…)." : "Mets la vidéo en « non répertoriée » sur YouTube : seuls ceux qui ont le lien la voient."}
            >
              <input className="input" value={draft.youtubeUrl} onChange={(e) => setDraft((d) => ({ ...d, youtubeUrl: e.target.value }))} placeholder="https://www.youtube.com/watch?v=…" />
            </Field>
            <Field label="Résumé (optionnel)" hint="Une ou deux phrases sous le titre.">
              <input className="input" value={draft.summary} onChange={(e) => setDraft((d) => ({ ...d, summary: e.target.value }))} placeholder="Ce que l'élève saura faire à la fin du module." />
            </Field>
          </div>
          <div>
            <div className="label-xs mb-1.5">Aperçu</div>
            <div className="rounded-[10px] overflow-hidden" style={{ aspectRatio: "16 / 9", background: "var(--surface-3)" }}>
              {ytId && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={youtubeThumb(ytId)} alt="" className="w-full h-full object-cover" />
              )}
            </div>
          </div>
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className="label-xs">Annexe sous la vidéo</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowAnnexPreview((v) => !v)}>
              {showAnnexPreview ? "Modifier" : "Aperçu"}
            </button>
          </div>
          {showAnnexPreview ? (
            <div className="card-flat p-4 min-h-[120px]">
              {draft.annex.trim() ? <Annex text={draft.annex} /> : <span className="dim text-[13px]">Rien à afficher.</span>}
            </div>
          ) : (
            <textarea
              className="textarea min-h-[160px] font-mono text-[13px]"
              value={draft.annex}
              onChange={(e) => setDraft((d) => ({ ...d, annex: e.target.value }))}
              placeholder={"# Les étapes\n- Étape 1 : …\n- Étape 2 : …\n\nLiens utiles : https://…"}
            />
          )}
          <div className="dim text-[11.5px] mt-1 leading-snug">
            Mise en forme : <code className="mono"># Titre</code>, <code className="mono">- liste</code>, <code className="mono">1. étapes</code>, <code className="mono">**gras**</code>, les liens sont cliquables.
          </div>
        </div>

        <div className="mt-5">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div>
              <span className="label-xs">Objections qui reviennent souvent</span>
              <div className="dim text-[11.5px]">Ce que les clients de tes élèves leur disent, et la réponse à donner.</div>
            </div>
            <button
              className="btn btn-sm"
              onClick={() => setDraft((d) => ({ ...d, objections: [...d.objections, { id: localId(), question: "", answer: "" }] }))}
            >
              + Objection
            </button>
          </div>
          {!draft.objections.length && <div className="card-flat p-4 dim text-[13px]">Aucune objection pour ce module.</div>}
          <div className="flex flex-col gap-2">
            {draft.objections.map((o, i) => (
              <div key={o.id} className="card-flat p-3 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="label-xs num shrink-0">#{i + 1}</span>
                  <input
                    className="input flex-1"
                    value={o.question}
                    onChange={(e) => setObjection(o.id, { question: e.target.value })}
                    placeholder="« C'est trop cher »"
                  />
                  <button
                    className="btn btn-ghost btn-sm shrink-0"
                    onClick={() => setDraft((d) => ({ ...d, objections: d.objections.filter((x) => x.id !== o.id) }))}
                    title="Retirer"
                    style={{ color: "var(--critical)" }}
                  >
                    ✕
                  </button>
                </div>
                <textarea
                  className="textarea min-h-[70px] text-[13px]"
                  value={o.answer}
                  onChange={(e) => setObjection(o.id, { answer: e.target.value })}
                  placeholder="La réponse à donner, mot pour mot si tu veux."
                />
              </div>
            ))}
          </div>
        </div>
      </Modal>
    </div>
  );
}
