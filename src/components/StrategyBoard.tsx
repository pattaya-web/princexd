"use client";

/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCollection, useDebouncedSave } from "@/lib/client";
import { clipboardFiles, droppedFiles } from "@/lib/upload-client";
import { thumbUrl } from "@/components/MediaThumb";
import { ProgressBar, uploadMany, type Progress } from "./upload-ui";
import { Card, Empty, ErrorNote, Modal, Spinner, useToast } from "./ui";
import type { AdBoard, AdFolder, BoardCard, Swipe } from "@/lib/types";

/**
 * Tableau de stratégie créative, façon Miro, dans la section Ads.
 *
 * Un tableau par dossier Ads (plus un tableau global) : une toile infinie où
 * poser des notes (hooks, angles, promesses), des captures d'écran collées
 * au Ctrl+V, des liens vers des pubs de référence, et des zones titrées pour
 * regrouper tout ça. Les hooks déjà extraits par l'IA sur les swipes et les
 * scripts s'ajoutent en un clic : le tableau n'est pas un outil à part, il
 * s'appuie sur ce que la section contient déjà.
 *
 * Tout est sauvegardé en base (collection `adBoards`) avec un léger différé,
 * donc le tableau se retrouve tel quel depuis n'importe quel appareil.
 */

type Mode = { kind: "pan"; sx: number; sy: number; ox: number; oy: number } | { kind: "move" | "resize"; id: string; sx: number; sy: number; ox: number; oy: number } | null;

const COLORS: { key: string; label: string; bg: string }[] = [
  { key: "", label: "Neutre", bg: "" },
  { key: "yellow", label: "Jaune", bg: "#fde68a" },
  { key: "green", label: "Vert", bg: "#bbf7d0" },
  { key: "blue", label: "Bleu", bg: "#bfdbfe" },
  { key: "pink", label: "Rose", bg: "#fbcfe8" },
  { key: "orange", label: "Orange", bg: "#fed7aa" },
];
const bgOf = (c: string) => COLORS.find((x) => x.key === c)?.bg || "";

const MIN_SCALE = 0.25;
const MAX_SCALE = 2.5;
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/* ------------------------------ Une carte ------------------------------ */

