"use client";

import { useMemo, useState } from "react";
import { useCollection } from "@/lib/client";
import { Card, Empty, ErrorNote, PageHeader, Spinner, Tabs, useToast } from "@/components/ui";
import { fmtDate, label } from "@/lib/format";
import type { Todo } from "@/lib/types";

const PROJECTS = ["contenu", "crm", "eleves", "ads", "produit", "perso"];
const PRIOS: Todo["priority"][] = ["P1", "P2", "P3"];

const PRIO_COLOR: Record<Todo["priority"], string> = {
  P1: "var(--critical)",
  P2: "var(--warning)",
  P3: "var(--text-3)",
};

export default function TodoPage() {
  const { rows, loading, error, create, patch, destroy } = useCollection<Todo>("todos");
  const toast = useToast();

  const [text, setText] = useState("");
  const [priority, setPriority] = useState<Todo["priority"]>("P2");
  const [project, setProject] = useState("contenu");
  const [due, setDue] = useState("");
  const [filter, setFilter] = useState<"actives" | "toutes" | "faites">("actives");

  const add = async () => {
    if (!text.trim()) return;
    try {
      await create({ text: text.trim(), priority, project, due, done: false });
      setText("");
      setDue("");
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  const visible = useMemo(() => {
    const base =
      filter === "actives" ? rows.filter((t) => !t.done) : filter === "faites" ? rows.filter((t) => t.done) : rows;
    // Priorité d'abord, puis échéance la plus proche.
    return [...base].sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      if (a.priority !== b.priority) return a.priority.localeCompare(b.priority);
      if (a.due && b.due) return a.due.localeCompare(b.due);
      return a.due ? -1 : b.due ? 1 : 0;
    });
  }, [rows, filter]);

  const overdue = (t: Todo) => !t.done && t.due && t.due < new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader
        title="To-do"
        subtitle="Ce qui doit sortir aujourd'hui. Les tâches en retard remontent en rouge."
        actions={
          <Tabs
            value={filter}
            onChange={setFilter}
            options={[
              { value: "actives", label: "À faire", count: rows.filter((t) => !t.done).length },
              { value: "faites", label: "Faites", count: rows.filter((t) => t.done).length },
              { value: "toutes", label: "Toutes", count: rows.length },
            ]}
          />
        }
      />

      {error && <div className="mb-4"><ErrorNote>{error}</ErrorNote></div>}

      <Card className="mb-4">
        <div className="flex flex-wrap gap-2">
          <input
            className="input flex-1 min-w-[220px]"
            placeholder="Nouvelle tâche…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void add();
            }}
          />
          <select className="select !w-[92px]" value={priority} onChange={(e) => setPriority(e.target.value as Todo["priority"])}>
            {PRIOS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <select className="select !w-[130px]" value={project} onChange={(e) => setProject(e.target.value)}>
            {PROJECTS.map((p) => (
              <option key={p} value={p}>{label(p)}</option>
            ))}
          </select>
          <input className="input !w-[145px]" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          <button className="btn btn-primary" onClick={() => void add()} disabled={!text.trim()}>
            Ajouter
          </button>
        </div>
      </Card>

      {loading ? (
        <Card><Spinner label="Chargement…" /></Card>
      ) : !visible.length ? (
        <Card><Empty>Rien à afficher ici.</Empty></Card>
      ) : (
        <Card padded={false}>
          <ul>
            {visible.map((t, i) => (
              <li
                key={t.id}
                className="flex items-center gap-3 px-3.5 py-2.5"
                style={{ borderBottom: i < visible.length - 1 ? "1px solid var(--border)" : "none" }}
              >
                <input
                  type="checkbox"
                  checked={t.done}
                  onChange={() => void patch(t.id, { done: !t.done })}
                  className="shrink-0 cursor-pointer"
                  style={{ width: 15, height: 15, accentColor: "var(--accent)" }}
                  aria-label={t.done ? "Rouvrir" : "Terminer"}
                />
                <span
                  className="w-[22px] shrink-0 text-[11px] font-bold num"
                  style={{ color: PRIO_COLOR[t.priority] }}
                >
                  {t.priority}
                </span>
                <span
                  className="flex-1 text-[13px] leading-snug"
                  style={{ textDecoration: t.done ? "line-through" : "none", color: t.done ? "var(--text-3)" : undefined }}
                >
                  {t.text}
                </span>
                <span className="badge !text-[10.5px] shrink-0">{label(t.project)}</span>
                {t.due && (
                  <span
                    className="text-[11.5px] num shrink-0 w-[62px] text-right"
                    style={{ color: overdue(t) ? "var(--critical)" : "var(--text-3)", fontWeight: overdue(t) ? 600 : 400 }}
                  >
                    {fmtDate(t.due)}
                  </span>
                )}
                <button
                  className="btn btn-sm btn-danger shrink-0"
                  onClick={() => void destroy(t.id)}
                  aria-label="Supprimer"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
