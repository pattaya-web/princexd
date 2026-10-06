"use client";

/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client";
import { useCollection, useDebouncedSave, useLocalState } from "@/lib/client";
import { clipboardFiles } from "@/lib/upload-client";
import { thumbUrl } from "@/components/MediaThumb";
import { uploadMany, type Progress, ProgressBar } from "./upload-ui";
import { Empty, ErrorNote, Modal, Spinner, useToast } from "./ui";
import type { Todo } from "@/lib/types";

/**
 * To-do flottante.
 *
 * Un bouton « TODO » en bas à droite de chaque page, comme la bulle d'un
 * chat. Il ouvre un panneau que l'on déplace et redimensionne librement, et
 * dont la taille est mémorisée. Deux onglets : les tâches à cocher (priorité,
 * couleur, ordre manuel, notes, photos) et un bloc-notes libre pour ce qu'on
 * griffonne sans vouloir en faire une tâche.
 *
 * La page /todo réutilise la même liste en pleine largeur.
 */

const PRIOS: Todo["priority"][] = ["P1", "P2", "P3"];
const PRIO_COLOR: Record<Todo["priority"], string> = {
  P1: "var(--critical)",
  P2: "var(--warning)",
  P3: "var(--text-3)",
};
const PRIO_LABEL: Record<Todo["priority"], string> = { P1: "Urgent", P2: "Normal", P3: "Quand je peux" };

const COLORS: { key: string; label: string; bg: string }[] = [
  { key: "", label: "Neutre", bg: "" },
  { key: "yellow", label: "Jaune", bg: "#fde68a" },
  { key: "green", label: "Vert", bg: "#bbf7d0" },
  { key: "blue", label: "Bleu", bg: "#bfdbfe" },
  { key: "pink", label: "Rose", bg: "#fbcfe8" },
  { key: "orange", label: "Orange", bg: "#fed7aa" },
  { key: "red", label: "Rouge", bg: "#fecaca" },
];
const bgOf = (c?: string) => COLORS.find((x) => x.key === (c ?? ""))?.bg || "";

const today = () => new Date().toISOString().slice(0, 10);
const orderOf = (t: Todo) => (typeof t.order === "number" ? t.order : Number.MAX_SAFE_INTEGER);

/** « il y a 2 min », « 14:05 », « hier » : quand le bloc-notes a été enregistré. */
function savedLabel(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return "à l'instant";
  if (diff < 3_600_000) return `il y a ${Math.round(diff / 60_000)} min`;
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(d);
  return sameDay ? `à ${time}` : `le ${new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short" }).format(d)} à ${time}`;
}

/* ------------------------- Zone de texte qui grandit ------------------------ */

/**
 * Textarea qui prend la hauteur de son contenu, entre `minRows` et `maxRows`.
 * Pour des notes, faire défiler trois lignes dans une boîte fixe est la
 * première chose qui donne envie de ne plus rien écrire.
 */
