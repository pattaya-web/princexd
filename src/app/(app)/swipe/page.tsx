"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CreatorPlayer, DownloadButton } from "@/components/CreatorPlayer";
import { CopyLinkButton } from "@/components/CopyLinkButton";
import { isLocalMedia, ThumbImg } from "@/components/MediaThumb";
import { api, useCollection } from "@/lib/client";
import { Card, Empty, ErrorNote, Modal, PageHeader, Spinner, Tabs, useToast } from "@/components/ui";
import { relative } from "@/lib/format";
import { swipeProdStatus, swipeStage, type Swipe, type SwipeAnalysis, type SwipeNeed, type SwipeProdStatus, type SwipeStage } from "@/lib/types";
import { PromptsInline } from "@/components/SwipeProduction";
import { MechanicsPanel, NeedSelect, ShotsPanel, STAGE_COLOR, STAGE_HINT, STAGE_TITLE, StageBadge, StateBadge, swipeState, type SwipeState } from "@/components/swipe/panels";
import { SourcePanel } from "@/components/swipe/SourcePanel";
import { ScriptStudio } from "@/components/swipe/ScriptStudio";
import { ProductionPanel } from "@/components/swipe/ProductionPanel";

/*
 * Swipe file (refonte 2026-10-22) : la bibliothèque de Reels à reproduire.
 *
 * En haut, un seul champ : coller un lien, « Analyser ce Reel ». Le tool
 * récupère la référence, tente la transcription, classe le Reel (TOFU / MOFU
 * / BOFU) et le range dans sa section. Si la transcription automatique est
 * impossible, la fiche le dit et propose l'import d'un fichier ou le collage
 * du texte : jamais de légende prise pour une transcription.
 * En dessous : trois sections repliables, des cartes compactes, et la fiche
 * complète quand on en ouvre une (Source, Analyse, Mon script, Plans,
 * Prompts IA, Production).
 */

type Panel = "source" | "analyse" | "script" | "plans" | "prompts" | "production";
type Filter = "todo" | "all" | "fresh" | "script" | "prod" | "published";

/** Par défaut, seulement ce qui reste à faire : un Reel coché « Tourné » disparaît de la vue. */
const FILTERS: { key: Filter; label: string }[] = [
  { key: "todo", label: "À faire" },
  { key: "fresh", label: "Non exploités" },
  { key: "script", label: "Script prêt" },
  { key: "prod", label: "En production" },
  { key: "published", label: "Publiés" },
  { key: "all", label: "Tout" },
];

const IN_PROD: SwipeProdStatus[] = ["a-tourner", "tourne", "monte", "validation", "programme"];

const matchesFilter = (s: Swipe, f: Filter) => {
  const prod = swipeProdStatus(s);
  if (f === "all") return true;
  if (f === "todo") return prod === "source" || prod === "scripte" || prod === "a-tourner";
  if (f === "fresh") return prod === "source";
  if (f === "script") return prod === "scripte";
  if (f === "prod") return IN_PROD.includes(prod);
  return prod === "publie";
};

/** Même lien avec ou sans paramètres / slash final. */
const canon = (u: string) => u.trim().replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();

/** Accent bleu #006DBC sur tout le Swipe file, sans toucher au reste du tool. */
const BLUE: React.CSSProperties & Record<string, string> = {
  "--accent": "#006DBC",
  "--accent-hover": "#005a9c",
  "--accent-soft": "#e6f1fa",
  "--accent-ring": "#9cc8ea",
  "--grad-accent": "linear-gradient(135deg, #006DBC 0%, #2a8ad6 100%)",
};

