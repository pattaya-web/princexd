"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { api } from "@/lib/client";
import { CHANNEL_LABEL, TEMPLATE_ACTIONS, TEMPLATE_CHANNELS } from "@/lib/sales/templates";
import { Card, Empty, Field, Modal, PageHeader, Spinner, Tabs, useToast } from "@/components/ui";
import { SettingExamples } from "@/components/sales/SettingExamples";
import type { SettingExample } from "@/lib/types";
import { useSales } from "@/components/sales/context";
import type { MessageTemplate, TemplateChannel } from "@/lib/types";

const ACCENT = { "--accent": "#006dbc", "--accent-hover": "#005a9c", "--accent-soft": "#e6f1fa", "--accent-ring": "#9cc9ea", "--grad-accent": "linear-gradient(135deg, #006dbc 0%, #2a8fd8 100%)" } as CSSProperties;

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
  notes: string;
};

const blank = (category = "AUTRE"): Draft => ({ name: "", category, content: "", channel: "whatsapp", isFavorite: false, isActive: true, defaultFor: [], notes: "" });

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Gestion des templates de messages. Un seul modele, generique : nom,
 * categorie libre, message, canal, favori (en tete de la page Leads), actif,
 * ordre. Les commerciaux non admin voient les messages et peuvent les copier.
 */