function CardView({
  card,
  selected,
  editing,
  onPointerDown,
  onResizeDown,
  onEdit,
  onText,
  onStopEdit,
}: {
  card: BoardCard;
  selected: boolean;
  editing: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onResizeDown: (e: React.PointerEvent) => void;
  onEdit: () => void;
  onText: (text: string) => void;
  onStopEdit: () => void;
}) {
  const bg = bgOf(card.color);
  const isZone = card.kind === "zone";
  const base: React.CSSProperties = {
    position: "absolute",
    left: card.x,
    top: card.y,
    width: card.w,
    height: card.h,
    zIndex: isZone ? 0 : 1 + card.z,
    borderRadius: 10,
    outline: selected ? "2px solid var(--accent)" : "none",
    outlineOffset: 2,
    cursor: editing ? "text" : "grab",
    touchAction: "none",
    userSelect: "none",
  };

  const textarea = (
    <textarea
      autoFocus
      className="w-full h-full resize-none bg-transparent outline-none text-[13px] leading-snug"
      style={{ color: bg ? "#1f2937" : "var(--text)", fontWeight: isZone ? 600 : 400 }}
      value={card.text}
      onChange={(e) => onText(e.target.value)}
      onBlur={onStopEdit}
      onKeyDown={(e) => {
        if (e.key === "Escape") onStopEdit();
        e.stopPropagation();
      }}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );

  if (isZone) {
    return (
      <div
        style={{
          ...base,
          border: `2px dashed ${bg || "var(--border-strong, var(--border))"}`,
          background: bg ? `color-mix(in srgb, ${bg} 18%, transparent)` : "color-mix(in srgb, var(--surface-3) 45%, transparent)",
        }}
        onPointerDown={onPointerDown}
        onDoubleClick={onEdit}
      >
        <div className="absolute left-2 top-1.5 right-2 h-[26px] text-[13px] font-semibold truncate" style={{ color: bg ? "#1f2937" : "var(--text-2)" }}>
          {editing ? textarea : card.text || "Zone sans titre"}
        </div>
        {selected && <ResizeHandle onPointerDown={onResizeDown} />}
      </div>
    );
  }

  return (
    <div
      className="card-flat overflow-hidden flex flex-col"
      style={{
        ...base,
        background: bg || "var(--surface)",
        color: bg ? "#1f2937" : "var(--text)",
        boxShadow: "0 2px 10px rgb(0 0 0 / 0.08)",
      }}
      onPointerDown={onPointerDown}
      onDoubleClick={card.kind === "image" ? undefined : onEdit}
    >
      {card.kind === "note" && (
        <div className="flex-1 min-h-0 p-2.5 text-[13px] leading-snug whitespace-pre-wrap break-words overflow-hidden">
          {editing ? textarea : card.text || <span style={{ opacity: 0.5 }}>Double-clic pour écrire</span>}
        </div>
      )}
      {card.kind === "link" && (
        <div className="flex-1 min-h-0 p-2.5 flex flex-col gap-1 overflow-hidden">
          {editing ? (
            textarea
          ) : (
            <>
              <span className="text-[13px] font-medium leading-snug break-words">{card.text || hostOf(card.url)}</span>
              <a
                href={card.url}
                target="_blank"
                rel="noreferrer"
                className="text-[11.5px] truncate mt-auto"
                style={{ color: bg ? "#1d4ed8" : "var(--accent)" }}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                title={card.url}
              >
                {hostOf(card.url)} ↗
              </a>
            </>
          )}
        </div>
      )}
      {card.kind === "image" && (
        <>
          <div className="flex-1 min-h-0" style={{ background: "#000" }}>
            <img src={thumbUrl(card.url, 480)} alt={card.text} className="w-full h-full object-contain pointer-events-none" draggable={false} />
          </div>
          <div className="px-2 py-1 text-[11px] truncate" style={{ minHeight: 22 }} onDoubleClick={onEdit}>
            {editing ? (
              <input
                autoFocus
                className="w-full bg-transparent outline-none text-[11px]"
                value={card.text}
                onChange={(e) => onText(e.target.value)}
                onBlur={onStopEdit}
                onKeyDown={(e) => {
                  if (e.key === "Escape" || e.key === "Enter") onStopEdit();
                  e.stopPropagation();
                }}
                onPointerDown={(e) => e.stopPropagation()}
              />
            ) : (
              card.text || <span style={{ opacity: 0.5 }}>Double-clic pour légender</span>
            )}
          </div>
        </>
      )}
      {card.source && !editing && (
        <span className="absolute top-1 right-1.5 text-[9.5px] opacity-60" title="Hook repris d'un swipe ou d'un script">✦</span>
      )}
      {selected && <ResizeHandle onPointerDown={onResizeDown} />}
    </div>
  );
}

function ResizeHandle({ onPointerDown }: { onPointerDown: (e: React.PointerEvent) => void }) {
  return (
    <div
      onPointerDown={onPointerDown}
      className="absolute"
      style={{ right: -4, bottom: -4, width: 16, height: 16, cursor: "nwse-resize", borderRadius: 4, background: "var(--accent)", zIndex: 5 }}
      title="Redimensionner"
    />
  );
}

/* ---------------------------- Import des hooks ---------------------------- */