export default function SwipePage() {
  const { rows, loading, create, patch, destroy, setRows } = useCollection<Swipe>("swipes");
  const toast = useToast();

  const [url, setUrl] = useState("");
  const [addPhase, setAddPhase] = useState("");
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>("source");
  const [filter, setFilter] = useState<Filter>("todo");
  const [working, setWorking] = useState<Record<string, string>>({});
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({ TOFU: true, MOFU: true, BOFU: true, check: true });
  const [playing, setPlaying] = useState<Swipe | null>(null);

  const selected = rows.find((s) => s.id === selectedId) ?? null;
  const setWork = (id: string, phase: string) => setWorking((w) => ({ ...w, [id]: phase }));

  // Arrivée avec ?s=ID (assistant, liens internes) : on ouvre la fiche.
  useEffect(() => {
    try {
      const wanted = new URLSearchParams(window.location.search).get("s");
      if (wanted && rows.some((r) => r.id === wanted)) setSelectedId((cur) => cur ?? wanted);
    } catch {
      // ignoré
    }
  }, [rows]);

  const open = (s: Swipe, p: Panel = "source") => {
    setSelectedId(s.id);
    setPanel(s.script?.hook ? (p === "source" ? "script" : p) : s.analysis ? (p === "source" ? "analyse" : p) : "source");
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const analyzeSwipe = useCallback(
    async (id: string) => {
      setWork(id, "Analyse…");
      try {
        const res = await api<{ analysis: SwipeAnalysis }>("/api/ai/analyze", { job: true, method: "POST", body: JSON.stringify({ swipeId: id }), timeoutMs: 300_000 });
        setRows((prev) => prev.map((s) => (s.id === id ? { ...s, analysis: res.analysis, status: "analyse", transcriptNeeded: false } : s)));
        const st = res.analysis.etape;
        const conf = res.analysis.confiance ?? 0;
        toast(st && conf >= 70 ? `Classé ${st} (${conf} %).` : "Classification à vérifier : choisis la catégorie à la main.");
        window.dispatchEvent(new Event("swipes:changed"));
        return true;
      } catch (e) {
        toast((e as Error).message, "err");
        return false;
      } finally {
        setWork(id, "");
      }
    },
    [setRows, toast],
  );

  /** Coller un lien → référence → transcription → classement. Chaque étape dit où elle en est. */
  const addSwipe = async () => {
    const raw = url.trim();
    if (!raw) return;
    if (!/^https?:\/\//i.test(raw)) {
      setError("Colle un lien complet (https://…).");
      return;
    }
    const dup = rows.find((s) => canon(s.url) === canon(raw));
    if (dup) {
      setUrl("");
      open(dup);
      toast("Ce Reel est déjà dans ta swipe file : fiche ouverte.");
      return;
    }
    setError("");
    setAddPhase("Récupération de la référence…");
    let row: Swipe | null = null;
    try {
      const meta = await api<{ platform: string; author: string; title: string; caption: string; thumbnail: string; warning: string }>("/api/swipe/extract", { method: "POST", body: JSON.stringify({ url: raw }) });
      row = await create({
        url: raw,
        platform: meta.platform,
        author: meta.author,
        title: meta.title,
        caption: meta.caption,
        thumbnail: meta.thumbnail,
        transcriptInput: "",
        screenTextInput: "",
        tags: "",
        analysis: null,
        status: "a-analyser",
        etapeManuelle: "",
        transcriptSource: "",
        transcriptNeeded: false,
      });
      setUrl("");
      setSelectedId(row.id);
      setPanel("source");
    } catch (e) {
      setError((e as Error).message);
      setAddPhase("");
      return;
    }
    setAddPhase("");
    const id = row.id;
    setWork(id, "Transcription…");
    try {
      const r = await api<{ transcript: string }>("/api/ai/transcribe-url", { job: true, method: "POST", body: JSON.stringify({ url: raw }), timeoutMs: 300_000 });
      await patch(id, { transcriptInput: r.transcript, transcriptSource: "auto", transcriptNeeded: false });
      setWork(id, "");
      await analyzeSwipe(id);
      setPanel("analyse");
    } catch {
      await patch(id, { transcriptNeeded: true });
      setWork(id, "");
      toast("Transcription automatique impossible pour ce Reel : importe la vidéo ou colle le texte des paroles.", "err");
    }
  };

  const setStage = async (s: Swipe, stage: SwipeStage | "") => {
    try {
      await patch(s.id, { etapeManuelle: stage });
      toast(stage ? `Catégorie : ${stage}.` : "Retour au classement automatique.");
      window.dispatchEvent(new Event("swipes:changed"));
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  /** Le fichier vidéo est en cache chez nous : sa première image devient la miniature de la carte. */
  const rememberPoster = (s: Swipe, localSrc: string) => {
    if (!isLocalMedia(localSrc) || (s.thumbnail && isLocalMedia(s.thumbnail))) return;
    void patch(s.id, { thumbnail: localSrc }).catch(() => undefined);
  };

  /** Je l'ai filmé : le Reel passe au montage (les rushs, le monteur les a déjà). */
  const sendToEditor = async (s: Swipe) => {
    try {
      await setStatus(s, "tourne");
      toast("Tourné : il sort de la liste (retrouve-le dans « En production »).");
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  const setNeed = async (s: Swipe, need: SwipeNeed | "") => {
    try {
      await patch(s.id, { need: need || undefined });
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  const setStatus = async (s: Swipe, status: SwipeProdStatus) => {
    const r = await api<{ swipe: Swipe }>("/api/swipe/status", { method: "POST", body: JSON.stringify({ swipeId: s.id, status }) });
    setRows((prev) => prev.map((x) => (x.id === s.id ? { ...x, prodStatus: status, prodDates: r.swipe.prodDates } : x)));
    window.dispatchEvent(new Event("swipes:changed"));
  };

  /* --- Regroupement par section --- */
  const grouped = useMemo(() => {
    const g: Record<SwipeStage | "check", Swipe[]> = { TOFU: [], MOFU: [], BOFU: [], check: [] };
    for (const s of rows) {
      if (!matchesFilter(s, filter)) continue;
      const st = swipeStage(s);
      if (st) g[st].push(s);
      else g.check.push(s);
    }
    for (const k of Object.keys(g) as (keyof typeof g)[]) g[k].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return g;
  }, [rows, filter]);
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { todo: 0, all: rows.length, fresh: 0, script: 0, prod: 0, published: 0 };
    for (const s of rows) for (const f of ["todo", "fresh", "script", "prod", "published"] as Filter[]) if (matchesFilter(s, f)) c[f]++;
    return c;
  }, [rows]);

  return (
    <div style={BLUE}>
      <PageHeader title="Swipe file" subtitle="Un lien, le type, la transcription (traduite si besoin). Rien d'autre." />

      <Card className="mb-4">
        <div className="flex flex-wrap gap-2">
          <input
            className="input flex-1 min-w-[260px]"
            placeholder="Colle le lien d'un Reel Instagram… (TikTok et YouTube Shorts aussi)"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void addSwipe();
            }}
            disabled={Boolean(addPhase)}
          />
          <button className="btn btn-primary" onClick={() => void addSwipe()} disabled={Boolean(addPhase) || !url.trim()}>
            {addPhase ? <span className="spinner" /> : "✦"} {addPhase || "Analyser ce Reel"}
          </button>
        </div>
        {error && (
          <div className="mt-3">
            <ErrorNote>{error}</ErrorNote>
          </div>
        )}
      </Card>

      {selected && (
        <Detail
          s={selected}
          working={working[selected.id] ?? ""}
          panel={panel}
          setPanel={setPanel}
          onBack={() => setSelectedId(null)}
          onPatch={async (p) => {
            await patch(selected.id, p);
          }}
          onAnalyze={async () => {
            if (await analyzeSwipe(selected.id)) setPanel("analyse");
          }}
          onStage={(stage) => void setStage(selected, stage)}
          onNeed={(need) => void setNeed(selected, need)}
          onStatus={(status) => setStatus(selected, status)}
          onStatusChange={(status, dates) => setRows((prev) => prev.map((x) => (x.id === selected.id ? { ...x, prodStatus: status, prodDates: dates } : x)))}
          onGenerated={(script, status, dates) => setRows((prev) => prev.map((x) => (x.id === selected.id ? { ...x, script, prodStatus: status, prodDates: dates, status: x.status === "a-analyser" ? "analyse" : x.status } : x)))}
          onDelete={async () => {
            if (!window.confirm("Supprimer ce Reel de la swipe file ?")) return;
            await destroy(selected.id);
            setSelectedId(null);
          }}
          onPlay={setPlaying}
        />
      )}

      <div className="flex flex-wrap gap-1.5 mb-3 items-center">
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <button key={f.key} type="button" onClick={() => setFilter(f.key)} className="h-[28px] px-3 rounded-full text-[12px] font-medium inline-flex items-center gap-1.5" style={{ background: active ? "var(--accent-soft)" : "var(--surface-2)", border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`, color: active ? "var(--accent)" : "var(--text-2)" }}>
              {f.label}
              <span className="num opacity-70">{counts[f.key]}</span>
            </button>
          );
        })}
      </div>

      {loading && !rows.length ? (
        <Card>
          <Spinner label="Chargement…" />
        </Card>
      ) : !rows.length ? (
        <Card>
          <Empty>Colle ton premier lien au-dessus.</Empty>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {(["TOFU", "MOFU", "BOFU"] as SwipeStage[]).map((st) => (
            <Section key={st} id={st} title={STAGE_TITLE[st]} hint={STAGE_HINT[st]} color={STAGE_COLOR[st]} items={grouped[st]} open={openSections[st]} onToggle={() => setOpenSections((o) => ({ ...o, [st]: !o[st] }))} working={working} selectedId={selectedId} onOpen={open} onNeed={setNeed} onPlay={setPlaying} onSend={sendToEditor} />
          ))}
          <Section id="check" title="À analyser" hint="Transcription ou classification incomplète : ouvre la fiche pour finir." color="#6b7280" items={grouped.check} open={openSections.check} onToggle={() => setOpenSections((o) => ({ ...o, check: !o.check }))} working={working} selectedId={selectedId} onOpen={open} onNeed={setNeed} onPlay={setPlaying} onSend={sendToEditor} discreet />
        </div>
      )}

      {playing && (
        <Modal open onClose={() => setPlaying(null)} title={playing.title || (playing.author ? `@${playing.author}` : "Reel")}>
          <div className="flex flex-col gap-3">
            <CreatorPlayer permalink={playing.url} src={`/api/creators/media?url=${encodeURIComponent(playing.url)}`} onReady={(local) => rememberPoster(playing, local)} />
            <div className="flex items-center gap-2 flex-wrap">
              <DownloadButton href={`/api/creators/media?url=${encodeURIComponent(playing.url)}&download=1`} />
              <a className="btn btn-sm" href={playing.url} target="_blank" rel="noreferrer">
                Ouvrir sur {playing.platform === "instagram" ? "Instagram" : playing.platform}
              </a>
              <CopyLinkButton url={playing.url} />
              <button
                className="btn btn-sm btn-ghost ml-auto"
                onClick={() => {
                  setPlaying(null);
                  open(playing);
                }}
              >
                Ouvrir la fiche
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ------------------------------- Sections ------------------------------- */

function Section({ id, title, hint, color, items, open, onToggle, working, selectedId, onOpen, onNeed, onPlay, onSend, discreet }: { id: string; title: string; hint: string; color: string; items: Swipe[]; open: boolean; onToggle: () => void; working: Record<string, string>; selectedId: string | null; onOpen: (s: Swipe, p?: Panel) => void; onNeed: (s: Swipe, need: SwipeNeed | "") => void; onPlay: (s: Swipe) => void; onSend: (s: Swipe) => Promise<void>; discreet?: boolean }) {
  if (discreet && !items.length) return null;
  return (
    <section className="card" style={{ borderColor: open && !discreet ? `color-mix(in srgb, ${color} 35%, var(--border))` : undefined }} data-section={id}>
      <button type="button" onClick={onToggle} className="w-full flex items-center gap-3 px-4 py-3 text-left">
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
        <span className="font-semibold text-[14.5px]" style={{ color: discreet ? "var(--text-2)" : color }}>
          {title}
        </span>
        <span className="badge num !text-[11px] !py-0">{items.length}</span>
        <span className="dim text-[12px] hidden md:inline truncate">{hint}</span>
        <span className="ml-auto dim text-[12px]">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="px-3 pb-3">
          {!items.length ? (
            <p className="dim text-[12.5px] px-1 pb-1">Rien ici pour l&apos;instant.</p>
          ) : (
            <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((s) => (
                <SwipeCard key={s.id} s={s} working={working[s.id]} active={selectedId === s.id} onOpen={onOpen} onNeed={onNeed} onPlay={onPlay} onSend={onSend} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function SwipeCard({ s, working, active, onOpen, onNeed, onPlay, onSend }: { s: Swipe; working?: string; active: boolean; onOpen: (s: Swipe, p?: Panel) => void; onNeed: (s: Swipe, need: SwipeNeed | "") => void; onPlay: (s: Swipe) => void; onSend: (s: Swipe) => Promise<void> }) {
  const hook = s.script?.hook || s.analysis?.hook || "";
  const excerpt = hook || (s.transcriptInput ?? "").trim().split(/\n/)[0] || "";
  const title = s.title || hook || s.caption || s.url;
  return (
    <div className="card-flat p-3 flex flex-col gap-2" style={{ borderColor: active ? "var(--accent)" : undefined }}>
      <div className="flex gap-2.5">
        <Thumb s={s} onPlay={onPlay} size={58} />
        <div className="min-w-0 flex-1">
          <button type="button" className="block text-left text-[13px] font-semibold leading-snug line-clamp-2 hover:underline" onClick={() => onOpen(s)}>
            {title}
          </button>
          <div className="dim text-[11.5px] mt-0.5 truncate">
            {s.author ? `@${s.author}` : s.platform}
            {" · "}
            <a href={s.url} target="_blank" rel="noreferrer" className="link">
              original ↗
            </a>
            {" · "}
            <CopyLinkButton url={s.url} label="copier le lien" className="link" />
            {" · "}
            {relative(s.createdAt)}
          </div>
        </div>
      </div>
      {excerpt && <p className="text-[12.5px] leading-snug line-clamp-2 muted">« {excerpt} »</p>}
      <div className="flex items-center gap-1.5 flex-wrap">
        <StageBadge s={s} small />
        <StateBadge s={s} working={working} />
        <span className="ml-auto">
          <NeedSelect s={s} onChange={(need) => onNeed(s, need)} small />
        </span>
      </div>
      <div className="flex gap-1.5 mt-auto">
        <button className="btn btn-sm flex-1" onClick={() => onOpen(s)}>
          Ouvrir
        </button>
        {swipeProdStatus(s) === "a-tourner" ? (
          <label className="btn btn-sm flex-1 cursor-pointer gap-2" title="Je l'ai filmé : il passe au montage">
            <input type="checkbox" checked={false} onChange={() => void onSend(s)} />
            Tourné
          </label>
        ) : (
          <button className="btn btn-sm btn-primary flex-1" onClick={() => onOpen(s, "script")}>
            Préparer mon script
          </button>
        )}
      </div>
    </div>
  );
}

/** Vignette cliquable : ouvre le lecteur (play direct, téléchargement, repli Instagram). */
function Thumb({ s, onPlay, size }: { s: Swipe; onPlay: (s: Swipe) => void; size: number }) {
  const w = Math.round(size * 0.76);
  return (
    <button type="button" onClick={() => onPlay(s)} className="relative shrink-0 rounded-[6px] overflow-hidden grid place-items-center group" style={{ width: w, height: size, background: "var(--surface-3)" }} title="Voir le Reel">
      {s.thumbnail ? (
        isLocalMedia(s.thumbnail) ? (
          <ThumbImg src={s.thumbnail} className="w-full h-full object-cover" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={s.thumbnail} alt="" className="w-full h-full object-cover" loading="lazy" />
        )
      ) : null}
      <span className="absolute inset-0 grid place-items-center text-[14px]" style={{ background: s.thumbnail ? "rgb(0 0 0 / 0.25)" : "transparent", color: s.thumbnail ? "#fff" : "var(--text-2)" }}>
        ▶
      </span>
    </button>
  );
}

/* --------------------------------- Fiche --------------------------------- */

function Detail({
  s,
  working,
  panel,
  setPanel,
  onBack,
  onPatch,
  onAnalyze,
  onStage,
  onNeed,
  onStatus,
  onStatusChange,
  onGenerated,
  onDelete,
  onPlay,
}: {
  s: Swipe;
  working: string;
  panel: Panel;
  setPanel: (p: Panel) => void;
  onBack: () => void;
  onPatch: (p: Partial<Swipe>) => Promise<void>;
  onAnalyze: () => Promise<void>;
  onStage: (stage: SwipeStage | "") => void;
  onNeed: (need: SwipeNeed | "") => void;
  onStatus: (status: SwipeProdStatus) => Promise<void>;
  onStatusChange: (status: SwipeProdStatus, dates: Swipe["prodDates"]) => void;
  onGenerated: (script: NonNullable<Swipe["script"]>, status: SwipeProdStatus, dates: Swipe["prodDates"]) => void;
  onDelete: () => Promise<void>;
  onPlay: (s: Swipe) => void;
}) {
  const state: SwipeState = swipeState(s);
  // Échap referme la fiche et rend la bibliothèque.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);
  const [more, setMore] = useState(panel !== "source" && panel !== "script");
  const main: { value: Panel; label: string }[] = [
    { value: "source", label: "Transcription" },
    { value: "script", label: "Mon script" },
  ];
  const extra: { value: Panel; label: string }[] = [
    { value: "analyse", label: "Analyse" },
    { value: "plans", label: "Plans" },
    { value: "prompts", label: "Prompts IA" },
    { value: "production", label: "Production" },
  ];
  const tabs = more ? [...main, ...extra] : main;
  const stage = swipeStage(s);
  return (
    <Card
      className="mb-4"
      title={
        <span className="inline-flex items-center gap-3">
          <button type="button" className="btn btn-sm" onClick={onBack} title="Retour à la bibliothèque (Échap)">
            ← Bibliothèque
          </button>
          <Thumb s={s} onPlay={onPlay} size={44} />
          <span className="min-w-0 truncate">{s.title || "Reel"}</span>
        </span>
      }
      subtitle={`${s.platform}${s.author ? ` · @${s.author}` : ""} · ajouté ${relative(s.createdAt)}`}
      actions={
        <>
          <StateBadge s={s} working={working} />
          <NeedSelect s={s} onChange={onNeed} />
          <select className="select select-sm !w-auto" value={s.etapeManuelle ?? ""} onChange={(e) => onStage(e.target.value as SwipeStage | "")} title="Déplacer dans une autre catégorie">
            <option value="">{s.analysis?.etape ? `Auto · ${s.analysis.etape}` : stage ? stage : "Catégorie…"}</option>
            {(["TOFU", "MOFU", "BOFU"] as SwipeStage[]).map((st) => (
              <option key={st} value={st}>
                {STAGE_TITLE[st]}
              </option>
            ))}
          </select>
          <a href={s.url} target="_blank" rel="noreferrer" className="btn btn-sm">
            Original ↗
          </a>
          <CopyLinkButton url={s.url} />
          <button className="btn btn-sm btn-ghost" onClick={() => void onDelete()}>
            Supprimer
          </button>
        </>
      }
      padded={false}
    >
      <div className="px-4 pt-3 flex items-center gap-2 flex-wrap">
        <Tabs value={panel} onChange={setPanel} options={tabs} />
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setMore((v) => !v)}>
          {more ? "Moins" : "Plus ▸"}
        </button>
      </div>
      <div className="p-4">
        {panel === "source" && <SourcePanel s={s} busy={working} onPatch={onPatch} onAnalyze={onAnalyze} />}
        {panel === "analyse" &&
          (s.analysis ? (
            <MechanicsPanel s={s} a={s.analysis} onStage={onStage} />
          ) : (
            <Empty
              action={
                <button className="btn btn-primary btn-sm" onClick={() => setPanel("source")}>
                  {state === "needs-transcript" ? "Fournir la transcription" : "Lancer l'analyse"}
                </button>
              }
            >
              {state === "needs-transcript" ? "Transcription nécessaire avant l'analyse." : "Pas encore analysé."}
            </Empty>
          ))}
        {panel === "script" && <ScriptStudio key={s.id} s={s} onPatch={onPatch} onGenerated={onGenerated} onStatus={onStatus} />}
        {panel === "plans" && (s.analysis ? <ShotsPanel a={s.analysis} /> : <Empty>Lance l&apos;analyse pour obtenir le découpage et les plans.</Empty>)}
        {panel === "prompts" && (s.analysis ? <PromptsInline a={s.analysis} swipeId={s.id} /> : <Empty>Lance l&apos;analyse pour obtenir les prompts d&apos;images et de B-roll.</Empty>)}
        {panel === "production" && <ProductionPanel s={s} onPatch={onPatch} onStatusChange={onStatusChange} />}
      </div>
      <div className="px-4 pb-4 flex justify-end">
        <button className="btn btn-sm" onClick={onBack}>
          ← Retour à la bibliothèque
        </button>
      </div>
    </Card>
  );
}
