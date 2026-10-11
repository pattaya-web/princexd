"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { CHANNEL_LABEL, TEMPLATE_ACTIONS, TEMPLATE_CHANNELS } from "@/lib/sales/templates";
import { Card, Empty, Field, Modal, PageHeader, Spinner, useToast } from "@/components/ui";
import { useSales } from "@/components/sales/context";
import type { MessageTemplate, TemplateChannel } from "@/lib/types";

interface Payload {
  rows: MessageTemplate[];
  categories: string[];
}

type Draft = {
  id?: string;
  name: string;
  category: string;
  content: string;
  channel: TemplateChannel;
  isFavorite: boolean;
  isActive: boolean;
  defaultFor: string[];
};

const blank = (category = "AUTRE"): Draft => ({ name: "", category, content: "", channel: "whatsapp", isFavorite: false, isActive: true, defaultFor: [] });

/**
 * Gestion des templates de messages. Un seul modele, generique : nom,
 * categorie libre, message, canal, favori (en tete du menu « Messages »),
 * actif, ordre, et « par defaut pour » une action de la liste des leads.
 */
export default function MessagesTemplatesPage() {
  const { session } = useSales();
  const toast = useToast();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Draft | null>(null);
  const [catsText, setCatsText] = useState("");
  const [catsBusy, setCatsBusy] = useState(false);
  const [filter, setFilter] = useState("");
  const admin = session.isAdmin;

  const load = () =>
    api<Payload>("/api/sales/templates")
      .then((d) => {
        setData(d);
        setCatsText(d.categories.join(", "));
        setError("");
      })
      .catch((e: Error) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);

  const patch = async (id: string, body: Record<string, unknown>, ok?: string) => {
    try {
      const r = await api<{ rows: MessageTemplate[] }>(`/api/sales/templates/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      setData((d) => (d ? { ...d, rows: r.rows } : d));
      if (ok) toast(ok);
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  const remove = async (t: MessageTemplate) => {
    if (!window.confirm(`Supprimer le template « ${t.name} » ?`)) return;
    try {
      const r = await api<{ rows: MessageTemplate[] }>(`/api/sales/templates/${t.id}`, { method: "DELETE" });
      setData((d) => (d ? { ...d, rows: r.rows } : d));
      toast("Template supprimé.");
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  const move = async (t: MessageTemplate, dir: -1 | 1) => {
    if (!data) return;
    const ids = data.rows.map((x) => x.id);
    const i = ids.indexOf(t.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    try {
      const r = await api<Payload>("/api/sales/templates", { method: "PUT", body: JSON.stringify({ order: ids }) });
      setData(r);
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  const saveCategories = async () => {
    setCatsBusy(true);
    try {
      const r = await api<Payload>("/api/sales/templates", { method: "PUT", body: JSON.stringify({ categories: catsText.split(",").map((s) => s.trim()).filter(Boolean) }) });
      setData(r);
      setCatsText(r.categories.join(", "));
      toast("Catégories enregistrées.");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setCatsBusy(false);
    }
  };

  const save = async (d: Draft) => {
    const body = { name: d.name, category: d.category, content: d.content, channel: d.channel, isFavorite: d.isFavorite, isActive: d.isActive, defaultFor: d.defaultFor };
    try {
      if (d.id) {
        const r = await api<{ rows: MessageTemplate[] }>(`/api/sales/templates/${d.id}`, { method: "PATCH", body: JSON.stringify(body) });
        setData((x) => (x ? { ...x, rows: r.rows } : x));
      } else {
        await api("/api/sales/templates", { method: "POST", body: JSON.stringify(body) });
        await load();
      }
      toast("Template enregistré.");
      setEditing(null);
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  const rows = (data?.rows ?? []).filter((t) => !filter || t.category === filter);
  const categories = data?.categories ?? [];

  return (
    <>
      <PageHeader
        title="Messages templates"
        subtitle="Les messages à copier ou à ouvrir dans WhatsApp depuis la liste des leads. Les favoris ⭐ sont en tête du menu « Messages » de chaque lead."
        actions={
          admin ? (
            <button className="btn btn-primary" onClick={() => setEditing(blank(categories[0]))}>
              + Nouveau template
            </button>
          ) : undefined
        }
      />

      {error && <Card>{error}</Card>}

      {admin && (
        <Card title="Catégories" subtitle="Libres, séparées par des virgules. Une catégorie tapée dans un template s'ajoute toute seule.">
          <div className="flex gap-2 items-start">
            <input className="input flex-1" value={catsText} onChange={(e) => setCatsText(e.target.value)} />
            <button className="btn" onClick={() => void saveCategories()} disabled={catsBusy}>
              {catsBusy ? <span className="spinner" /> : "Enregistrer"}
            </button>
          </div>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-1.5 my-3">
        <button type="button" className={`btn btn-sm ${!filter ? "btn-primary" : ""}`} onClick={() => setFilter("")}>
          Tous <span className="num opacity-70">{data?.rows.length ?? 0}</span>
        </button>
        {categories.map((c) => {
          const n = data?.rows.filter((t) => t.category === c).length ?? 0;
          if (!n) return null;
          return (
            <button key={c} type="button" className={`btn btn-sm ${filter === c ? "btn-primary" : ""}`} onClick={() => setFilter(filter === c ? "" : c)}>
              {c} <span className="num opacity-70">{n}</span>
            </button>
          );
        })}
      </div>

      {!data ? (
        <Card>
          <Spinner label="Chargement…" />
        </Card>
      ) : !rows.length ? (
        <Card>
          <Empty>Aucun template{filter ? " dans cette catégorie" : ""}.</Empty>
        </Card>
      ) : (
        <Card padded={false}>
          <ul>
            {rows.map((t, i) => (
              <li key={t.id} className="px-3.5 py-3 flex items-start gap-3" style={{ borderBottom: i < rows.length - 1 ? "1px solid var(--border)" : "none", opacity: t.isActive ? 1 : 0.55 }}>
                <button
                  type="button"
                  className="text-[18px] leading-none mt-0.5 shrink-0"
                  title={t.isFavorite ? "Retirer des favoris" : "Mettre en favori"}
                  disabled={!admin}
                  onClick={() => void patch(t.id, { isFavorite: !t.isFavorite })}
                  style={{ opacity: t.isFavorite ? 1 : 0.3 }}
                >
                  ⭐
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13.5px] font-semibold">{t.name}</span>
                    <span className="badge !text-[10px] !py-0">{t.category}</span>
                    <span className="dim text-[11.5px]">{CHANNEL_LABEL[t.channel]}</span>
                    {!t.isActive && <span className="badge badge-warn !text-[10px] !py-0">inactif</span>}
                    {t.defaultFor?.map((a) => (
                      <span key={a} className="badge badge-accent !text-[10px] !py-0">
                        par défaut : {TEMPLATE_ACTIONS.find((x) => x.key === a)?.label ?? a}
                      </span>
                    ))}
                  </div>
                  <p className="dim text-[12.5px] mt-1 whitespace-pre-wrap line-clamp-3">{t.content}</p>
                  {admin && (
                    <div className="flex items-center gap-1.5 flex-wrap mt-2">
                      <button className="btn btn-sm !h-[28px]" onClick={() => setEditing({ id: t.id, name: t.name, category: t.category, content: t.content, channel: t.channel, isFavorite: t.isFavorite, isActive: t.isActive, defaultFor: t.defaultFor ?? [] })}>
                        Modifier
                      </button>
                      <button className="btn btn-sm !h-[28px]" onClick={() => void patch(t.id, { action: "duplicate" }, "Template dupliqué.")}>
                        Dupliquer
                      </button>
                      <button className="btn btn-sm !h-[28px]" onClick={() => void patch(t.id, { isActive: !t.isActive })}>
                        {t.isActive ? "Désactiver" : "Activer"}
                      </button>
                      <span className="inline-flex">
                        <button className="btn btn-ghost btn-sm !h-[28px] !px-2" title="Monter" disabled={!!filter || i === 0} onClick={() => void move(t, -1)}>
                          ↑
                        </button>
                        <button className="btn btn-ghost btn-sm !h-[28px] !px-2" title="Descendre" disabled={!!filter || i === rows.length - 1} onClick={() => void move(t, 1)}>
                          ↓
                        </button>
                      </span>
                      <button className="btn btn-ghost btn-sm !h-[28px] ml-auto" style={{ color: "var(--critical)" }} onClick={() => void remove(t)}>
                        Supprimer
                      </button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {editing && <EditorModal draft={editing} categories={categories} onClose={() => setEditing(null)} onSave={save} />}
    </>
  );
}

function EditorModal({ draft, categories, onClose, onSave }: { draft: Draft; categories: string[]; onClose: () => void; onSave: (d: Draft) => Promise<void> }) {
  const [d, setD] = useState<Draft>(draft);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const submit = async () => {
    setBusy(true);
    try {
      await onSave(d);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={d.id ? "Modifier le template" : "Nouveau template"}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Annuler
          </button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy || !d.name.trim() || !d.content.trim()}>
            {busy ? <span className="spinner" /> : "Enregistrer"}
          </button>
        </>
      }
    >
      <div className="grid sm:grid-cols-[1fr_200px_160px] gap-3">
        <Field label="Nom">
          <input className="input" value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="Appel sans réponse — Lead Ads" autoFocus />
        </Field>
        <Field label="Catégorie" hint="Tape-en une nouvelle si besoin.">
          <input className="input" list="template-categories" value={d.category} onChange={(e) => set({ category: e.target.value.toUpperCase() })} />
          <datalist id="template-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="Canal">
          <select className="select" value={d.channel} onChange={(e) => set({ channel: e.target.value as TemplateChannel })}>
            {TEMPLATE_CHANNELS.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Message" className="sm:col-span-3" hint="Pas besoin de prénom : on copie-colle sans vérifier le nom. « {{prenom}} » et « {{nom}} » restent possibles.">
          <textarea className="textarea w-full !text-[13.5px] leading-relaxed" rows={10} value={d.content} onChange={(e) => set({ content: e.target.value })} />
        </Field>
        <div className="sm:col-span-3 flex items-center gap-5 flex-wrap text-[12.5px]">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={d.isFavorite} onChange={(e) => set({ isFavorite: e.target.checked })} /> ⭐ Favori (en tête du menu)
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={d.isActive} onChange={(e) => set({ isActive: e.target.checked })} /> Actif
          </label>
          {TEMPLATE_ACTIONS.map((a) => (
            <label key={a.key} className="flex items-center gap-2">
              <input type="checkbox" checked={d.defaultFor.includes(a.key)} onChange={(e) => set({ defaultFor: e.target.checked ? [...d.defaultFor, a.key] : d.defaultFor.filter((x) => x !== a.key) })} /> S&apos;ouvre par défaut : {a.label}
            </label>
          ))}
        </div>
      </div>
    </Modal>
  );
}