export default function MessagesTemplatesPage() {
  const { session, members } = useSales();
  const toast = useToast();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Draft | null>(null);
  const [catsText, setCatsText] = useState("");
  const [catsOpen, setCatsOpen] = useState(false);
  const [catsBusy, setCatsBusy] = useState(false);
  const [filter, setFilter] = useState("");
  const [copiedId, setCopiedId] = useState("");
  const [tab, setTab] = useState<"scripts" | "examples">("scripts");
  const admin = session.isAdmin;
  /* Un setter cree ses propres scripts et ne modifie que les siens ; l'admin fait tout. */
  const canEdit = (t: MessageTemplate) => admin || t.ownerId === session.memberId;
  const ownerLabel = (t: MessageTemplate) => (t.ownerId ? members.find((m) => m.id === t.ownerId)?.name ?? "" : "");

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
      setCatsOpen(false);
      toast("Catégories enregistrées.");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setCatsBusy(false);
    }
  };

  const save = async (d: Draft) => {
    const body = { name: d.name, category: d.category, content: d.content, channel: d.channel, isFavorite: d.isFavorite, isActive: d.isActive, defaultFor: d.defaultFor, notes: d.notes };
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

  const copy = async (t: MessageTemplate) => {
    if (!(await copyText(t.content))) {
      toast("Copie impossible ici : sélectionne le texte et copie-le à la main.", "err");
      return;
    }
    setCopiedId(t.id);
    setTimeout(() => setCopiedId((c) => (c === t.id ? "" : c)), 1500);
  };

  const rows = (data?.rows ?? []).filter((t) => !filter || t.category === filter);
  const categories = data?.categories ?? [];

  return (
    <div style={ACCENT}>
      <PageHeader
        title="Messages & scripts"
        subtitle={admin ? "Les scripts à copier. Chaque setter crée les siens, note ce qui a marché, et garde ses exemples de setting." : "Tes scripts, un par contexte (première approche, relance, envoi du lien…). Note sur chacun ce qu'il a donné : avec le temps, tu sais quelle approche pose le plus de rendez-vous."}
        actions={
          <>
            <Tabs value={tab} onChange={setTab} options={[{ value: "scripts", label: "Scripts", count: data?.rows.length }, { value: "examples", label: "Exemples de setting" }]} />
            {tab === "scripts" && admin && (
              <button className="btn" onClick={() => setCatsOpen((v) => !v)}>
                Catégories
              </button>
            )}
            {tab === "scripts" && (
              <button className="btn btn-primary" onClick={() => setEditing(blank(categories[0]))}>
                + Nouveau script
              </button>
            )}
          </>
        }
      />

      {tab === "examples" && (
        <SettingExamples
          onMakeScript={(ex: SettingExample) => {
            setTab("scripts");
            setEditing({ ...blank("EXEMPLE"), name: ex.title.slice(0, 80), content: ex.transcript, notes: [ex.context, ex.notes].filter(Boolean).join("\n") });
          }}
        />
      )}
      {tab === "examples" ? null : (
      <>

      {error && <Card className="mb-4">{error}</Card>}

      {admin && catsOpen && (
        <Card className="mb-4" title="Catégories" subtitle="Libres, séparées par des virgules. Une catégorie tapée dans un template s'ajoute toute seule.">
          <div className="flex gap-2 items-start">
            <input className="input flex-1" value={catsText} onChange={(e) => setCatsText(e.target.value)} />
            <button className="btn btn-primary" onClick={() => void saveCategories()} disabled={catsBusy}>
              {catsBusy ? <span className="spinner" /> : "Enregistrer"}
            </button>
          </div>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-1.5 mb-4">
        <button type="button" className="h-[30px] px-3 rounded-full text-[12.5px] font-medium" style={{ background: !filter ? "var(--accent-soft)" : "var(--surface-2)", border: `1px solid ${!filter ? "var(--accent)" : "var(--border)"}`, color: !filter ? "var(--accent)" : "var(--text-2)" }} onClick={() => setFilter("")}>
          Tous <span className="num opacity-70">{data?.rows.length ?? 0}</span>
        </button>
        {categories.map((c) => {
          const n = data?.rows.filter((t) => t.category === c).length ?? 0;
          if (!n) return null;
          const active = filter === c;
          return (
            <button key={c} type="button" className="h-[30px] px-3 rounded-full text-[12.5px] font-medium" style={{ background: active ? "var(--accent-soft)" : "var(--surface-2)", border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`, color: active ? "var(--accent)" : "var(--text-2)" }} onClick={() => setFilter(active ? "" : c)}>
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
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {rows.map((t, i) => (
            <section key={t.id} className="card flex flex-col" style={{ opacity: t.isActive ? 1 : 0.6 }}>
              <div className="px-5 pt-4 flex items-start gap-2.5">
                <button
                  type="button"
                  className="text-[18px] leading-none mt-0.5 shrink-0"
                  title={t.isFavorite ? "Retirer des favoris" : "Mettre en favori"}
                  disabled={!canEdit(t)}
                  onClick={() => void patch(t.id, { isFavorite: !t.isFavorite })}
                  style={{ opacity: t.isFavorite ? 1 : 0.25 }}
                >
                  ⭐
                </button>
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-semibold leading-snug">{t.name}</div>
                  <div className="flex items-center gap-2 flex-wrap mt-1.5">
                    <span className="badge !text-[10.5px] !py-0">{t.category}</span>
                    <span className="dim text-[11.5px]">{CHANNEL_LABEL[t.channel]}</span>
                    {!t.isActive && <span className="badge badge-warn !text-[10.5px] !py-0">inactif</span>}
                    {t.ownerId && <span className="dim text-[11px]">{t.ownerId === session.memberId ? "mon script" : ownerLabel(t) ? `script de ${ownerLabel(t)}` : "script d'un setter"}</span>}
                    {t.defaultFor?.map((a) => (
                      <span key={a} className="badge badge-accent !text-[10.5px] !py-0">
                        par défaut : {TEMPLATE_ACTIONS.find((x) => x.key === a)?.label ?? a}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <pre className="px-5 py-3.5 text-[13.5px] leading-relaxed whitespace-pre-wrap flex-1" style={{ fontFamily: "inherit", color: "var(--text-2)" }}>
                {t.content}
              </pre>
              {t.notes && (
                <div className="px-5 pb-3 text-[12px] leading-snug whitespace-pre-wrap" style={{ color: "var(--text-2)" }}>
                  <span className="label-xs">Ce que ça a donné · </span>
                  {t.notes}
                </div>
              )}
              <div className="px-5 pb-4 flex items-center gap-2 flex-wrap" style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
                <button className={`btn btn-sm !h-[32px] ${copiedId === t.id ? "" : "btn-primary"}`} onClick={() => void copy(t)} style={copiedId === t.id ? { background: "var(--good)", borderColor: "var(--good)", color: "#fff" } : undefined}>
                  {copiedId === t.id ? "Copié ✓" : "Copier"}
                </button>
                {!canEdit(t) && (
                  <button className="btn btn-sm !h-[32px]" onClick={() => void patch(t.id, { action: "duplicate" }, "Copie créée : c'est maintenant ton script.")} title="En faire ta version">
                    Dupliquer
                  </button>
                )}
                {canEdit(t) && (
                  <>
                    <button className="btn btn-sm !h-[32px]" onClick={() => setEditing({ id: t.id, name: t.name, category: t.category, content: t.content, channel: t.channel, isFavorite: t.isFavorite, isActive: t.isActive, defaultFor: t.defaultFor ?? [], notes: t.notes ?? "" })}>
                      Modifier
                    </button>
                    <button className="btn btn-sm !h-[32px]" onClick={() => void patch(t.id, { action: "duplicate" }, "Script dupliqué.")}>
                      Dupliquer
                    </button>
                    <button className="btn btn-sm !h-[32px]" onClick={() => void patch(t.id, { isActive: !t.isActive })}>
                      {t.isActive ? "Désactiver" : "Activer"}
                    </button>
                    <span className="inline-flex ml-auto">
                      {admin && (
                        <>
                          <button className="btn btn-ghost btn-sm !h-[32px] !px-2" title="Monter" disabled={!!filter || i === 0} onClick={() => void move(t, -1)}>
                            ↑
                          </button>
                          <button className="btn btn-ghost btn-sm !h-[32px] !px-2" title="Descendre" disabled={!!filter || i === rows.length - 1} onClick={() => void move(t, 1)}>
                            ↓
                          </button>
                        </>
                      )}
                      <button className="btn btn-ghost btn-sm !h-[32px]" style={{ color: "var(--critical)" }} onClick={() => void remove(t)}>
                        Supprimer
                      </button>
                    </span>
                  </>
                )}
              </div>
            </section>
          ))}
        </div>
      )}

      </>
      )}

      {editing && <EditorModal draft={editing} categories={categories} admin={admin} onClose={() => setEditing(null)} onSave={save} />}
    </div>
  );
}

function EditorModal({ draft, categories, admin, onClose, onSave }: { draft: Draft; categories: string[]; admin: boolean; onClose: () => void; onSave: (d: Draft) => Promise<void> }) {
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
      title={d.id ? "Modifier le script" : "Nouveau script"}
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
        <Field label="Ce que ça a donné" className="sm:col-span-3" hint="Dans quel contexte tu l'utilises, combien de réponses, combien de rendez-vous. C'est ta data : avec le temps tu sais quelle approche marche.">
          <textarea className="textarea w-full" rows={3} value={d.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Ex : après un like sur un reel value · 10 envois → 6 réponses → 2 RDV" />
        </Field>
        <div className="sm:col-span-3 flex items-center gap-5 flex-wrap text-[12.5px]">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={d.isFavorite} onChange={(e) => set({ isFavorite: e.target.checked })} /> ⭐ Favori (affiché en premier sur la page Leads)
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={d.isActive} onChange={(e) => set({ isActive: e.target.checked })} /> Actif
          </label>
          {admin && TEMPLATE_ACTIONS.map((a) => (
            <label key={a.key} className="flex items-center gap-2">
              <input type="checkbox" checked={d.defaultFor.includes(a.key)} onChange={(e) => set({ defaultFor: e.target.checked ? [...d.defaultFor, a.key] : d.defaultFor.filter((x) => x !== a.key) })} /> Par défaut : {a.label}
            </label>
          ))}
        </div>
      </div>
    </Modal>
  );
}
