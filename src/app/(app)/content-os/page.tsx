"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, Modal, PageHeader, Spinner } from "@/components/ui";
import { CosShell } from "@/components/content-os/CosShell";
import { useContentOs } from "@/components/content-os/useContentOs";
import { dayKey, STATUSES } from "@/lib/content-os";
import type { CosHabit } from "@/lib/types";

/*
 * Aujourd'hui : la phrase, les 5 actions du jour, la priorité du jour. Rien
 * d'autre au-dessus de la ligne de flottaison. Les cases repartent à zéro
 * chaque jour (date locale), l'historique reste en base.
 */
export default function ContentOsToday() {
  const { state, items, loading, patchState } = useContentOs();
  const [today, setToday] = useState(dayKey());
  const [priority, setPriority] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<CosHabit[]>([]);

  // Minuit passé pendant que la page est ouverte : nouvelle journée, cases vides.
  useEffect(() => {
    const t = setInterval(() => setToday((d) => (d === dayKey() ? d : dayKey())), 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    setPriority(state.priorities[today] ?? "");
  }, [state.priorities, today]);

  const done = useMemo(() => new Set(state.habitLog[today] ?? []), [state.habitLog, today]);
  const habits = useMemo(() => [...state.habits].sort((a, b) => a.order - b.order), [state.habits]);
  const rushes = habits.find((h) => /rush/i.test(h.label));
  const inFlight = items.filter((i) => i.status !== "published").length;
  const shot = items.filter((i) => i.status === "shot" || i.status === "editing").length;

  const last7 = useMemo(() => {
    const out: { key: string; n: number; of: number; label: string }[] = [];
    for (let i = 6; i >= 1; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = dayKey(d);
      out.push({ key, n: (state.habitLog[key] ?? []).length, of: habits.length, label: d.toLocaleDateString("fr-FR", { weekday: "short" }) });
    }
    return out;
  }, [state.habitLog, habits.length]);

  function toggle(id: string, value: boolean) {
    void patchState({ habitToggle: { date: today, id, done: value } }, (s) => {
      const set = new Set(s.habitLog[today] ?? []);
      if (value) set.add(id);
      else set.delete(id);
      return { ...s, habitLog: { ...s.habitLog, [today]: Array.from(set) } };
    });
  }

  function savePriority() {
    if ((state.priorities[today] ?? "") === priority.trim()) return;
    void patchState({ priority: { date: today, text: priority } }, (s) => ({ ...s, priorities: { ...s.priorities, [today]: priority.trim() } }));
  }

  function openEditor() {
    setDraft(habits.map((h) => ({ ...h })));
    setEditing(true);
  }

  async function saveHabits() {
    const clean = draft.filter((h) => h.label.trim());
    if (!clean.length) return;
    await patchState({ habits: clean.map((h, i) => ({ ...h, order: i + 1 })) });
    setEditing(false);
  }

  const dateLabel = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });

  return (
    <CosShell>
      <PageHeader title="Content OS" subtitle={dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1)} />

      <div className="card p-6 sm:p-8 mb-5" style={{ background: "var(--grad-accent)", color: "#fff", border: "none" }}>
        <div className="font-bold tracking-tight" style={{ fontSize: "clamp(26px, 4.5vw, 40px)", lineHeight: 1.05 }}>
          TA VIE, C&apos;EST LE CONTENU.
        </div>
        <div className="mt-2 text-[15px]" style={{ opacity: 0.9 }}>
          Arrête de chercher quoi filmer. Documente ce que tu fais déjà.
        </div>
      </div>

      {loading ? (
        <Spinner label="Chargement…" />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          <Card
            title="Mes actions du jour"
            subtitle={`${done.size}/${habits.length} · tout repart à zéro demain, l'historique est gardé.`}
            actions={
              <div className="flex gap-1.5">
                {rushes && !done.has(rushes.id) && (
                  <button className="btn btn-sm btn-primary" onClick={() => toggle(rushes.id, true)}>
                    Mes rushs sont prêts
                  </button>
                )}
                <button className="btn btn-sm btn-ghost" onClick={openEditor}>
                  Modifier
                </button>
              </div>
            }
          >
            <div className="h-1.5 rounded-full mb-4" style={{ background: "var(--surface-3)" }}>
              <div className="h-1.5 rounded-full" style={{ width: `${habits.length ? (done.size / habits.length) * 100 : 0}%`, background: "var(--accent)", transition: "width .2s" }} />
            </div>
            <ul className="grid gap-1.5">
              {habits.map((h) => {
                const on = done.has(h.id);
                return (
                  <li key={h.id}>
                    <label
                      className="flex items-start gap-3 rounded-xl px-3 py-2.5 cursor-pointer"
                      style={{ background: on ? "var(--accent-soft)" : "var(--surface-2)", border: `1px solid ${on ? "var(--accent-ring)" : "var(--border)"}` }}
                    >
                      <input type="checkbox" className="mt-0.5" checked={on} onChange={(e) => toggle(h.id, e.target.checked)} />
                      <span className="text-[13.5px] leading-snug" style={{ textDecoration: on ? "line-through" : "none", color: on ? "var(--text-2)" : "var(--text)" }}>
                        {h.label}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <div className="flex items-end gap-1.5 mt-4" title="Les 6 derniers jours">
              {last7.map((d) => (
                <div key={d.key} className="flex flex-col items-center gap-1" style={{ width: 34 }}>
                  <div className="w-full rounded-md" style={{ height: 28, background: "var(--surface-3)", position: "relative", overflow: "hidden" }}>
                    <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: `${d.of ? (d.n / d.of) * 100 : 0}%`, background: "var(--accent)", opacity: 0.8 }} />
                  </div>
                  <span className="dim text-[10.5px]">{d.label}</span>
                </div>
              ))}
            </div>
          </Card>

          <div className="grid gap-5 content-start">
            <Card title="Priorité du jour" subtitle="Une seule. Celle qui compte vraiment.">
              <input
                className="input"
                placeholder="Ex. Tourner les séquences du challenge YouTube — Jour 1"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                onBlur={savePriority}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
              />
              {state.priorities[today] && <div className="dim text-[12px] mt-2">Enregistrée. Change-la quand elle est faite ou si la journée tourne autrement.</div>}
            </Card>

            <Card title="Pipeline" subtitle="En un coup d'œil.">
              <div className="grid grid-cols-2 gap-2 text-[13px]">
                <Stat label="Contenus en cours" value={inFlight} />
                <Stat label="Tournés, à monter" value={shot} />
                <Stat label="Programmés" value={items.filter((i) => i.status === "scheduled").length} />
                <Stat label="Publiés" value={items.filter((i) => i.status === "published").length} />
              </div>
              <div className="flex gap-1.5 mt-3">
                <Link className="btn btn-sm" href="/content-os/pipeline">
                  Ouvrir le pipeline
                </Link>
                <Link className="btn btn-sm btn-ghost" href="/content-os/strategie">
                  Stratégie
                </Link>
              </div>
            </Card>
          </div>
        </div>
      )}

      <Modal
        open={editing}
        onClose={() => setEditing(false)}
        title="Mes actions du jour"
        footer={
          <div className="flex gap-2 justify-end w-full">
            <button className="btn btn-sm btn-ghost" onClick={() => setDraft((d) => [...d, { id: `h${Date.now()}`, label: "", order: d.length + 1 }])}>
              + Ajouter
            </button>
            <button className="btn btn-sm btn-primary" onClick={saveHabits}>
              Enregistrer
            </button>
          </div>
        }
      >
        <div className="grid gap-2">
          {draft.map((h, i) => (
            <div key={h.id} className="flex gap-2 items-center">
              <input className="input" value={h.label} placeholder="Nouvelle action" onChange={(e) => setDraft((d) => d.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)))} />
              <button className="btn btn-sm btn-ghost" title="Supprimer" onClick={() => setDraft((d) => d.filter((_, k) => k !== i))}>
                ✕
              </button>
            </div>
          ))}
          <div className="dim text-[12px]">L&apos;ordre des lignes est l&apos;ordre d&apos;affichage. Les coches des jours passés restent dans l&apos;historique.</div>
        </div>
      </Modal>

      <div className="dim text-[11.5px] mt-6">
        Étapes du pipeline : {STATUSES.map((s) => s.label).join(" → ")}.
      </div>
    </CosShell>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl px-3 py-2" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
      <div className="num font-semibold text-[18px]">{value}</div>
      <div className="dim text-[11.5px]">{label}</div>
    </div>
  );
}
