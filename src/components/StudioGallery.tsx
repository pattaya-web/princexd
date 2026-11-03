"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Toggle } from "@/components/ui";

/**
 * Galerie du Studio IA (2026-11-03) : toutes les créations sur une seule page,
 * chargées au fil du défilement, en mosaïque qui respecte le format réel de
 * chaque rendu (9:16 haut, 16:9 large…) ou en grille carrée. Menu
 * « Affichage » : disposition, séparation par jour, taille des cartes,
 * mémorisés sur l'appareil.
 */

export interface GalleryView {
  layout: "masonry" | "square";
  byDay: boolean;
  /** Index dans SIZES. */
  size: number;
}

export const DEFAULT_GALLERY_VIEW: GalleryView = { layout: "masonry", byDay: false, size: 1 };

/* Largeur visée d'une colonne, en px, pour chaque cran du curseur. */
const SIZES = [140, 190, 250, 330];
const GAP = 8;
const PAGE = 40;
/* Format d'une tuile tant qu'on ne connaît rien du rendu. */
const FALLBACK_RATIO = 4 / 5;

export interface GalleryItem {
  key: string;
  at: string;
  /** Largeur / hauteur annoncée par les réglages (null : inconnue, « auto »). */
  ratio: number | null;
  /** Rendu affiché (sinon : en cours ou en échec, la tuile garde de quoi lire son texte). */
  settled: boolean;
}

export interface TileProps {
  aspect: string;
  onRatio: (ratio: number) => void;
}