function HooksPicker({
  swipes,
  folder,
  onClose,
  onAdd,
}: {
  swipes: Swipe[];
  folder: AdFolder | null;
  onClose: () => void;
  onAdd: (hooks: { text: string; source: string }[]) => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");

  const items = useMemo(() => {
    const out: { key: string; text: string; source: string; from: string }[] = [];
    for (const s of swipes) {
      if (!s.analysis) continue;
      const from = s.author ? `@${s.author.replace(/^@/, "")}` : s.title || s.platform || "swipe";
      if (s.analysis.hook) out.push({ key: `${s.id}:hook`, text: s.analysis.hook, source: `swipe:${s.id}`, from });
      (s.analysis.altHooks ?? []).forEach((h, i) => h && out.push({ key: `${s.id}:alt${i}`, text: h, source: `swipe:${s.id}`, from: `${from} · variante` }));
      if (s.analysis.adaptation?.hook) out.push({ key: `${s.id}:adapt`, text: s.analysis.adaptation.hook, source: `swipe:${s.id}`, from: `${from} · adapté à toi` });
    }
    if (folder) {
      for (const sc of folder.scripts) {
        if (sc.hook) out.push({ key: `${sc.id}:hook`, text: sc.hook, source: `script:${sc.id}`, from: `script « ${sc.title} »` });
        (sc.hooks ?? []).forEach((h, i) => h && out.push({ key: `${sc.id}:h${i}`, text: h, source: `script:${sc.id}`, from: `script « ${sc.title} » · variante` }));
      }
    }
    const needle = q.trim().toLowerCase();
    return needle ? out.filter((o) => `${o.text} ${o.from}`.toLowerCase().includes(needle)) : out;
  }, [swipes, folder, q]);

  const toggle = (k: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title="Ajouter des hooks au tableau"
      footer={
        <>
          <span className="dim text-[12px] mr-auto">{picked.size} sélectionné{picked.size > 1 ? "s" : ""}</span>
          <button className="btn" onClick={onClose}>Annuler</button>
          <button
            className="btn btn-primary"
            disabled={!picked.size}
            onClick={() => {
              onAdd(items.filter((i) => picked.has(i.key)).map((i) => ({ text: i.text, source: i.source })));
              onClose();
            }}
          >
            Poser {picked.size || ""} hook{picked.size > 1 ? "s" : ""}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="dim text-[12.5px]">
          Les hooks extraits par l&apos;IA sur tes swipes{folder ? `, et ceux des scripts du dossier « ${folder.title} »` : ""}. Coche ceux à poser
          sur le tableau : chacun devient une note jaune.
        </p>
        <input className="input w-full" placeholder="Filtrer…" value={q} onChange={(e) => setQ(e.target.value)} />
        {!items.length ? (
          <Empty>Aucun hook analysé pour l&apos;instant. Analyse un swipe ou écris un hook dans un script.</Empty>
        ) : (
          <ul className="flex flex-col gap-1 max-h-[55vh] overflow-y-auto pr-1">
            {items.map((i) => (
              <li key={i.key}>
                <label className="flex items-start gap-2.5 rounded-[8px] px-2.5 py-2 cursor-pointer" style={{ background: picked.has(i.key) ? "color-mix(in srgb, var(--accent) 12%, transparent)" : "var(--surface-2)" }}>
                  <input type="checkbox" className="mt-0.5" checked={picked.has(i.key)} onChange={() => toggle(i.key)} />
                  <span className="min-w-0">
                    <span className="block text-[13px] leading-snug">{i.text}</span>
                    <span className="block dim text-[11px] mt-0.5 truncate">{i.from}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

/* ------------------------------- Tableau -------------------------------- */

export function StrategyBoard({ folders }: { folders: AdFolder[] }) {
  const { rows, loading, error, create, patch } = useCollection<AdBoard>("adBoards");
  const { rows: swipes } = useCollection<Swipe>("swipes");
  const toast = useToast();

  const [folderId, setFolderId] = useState<string>("");
  const folder = folders.find((f) => f.id === folderId) ?? null;
  const board = rows.find((b) => b.folderId === folderId) ?? null;
  const creatingRef = useRef(false);

  // Premier passage sur un dossier : le tableau est créé vide, sans bouton.
  useEffect(() => {
    if (loading || board || creatingRef.current) return;
    creatingRef.current = true;
    void create({ folderId, title: folder ? folder.title : "Stratégie globale", cards: [], updatedAt: new Date().toISOString() })
      .catch((e) => toast((e as Error).message, "err"))
      .finally(() => {
        creatingRef.current = false;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, board, folderId]);

  /* Cartes : copie locale pour un déplacement fluide, sauvegarde différée. */
  const [cards, setCards] = useState<BoardCard[]>([]);
  const boardIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!board) return;
    if (boardIdRef.current !== board.id) {
      boardIdRef.current = board.id;
      setCards(board.cards ?? []);
      setSelected(null);
      setEditing(null);
    }
  }, [board]);

  const [saving, setSaving] = useState(false);
  const save = useDebouncedSave<BoardCard[]>(async (next) => {
    if (!boardIdRef.current) return;
    setSaving(true);
    try {
      await patch(boardIdRef.current, { cards: next, updatedAt: new Date().toISOString() });
    } catch (e) {
      toast(`Sauvegarde impossible : ${(e as Error).message}`, "err");
    } finally {
      setSaving(false);
    }
  }, 700);

  const update = useCallback(
    (fn: (prev: BoardCard[]) => BoardCard[]) => {
      setCards((prev) => {
        const next = fn(prev);
        save(next);
        return next;
      });
    },
    [save],
  );

  /* Vue : décalage et zoom. */
  const [view, setView] = useState({ x: 60, y: 40, s: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const canvasRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef<Mode>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [preview, setPreview] = useState<BoardCard | null>(null);

  const toWorld = (clientX: number, clientY: number) => {
    const r = canvasRef.current?.getBoundingClientRect();
    const v = viewRef.current;
    return { x: ((clientX - (r?.left ?? 0)) - v.x) / v.s, y: ((clientY - (r?.top ?? 0)) - v.y) / v.s };
  };
  const center = () => {
    const r = canvasRef.current?.getBoundingClientRect();
    return toWorld((r?.left ?? 0) + (r?.width ?? 800) / 2, (r?.top ?? 0) + (r?.height ?? 500) / 2);
  };

  /* Molette : défilement = déplacement, Ctrl/⌘ + molette ou pincement = zoom. */
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect();
        const px = e.clientX - r.left;
        const py = e.clientY - r.top;
        const ns = clamp(v.s * Math.exp(-e.deltaY * 0.0015), MIN_SCALE, MAX_SCALE);
        const k = ns / v.s;
        setView({ s: ns, x: px - (px - v.x) * k, y: py - (py - v.y) * k });
      } else {
        setView({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const zoomBy = (k: number) => {
    const r = canvasRef.current?.getBoundingClientRect();
    const px = (r?.width ?? 800) / 2;
    const py = (r?.height ?? 500) / 2;
    const v = viewRef.current;
    const ns = clamp(v.s * k, MIN_SCALE, MAX_SCALE);
    const kk = ns / v.s;
    setView({ s: ns, x: px - (px - v.x) * kk, y: py - (py - v.y) * kk });
  };

  /* Pointeur : déplacement de la toile, d'une carte, ou redimensionnement. */
  const onCanvasDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    if (e.target !== e.currentTarget && (e.target as HTMLElement).dataset.bg !== "1") return;
    setSelected(null);
    setEditing(null);
    modeRef.current = { kind: "pan", sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onCardDown = (c: BoardCard) => (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.stopPropagation();
    if (editing && editing !== c.id) setEditing(null);
    setSelected(c.id);
    // Au premier plan : la carte qu'on touche passe devant les autres.
    if (c.kind !== "zone") {
      const top = Math.max(0, ...cards.map((x) => x.z));
      if (c.z < top) update((prev) => prev.map((x) => (x.id === c.id ? { ...x, z: top + 1 } : x)));
    }
    if (editing === c.id) return;
    modeRef.current = { kind: "move", id: c.id, sx: e.clientX, sy: e.clientY, ox: c.x, oy: c.y };
    canvasRef.current?.setPointerCapture(e.pointerId);
  };
  const onResizeDown = (c: BoardCard) => (e: React.PointerEvent) => {
    e.stopPropagation();
    modeRef.current = { kind: "resize", id: c.id, sx: e.clientX, sy: e.clientY, ox: c.w, oy: c.h };
    canvasRef.current?.setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const m = modeRef.current;
    if (!m) return;
    const dx = e.clientX - m.sx;
    const dy = e.clientY - m.sy;
    if (m.kind === "pan") {
      setView((v) => ({ ...v, x: m.ox + dx, y: m.oy + dy }));
      return;
    }
    const s = viewRef.current.s;
    if (m.kind === "move") {
      setCards((prev) => prev.map((c) => (c.id === m.id ? { ...c, x: Math.round(m.ox + dx / s), y: Math.round(m.oy + dy / s) } : c)));
    } else {
      setCards((prev) =>
        prev.map((c) => (c.id === m.id ? { ...c, w: Math.max(90, Math.round(m.ox + dx / s)), h: Math.max(50, Math.round(m.oy + dy / s)) } : c)),
      );
    }
  };
  const onUp = () => {
    const m = modeRef.current;
    modeRef.current = null;
    if (m && m.kind !== "pan") setCards((prev) => (save(prev), prev));
  };

  /* Ajouts. */
  const add = (partial: Partial<BoardCard> & Pick<BoardCard, "kind">, at?: { x: number; y: number }) => {
    const p = at ?? center();
    const size = partial.kind === "zone" ? { w: 420, h: 300 } : partial.kind === "image" ? { w: 260, h: 220 } : partial.kind === "link" ? { w: 220, h: 90 } : { w: 200, h: 110 };
    const card: BoardCard = {
      id: uid(),
      x: Math.round(p.x - size.w / 2),
      y: Math.round(p.y - size.h / 2),
      ...size,
      text: "",
      url: "",
      color: partial.kind === "note" ? "yellow" : "",
      source: "",
      z: Math.max(0, ...cards.map((c) => c.z)) + 1,
      ...partial,
    };
    update((prev) => [...prev, card]);
    setSelected(card.id);
    return card;
  };

  const addNote = () => {
    const c = add({ kind: "note" });
    setEditing(c.id);
  };
  const addZone = () => {
    const c = add({ kind: "zone", text: "" });
    setEditing(c.id);
  };
  const addLink = () => {
    const url = window.prompt("Adresse du lien (pub, page, vidéo…)");
    if (!url?.trim()) return;
    const clean = /^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
    const c = add({ kind: "link", url: clean, text: "" });
    setEditing(c.id);
  };
  const addHooks = (hooks: { text: string; source: string }[]) => {
    const c = center();
    const cols = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(hooks.length))));
    const zTop = Math.max(0, ...cards.map((x) => x.z));
    const fresh: BoardCard[] = hooks.map((h, i) => ({
      id: uid(),
      kind: "note",
      x: Math.round(c.x - (cols * 215) / 2 + (i % cols) * 215),
      y: Math.round(c.y - 60 + Math.floor(i / cols) * 125),
      w: 200,
      h: 110,
      text: h.text,
      url: "",
      color: "yellow",
      source: h.source,
      z: zTop + 1 + i,
    }));
    update((prev) => [...prev, ...fresh]);
    toast(`${fresh.length} hook${fresh.length > 1 ? "s" : ""} posé${fresh.length > 1 ? "s" : ""} sur le tableau.`);
  };

  const addImages = async (files: File[], at?: { x: number; y: number }) => {
    const imgs = files.filter((f) => f.type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(f.name));
    if (!imgs.length) return toast("Seules les images sont acceptées sur le tableau.", "err");
    try {
      const ups = await uploadMany(imgs, setProgress);
      const base = at ?? center();
      ups.forEach((u, i) => add({ kind: "image", url: u.url, text: "" }, { x: base.x + i * 30, y: base.y + i * 30 }));
      toast(`${ups.length} capture${ups.length > 1 ? "s" : ""} ajoutée${ups.length > 1 ? "s" : ""}.`);
    } catch (e) {
      setProgress(null);
      toast((e as Error).message, "err");
    }
  };

  // Ctrl+V d'une capture d'écran : le geste principal pour alimenter le tableau.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (editing) return;
      const files = clipboardFiles(e);
      if (files.length) {
        e.preventDefault();
        void addImages(files);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, cards, view]);

  // Suppr / Retour arrière sur la carte sélectionnée, Échap pour désélectionner.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editing) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "Escape") setSelected(null);
      if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        e.preventDefault();
        removeSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, selected, cards]);

  const removeSelected = () => {
    const c = cards.find((x) => x.id === selected);
    if (!c) return;
    if ((c.kind === "image" || c.kind === "zone") && !window.confirm(c.kind === "image" ? "Retirer cette capture du tableau ?" : "Retirer cette zone ? Les cartes qu'elle contient restent.")) return;
    update((prev) => prev.filter((x) => x.id !== c.id));
    setSelected(null);
  };
  const recolor = (color: string) => {
    if (!selected) return;
    update((prev) => prev.map((x) => (x.id === selected ? { ...x, color } : x)));
  };
  const sel = cards.find((c) => c.id === selected) ?? null;

  if (loading && !rows.length) return <Card><Spinner label="Chargement du tableau…" /></Card>;
  if (error) return <ErrorNote>{error}</ErrorNote>;

  return (
    <div className="flex flex-col gap-2">
      {/* Barre d'outils */}
      <div className="flex flex-wrap items-center gap-2">
        <select className="select !w-auto !h-[30px] !text-[12px]" value={folderId} onChange={(e) => setFolderId(e.target.value)} title="Quel tableau">
          <option value="">🧭 Stratégie globale</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>📁 {f.title}</option>
          ))}
        </select>
        <span className="w-px h-5" style={{ background: "var(--border)" }} />
        <button className="btn btn-sm" onClick={addNote} title="Une note : hook, angle, promesse…">+ Note</button>
        <button className="btn btn-sm" onClick={addZone} title="Un cadre titré pour regrouper">+ Zone</button>
        <button className="btn btn-sm" onClick={addLink} title="Un lien vers une pub ou une page">+ Lien</button>
        <label className="btn btn-sm cursor-pointer" title="Une capture d'écran (ou colle-la avec Ctrl+V)">
          + Capture
          <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; void addImages(f); }} />
        </label>
        <button className="btn btn-sm btn-primary" onClick={() => setPicker(true)} title="Poser les hooks déjà analysés sur tes swipes et scripts">✦ Hooks des swipes</button>

        {sel && (
          <>
            <span className="w-px h-5" style={{ background: "var(--border)" }} />
            <span className="flex items-center gap-1" title="Couleur de la carte">
              {COLORS.map((c) => (
                <button
                  key={c.key}
                  onClick={() => recolor(c.key)}
                  className="rounded-full"
                  style={{ width: 18, height: 18, background: c.bg || "var(--surface-3)", border: sel.color === c.key ? "2px solid var(--accent)" : "1px solid var(--border)" }}
                  title={c.label}
                />
              ))}
            </span>
            {sel.kind === "image" && <button className="btn btn-sm" onClick={() => setPreview(sel)}>Voir en grand</button>}
            {sel.kind === "link" && <a className="btn btn-sm" href={sel.url} target="_blank" rel="noreferrer">Ouvrir ↗</a>}
            <button className="btn btn-sm btn-danger" onClick={removeSelected}>Retirer</button>
          </>
        )}

        <span className="ml-auto flex items-center gap-1">
          <span className="dim text-[11.5px] mr-1">{saving ? "Enregistrement…" : `${cards.length} carte${cards.length > 1 ? "s" : ""}`}</span>
          <button className="btn btn-sm" onClick={() => zoomBy(1 / 1.2)} title="Zoom arrière">−</button>
          <button className="btn btn-sm num" onClick={() => setView({ x: 60, y: 40, s: 1 })} title="Revenir à la vue de départ">{Math.round(view.s * 100)} %</button>
          <button className="btn btn-sm" onClick={() => zoomBy(1.2)} title="Zoom avant">+</button>
        </span>
      </div>

      {progress && <ProgressBar p={progress} />}

      {/* Toile */}
      <div
        ref={canvasRef}
        className="relative overflow-hidden rounded-[12px] select-none"
        style={{
          height: "max(520px, calc(100vh - 250px))",
          border: "1px solid var(--border)",
          background: "var(--surface-2)",
          backgroundImage: "radial-gradient(var(--border) 1px, transparent 1px)",
          backgroundSize: `${24 * view.s}px ${24 * view.s}px`,
          backgroundPosition: `${view.x}px ${view.y}px`,
          cursor: modeRef.current?.kind === "pan" ? "grabbing" : "default",
          touchAction: "none",
        }}
        onPointerDown={onCanvasDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const files = droppedFiles(e);
          if (files.length) void addImages(files, toWorld(e.clientX, e.clientY));
        }}
      >
        <div data-bg="1" style={{ position: "absolute", inset: 0 }} />
        <div style={{ position: "absolute", left: 0, top: 0, transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`, transformOrigin: "0 0" }}>
          {cards.map((c) => (
            <CardView
              key={c.id}
              card={c}
              selected={selected === c.id}
              editing={editing === c.id}
              onPointerDown={onCardDown(c)}
              onResizeDown={onResizeDown(c)}
              onEdit={() => {
                setSelected(c.id);
                setEditing(c.id);
              }}
              onText={(text) => update((prev) => prev.map((x) => (x.id === c.id ? { ...x, text } : x)))}
              onStopEdit={() => setEditing(null)}
            />
          ))}
        </div>

        {!cards.length && (
          <div className="absolute inset-0 grid place-items-center pointer-events-none">
            <div className="text-center max-w-[420px] px-4" style={{ color: "var(--text-2)" }}>
              <p className="text-[15px] font-semibold mb-1">Ton tableau est vide</p>
              <p className="text-[12.5px] leading-relaxed">
                Pose des <strong>notes</strong> pour tes hooks et tes angles, <strong>colle des captures</strong> avec Ctrl+V, ajoute des <strong>liens</strong> vers les pubs qui t&apos;inspirent, et range tout dans des <strong>zones</strong>.
                Molette pour te déplacer, Ctrl + molette pour zoomer, double-clic pour écrire.
              </p>
            </div>
          </div>
        )}
      </div>

      {picker && <HooksPicker swipes={swipes} folder={folder} onClose={() => setPicker(false)} onAdd={addHooks} />}

      <Modal open={preview !== null} onClose={() => setPreview(null)} wide title={preview?.text || "Capture"}>
        {preview && <img src={preview.url} alt={preview.text} className="w-full max-h-[75vh] object-contain rounded-[10px]" />}
      </Modal>
    </div>
  );
}
