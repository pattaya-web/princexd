"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { Card, Empty, ErrorNote, Field, Modal, PageHeader, Spinner, Toggle, useToast } from "@/components/ui";
import { Annex } from "@/components/formation/Annex";
import type { StepsPayload } from "@/app/api/formation/steps/route";
import type { CourseStep, StudentPortalSettings } from "@/lib/types";

/**
 * Parcours & étapes (admin) : la marche à suivre que chaque élève coche dans
 * Scale X, dans l'ordre, et les réglages de la plateforme (lien de
 * réservation, WhatsApp, phrase d'accompagnement, citation).
 */

interface Draft {
  title: string;
  detail: string;
  link: string;
  moduleId: string;
  published: boolean;
}
const EMPTY: Draft = { title: "", detail: "", link: "", moduleId: "", published: true };

export default function ParcoursAdminPage() {
  const toast = useToast();
  const [data, setData] = useState<StepsPayload | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<CourseStep | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [preview, setPreview] = useState(false);
  const [portal, setPortal] = useState<StudentPortalSettings | null>(null);
  const [savingPortal, setSavingPortal] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<StepsPayload>("/api/formation/steps");
      setData(r);
      setPortal((p) => p ?? r.portal);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openNew = () => {
    setDraft(EMPTY);
    setPreview(false);
    setEditing("new");
  };
  const openEdit = (s: CourseStep) => {
    setDraft({ title: s.title, detail: s.detail, link: s.link, moduleId: s.moduleId ?? "", published: s.published });
    setPreview(false);
    setEditing(s);
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const body = JSON.stringify(draft);
      if (editing === "new") await api("/api/formation/steps", { method: "POST", body });
      else await api(`/api/formation/steps/${editing.id}`, { method: "PATCH", body });
      toast(editing === "new" ? "Étape ajoutée." : "Étape enregistrée.");
      setEditing(null);
      await load();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setSaving(false);
    }
  };

  const togglePublished = async (s: CourseStep) => {
    setBusyId(s.id);
    try {
      await api(`/api/formation/steps/${s.id}`, { method: "PATCH", body: JSON.stringify({ published: !s.published }) });
      await load();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusyId("");
    }
  };

  const remove = async (s: CourseStep) => {
    if (!window.confirm(`Supprimer « ${s.title} » ? Elle disparaît du parcours de tous les élèves.`)) return;
    setBusyId(s.id);
    try {
      await api(`/api/formation/steps/${s.id}`, { method: "DELETE" });
      toast("Étape supprimée.");
      await load();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusyId("");
    }
  };

  const move = async (s: CourseStep, dir: -1 | 1) => {
    if (!data) return;
    const ids = data.raw.map((x) => x.id);
    const i = ids.indexOf(s.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setBusyId(s.id);
    try {
      await api("/api/formation/steps", { method: "PATCH", body: JSON.stringify({ order: ids }) });
      await load();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusyId("");
    }
  };

  const savePortal = async () => {
    if (!portal) return;
    setSavingPortal(true);
    try {
      await api("/api/settings", { method: "PATCH", body: JSON.stringify({ studentPortal: portal }) });
      toast("Réglages de la plateforme enregistrés.");
      await load();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setSavingPortal(false);
    }
  };

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data || !portal) return <Spinner label="Chargement du parcours…" />;

  const setP = <K extends keyof StudentPortalSettings>(k: K, v: string) => setPortal({ ...portal, [k]: v });

  return (
    <div>
      <PageHeader
        title="Parcours & étapes"
        subtitle="La marche à suivre que chaque élève coche dans Scale X, dans l'ordre. Les balises {{formulaire}}, {{shopify}}, {{claude}}, {{brainsearch}} prennent les liens d'Élèves → Onboarding."
        actions={
          <>
            <button className="btn btn-sm btn-primary" onClick={openNew}>
              Ajouter une étape
            </button>
            <Link href="/formation" className="btn btn-sm btn-ghost">
              Voir Scale X
            </Link>
            <Link href="/formation/eleves" className="btn btn-sm btn-ghost">
              Suivi des élèves
            </Link>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] items-start">
        <Card title="La marche à suivre" subtitle={`${data.raw.filter((s) => s.published).length} étape(s) publiée(s) sur ${data.raw.length}`} padded={false}>
          {data.raw.length === 0 ? (
            <div className="p-5">
              <Empty action={<button className="btn btn-primary btn-sm" onClick={openNew}>Ajouter la première étape</button>}>Aucune étape.</Empty>
            </div>
          ) : (
            <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
              {data.raw.map((s, i) => (
                <li key={s.id} className="flex items-start gap-3 px-4 sm:px-5 py-3" style={{ opacity: busyId === s.id ? 0.6 : 1 }}>
                  <span className="label-xs num mt-1 w-[22px] shrink-0">{String(i + 1).padStart(2, "0")}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[14px] font-semibold leading-snug">{s.title}</span>
                      {!s.published && <span className="badge badge-warn !text-[10px] !py-0">brouillon</span>}
                      {s.link && <span className="dim text-[11.5px] truncate max-w-[260px]">{s.link}</span>}
                    </div>
                    {s.detail && <div className="dim text-[12.5px] mt-1 line-clamp-2 whitespace-pre-line">{s.detail}</div>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button className="btn btn-sm btn-ghost !px-2" onClick={() => void move(s, -1)} disabled={i === 0 || Boolean(busyId)} title="Monter">
                      ↑
                    </button>
                    <button className="btn btn-sm btn-ghost !px-2" onClick={() => void move(s, 1)} disabled={i === data.raw.length - 1 || Boolean(busyId)} title="Descendre">
                      ↓
                    </button>
                    <button className="btn btn-sm btn-ghost" onClick={() => void togglePublished(s)} disabled={Boolean(busyId)}>
                      {s.published ? "Publiée" : "Publier"}
                    </button>
                    <button className="btn btn-sm" onClick={() => openEdit(s)} disabled={Boolean(busyId)}>
                      Modifier
                    </button>
                    <button className="btn btn-sm btn-ghost" onClick={() => void remove(s)} disabled={Boolean(busyId)}>
                      Suppr.
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Réglages de la plateforme" subtitle="Ce que voient les élèves dans Accompagnement et en pied de page.">
          <div className="flex flex-col gap-3">
            <Field label="Lien « Réserver un appel »" hint="Vide = ton lien de réservation iClosed des réglages Sales.">
              <input className="input" value={portal.bookingUrl} onChange={(e) => setP("bookingUrl", e.target.value)} placeholder="https://app.iclosed.io/e/…" inputMode="url" />
            </Field>
            <Field label="WhatsApp du coach" hint="Numéro international (+33 6…). Vide = pas de bouton WhatsApp.">
              <input className="input" value={portal.whatsapp} onChange={(e) => setP("whatsapp", e.target.value)} placeholder="+33 6 12 34 56 78" inputMode="tel" />
            </Field>
            <Field label="Phrase d'accompagnement">
              <textarea className="input" rows={3} value={portal.helpText} onChange={(e) => setP("helpText", e.target.value)} />
            </Field>
            <Field label="Citation du pied de page">
              <textarea className="input" rows={2} value={portal.quote} onChange={(e) => setP("quote", e.target.value)} />
            </Field>
            <Field label="Signature">
              <input className="input" value={portal.quoteAuthor} onChange={(e) => setP("quoteAuthor", e.target.value)} />
            </Field>
            <Field label="Vidéo d'accompagnement (Démarrage)" hint="Lien YouTube non répertorié, ou fichier déposé depuis la page Démarrage. Affichée en haut de Démarrage avec les liens en dessous.">
              <input className="input" value={portal.welcomeVideoUrl} onChange={(e) => setP("welcomeVideoUrl", e.target.value)} placeholder="https://youtu.be/…" inputMode="url" />
            </Field>
            <div className="flex justify-end">
              <button className="btn btn-sm btn-primary" onClick={() => void savePortal()} disabled={savingPortal}>
                {savingPortal ? "Enregistrement…" : "Enregistrer"}
              </button>
            </div>
          </div>
        </Card>
      </div>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "Nouvelle étape" : "Modifier l'étape"}
        wide
        footer={
          <>
            <button className="btn btn-sm btn-ghost" onClick={() => setEditing(null)} disabled={saving}>
              Annuler
            </button>
            <button className="btn btn-sm btn-primary" onClick={() => void save()} disabled={saving || !draft.title.trim()}>
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label="Titre" hint="Une action, à l'impératif : « Ouvre ta boutique Shopify (1 €) ».">
            <input className="input" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} autoFocus maxLength={160} />
          </Field>
          <Field label="Consigne" hint="Mise en forme légère : lignes commençant par « - » pour une liste, liens collés tels quels.">
            <textarea className="input font-mono text-[12.5px]" rows={8} value={draft.detail} onChange={(e) => setDraft({ ...draft, detail: e.target.value })} />
          </Field>
          {draft.detail.trim() && (
            <div>
              <button className="btn btn-sm btn-ghost" onClick={() => setPreview((v) => !v)}>
                {preview ? "Masquer l'aperçu" : "Aperçu"}
              </button>
              {preview && (
                <div className="card-flat p-3 mt-2 text-[13.5px]">
                  <Annex text={draft.detail} />
                </div>
              )}
            </div>
          )}
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Lien à ouvrir" hint="URL, ou balise {{formulaire}} / {{shopify}} / {{claude}} / {{brainsearch}}, ou /formation/cours.">
              <input className="input" value={draft.link} onChange={(e) => setDraft({ ...draft, link: e.target.value })} placeholder="https://… ou {{shopify}}" />
            </Field>
            <Field label="Module lié (facultatif)">
              <select className="input" value={draft.moduleId} onChange={(e) => setDraft({ ...draft, moduleId: e.target.value })}>
                <option value="">Aucun</option>
                {data.modules.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Toggle checked={draft.published} onChange={(v) => setDraft({ ...draft, published: v })} label={draft.published ? "Publiée : les élèves la voient" : "Brouillon"} />
        </div>
      </Modal>
    </div>
  );
}
