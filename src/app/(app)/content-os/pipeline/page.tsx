"use client";

import { useMemo, useState } from "react";
import { Card, Field, InfoNote, Modal, PageHeader, Spinner, useToast } from "@/components/ui";
import { CosShell, Fold } from "@/components/content-os/CosShell";
import { useContentOs } from "@/components/content-os/useContentOs";
import { emptyItem, FORMATS, FUNNELS, PLATFORMS, STATUSES, weekKey } from "@/lib/content-os";
import type { ContentItem, ContentStatus, CosHabit } from "@/lib/types";

/*
 * Pipeline de production : Kanban Idées → … → Publié, fiche complète par
 * contenu, filtre par plateforme, contenus gagnants, routine hebdo.
 * Déplacement par glisser-déposer, ou par les flèches sur mobile. Tout est
 * enregistré au moment du geste.
 */
type Draft = Omit<ContentItem, "id" | "createdAt" | "updatedAt"> & { id?: string };

export default function ContentOsPipeline() {
  const toast = useToast();
  const { state, items, loading, patchState, createItem, updateItem, deleteItem } = useContentOs();
  const [platform, setPlatform] = useState<"all" | ContentItem["platform"]>("all");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<ContentStatus | null>(null);

  const visible = useMemo(() => (platform === "all" ? items : items.filter((i) => i.platform === platform)), [items, platform]);
  const byStatus = useMemo(() => {
    const m: Record<ContentStatus, ContentItem[]> = { idea: [], script: [], ready: [], shot: [], editing: [], review: [], scheduled: [], published: [] };
    for (const it of visible) m[it.status]?.push(it);
    for (const k of Object.keys(m) as ContentStatus[]) m[k].sort((a, b) => (a.dueAt || "9999").localeCompare(b.dueAt || "9999") || a.order - b.order);
    return m;
  }, [visible]);
  const winners = useMemo(() => items.filter((i) => i.winner), [items]);

  function move(it: ContentItem, status: ContentStatus) {
    if (it.status === status) return;
    void updateItem(it.id, { status });
  }

  function shift(it: ContentItem, dir: -1 | 1) {
    const idx = STATUSES.findIndex((s) => s.id === it.status);
    const next = STATUSES[idx + dir];
    if (next) move(it, next.id);
  }

  async function save() {
    if (!draft) return;
    if (!draft.title.trim()) {
      toast("Donne un titre au contenu.", "err");
      return;
    }
    setSaving(true);
    try {
      const { id, ...data } = draft;
      if (id) await updateItem(id, data);
      else await createItem(data);
      setDraft(null);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setSaving(false);
    }
  }

  async function del() {
    if (!draft?.id || !window.confirm("Supprimer ce contenu ?")) return;
    await deleteItem(draft.id);
    setDraft(null);
  }

  // Routine hebdo : clé = lundi de la semaine en cours.
  const week = weekKey();
  const routineDone = new Set(state.routineLog[week] ?? []);
  const routine = [...state.routineItems].sort((a, b) => a.order - b.order);
  const [routineEdit, setRoutineEdit] = useState<CosHabit[] | null>(null);
  function toggleRoutine(id: string, value: boolean) {
    void patchState({ routineToggle: { week, id, done: value } }, (s) => {
      const set = new Set(s.routineLog[week] ?? []);
      if (value) set.add(id);
      else set.delete(id);
      return { ...s, routineLog: { ...s.routineLog, [week]: Array.from(set) } };
    });
  }
  const pastWeeks = Object.entries(state.routineLog)
    .filter(([k]) => k !== week)
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .slice(0, 8);

  return (
    <CosShell>
      <PageHeader
        title="Pipeline de production"
        subtitle="Chaque contenu avance de colonne en colonne. Glisse la carte, ou utilise les flèches."
        actions={
          <div className="flex gap-1.5 items-center flex-wrap">
            <select className="select select-sm !w-auto" value={platform} onChange={(e) => setPlatform(e.target.value as typeof platform)}>
              <option value="all">Toutes les plateformes</option>
              {PLATFORMS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <button className="btn btn-sm btn-primary" onClick={() => setDraft({ ...emptyItem() })}>
              + Contenu
            </button>
          </div>
        }
      />

      {loading ? (
        <Spinner label="Chargement…" />
      ) : (
        <>
          <div className="flex gap-3 overflow-x-auto pb-3" style={{ scrollSnapType: "x proximity" }}>
            {STATUSES.map((col) => {
              const list = byStatus[col.id];
              const over = overCol === col.id;
              return (
                <div
                  key={col.id}
                  className="shrink-0 rounded-2xl p-2.5 flex flex-col gap-2"
                  style={{ width: 240, minHeight: 200, background: over ? "var(--accent-soft)" : "var(--surface-2)", border: `1px solid ${over ? "var(--accent-ring)" : "var(--border)"}`, scrollSnapAlign: "start" }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (overCol !== col.id) setOverCol(col.id);
                  }}
                  onDragLeave={() => setOverCol((c) => (c === col.id ? null : c))}
                  onDrop={(e) => {
                    e.preventDefault();
                    setOverCol(null);
                    const it = items.find((x) => x.id === dragId);
                    if (it) move(it, col.id);
                    setDragId(null);
                  }}
                >
                  <div className="flex items-center justify-between px-1">
                    <span className="font-semibold text-[12.5px]">{col.label}</span>
                    <span className="dim text-[11.5px] num">{list.length}</span>
                  </div>
                  {list.map((it) => (
                    <div
                      key={it.id}
                      draggable
                      onDragStart={() => setDragId(it.id)}
                      onDragEnd={() => {
                        setDragId(null);
                        setOverCol(null);
                      }}
                      className="rounded-xl p-2.5 grid gap-1.5 cursor-grab"
                      style={{ background: "var(--surface)", border: `1px solid ${it.winner ? "var(--accent-ring)" : "var(--border)"}`, opacity: dragId === it.id ? 0.5 : 1 }}
                      onClick={() => setDraft({ ...it })}
                    >
                      <div className="text-[13px] font-medium leading-snug">{it.title}</div>
                      <div className="flex gap-1 flex-wrap">
                        <Tag>{PLATFORMS.find((p) => p.id === it.platform)?.label}</Tag>
                        <Tag>{FORMATS.find((f) => f.id === it.format)?.label}</Tag>
                        <Tag>{it.funnel}</Tag>
                        {it.winner && <Tag accent>Gagnant</Tag>}
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="dim text-[11px]">{it.dueAt ? new Date(`${it.dueAt}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : it.owner || ""}</span>
                        <span className="flex gap-0.5" onClick={(e) => e.stopPropagation()}>
                          <button className="btn btn-sm btn-ghost !px-1.5 !h-[24px]" title="Colonne précédente" onClick={() => shift(it, -1)} disabled={it.status === "idea"}>
                            ←
                          </button>
                          <button className="btn btn-sm btn-ghost !px-1.5 !h-[24px]" title="Colonne suivante" onClick={() => shift(it, 1)} disabled={it.status === "published"}>
                            →
                          </button>
                        </span>
                      </div>
                    </div>
                  ))}
                  {col.id === "idea" && (
                    <button className="btn btn-sm btn-ghost" onClick={() => setDraft({ ...emptyItem() })}>
                      + Idée
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <div className="grid gap-5 lg:grid-cols-2 mt-4">
            <Card title="Contenus gagnants" subtitle="À reproduire : ce qui a marché, et les variations à tester.">
              {winners.length === 0 ? (
                <div className="dim text-[13px]">Aucun pour l&apos;instant. Dans la fiche d&apos;un contenu publié, coche « Contenu gagnant » et note pourquoi.</div>
              ) : (
                <ul className="grid gap-2">
                  {winners.map((w) => (
                    <li key={w.id} className="rounded-xl p-3 cursor-pointer" style={{ background: "var(--surface-2)", border: "1px solid var(--accent-ring)" }} onClick={() => setDraft({ ...w })}>
                      <div className="font-medium text-[13.5px]">{w.title}</div>
                      <div className="dim text-[12px] num">
                        {w.views.toLocaleString("fr-FR")} vues · {w.comments} commentaires · {w.dms} DM · {w.leads} leads
                      </div>
                      {w.winnerNotes && <div className="text-[12.5px] mt-1 whitespace-pre-wrap">{w.winnerNotes}</div>}
                      {w.variations && (
                        <div className="text-[12.5px] mt-1 whitespace-pre-wrap">
                          <span className="dim">Variations : </span>
                          {w.variations}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card
              title="Routine de production"
              subtitle={`Semaine du ${new Date(`${week}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })} · ${routineDone.size}/${routine.length}`}
              actions={
                <button className="btn btn-sm btn-ghost" onClick={() => setRoutineEdit(routine.map((r) => ({ ...r })))}>
                  Modifier
                </button>
              }
            >
              <InfoNote>Préparer idéalement deux semaines de contenu à l&apos;avance.</InfoNote>
              <ul className="grid gap-1.5 mt-3">
                {routine.map((r) => {
                  const on = routineDone.has(r.id);
                  return (
                    <li key={r.id}>
                      <label className="flex items-start gap-2.5 rounded-xl px-3 py-2 cursor-pointer" style={{ background: on ? "var(--accent-soft)" : "var(--surface-2)", border: `1px solid ${on ? "var(--accent-ring)" : "var(--border)"}` }}>
                        <input type="checkbox" className="mt-0.5" checked={on} onChange={(e) => toggleRoutine(r.id, e.target.checked)} />
                        <span className="text-[13px]" style={{ textDecoration: on ? "line-through" : "none", color: on ? "var(--text-2)" : "var(--text)" }}>
                          {r.label}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              {pastWeeks.length > 0 && (
                <Fold title="Semaines précédentes">
                  <ul className="grid gap-0.5 text-[12.5px]">
                    {pastWeeks.map(([k, ids]) => (
                      <li key={k} className="flex justify-between">
                        <span>Semaine du {new Date(`${k}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</span>
                        <span className="num dim">
                          {ids.length}/{routine.length}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Fold>
              )}
            </Card>
          </div>
        </>
      )}

      {/* Fiche contenu */}
      <Modal
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        title={draft?.id ? "Fiche contenu" : "Nouveau contenu"}
        wide
        footer={
          <div className="flex gap-2 justify-between w-full">
            {draft?.id ? (
              <button className="btn btn-sm btn-ghost" onClick={del} disabled={saving}>
                Supprimer
              </button>
            ) : (
              <span />
            )}
            <button className="btn btn-sm btn-primary" onClick={save} disabled={saving}>
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        }
      >
        {draft && (
          <div className="grid gap-3">
            <Field label="Titre">
              <input className="input" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Ex. Challenge e-commerce 7 jours — Jour 1" />
            </Field>
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Plateforme">
                <select className="select" value={draft.platform} onChange={(e) => setDraft({ ...draft, platform: e.target.value as ContentItem["platform"] })}>
                  {PLATFORMS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Format">
                <select className="select" value={draft.format} onChange={(e) => setDraft({ ...draft, format: e.target.value as ContentItem["format"] })}>
                  {FORMATS.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Funnel">
                <select className="select" value={draft.funnel} onChange={(e) => setDraft({ ...draft, funnel: e.target.value as ContentItem["funnel"] })}>
                  {FUNNELS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Statut">
                <select className="select" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as ContentStatus })}>
                  {STATUSES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Hook">
              <input className="input" value={draft.hook} onChange={(e) => setDraft({ ...draft, hook: e.target.value })} placeholder="La première phrase, celle qui arrête le scroll" />
            </Field>
            <Field label="Plan ou notes">
              <textarea className="textarea" style={{ minHeight: 110 }} value={draft.plan} onChange={(e) => setDraft({ ...draft, plan: e.target.value })} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Responsable">
                <input className="input" value={draft.owner} onChange={(e) => setDraft({ ...draft, owner: e.target.value })} placeholder="Moi, monteur, clipper…" />
              </Field>
              <Field label="Date prévue">
                <input className="input" type="date" value={draft.dueAt} onChange={(e) => setDraft({ ...draft, dueAt: e.target.value })} />
              </Field>
              <Field label="Lien vers les rushs">
                <input className="input mono" value={draft.rushesUrl} onChange={(e) => setDraft({ ...draft, rushesUrl: e.target.value })} placeholder="Drive, Dropbox…" />
              </Field>
              <Field label="Lien vers la version montée">
                <input className="input mono" value={draft.editUrl} onChange={(e) => setDraft({ ...draft, editUrl: e.target.value })} />
              </Field>
            </div>
            <Fold title="Après publication : résultats et contenu gagnant" open={draft.status === "published" || draft.winner}>
              <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
                {(["views", "comments", "dms", "leads"] as const).map((k) => (
                  <Field key={k} label={{ views: "Vues", comments: "Commentaires", dms: "DM", leads: "Leads" }[k]}>
                    <input className="input num" type="number" min={0} value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: Number(e.target.value) || 0 })} />
                  </Field>
                ))}
              </div>
              <Field label="Notes après publication">
                <textarea className="textarea" style={{ minHeight: 70 }} value={draft.postNotes} onChange={(e) => setDraft({ ...draft, postNotes: e.target.value })} />
              </Field>
              <label className="flex items-center gap-2 text-[13.5px] font-medium cursor-pointer">
                <input type="checkbox" checked={draft.winner} onChange={(e) => setDraft({ ...draft, winner: e.target.checked })} />
                Contenu gagnant, à reproduire
              </label>
              {draft.winner && (
                <>
                  <Field label="Ce qui a fonctionné">
                    <textarea className="textarea" style={{ minHeight: 70 }} value={draft.winnerNotes} onChange={(e) => setDraft({ ...draft, winnerNotes: e.target.value })} placeholder="Le hook, l'émotion, le format, le moment…" />
                  </Field>
                  <Field label="Variations à tester">
                    <textarea className="textarea" style={{ minHeight: 70 }} value={draft.variations} onChange={(e) => setDraft({ ...draft, variations: e.target.value })} placeholder="Même sujet, nouveau hook ; même hook, autre exemple ; un seul paramètre à la fois." />
                  </Field>
                </>
              )}
            </Fold>
          </div>
        )}
      </Modal>

      {/* Routine : édition des lignes */}
      <Modal
        open={Boolean(routineEdit)}
        onClose={() => setRoutineEdit(null)}
        title="Routine de production"
        footer={
          <div className="flex gap-2 justify-end w-full">
            <button className="btn btn-sm btn-ghost" onClick={() => setRoutineEdit((d) => [...(d ?? []), { id: `r${Date.now()}`, label: "", order: (d?.length ?? 0) + 1 }])}>
              + Ajouter
            </button>
            <button
              className="btn btn-sm btn-primary"
              onClick={async () => {
                const clean = (routineEdit ?? []).filter((h) => h.label.trim());
                if (!clean.length) return;
                await patchState({ routineItems: clean.map((h, i) => ({ ...h, order: i + 1 })) });
                setRoutineEdit(null);
              }}
            >
              Enregistrer
            </button>
          </div>
        }
      >
        <div className="grid gap-2">
          {(routineEdit ?? []).map((h, i) => (
            <div key={h.id} className="flex gap-2 items-center">
              <input className="input" value={h.label} placeholder="Nouvelle action" onChange={(e) => setRoutineEdit((d) => (d ?? []).map((x, k) => (k === i ? { ...x, label: e.target.value } : x)))} />
              <button className="btn btn-sm btn-ghost" title="Supprimer" onClick={() => setRoutineEdit((d) => (d ?? []).filter((_, k) => k !== i))}>
                ✕
              </button>
            </div>
          ))}
        </div>
      </Modal>
    </CosShell>
  );
}

function Tag({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <span className="text-[10.5px] px-1.5 py-0.5 rounded-full" style={{ background: accent ? "var(--accent-soft)" : "var(--surface-3)", color: accent ? "var(--accent)" : "var(--text-2)", border: `1px solid ${accent ? "var(--accent-ring)" : "var(--border)"}` }}>
      {children}
    </span>
  );
}