function GrowingTextarea({
  value,
  onChange,
  placeholder,
  minRows = 3,
  maxRows = 14,
  className = "",
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  minRows?: number;
  maxRows?: number;
  className?: string;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const line = 20;
    const max = maxRows * line + 16;
    el.style.height = `${Math.min(Math.max(el.scrollHeight, minRows * line + 16), max)}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, [value, minRows, maxRows]);
  return (
    <textarea
      ref={ref}
      className={`input w-full !text-[13px] leading-[20px] resize-none ${className}`}
      value={value}
      placeholder={placeholder}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/* ------------------------------- Une tâche ------------------------------- */

function TodoItem({
  todo,
  expanded,
  dragging,
  onToggle,
  onPatch,
  onRemove,
  onExpand,
  onDragHandleDown,
  onPreview,
}: {
  todo: Todo;
  expanded: boolean;
  dragging: boolean;
  onToggle: () => void;
  onPatch: (p: Partial<Todo>) => void;
  onRemove: () => void;
  onExpand: () => void;
  onDragHandleDown: (e: React.PointerEvent) => void;
  onPreview: (url: string) => void;
}) {
  const toast = useToast();
  const [progress, setProgress] = useState<Progress | null>(null);
  const [desc, setDesc] = useState(todo.description ?? "");
  const [notes, setNotes] = useState(todo.notes ?? "");
  const [title, setTitle] = useState(todo.text);
  const [savedAt, setSavedAt] = useState("");
  useEffect(() => setDesc(todo.description ?? ""), [todo.description]);
  useEffect(() => setNotes(todo.notes ?? ""), [todo.notes]);
  useEffect(() => setTitle(todo.text), [todo.text]);
  const markSaved = () => setSavedAt(new Date().toISOString());
  const saveDesc = useDebouncedSave<string>((v) => {
    onPatch({ description: v });
    markSaved();
  }, 500);
  const saveNotes = useDebouncedSave<string>((v) => {
    onPatch({ notes: v });
    markSaved();
  }, 500);
  const saveTitle = useDebouncedSave<string>((v) => {
    if (v.trim()) onPatch({ text: v.trim() });
  }, 500);

  const bg = bgOf(todo.color);
  const overdue = !todo.done && todo.due && todo.due < today();
  const photos = todo.photos ?? [];
  // Aperçu replié : le détail, sinon la première ligne des notes.
  const preview = (todo.description || (todo.notes ?? "").split("\n").find((l) => l.trim()) || "").trim();
  const noteLines = (todo.notes ?? "").split("\n").filter((l) => l.trim()).length;

  const addPhotos = async (files: File[]) => {
    const imgs = files.filter((f) => f.type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(f.name));
    if (!imgs.length) return toast("Seules les images sont acceptées.", "err");
    try {
      const ups = await uploadMany(imgs, setProgress);
      onPatch({ photos: [...photos, ...ups.map((u) => ({ url: u.url, name: u.name }))] });
      toast(`${ups.length} photo${ups.length > 1 ? "s" : ""} ajoutée${ups.length > 1 ? "s" : ""}.`);
    } catch (e) {
      setProgress(null);
      toast((e as Error).message, "err");
    }
  };

  // Ctrl+V d'une capture quand la tâche est ouverte : elle s'y attache.
  useEffect(() => {
    if (!expanded) return;
    const onPaste = (e: ClipboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") {
        // Un texte collé dans un champ reste un texte ; seule une image est captée.
        if (!clipboardFiles(e).length) return;
      }
      const files = clipboardFiles(e);
      if (files.length) {
        e.preventDefault();
        void addPhotos(files);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, photos.length]);

  /** Un clic sur la carte (hors champs et boutons) ouvre ou replie la tâche. */
  const onRowClick = (e: React.MouseEvent) => {
    const el = e.target as HTMLElement;
    if (el.closest("input, textarea, button, a, select, label, summary")) return;
    onExpand();
  };

  return (
    <li
      className="rounded-[10px] transition-shadow"
      style={{
        background: bg ? `color-mix(in srgb, ${bg} 28%, var(--surface))` : "var(--surface)",
        border: "1px solid var(--border)",
        borderLeftWidth: 4,
        borderLeftColor: bg || PRIO_COLOR[todo.priority],
        opacity: dragging ? 0.55 : todo.done ? 0.7 : 1,
        boxShadow: dragging ? "var(--shadow-lg)" : expanded ? "var(--shadow)" : "none",
      }}
    >
      <div className="flex items-start gap-2 px-2 py-2 cursor-pointer" onClick={onRowClick}>
        {/* Poignée : glisser pour réordonner. */}
        <button
          type="button"
          onPointerDown={onDragHandleDown}
          className="shrink-0 mt-0.5 px-0.5 text-[14px] leading-none select-none"
          style={{ color: "var(--text-3)", cursor: "grab", touchAction: "none" }}
          title="Glisser pour réordonner"
          aria-label="Réordonner"
        >
          ⋮⋮
        </button>
        <input
          type="checkbox"
          className="mt-[3px] shrink-0 cursor-pointer"
          style={{ width: 18, height: 18, accentColor: "var(--accent)" }}
          checked={todo.done}
          onChange={onToggle}
          aria-label={todo.done ? "Rouvrir" : "Terminer"}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-1.5">
            <input
              className="flex-1 min-w-0 bg-transparent outline-none text-[14px] font-medium leading-snug"
              style={{ textDecoration: todo.done ? "line-through" : "none", color: todo.done ? "var(--text-3)" : undefined }}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                saveTitle(e.target.value);
              }}
              onBlur={() => title.trim() && title.trim() !== todo.text && onPatch({ text: title.trim() })}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              placeholder="Titre de la tâche"
            />
            <button
              type="button"
              className="shrink-0 text-[10.5px] font-bold px-1.5 rounded-full"
              style={{ color: PRIO_COLOR[todo.priority], border: `1px solid ${PRIO_COLOR[todo.priority]}` }}
              onClick={() => onPatch({ priority: PRIOS[(PRIOS.indexOf(todo.priority) + 1) % PRIOS.length] })}
              title={`${PRIO_LABEL[todo.priority]} · clic pour changer`}
            >
              {todo.priority}
            </button>
            <button type="button" className="btn btn-ghost btn-sm shrink-0 !px-1.5" onClick={onExpand} title={expanded ? "Replier" : "Notes, photos, échéance"}>
              {expanded ? "▾" : "▸"}
            </button>
          </div>
          {!expanded && (preview || photos.length > 0 || todo.due || noteLines > 0) && (
            <div className="flex items-center gap-2 mt-0.5 text-[11.5px] dim min-w-0">
              {preview && <span className="truncate">{preview}</span>}
              {noteLines > 0 && <span className="shrink-0" title={`${noteLines} ligne${noteLines > 1 ? "s" : ""} de notes`}>📝 {noteLines}</span>}
              {photos.length > 0 && <span className="shrink-0">📷 {photos.length}</span>}
              {todo.due && (
                <span className="shrink-0 num" style={{ color: overdue ? "var(--critical)" : undefined, fontWeight: overdue ? 600 : 400 }}>
                  ⏰ {todo.due.split("-").reverse().slice(0, 2).join("/")}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {expanded && (
        <div className="px-2.5 pb-2.5 pl-[58px] flex flex-col gap-2">
          <input
            className="input w-full !text-[12.5px] !h-[32px]"
            placeholder="Détail en une ligne : quoi, pour qui…"
            value={desc}
            onChange={(e) => {
              setDesc(e.target.value);
              saveDesc(e.target.value);
            }}
          />
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="label-xs">Notes</span>
              <span className="dim text-[11px]">{savedAt ? `Enregistré ${savedLabel(savedAt)}` : "Enregistrement automatique"}</span>
            </div>
            <GrowingTextarea
              value={notes}
              onChange={(v) => {
                setNotes(v);
                saveNotes(v);
              }}
              placeholder="Liens, étapes, idées… Tout ce qu'il faut garder sous la main. Ctrl+V colle une capture d'écran."
              minRows={3}
            />
          </div>

          {(photos.length > 0 || progress) && (
            <div className="flex flex-wrap gap-1.5">
              {photos.map((p) => (
                <div key={p.url} className="relative group">
                  <img
                    src={thumbUrl(p.url, 240)}
                    alt={p.name}
                    className="rounded-[8px] object-cover cursor-zoom-in"
                    style={{ width: 72, height: 72, border: "1px solid var(--border)" }}
                    onClick={() => onPreview(p.url)}
                    loading="lazy"
                  />
                  <button
                    type="button"
                    className="absolute -top-1.5 -right-1.5 rounded-full text-[10px] grid place-items-center"
                    style={{ width: 18, height: 18, background: "var(--critical)", color: "#fff" }}
                    onClick={() => onPatch({ photos: photos.filter((x) => x.url !== p.url) })}
                    title="Retirer la photo"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
          {progress && <ProgressBar p={progress} />}

          <div className="flex flex-wrap items-center gap-1.5">
            <label className="btn btn-sm cursor-pointer" title="Ajouter une photo (ou colle une capture avec Ctrl+V)">
              📷 Photo
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  const f = Array.from(e.target.files ?? []);
                  e.target.value = "";
                  void addPhotos(f);
                }}
              />
            </label>
            <span className="flex items-center gap-1 ml-1" title="Couleur">
              {COLORS.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => onPatch({ color: c.key })}
                  className="rounded-full"
                  style={{
                    width: 16,
                    height: 16,
                    background: c.bg || "var(--surface-3)",
                    border: (todo.color ?? "") === c.key ? "2px solid var(--accent)" : "1px solid var(--border)",
                  }}
                  title={c.label}
                />
              ))}
            </span>
            <select
              className="select select-xs !w-auto !text-[11.5px]"
              value={todo.priority}
              onChange={(e) => onPatch({ priority: e.target.value as Todo["priority"] })}
              title="Priorité"
            >
              {PRIOS.map((p) => (
                <option key={p} value={p}>
                  {p} · {PRIO_LABEL[p]}
                </option>
              ))}
            </select>
            <input
              type="date"
              className="input !h-[26px] !text-[11.5px] !w-auto"
              value={todo.due}
              onChange={(e) => onPatch({ due: e.target.value })}
              title="Échéance"
            />
            <button type="button" className="btn btn-sm btn-ghost ml-auto" style={{ color: "var(--critical)" }} onClick={onRemove}>
              Supprimer
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

/* -------------------------------- La liste -------------------------------- */

export function TodoList({ compact = false }: { compact?: boolean }) {
  const { rows, loading, error, create, patch, destroy } = useCollection<Todo>("todos");
  const toast = useToast();
  const [text, setText] = useState("");
  const [priority, setPriority] = useState<Todo["priority"]>("P2");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const active = useMemo(
    () => rows.filter((t) => !t.done).sort((a, b) => orderOf(a) - orderOf(b) || b.createdAt.localeCompare(a.createdAt)),
    [rows],
  );
  const done = useMemo(
    () => rows.filter((t) => t.done).sort((a, b) => (b.doneAt ?? b.createdAt).localeCompare(a.doneAt ?? a.createdAt)),
    [rows],
  );

  /* Ordre manuel : la liste locale bouge pendant le glisser, la base à la fin. */
  const [order, setOrder] = useState<string[] | null>(null);
  const shown = useMemo(
    () => (order ? (order.map((id) => active.find((t) => t.id === id)).filter(Boolean) as Todo[]) : active),
    [order, active],
  );
  const itemRefs = useRef(new Map<string, HTMLLIElement>());
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragRef = useRef<{ id: string; pointerId: number } | null>(null);

  const onDragHandleDown = (id: string) => (e: React.PointerEvent) => {
    e.preventDefault();
    dragRef.current = { id, pointerId: e.pointerId };
    setDraggingId(id);
    setOrder(active.map((t) => t.id));
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onDragMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    setOrder((prev) => {
      if (!prev) return prev;
      const from = prev.indexOf(d.id);
      if (from < 0) return prev;
      // Cible : la première carte dont le milieu est sous le pointeur.
      let to = from;
      for (let i = 0; i < prev.length; i++) {
        if (prev[i] === d.id) continue;
        const el = itemRefs.current.get(prev[i]);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        const mid = r.top + r.height / 2;
        if (i < from && e.clientY < mid) {
          to = i;
          break;
        }
        if (i > from && e.clientY > mid) to = i;
      }
      if (to === from) return prev;
      const next = [...prev];
      next.splice(from, 1);
      next.splice(to, 0, d.id);
      return next;
    });
  };
  const onDragEnd = async () => {
    const d = dragRef.current;
    dragRef.current = null;
    setDraggingId(null);
    if (!d || !order) return;
    const final = order;
    setOrder(null);
    // On n'écrit que les tâches dont la position a changé.
    const changes = final.map((id, i) => ({ id, i })).filter(({ id, i }) => rows.find((t) => t.id === id)?.order !== i);
    try {
      await Promise.all(changes.map(({ id, i }) => patch(id, { order: i })));
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  /**
   * Ajout rapide. Entrée ajoute et referme ; Maj+Entrée ajoute et ouvre la
   * tâche pour écrire ses notes dans la foulée.
   */
  const add = async (openAfter = false) => {
    const t = text.trim();
    if (!t) return;
    try {
      const minOrder = active.length ? Math.min(...active.map(orderOf).filter((n) => n !== Number.MAX_SAFE_INTEGER), 0) : 0;
      const created = await create({
        text: t,
        priority,
        project: "",
        due: "",
        done: false,
        description: "",
        notes: "",
        color: "",
        photos: [],
        order: minOrder - 1,
      });
      setText("");
      if (openAfter) setExpanded(created.id);
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  const toggle = (t: Todo) => void patch(t.id, { done: !t.done, doneAt: t.done ? "" : new Date().toISOString() });
  const remove = async (t: Todo) => {
    if (!window.confirm(`Supprimer « ${t.text} » ?`)) return;
    await destroy(t.id).catch((e) => toast((e as Error).message, "err"));
  };

  if (loading && !rows.length)
    return (
      <div className="p-4">
        <Spinner label="Chargement de la to-do…" />
      </div>
    );
  if (error)
    return (
      <div className="p-3">
        <ErrorNote>{error}</ErrorNote>
      </div>
    );

  return (
    <div className="flex flex-col gap-2.5 h-full min-h-0">
      {/* Saisie rapide */}
      <div>
        <div className="flex items-center gap-1.5">
          <input
            className="input flex-1 !h-[36px]"
            placeholder="Nouvelle tâche…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void add(e.shiftKey);
            }}
          />
          <select
            className="select !w-[64px] !h-[36px] !text-[12px]"
            value={priority}
            onChange={(e) => setPriority(e.target.value as Todo["priority"])}
            title="Priorité"
            style={{ color: PRIO_COLOR[priority], fontWeight: 700 }}
          >
            {PRIOS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <button className="btn btn-primary !h-[36px]" onClick={() => void add(true)} disabled={!text.trim()} title="Ajouter et ouvrir les notes">
            +
          </button>
        </div>
        <div className="dim text-[11px] mt-1 pl-0.5">Entrée : ajouter · Maj+Entrée ou + : ajouter et écrire les notes · clic sur une tâche : l&apos;ouvrir</div>
      </div>

      <div
        className="flex-1 min-h-0 overflow-y-auto pr-0.5"
        onPointerMove={onDragMove}
        onPointerUp={() => void onDragEnd()}
        onPointerCancel={() => void onDragEnd()}
      >
        {!active.length && !done.length ? (
          <Empty>Rien à faire. Note ta première tâche ci-dessus.</Empty>
        ) : (
          <>
            {!active.length && <p className="dim text-[12.5px] text-center py-4">Tout est fait. 🎉</p>}
            <ul className={`flex flex-col ${compact ? "gap-1.5" : "gap-2"}`}>
              {shown.map((t) => (
                <div
                  key={t.id}
                  ref={(el) => {
                    if (el) itemRefs.current.set(t.id, el as unknown as HTMLLIElement);
                    else itemRefs.current.delete(t.id);
                  }}
                  className="contents"
                >
                  <TodoItem
                    todo={t}
                    expanded={expanded === t.id}
                    dragging={draggingId === t.id}
                    onToggle={() => toggle(t)}
                    onPatch={(p) => void patch(t.id, p)}
                    onRemove={() => void remove(t)}
                    onExpand={() => setExpanded(expanded === t.id ? null : t.id)}
                    onDragHandleDown={onDragHandleDown(t.id)}
                    onPreview={setPreview}
                  />
                </div>
              ))}
            </ul>
            {done.length > 0 && (
              <div className="mt-3">
                <button type="button" className="dim text-[12px] select-none" onClick={() => setShowDone((v) => !v)}>
                  {showDone ? "▾" : "▸"} Faites · {done.length}
                </button>
                {showDone && (
                  <ul className="flex flex-col gap-1.5 mt-1.5">
                    {done.map((t) => (
                      <TodoItem
                        key={t.id}
                        todo={t}
                        expanded={expanded === t.id}
                        dragging={false}
                        onToggle={() => toggle(t)}
                        onPatch={(p) => void patch(t.id, p)}
                        onRemove={() => void remove(t)}
                        onExpand={() => setExpanded(expanded === t.id ? null : t.id)}
                        onDragHandleDown={() => undefined}
                        onPreview={setPreview}
                      />
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <Modal open={preview !== null} onClose={() => setPreview(null)} wide title="Photo">
        {preview && <img src={preview} alt="" className="w-full max-h-[75vh] object-contain rounded-[10px]" />}
      </Modal>
    </div>
  );
}

/* ------------------------------- Bloc-notes ------------------------------- */

/**
 * Un texte libre, enregistré tout seul. Pas de tâche, pas de case à cocher :
 * l'endroit où l'on pose un numéro, une idée, le brouillon d'un message,
 * avant de savoir ce qu'on en fera.
 */
export function Notepad() {
  const [notes, setNotes] = useState("");
  const [savedAt, setSavedAt] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "saving" | "error">("loading");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let alive = true;
    api<{ notes: string; updatedAt: string }>("/api/notes")
      .then((r) => {
        if (!alive) return;
        setNotes(r.notes);
        setSavedAt(r.updatedAt);
        setState("ready");
      })
      .catch(() => alive && setState("error"));
    return () => {
      alive = false;
    };
  }, []);

  const save = useDebouncedSave<string>(async (v) => {
    setState("saving");
    try {
      const r = await api<{ updatedAt: string }>("/api/notes", { method: "PATCH", body: JSON.stringify({ notes: v }) });
      setSavedAt(r.updatedAt);
      setState("ready");
    } catch {
      setState("error");
    }
  }, 600);

  /** Insère la date du jour à la position du curseur : une ligne de journal. */
  const stamp = () => {
    const el = ref.current;
    const d = new Date();
    const line = `— ${new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "2-digit", month: "short" }).format(d)} ${new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(d)} —\n`;
    const start = el?.selectionStart ?? notes.length;
    const before = notes.slice(0, start);
    const prefix = before && !before.endsWith("\n") ? "\n" : "";
    const next = `${before}${prefix}${line}${notes.slice(el?.selectionEnd ?? start)}`;
    setNotes(next);
    save(next);
    requestAnimationFrame(() => {
      if (!el) return;
      const pos = (before + prefix + line).length;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  if (state === "loading") {
    return (
      <div className="p-4">
        <Spinner label="Chargement du bloc-notes…" />
      </div>
    );
  }

  const words = notes.trim() ? notes.trim().split(/\s+/).length : 0;

  return (
    <div className="flex flex-col gap-2 h-full min-h-0">
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" className="btn btn-sm" onClick={stamp} title="Insérer la date et l'heure à l'endroit du curseur">
          📅 Date
        </button>
        <span className="dim text-[11px] num">{words} mot{words > 1 ? "s" : ""}</span>
        <span className="ml-auto text-[11px]" style={{ color: state === "error" ? "var(--critical)" : "var(--text-3)" }}>
          {state === "saving" ? "Enregistrement…" : state === "error" ? "Non enregistré, réessaie" : savedAt ? `Enregistré ${savedLabel(savedAt)}` : "Enregistrement automatique"}
        </span>
      </div>
      <textarea
        ref={ref}
        className="input flex-1 min-h-0 w-full !text-[13.5px] leading-[22px] resize-none"
        placeholder={"Écris ici ce que tu veux garder sous la main : idées, numéros, brouillons de messages…\nTout est enregistré automatiquement."}
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value);
          save(e.target.value);
        }}
        spellCheck
      />
    </div>
  );
}

/* ------------------------------ Le panneau ------------------------------- */

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
type ResizeDir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
type Tab = "tasks" | "notes";

const DEFAULT_BOX: Box = { x: -1, y: -1, w: 440, h: 600 };
const MIN_W = 300;
const MIN_H = 260;
/** Place du bouton en bas à droite : le panneau s'ouvre juste au-dessus. */
const LAUNCHER_GAP = 76;

export function TodoDock() {
  const { rows } = useCollection<Todo>("todos");
  const [open, setOpen] = useLocalState<boolean>("todo-dock:open", false);
  const [tab, setTab] = useLocalState<Tab>("todo-dock:tab", "tasks");
  const [box, setBox] = useLocalState<Box>("todo-dock:box", DEFAULT_BOX);
  const [max, setMax] = useState(false);
  const boxRef = useRef(box);
  boxRef.current = box;
  const modeRef = useRef<{ kind: "move" | "resize"; dir?: ResizeDir; sx: number; sy: number; start: Box } | null>(null);

  const active = rows.filter((t) => !t.done);
  const urgent = active.filter((t) => t.priority === "P1").length;

  // Première ouverture : collé en bas à droite, au-dessus du bouton. Ensuite,
  // là où on l'a laissé, ramené dans l'écran si la fenêtre a rétréci.
  const resolved = useMemo<Box>(() => {
    if (typeof window === "undefined") return box;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (max) return { x: Math.round(vw * 0.04), y: 56, w: Math.round(vw * 0.92), h: vh - 72 };
    const w = Math.min(box.w, vw - 16);
    const h = Math.min(box.h, vh - 72);
    const x = box.x < 0 ? Math.max(8, vw - w - 20) : Math.min(Math.max(0, box.x), Math.max(0, vw - w));
    const y = box.y < 0 ? Math.max(56, vh - h - LAUNCHER_GAP) : Math.min(Math.max(56, box.y), Math.max(56, vh - h));
    return { x, y, w, h };
  }, [box, max]);

  const startMove = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    modeRef.current = { kind: "move", sx: e.clientX, sy: e.clientY, start: resolved };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setMax(false);
  };
  const startResize = (dir: ResizeDir) => (e: React.PointerEvent) => {
    e.stopPropagation();
    modeRef.current = { kind: "resize", dir, sx: e.clientX, sy: e.clientY, start: resolved };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setMax(false);
  };
  const onMove = (e: React.PointerEvent) => {
    const m = modeRef.current;
    if (!m) return;
    const dx = e.clientX - m.sx;
    const dy = e.clientY - m.sy;
    const s = m.start;
    if (m.kind === "move") {
      setBox({ ...s, x: s.x + dx, y: Math.max(56, s.y + dy) });
      return;
    }
    let { x, y, w, h } = s;
    const d = m.dir ?? "se";
    if (d.includes("e")) w = Math.max(MIN_W, s.w + dx);
    if (d.includes("s")) h = Math.max(MIN_H, s.h + dy);
    if (d.includes("w")) {
      w = Math.max(MIN_W, s.w - dx);
      x = s.x + (s.w - w);
    }
    if (d.includes("n")) {
      h = Math.max(MIN_H, s.h - dy);
      y = s.y + (s.h - h);
    }
    setBox({ x, y, w, h });
  };
  const onUp = () => {
    modeRef.current = null;
  };

  // Échap referme le panneau quand on n'est pas en train d'écrire.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === "Escape" && tag !== "INPUT" && tag !== "TEXTAREA") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  const handle = useCallback(
    (dir: ResizeDir, style: React.CSSProperties, cursor: string) => (
      <div key={dir} onPointerDown={startResize(dir)} style={{ position: "absolute", ...style, cursor, touchAction: "none", zIndex: 2 }} />
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resolved],
  );

  const tabBtn = (key: Tab, labelText: string) => (
    <button
      type="button"
      onClick={() => setTab(key)}
      className="px-2.5 h-[26px] rounded-[7px] text-[12.5px] font-medium transition-colors"
      style={{
        background: tab === key ? "var(--surface)" : "transparent",
        color: tab === key ? "var(--text)" : "var(--text-2)",
        boxShadow: tab === key ? "var(--shadow)" : "none",
      }}
    >
      {labelText}
    </button>
  );

  return (
    <>
      {/* Le bouton, en bas à droite, toujours visible. */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="todo-launcher fixed z-40 flex items-center gap-2 rounded-full font-bold tracking-wide select-none transition-transform"
        style={{
          background: open ? "var(--surface)" : "var(--accent)",
          color: open ? "var(--text)" : "var(--accent-on)",
          border: open ? "1px solid var(--border)" : "1px solid transparent",
          boxShadow: "var(--shadow-lg)",
          padding: "10px 18px",
          fontSize: 14,
        }}
        title={open ? "Fermer la to-do (Échap)" : "Ouvrir la to-do et le bloc-notes"}
      >
        <span style={{ fontSize: 16 }}>{open ? "✕" : "☑"}</span>
        {open ? "Fermer" : "TODO"}
        {!open && active.length > 0 && (
          <span
            className="num rounded-full px-1.5 text-[11.5px]"
            style={{ background: urgent ? "var(--critical)" : "rgb(255 255 255 / 0.25)", color: urgent ? "#fff" : "inherit", minWidth: 20, textAlign: "center" }}
            title={urgent ? `${urgent} urgente${urgent > 1 ? "s" : ""}` : `${active.length} à faire`}
          >
            {urgent || active.length}
          </span>
        )}
      </button>

      {open && (
        <div
          className="fixed z-40 flex flex-col rise"
          style={{
            left: resolved.x,
            top: resolved.y,
            width: resolved.w,
            height: resolved.h,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 14,
            boxShadow: "var(--shadow-lg)",
            overflow: "hidden",
          }}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          {/* Barre : onglets, déplacer, agrandir, fermer */}
          <div
            className="flex items-center gap-2 px-2.5 py-2 select-none shrink-0"
            style={{ background: "var(--surface-2)", borderBottom: "1px solid var(--border)", cursor: "move", touchAction: "none" }}
            onPointerDown={startMove}
            title="Glisser pour déplacer"
          >
            <div className="flex gap-1 p-1 rounded-[10px]" style={{ background: "var(--surface-3)" }}>
              {tabBtn("tasks", `☑ Tâches${active.length ? ` · ${active.length}` : ""}`)}
              {tabBtn("notes", "📝 Bloc-notes")}
            </div>
            {urgent > 0 && tab === "tasks" && (
              <span className="text-[11.5px] font-semibold" style={{ color: "var(--critical)" }}>
                {urgent} urgente{urgent > 1 ? "s" : ""}
              </span>
            )}
            <span className="ml-auto flex items-center gap-1">
              <a href="/todo" className="btn btn-ghost btn-sm !px-2" title="Ouvrir en pleine page">
                ↗
              </a>
              <button type="button" className="btn btn-ghost btn-sm !px-2" onClick={() => setMax((v) => !v)} title={max ? "Taille normale" : "Plein écran"}>
                {max ? "🗗" : "🗖"}
              </button>
              <button type="button" className="btn btn-ghost btn-sm !px-2" onClick={() => setOpen(false)} title="Fermer (Échap)">
                ✕
              </button>
            </span>
          </div>

          <div className="flex-1 min-h-0 p-2.5">{tab === "tasks" ? <TodoList compact /> : <Notepad />}</div>

          {/* Poignées de redimensionnement : quatre bords, quatre coins. */}
          {handle("n", { top: -3, left: 10, right: 10, height: 7 }, "ns-resize")}
          {handle("s", { bottom: -3, left: 10, right: 10, height: 7 }, "ns-resize")}
          {handle("e", { right: -3, top: 10, bottom: 10, width: 7 }, "ew-resize")}
          {handle("w", { left: -3, top: 10, bottom: 10, width: 7 }, "ew-resize")}
          {handle("ne", { top: -4, right: -4, width: 14, height: 14 }, "nesw-resize")}
          {handle("nw", { top: -4, left: -4, width: 14, height: 14 }, "nwse-resize")}
          {handle("se", { bottom: -4, right: -4, width: 14, height: 14 }, "nwse-resize")}
          {handle("sw", { bottom: -4, left: -4, width: 14, height: 14 }, "nesw-resize")}
          <div
            className="absolute"
            style={{
              right: 3,
              bottom: 3,
              width: 10,
              height: 10,
              borderRight: "2px solid var(--text-3)",
              borderBottom: "2px solid var(--text-3)",
              borderRadius: 2,
              pointerEvents: "none",
              opacity: 0.6,
            }}
          />
        </div>
      )}
    </>
  );
}