/** « 3:4 », « portrait_16_9 », « square_hd », « portrait »… en largeur / hauteur. */
export function parseRatio(v: unknown): number | null {
  if (typeof v !== "string" || !v) return null;
  const s = v.toLowerCase();
  if (s === "square" || s === "square_hd") return 1;
  if (s === "portrait") return 9 / 16;
  if (s === "landscape") return 16 / 9;
  const m = s.match(/(\d+(?:\.\d+)?)\s*[:_x/]\s*(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (!a || !b) return null;
  // « portrait_16_9 » : le grand nombre est la hauteur.
  if (s.startsWith("portrait")) return Math.min(a, b) / Math.max(a, b);
  if (s.startsWith("landscape")) return Math.max(a, b) / Math.min(a, b);
  return a / b;
}

/* Formats mesurés sur les vignettes, gardés d'une visite à l'autre : la mosaïque ne saute plus au chargement. */
const CACHE_KEY = "studio-gallery-ratios";
const CACHE_MAX = 600;

function readCache(): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function writeCache(map: Record<string, number>) {
  try {
    const keys = Object.keys(map);
    const kept = keys.length > CACHE_MAX ? Object.fromEntries(keys.slice(-CACHE_MAX).map((k) => [k, map[k]])) : map;
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(kept));
  } catch {
    /* stockage plein ou bloqué : la mosaïque se recalcule au chargement */
  }
}

function parisDay(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-CA", { timeZone: "Europe/Paris" });
}

function dayLabel(day: string): string {
  const today = parisDay(new Date().toISOString());
  const yesterday = parisDay(new Date(Date.now() - 86_400_000).toISOString());
  if (day === today) return "Aujourd'hui";
  if (day === yesterday) return "Hier";
  const d = new Date(`${day}T12:00:00`);
  const sameYear = day.slice(0, 4) === today.slice(0, 4);
  return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", ...(sameYear ? {} : { year: "numeric" }) });
}

export function StudioGallery<T extends GalleryItem>({
  items,
  view,
  resetKey,
  render,
}: {
  items: T[];
  view: GalleryView;
  /** Change quand le filtre change : on repart des premières créations. */
  resetKey: string;
  render: (item: T, tile: TileProps) => ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [shown, setShown] = useState(PAGE);
  const [measured, setMeasured] = useState<Record<string, number>>({});

  useEffect(() => setMeasured(readCache()), []);
  useEffect(() => setShown(PAGE), [resetKey]);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* Chargement continu : la suite arrive avant d'atteindre le bas. */
  const sentinel = useRef<HTMLDivElement>(null);
  const more = items.length > shown;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !more) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setShown((n) => n + PAGE);
    }, { rootMargin: "1200px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [more, shown]);

  const onRatio = useCallback((key: string, r: number) => {
    if (!Number.isFinite(r) || r <= 0) return;
    setMeasured((prev) => {
      if (prev[key] && Math.abs(prev[key] - r) < 0.01) return prev;
      const next = { ...prev, [key]: Math.round(r * 1000) / 1000 };
      writeCache(next);
      return next;
    });
  }, []);

  const ratioOf = useCallback(
    (it: T) => {
      const r = measured[it.key] ?? it.ratio ?? FALLBACK_RATIO;
      // En cours / en échec : pas plus large que haut, le texte doit tenir.
      return it.settled ? r : Math.min(r, 1);
    },
    [measured],
  );

  const target = SIZES[Math.max(0, Math.min(SIZES.length - 1, view.size))];
  const cols = width ? Math.max(2, Math.floor((width + GAP) / (target + GAP))) : 0;

  const groups = useMemo(() => {
    const list = items.slice(0, shown);
    if (!view.byDay) return [{ day: "", items: list }];
    const out: { day: string; items: T[] }[] = [];
    for (const it of list) {
      const d = parisDay(it.at);
      const last = out[out.length - 1];
      if (last && last.day === d) last.items.push(it);
      else out.push({ day: d, items: [it] });
    }
    return out;
  }, [items, shown, view.byDay]);

  const tile = (it: T, aspect: string) => render(it, { aspect, onRatio: (r) => onRatio(it.key, r) });

  const block = (list: T[]) => {
    if (!cols) return null;
    if (view.layout === "square") {
      return (
        <div className="grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: GAP }}>
          {list.map((it) => (
            <div key={it.key}>{tile(it, "1 / 1")}</div>
          ))}
        </div>
      );
    }
    /*
     * Mosaïque : chaque création va dans la colonne la moins haute, dans
     * l'ordre (les plus récentes restent en haut, de gauche à droite).
     */
    const colW = (width - GAP * (cols - 1)) / cols;
    const heights = new Array<number>(cols).fill(0);
    const columns: { it: T; r: number }[][] = Array.from({ length: cols }, () => []);
    for (const it of list) {
      const r = ratioOf(it);
      let c = 0;
      for (let i = 1; i < cols; i++) if (heights[i] < heights[c] - 1) c = i;
      columns[c].push({ it, r });
      heights[c] += colW / r + GAP;
    }
    return (
      <div className="flex items-start" style={{ gap: GAP }}>
        {columns.map((col, i) => (
          <div key={i} className="flex flex-col min-w-0" style={{ gap: GAP, flex: "1 1 0" }}>
            {col.map(({ it, r }) => (
              <div key={it.key}>{tile(it, `${r}`)}</div>
            ))}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div ref={wrapRef} className="flex flex-col gap-4">
      {groups.map((g) => (
        <section key={g.day || "all"} className="flex flex-col gap-2">
          {g.day && (
            <h3 className="text-[13px] font-semibold first-letter:uppercase" style={{ letterSpacing: "-0.01em" }}>
              {dayLabel(g.day)} <span className="dim font-normal">· {g.items.length}</span>
            </h3>
          )}
          {block(g.items)}
        </section>
      ))}
      {more && (
        <div ref={sentinel} className="flex justify-center py-2">
          <button type="button" className="btn btn-sm" onClick={() => setShown((n) => n + PAGE)}>
            Afficher plus ({items.length - shown} restantes)
          </button>
        </div>
      )}
    </div>
  );
}

/** Menu « Affichage » : disposition, séparation par jour, taille des cartes. */
export function GalleryViewMenu({ view, onChange }: { view: GalleryView; onChange: (v: GalleryView) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const layouts: { key: GalleryView["layout"]; label: string; icon: string }[] = [
    { key: "square", label: "Carré", icon: "▦" },
    { key: "masonry", label: "Mosaïque", icon: "▥" },
  ];

  return (
    <div className="relative" ref={ref}>
      <button type="button" className="btn btn-sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        ▦ Affichage
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1.5 w-[230px] rounded-[12px] p-2.5 flex flex-col gap-1 z-30"
          style={{ background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "var(--shadow-lg)" }}
        >
          <div className="label-xs px-1.5 pt-0.5 pb-1">Disposition</div>
          {layouts.map((l) => (
            <button
              key={l.key}
              type="button"
              className="flex items-center gap-2.5 px-1.5 h-[32px] rounded-[8px] text-[13px] text-left hover:bg-[var(--surface-2)]"
              onClick={() => onChange({ ...view, layout: l.key })}
            >
              <span className="w-4 text-center muted">{l.icon}</span>
              <span className="flex-1">{l.label}</span>
              {view.layout === l.key && <span style={{ color: "var(--accent)" }}>✓</span>}
            </button>
          ))}
          <div className="flex items-center justify-between px-1.5 h-[36px] mt-0.5 border-t" style={{ borderColor: "var(--border)" }}>
            <span className="text-[13px]">Séparer par jour</span>
            <Toggle checked={view.byDay} onChange={(byDay) => onChange({ ...view, byDay })} />
          </div>
          <div className="label-xs px-1.5 pt-1.5">Taille des cartes</div>
          <div className="px-1.5 pb-1">
            <input
              type="range"
              min={0}
              max={SIZES.length - 1}
              step={1}
              value={view.size}
              onChange={(e) => onChange({ ...view, size: Number(e.target.value) })}
              className="w-full"
              style={{ accentColor: "var(--accent)" }}
              aria-label="Taille des cartes"
            />
            <div className="flex justify-between dim text-[10.5px] -mt-0.5">
              <span>Petites</span>
              <span>Grandes</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
