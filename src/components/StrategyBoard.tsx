"use client";

/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCollection, useDebouncedSave } from "@/lib/client";
import { clipboardFiles, droppedFiles } from "@/lib/upload-client";
import { relative } from "@/lib/format";
import { thumbUrl } from "@/components/MediaThumb";
import { ProgressBar, uploadMany, type Progress } from "./upload-ui";
import { Card, Empty, ErrorNote, Modal, Spinner, useToast } from "./ui";
import type { AdBoard, AdFolder, BoardArrow, BoardCard, Swipe } from "@/lib/types";

/**
 * Tableau de stratégie créative, façon Miro, dans la section Ads.
 *
 * Plusieurs tableaux nommés (« Stratégie Q4 », « Angles produit X »…), chacun
 * une toile infinie : notes et textes à la taille voulue, captures d'écran
 * collées au Ctrl+V, liens, zones titrées pour regrouper, et des flèches qui
 * relient tout ça. Les hooks déjà extraits par l'IA sur les swipes et les
 * scripts s'ajoutent en un clic. Sauvegarde automatique, plus un bouton
 * « Enregistrer » pour ceux qui aiment voir le geste.
 */

type Mode =
  | { kind: "pan"; sx: number; sy: number; ox: number; oy: number }
  | { kind: "move" | "resize"; id: string; sx: number; sy: number; ox: number; oy: number }
  | null;
type Sel = { kind: "card" | "arrow"; id: string } | null;

const COLORS: { key: string; label: string; bg: string; ink: string }[] = [
  { key: "", label: "Neutre", bg: "", ink: "" },
  { key: "yellow", label: "Jaune", bg: "#fde68a", ink: "#b45309" },
  { key: "green", label: "Vert", bg: "#bbf7d0", ink: "#15803d" },
  { key: "blue", label: "Bleu", bg: "#bfdbfe", ink: "#1d4ed8" },
  { key: "pink", label: "Rose", bg: "#fbcfe8", ink: "#be185d" },
  { key: "orange", label: "Orange", bg: "#fed7aa", ink: "#c2410c" },
  { key: "red", label: "Rouge", bg: "#fecaca", ink: "#b91c1c" },
];
const bgOf = (c: string) => COLORS.find((x) => x.key === c)?.bg || "";
const inkOf = (c: string) => COLORS.find((x) => x.key === c)?.ink || "";

const BACKGROUNDS: { key: string; label: string; bg: string; dot: string; pattern: "dots" | "grid" | "none"; swatch: string }[] = [
  { key: "dots", label: "Points", bg: "var(--surface-2)", dot: "var(--border)", pattern: "dots", swatch: "var(--surface-3)" },
  { key: "grid", label: "Grille", bg: "var(--surface-2)", dot: "var(--border)", pattern: "grid", swatch: "var(--surface-3)" },
  { key: "plain", label: "Uni", bg: "var(--surface-2)", dot: "", pattern: "none", swatch: "var(--surface-2)" },
  { key: "white", label: "Blanc", bg: "#ffffff", dot: "#e5e7eb", pattern: "dots", swatch: "#ffffff" },
  { key: "paper", label: "Papier", bg: "#fdf6e3", dot: "#e7dcc3", pattern: "dots", swatch: "#fdf6e3" },
  { key: "mint", label: "Menthe", bg: "#ecfdf5", dot: "#bbf7d0", pattern: "dots", swatch: "#ecfdf5" },
  { key: "dark", label: "Ardoise", bg: "#0f172a", dot: "#1e293b", pattern: "grid", swatch: "#0f172a" },
];
const backgroundOf = (key: string) => BACKGROUNDS.find((b) => b.key === key) ?? BACKGROUNDS[0];

