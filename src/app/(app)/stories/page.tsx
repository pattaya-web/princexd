"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, useCollection } from "@/lib/client";
import { Card, CopyButton, Empty, ErrorNote, Field, InfoNote, Modal, PageHeader, Spinner, Toggle, useToast } from "@/components/ui";
import { StatTile } from "@/components/ui";
import { fmtCompact, fmtInt, label, todayISO, WEEKDAYS } from "@/lib/format";
import type { Settings, Story } from "@/lib/types";

const SLOT_ORDER: Story["slot"][] = ["matin", "midi", "aprem", "soir"];

const TYPE_COLOR: Record<string, string> = {
  value: "var(--s1)",
  lifestyle: "var(--s5)",
  "daily-life": "var(--s4)",
  "proof-shopify": "var(--s3)",
  coulisses: "var(--s7)",
  engagement: "var(--s2)",
  "cta-call": "var(--s8)",
  temoignage: "var(--s6)",
};

export default function StoriesPage() {
  const { rows, loading, create, patch, destroy } = useCollection<Story>("stories");
  const toast = useToast();

  const [settings, setSettings] = useState<Settings | null>(null);
  const [date, setDate] = useState(todayISO());
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Story | null>(null);

  useEffect(() => {
    void api<Settings>("/api/settings").then(setSettings).catch(() => setSettings(null));
  }, []);

  const dayStories = useMemo(
    () =>
      rows
        .filter((s) => s.date === date)
        .sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot)),
    [rows, date],
  );

  const weekday = new Date(`${date}T12:00:00`).getDay();
  const plan = settings?.storyPlan?.[String(weekday)] ?? [];

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await api<{ created: Story[] }>("/api/ai/stories", {
        method: "POST",
        body: JSON.stringify({ date }),
      });
      toast(`${res.created.length} séquences écrites pour le ${date}.`);
      window.location.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const addManual = async () => {
    const used = new Set(dayStories.map((s) => s.slot));
    const slot = SLOT_ORDER.find((s) => !used.has(s)) ?? "soir";
    const created = await create({
      date,
      slot,
      type: (plan[SLOT_ORDER.indexOf(slot)] ?? "value") as Story["type"],
      idea: "",
      script: "",
      done: false,
      views: 0,
      replies: 0,
      stickerTaps: 0,
      linkClicks: 0,
      callsBooked: 0,
    });
    setEditing(created);
  };

  const last30 = useMemo(() => {
    const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    return rows.filter((s) => s.date >= cutoff);
  }, [rows]);

  return (
    <>
      <PageHeader
        title="Story OS"
        subtitle="Une rotation fixe par jour de semaine pour ne plus jamais improviser : value, preuve, daily life, puis CTA call."
        actions={
          <>
            <input className="input !w-[150px]" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <button className="btn" onClick={() => void addManual()}>+ Slot</button>
            <button className="btn btn-primary" onClick={() => void generate()} disabled={generating}>
              {generating ? <span className="spinner" /> : "✦"} Écrire la journée
            </button>
          </>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <StatTile label="Stories (30 j)" value={fmtInt(last30.length)} hint={`${last30.filter((s) => s.done).length} postées`} />
        <StatTile label="Vues cumulées" value={fmtCompact(last30.reduce((a, s) => a + s.views, 0))} />
        <StatTile
          label="Clics sur le lien"
          value={fmtInt(last30.reduce((a, s) => a + s.linkClicks, 0))}
          hint="Trafic envoyé vers la prise de call"
        />
        <StatTile
          label="Calls générés"
          value={fmtInt(last30.reduce((a, s) => a + s.callsBooked, 0))}
          accent="var(--good)"
        />
      </div>

      <div className="grid lg:grid-cols-[1fr_290px] gap-4 items-start">
        <div className="flex flex-col gap-4">
          {error && <ErrorNote>{error}</ErrorNote>}

          <Card
            title={`${WEEKDAYS[weekday]} ${date}`}
            subtitle={
              plan.length
                ? `Rotation prévue : ${plan.map((t) => label(t)).join(" → ")}`
                : "Aucune rotation définie pour ce jour."
            }
            padded={false}
          >
            {loading ? (
              <div className="p-4"><Spinner label="Chargement…" /></div>
            ) : !dayStories.length ? (
              <Empty
                action={
                  <button className="btn btn-primary" onClick={() => void generate()} disabled={generating}>
                    ✦ Écrire la journée avec l&apos;IA
                  </button>
                }
              >
                Rien de prévu pour cette date. L&apos;IA écrit les séquences en s&apos;appuyant sur la rotation du
                jour et sur les résultats réels de tes élèves.
              </Empty>
            ) : (
              <ul>
                {dayStories.map((s, i) => (
                  <li
                    key={s.id}
                    className="px-4 py-3"
                    style={{ borderBottom: i < dayStories.length - 1 ? "1px solid var(--border)" : "none" }}
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className="w-[3px] self-stretch rounded-full shrink-0"
                        style={{ background: TYPE_COLOR[s.type] ?? "var(--border-strong)", minHeight: 34 }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="badge !text-[10.5px]">{label(s.slot)}</span>
                          <span
                            className="badge !text-[10.5px]"
                            style={{
                              background: `color-mix(in srgb, ${TYPE_COLOR[s.type] ?? "var(--text-3)"} 15%, transparent)`,
                              borderColor: `color-mix(in srgb, ${TYPE_COLOR[s.type] ?? "var(--text-3)"} 35%, transparent)`,
                              color: TYPE_COLOR[s.type] ?? "var(--text-2)",
                            }}
                          >
                            {label(s.type)}
                          </span>
                          {s.done && <span className="badge badge-good !text-[10.5px]">Postée</span>}
                        </div>
                        {s.idea && <p className="text-[13px] font-medium leading-snug">{s.idea}</p>}
                        {s.script && (
                          <p className="prose-sm mt-1.5 line-clamp-3">{s.script}</p>
                        )}
                      </div>
                      <div className="flex flex-col gap-1.5 shrink-0">
                        <Toggle checked={s.done} onChange={(v) => void patch(s.id, { done: v })} />
                        <button className="btn btn-sm btn-ghost" onClick={() => setEditing(s)}>
                          Ouvrir
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card title="La rotation de la semaine">
            <div className="flex flex-col gap-2">
              {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                const types = settings?.storyPlan?.[String(d)] ?? [];
                return (
                  <div key={d} className="flex items-start gap-2">
                    <span className="text-[11.5px] font-semibold w-[26px] shrink-0 pt-0.5">
                      {WEEKDAYS[d].slice(0, 3)}
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {types.length ? (
                        types.map((t, i) => (
                          <span
                            key={i}
                            className="badge !text-[10px] !py-0"
                            style={{
                              background: `color-mix(in srgb, ${TYPE_COLOR[t] ?? "var(--text-3)"} 14%, transparent)`,
                              borderColor: `color-mix(in srgb, ${TYPE_COLOR[t] ?? "var(--text-3)"} 32%, transparent)`,
                              color: TYPE_COLOR[t] ?? "var(--text-2)",
                            }}
                          >
                            {label(t)}
                          </span>
                        ))
                      ) : (
                        <span className="dim text-[11px]">—</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <Link href="/reglages" className="btn btn-sm w-full mt-3">
              Modifier la rotation
            </Link>
          </Card>

          <InfoNote>
            Le but des stories n&apos;est pas la vue : c&apos;est le clic vers ta page de réservation. Renseigne
            « Clics sur le lien » et « Calls générés » après chaque journée — c&apos;est ce qui te dira quel type de
            story ramène vraiment des appels.
          </InfoNote>
        </div>
      </div>

      <StoryModal
        story={editing}
        onClose={() => setEditing(null)}
        onSave={async (patchData) => {
          if (!editing) return;
          await patch(editing.id, patchData);
          setEditing(null);
          toast("Enregistré.");
        }}
        onDelete={async () => {
          if (!editing) return;
          if (!window.confirm("Supprimer cette story ?")) return;
          await destroy(editing.id);
          setEditing(null);
        }}
      />
    </>
  );
}

function StoryModal({
  story,
  onClose,
  onSave,
  onDelete,
}: {
  story: Story | null;
  onClose: () => void;
  onSave: (patch: Partial<Story>) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<Partial<Story>>({});

  useEffect(() => {
    if (story) setDraft({ ...story });
  }, [story]);

  if (!story) return null;

  const set = <K extends keyof Story>(k: K, v: Story[K]) => setDraft((d) => ({ ...d, [k]: v }));

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={`Story — ${label(story.slot)} · ${label(story.type)}`}
      footer={
        <>
          <button className="btn btn-danger mr-auto" onClick={() => void onDelete()}>Supprimer</button>
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" onClick={() => void onSave(draft)}>Enregistrer</button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Slot">
            <select className="select" value={draft.slot} onChange={(e) => set("slot", e.target.value as Story["slot"])}>
              {SLOT_ORDER.map((s) => (
                <option key={s} value={s}>{label(s)}</option>
              ))}
            </select>
          </Field>
          <Field label="Type">
            <select className="select" value={draft.type} onChange={(e) => set("type", e.target.value as Story["type"])}>
              {Object.keys(TYPE_COLOR).map((t) => (
                <option key={t} value={t}>{label(t)}</option>
              ))}
            </select>
          </Field>
          <Field label="Date">
            <input className="input" type="date" value={draft.date ?? ""} onChange={(e) => set("date", e.target.value)} />
          </Field>
        </div>

        <Field label="Angle">
          <input className="input" value={draft.idea ?? ""} onChange={(e) => set("idea", e.target.value)} />
        </Field>

        <Field label="Script de la séquence">
          <textarea
            className="textarea"
            style={{ minHeight: 220 }}
            value={draft.script ?? ""}
            onChange={(e) => set("script", e.target.value)}
          />
        </Field>

        {draft.script && (
          <div className="flex justify-end">
            <CopyButton text={draft.script} label="Copier le script" />
          </div>
        )}

        <div>
          <span className="label-xs block mb-2">Résultats (à remplir après avoir posté)</span>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {([
              ["views", "Vues"],
              ["replies", "Réponses"],
              ["stickerTaps", "Stickers"],
              ["linkClicks", "Clics lien"],
              ["callsBooked", "Calls"],
            ] as [keyof Story, string][]).map(([key, lbl]) => (
              <Field key={String(key)} label={lbl}>
                <input
                  className="input num"
                  type="number"
                  value={Number(draft[key] ?? 0)}
                  onChange={(e) => set(key as "views", Number(e.target.value))}
                />
              </Field>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