const MIN_SCALE = 0.2;
const MAX_SCALE = 3;
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const fontOf = (c: BoardCard) => c.fontSize ?? (c.kind === "text" ? 24 : 13);

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
  linking,
  onPointerDown,
  onResizeDown,
  onEdit,
  onText,
  onStopEdit,
}: {
  card: BoardCard;
  selected: boolean;
  editing: boolean;
  linking: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onResizeDown: (e: React.PointerEvent) => void;
  onEdit: () => void;
  onText: (text: string) => void;
  onStopEdit: () => void;
}) {
  const bg = bgOf(card.color);
  const isZone = card.kind === "zone";
  const isText = card.kind === "text";
  const fs = fontOf(card);
  const base: React.CSSProperties = {
    position: "absolute",
    left: card.x,
    top: card.y,
    width: card.w,
    height: card.h,
    zIndex: isZone ? 0 : 2 + card.z,
    borderRadius: 10,
    outline: selected ? "2px solid var(--accent)" : linking ? "2px dashed var(--accent)" : "none",
    outlineOffset: 2,
    cursor: editing ? "text" : linking ? "crosshair" : "grab",
    touchAction: "none",
    userSelect: "none",
  };

  const textColor = isText ? inkOf(card.color) || "var(--text)" : bg ? "#1f2937" : "var(--text)";
  const textarea = (
    <textarea
      autoFocus
      className="w-full h-full resize-none bg-transparent outline-none leading-snug"
      style={{ color: textColor, fontSize: isZone ? 13 : fs, fontWeight: isZone || isText ? 600 : 400 }}
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

  if (isText) {
    return (
      <div
        style={{ ...base, background: selected || editing ? "color-mix(in srgb, var(--accent) 6%, transparent)" : "transparent" }}
        onPointerDown={onPointerDown}
        onDoubleClick={onEdit}
      >
        <div className="w-full h-full p-1.5 leading-tight whitespace-pre-wrap break-words overflow-hidden font-semibold" style={{ color: textColor, fontSize: fs }}>
          {editing ? textarea : card.text || <span style={{ opacity: 0.4 }}>Double-clic pour écrire</span>}
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
        color: textColor,
        boxShadow: "0 2px 10px rgb(0 0 0 / 0.08)",
      }}
      onPointerDown={onPointerDown}
      onDoubleClick={card.kind === "image" ? undefined : onEdit}
    >
      {card.kind === "note" && (
        <div className="flex-1 min-h-0 p-2.5 leading-snug whitespace-pre-wrap break-words overflow-hidden" style={{ fontSize: fs }}>
          {editing ? textarea : card.text || <span style={{ opacity: 0.5 }}>Double-clic pour écrire</span>}
        </div>
      )}
      {card.kind === "link" && (
        <div className="flex-1 min-h-0 p-2.5 flex flex-col gap-1 overflow-hidden">
          {editing ? (
            textarea
          ) : (
            <>
              <span className="font-medium leading-snug break-words" style={{ fontSize: fs }}>{card.text || hostOf(card.url)}</span>
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

/* ------------------------------- Flèches -------------------------------- */

/** Point du bord d'un rectangle dans la direction d'un autre point. */
function edgePoint(c: BoardCard, towards: { x: number; y: number }) {
  const cx = c.x + c.w / 2;
  const cy = c.y + c.h / 2;
  const dx = towards.x - cx;
  const dy = towards.y - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const t = Math.min(c.w / 2 / Math.max(Math.abs(dx), 1e-6), c.h / 2 / Math.max(Math.abs(dy), 1e-6));
  return { x: cx + dx * t, y: cy + dy * t };
}

function ArrowLayer({
  arrows,
  cards,
  selectedId,
  onSelect,
  onLabel,
}: {
  arrows: BoardArrow[];
  cards: BoardCard[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onLabel: (id: string) => void;
}) {
  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  return (
    <svg
      style={{ position: "absolute", left: 0, top: 0, width: 1, height: 1, overflow: "visible", zIndex: 1, pointerEvents: "none" }}
    >
      {arrows.map((a) => {
        const from = byId.get(a.from);
        const to = byId.get(a.to);
        if (!from || !to) return null;
        const p1 = edgePoint(from, { x: to.x + to.w / 2, y: to.y + to.h / 2 });
        const p2 = edgePoint(to, { x: from.x + from.w / 2, y: from.y + from.h / 2 });
        const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x);
        const head = 11;
        const hx = p2.x - Math.cos(ang) * head;
        const hy = p2.y - Math.sin(ang) * head;
        const left = { x: hx - Math.sin(ang) * (head * 0.55), y: hy + Math.cos(ang) * (head * 0.55) };
        const right = { x: hx + Math.sin(ang) * (head * 0.55), y: hy - Math.cos(ang) * (head * 0.55) };
        const color = inkOf(a.color) || "var(--text-2)";
        const sel = a.id === selectedId;
        const mx = (p1.x + p2.x) / 2;
        const my = (p1.y + p2.y) / 2;
        return (
          <g key={a.id} style={{ pointerEvents: "none" }}>
            {/* Zone de clic large, invisible : la ligne fine serait impossible à viser. */}
            <line
              x1={p1.x} y1={p1.y} x2={hx} y2={hy}
              stroke="transparent" strokeWidth={16}
              style={{ pointerEvents: "stroke", cursor: "pointer" }}
              onPointerDown={(e) => { e.stopPropagation(); onSelect(a.id); }}
              onDoubleClick={(e) => { e.stopPropagation(); onLabel(a.id); }}
            />
            <line x1={p1.x} y1={p1.y} x2={hx} y2={hy} style={{ stroke: color }} strokeWidth={sel ? 3.5 : 2.2} strokeLinecap="round" />
            <polygon points={`${p2.x},${p2.y} ${left.x},${left.y} ${right.x},${right.y}`} style={{ fill: color }} />
            {sel && <circle cx={p1.x} cy={p1.y} r={4} style={{ fill: "var(--accent)" }} />}
            {a.label && (
              <g transform={`translate(${mx}, ${my})`} style={{ pointerEvents: "stroke", cursor: "pointer" }} onPointerDown={(e) => { e.stopPropagation(); onSelect(a.id); }} onDoubleClick={(e) => { e.stopPropagation(); onLabel(a.id); }}>
                <rect x={-(a.label.length * 3.4 + 8)} y={-10} width={a.label.length * 6.8 + 16} height={20} rx={6} style={{ fill: "var(--surface)", stroke: color }} strokeWidth={1} />
                <text textAnchor="middle" dominantBaseline="middle" fontSize={11.5} fontWeight={600} style={{ fill: color }}>{a.label}</text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
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
          Les hooks extraits par l&apos;IA sur tes swipes{folder ? `, et ceux des scripts du dossier « ${folder.title} »` : " (relie un dossier Ads au tableau pour voir aussi les hooks de ses scripts)"}. Coche ceux à poser
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

interface Snapshot { cards: BoardCard[]; arrows: BoardArrow[]; background: string }

export function StrategyBoard({ folders }: { folders: AdFolder[] }) {
  const { rows, loading, error, create, patch, destroy } = useCollection<AdBoard>("adBoards");
  const { rows: swipes } = useCollection<Swipe>("swipes");
  const toast = useToast();

  /* Quel tableau. Le plus récent par défaut ; un premier est créé s'il n'y en a aucun. */
  const boards = useMemo(() => [...rows].sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt)), [rows]);
  const [boardId, setBoardId] = useState<string | null>(null);
  const board = boards.find((b) => b.id === boardId) ?? boards[0] ?? null;
  const folder = folders.find((f) => f.id === board?.folderId) ?? null;
  const creatingRef = useRef(false);
  useEffect(() => {
    if (loading || board || creatingRef.current) return;
    creatingRef.current = true;
    void create({ folderId: "", title: "Stratégie globale", cards: [], arrows: [], background: "dots", updatedAt: new Date().toISOString() })
      .catch((e) => toast((e as Error).message, "err"))
      .finally(() => {
        creatingRef.current = false;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, board]);

  /* Copie locale pour un déplacement fluide ; sauvegarde différée. */
  const [snap, setSnap] = useState<Snapshot>({ cards: [], arrows: [], background: "dots" });
  const snapRef = useRef(snap);
  snapRef.current = snap;
  const boardIdRef = useRef<string | null>(null);
  const [selected, setSelected] = useState<Sel>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [linking, setLinking] = useState<{ from: string | null } | null>(null);
  useEffect(() => {
    if (!board) return;
    if (boardIdRef.current !== board.id) {
      boardIdRef.current = board.id;
      setSnap({ cards: board.cards ?? [], arrows: board.arrows ?? [], background: board.background || "dots" });
      setSelected(null);
      setEditing(null);
      setLinking(null);
    }
  }, [board]);

  const [saving, setSaving] = useState<"idle" | "pending" | "saving" | "saved">("idle");
  const persist = useCallback(
    async (s: Snapshot) => {
      if (!boardIdRef.current) return;
      setSaving("saving");
      try {
        await patch(boardIdRef.current, { cards: s.cards, arrows: s.arrows, background: s.background, updatedAt: new Date().toISOString() });
        setSaving("saved");
      } catch (e) {
        setSaving("idle");
        toast(`Sauvegarde impossible : ${(e as Error).message}`, "err");
      }
    },
    [patch, toast],
  );
  const save = useDebouncedSave<Snapshot>(persist, 800);
  const update = useCallback(
    (fn: (prev: Snapshot) => Snapshot) => {
      setSnap((prev) => {
        const next = fn(prev);
        setSaving("pending");
        save(next);
        return next;
      });
    },
    [save],
  );
  const updateCards = (fn: (prev: BoardCard[]) => BoardCard[]) => update((s) => ({ ...s, cards: fn(s.cards) }));
  const updateArrows = (fn: (prev: BoardArrow[]) => BoardArrow[]) => update((s) => ({ ...s, arrows: fn(s.arrows) }));
  const { cards, arrows } = snap;

  /* Vue : décalage et zoom. */
  const [view, setView] = useState({ x: 60, y: 40, s: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const canvasRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef<Mode>(null);
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
    // Mode flèche : premier clic = départ, second = arrivée.
    if (linking) {
      if (!linking.from) {
        setLinking({ from: c.id });
        setSelected({ kind: "card", id: c.id });
      } else if (linking.from !== c.id) {
        const from = linking.from;
        if (!arrows.some((a) => a.from === from && a.to === c.id)) {
          const arrow: BoardArrow = { id: uid(), from, to: c.id, color: "", label: "" };
          updateArrows((prev) => [...prev, arrow]);
          setSelected({ kind: "arrow", id: arrow.id });
        }
        setLinking(null);
      }
      return;
    }
    if (editing && editing !== c.id) setEditing(null);
    setSelected({ kind: "card", id: c.id });
    if (c.kind !== "zone") {
      const top = Math.max(0, ...cards.map((x) => x.z));
      if (c.z < top) updateCards((prev) => prev.map((x) => (x.id === c.id ? { ...x, z: top + 1 } : x)));
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
    setSnap((prev) => ({
      ...prev,
      cards: prev.cards.map((c) => {
        if (c.id !== m.id) return c;
        if (m.kind === "move") return { ...c, x: Math.round(m.ox + dx / s), y: Math.round(m.oy + dy / s) };
        return { ...c, w: Math.max(60, Math.round(m.ox + dx / s)), h: Math.max(30, Math.round(m.oy + dy / s)) };
      }),
    }));
  };
  const onUp = () => {
    const m = modeRef.current;
    modeRef.current = null;
    if (m && m.kind !== "pan") {
      setSaving("pending");
      save(snapRef.current);
    }
  };

  /* Ajouts. */
  const add = (partial: Partial<BoardCard> & Pick<BoardCard, "kind">, at?: { x: number; y: number }) => {
    const p = at ?? center();
    const size =
      partial.kind === "zone" ? { w: 420, h: 300 }
        : partial.kind === "image" ? { w: 260, h: 220 }
          : partial.kind === "link" ? { w: 220, h: 90 }
            : partial.kind === "text" ? { w: 320, h: 60 }
              : { w: 200, h: 110 };
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
    updateCards((prev) => [...prev, card]);
    setSelected({ kind: "card", id: card.id });
    return card;
  };

  const addNote = () => setEditing(add({ kind: "note" }).id);
  const addText = () => setEditing(add({ kind: "text", fontSize: 24 }).id);
  const addZone = () => setEditing(add({ kind: "zone" }).id);
  const addLink = () => {
    const url = window.prompt("Adresse du lien (pub, page, vidéo…)");
    if (!url?.trim()) return;
    const clean = /^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
    setEditing(add({ kind: "link", url: clean }).id);
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
    updateCards((prev) => [...prev, ...fresh]);
    toast(`${fresh.length} hook${fresh.length > 1 ? "s" : ""} posé${fresh.length > 1 ? "s" : ""} sur le tableau.`);
  };

  const addImages = async (files: File[], at?: { x: number; y: number }) => {
    const imgs = files.filter((f) => f.type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(f.name));
    if (!imgs.length) return toast("Seules les images sont acceptées sur le tableau.", "err");
    try {
      const ups = await uploadMany(imgs, setProgress);
      const base = at ?? center();
      ups.forEach((u, i) => add({ kind: "image", url: u.url }, { x: base.x + i * 30, y: base.y + i * 30 }));
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

  /* Clavier : Suppr retire la sélection, Échap annule / désélectionne. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editing) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "Escape") {
        if (linking) setLinking(null);
        else setSelected(null);
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        e.preventDefault();
        removeSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, selected, cards, arrows, linking]);

  const removeSelected = () => {
    if (!selected) return;
    if (selected.kind === "arrow") {
      updateArrows((prev) => prev.filter((a) => a.id !== selected.id));
      setSelected(null);
      return;
    }
    const c = cards.find((x) => x.id === selected.id);
    if (!c) return;
    if ((c.kind === "image" || c.kind === "zone") && !window.confirm(c.kind === "image" ? "Retirer cette capture du tableau ?" : "Retirer cette zone ? Les cartes qu'elle contient restent.")) return;
    // Les flèches qui partaient de la carte ou y arrivaient partent avec elle.
    update((s) => ({ ...s, cards: s.cards.filter((x) => x.id !== c.id), arrows: s.arrows.filter((a) => a.from !== c.id && a.to !== c.id) }));
    setSelected(null);
  };
  const recolor = (color: string) => {
    if (!selected) return;
    if (selected.kind === "arrow") updateArrows((prev) => prev.map((a) => (a.id === selected.id ? { ...a, color } : a)));
    else updateCards((prev) => prev.map((x) => (x.id === selected.id ? { ...x, color } : x)));
  };
  const resize = (delta: number) => {
    if (!selected || selected.kind !== "card") return;
    updateCards((prev) => prev.map((x) => (x.id === selected.id ? { ...x, fontSize: clamp(fontOf(x) + delta, 10, 96) } : x)));
  };
  const labelArrow = (id: string) => {
    const a = arrows.find((x) => x.id === id);
    const text = window.prompt("Texte sur la flèche (vide pour retirer)", a?.label ?? "");
    if (text === null) return;
    updateArrows((prev) => prev.map((x) => (x.id === id ? { ...x, label: text.trim().slice(0, 40) } : x)));
  };
  const startLinking = () => {
    if (linking) return setLinking(null);
    setEditing(null);
    setLinking({ from: selected?.kind === "card" ? selected.id : null });
  };

  /* Tableaux : créer, renommer, relier à un dossier, supprimer, enregistrer. */
  const newBoard = async () => {
    const title = window.prompt("Titre du nouveau tableau", "");
    if (title === null) return;
    try {
      const b = await create({ folderId: "", title: title.trim() || "Sans titre", cards: [], arrows: [], background: snap.background || "dots", updatedAt: new Date().toISOString() });
      setBoardId(b.id);
      toast(`Tableau « ${b.title} » créé.`);
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  const renameBoard = async () => {
    if (!board) return;
    const title = window.prompt("Titre du tableau", board.title);
    if (title === null || !title.trim()) return;
    await patch(board.id, { title: title.trim(), updatedAt: new Date().toISOString() }).catch((e) => toast((e as Error).message, "err"));
  };
  const linkFolder = async (folderId: string) => {
    if (!board) return;
    await patch(board.id, { folderId }).catch((e) => toast((e as Error).message, "err"));
  };
  const deleteBoard = async () => {
    if (!board) return;
    if (!window.confirm(`Supprimer le tableau « ${board.title} » et tout ce qu'il contient ?`)) return;
    try {
      await destroy(board.id);
      boardIdRef.current = null;
      setBoardId(null);
      toast("Tableau supprimé.");
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  const saveNow = () => void persist(snapRef.current);

  const selCard = selected?.kind === "card" ? cards.find((c) => c.id === selected.id) ?? null : null;
  const selArrow = selected?.kind === "arrow" ? arrows.find((a) => a.id === selected.id) ?? null : null;
  const selColor = selCard?.color ?? selArrow?.color ?? "";
  const bgDef = backgroundOf(snap.background);
  const bgImage =
    bgDef.pattern === "dots"
      ? `radial-gradient(${bgDef.dot} 1px, transparent 1px)`
      : bgDef.pattern === "grid"
        ? `linear-gradient(${bgDef.dot} 1px, transparent 1px), linear-gradient(90deg, ${bgDef.dot} 1px, transparent 1px)`
        : "none";

  if (loading && !rows.length) return <Card><Spinner label="Chargement des tableaux…" /></Card>;
  if (error) return <ErrorNote>{error}</ErrorNote>;

  return (
    <div className="flex flex-col gap-2">
      {/* Ligne 1 : quel tableau, son titre, son dossier, son fond, l'enregistrement */}
      <div className="flex flex-wrap items-center gap-2">
        <select className="select !w-auto !h-[30px] !text-[12.5px] font-semibold" value={board?.id ?? ""} onChange={(e) => setBoardId(e.target.value)} title="Choisir un tableau">
          {boards.map((b) => (
            <option key={b.id} value={b.id}>🧭 {b.title}</option>
          ))}
        </select>
        <button className="btn btn-sm" onClick={() => void newBoard()} title="Créer un nouveau tableau">+ Nouveau tableau</button>
        <button className="btn btn-sm" onClick={() => void renameBoard()} title="Renommer ce tableau">✎ Titre</button>
        <select className="select !w-auto !h-[30px] !text-[12px]" value={board?.folderId ?? ""} onChange={(e) => void linkFolder(e.target.value)} title="Dossier Ads lié : ses hooks de scripts deviennent importables">
          <option value="">Aucun dossier lié</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>📁 {f.title}</option>
          ))}
        </select>
        <span className="flex items-center gap-1 ml-1" title="Fond du tableau">
          <span className="dim text-[11.5px] mr-0.5">Fond</span>
          {BACKGROUNDS.map((b) => (
            <button
              key={b.key}
              onClick={() => update((s) => ({ ...s, background: b.key }))}
              className="rounded-full"
              style={{ width: 18, height: 18, background: b.swatch, border: snap.background === b.key ? "2px solid var(--accent)" : "1px solid var(--border)" }}
              title={b.label}
            />
          ))}
        </span>
        <span className="ml-auto flex items-center gap-2">
          <span className="dim text-[11.5px]">
            {saving === "saving" ? "Enregistrement…" : saving === "pending" ? "Modifications en attente…" : saving === "saved" ? "✓ Enregistré" : board?.updatedAt ? `Enregistré ${relative(board.updatedAt)}` : ""}
          </span>
          <button className="btn btn-sm btn-primary" onClick={saveNow} disabled={saving === "saving"} title="Enregistrer maintenant (la sauvegarde est aussi automatique)">💾 Enregistrer</button>
          <button className="btn btn-sm btn-danger" onClick={() => void deleteBoard()} title="Supprimer ce tableau">🗑</button>
        </span>
      </div>

      {/* Ligne 2 : ajouter, relier, et les réglages de la sélection */}
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-sm" onClick={addNote} title="Une note : hook, angle, promesse…">+ Note</button>
        <button className="btn btn-sm" onClick={addText} title="Du texte libre, sans fond, en grand">+ Texte</button>
        <button className="btn btn-sm" onClick={addZone} title="Un cadre titré pour regrouper">+ Zone</button>
        <button className="btn btn-sm" onClick={addLink} title="Un lien vers une pub ou une page">+ Lien</button>
        <label className="btn btn-sm cursor-pointer" title="Une capture d'écran (ou colle-la avec Ctrl+V)">
          + Capture
          <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; void addImages(f); }} />
        </label>
        <button className={`btn btn-sm ${linking ? "btn-primary" : ""}`} onClick={startLinking} title="Relier deux éléments par une flèche : clique le départ, puis l'arrivée">
          → Flèche
        </button>
        <button className="btn btn-sm" onClick={() => setPicker(true)} title="Poser les hooks déjà analysés sur tes swipes et scripts">✦ Hooks des swipes</button>

        {(selCard || selArrow) && (
          <>
            <span className="w-px h-5" style={{ background: "var(--border)" }} />
            <span className="flex items-center gap-1" title="Couleur">
              {COLORS.map((c) => (
                <button
                  key={c.key}
                  onClick={() => recolor(c.key)}
                  className="rounded-full"
                  style={{ width: 18, height: 18, background: c.bg || "var(--surface-3)", border: selColor === c.key ? "2px solid var(--accent)" : "1px solid var(--border)" }}
                  title={c.label}
                />
              ))}
            </span>
            {selCard && (selCard.kind === "note" || selCard.kind === "text" || selCard.kind === "link") && (
              <span className="flex items-center gap-0.5" title="Taille du texte">
                <button className="btn btn-sm !px-2" onClick={() => resize(-2)}>A−</button>
                <span className="dim text-[11px] num w-[28px] text-center">{fontOf(selCard)}</span>
                <button className="btn btn-sm !px-2" onClick={() => resize(2)}>A+</button>
              </span>
            )}
            {selCard?.kind === "image" && <button className="btn btn-sm" onClick={() => setPreview(selCard)}>Voir en grand</button>}
            {selCard?.kind === "link" && <a className="btn btn-sm" href={selCard.url} target="_blank" rel="noreferrer">Ouvrir ↗</a>}
            {selArrow && <button className="btn btn-sm" onClick={() => labelArrow(selArrow.id)}>✎ Texte de la flèche</button>}
            <button className="btn btn-sm btn-danger" onClick={removeSelected}>Retirer</button>
          </>
        )}

        <span className="ml-auto flex items-center gap-1">
          <span className="dim text-[11.5px] mr-1">{cards.length} carte{cards.length > 1 ? "s" : ""}{arrows.length ? ` · ${arrows.length} flèche${arrows.length > 1 ? "s" : ""}` : ""}</span>
          <button className="btn btn-sm" onClick={() => zoomBy(1 / 1.2)} title="Zoom arrière">−</button>
          <button className="btn btn-sm num" onClick={() => setView({ x: 60, y: 40, s: 1 })} title="Revenir à la vue de départ">{Math.round(view.s * 100)} %</button>
          <button className="btn btn-sm" onClick={() => zoomBy(1.2)} title="Zoom avant">+</button>
        </span>
      </div>

      {linking && (
        <div className="text-[12.5px] rounded-[8px] px-3 py-1.5" style={{ background: "color-mix(in srgb, var(--accent) 12%, transparent)", color: "var(--accent)" }}>
          {linking.from ? "Clique maintenant l'élément d'arrivée de la flèche." : "Clique l'élément de départ de la flèche."} Échap pour annuler.
        </div>
      )}

      {progress && <ProgressBar p={progress} />}

      {/* Toile */}
      <div
        ref={canvasRef}
        className="relative overflow-hidden rounded-[12px] select-none"
        style={{
          height: "max(520px, calc(100vh - 290px))",
          border: "1px solid var(--border)",
          background: bgDef.bg,
          backgroundImage: bgImage,
          backgroundSize: `${24 * view.s}px ${24 * view.s}px`,
          backgroundPosition: `${view.x}px ${view.y}px`,
          cursor: linking ? "crosshair" : modeRef.current?.kind === "pan" ? "grabbing" : "default",
          touchAction: "none",
          colorScheme: bgDef.key === "dark" ? "dark" : undefined,
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
          <ArrowLayer
            arrows={arrows}
            cards={cards}
            selectedId={selArrow?.id ?? null}
            onSelect={(id) => {
              setEditing(null);
              setSelected({ kind: "arrow", id });
            }}
            onLabel={labelArrow}
          />
          {cards.map((c) => (
            <CardView
              key={c.id}
              card={c}
              selected={selCard?.id === c.id}
              editing={editing === c.id}
              linking={Boolean(linking) && linking?.from !== c.id}
              onPointerDown={onCardDown(c)}
              onResizeDown={onResizeDown(c)}
              onEdit={() => {
                if (linking) return;
                setSelected({ kind: "card", id: c.id });
                setEditing(c.id);
              }}
              onText={(text) => updateCards((prev) => prev.map((x) => (x.id === c.id ? { ...x, text } : x)))}
              onStopEdit={() => setEditing(null)}
            />
          ))}
        </div>

        {!cards.length && (
          <div className="absolute inset-0 grid place-items-center pointer-events-none">
            <div className="text-center max-w-[460px] px-4" style={{ color: bgDef.key === "dark" ? "#cbd5e1" : bgDef.key === "white" || bgDef.key === "paper" || bgDef.key === "mint" ? "#475569" : "var(--text-2)" }}>
              <p className="text-[15px] font-semibold mb-1">Ton tableau est vide</p>
              <p className="text-[12.5px] leading-relaxed">
                Pose des <strong>notes</strong> et du <strong>texte</strong> pour tes hooks et tes angles, <strong>colle des captures</strong> avec Ctrl+V, ajoute des <strong>liens</strong>, range tout dans des <strong>zones</strong> et relie les éléments avec des <strong>flèches</strong>.
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
