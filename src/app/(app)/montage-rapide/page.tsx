"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, Empty, PageHeader, useToast } from "@/components/ui";
import { DropZone, ProgressBar, type Progress } from "@/components/upload-ui";
import { formatBytes, uploadFile } from "@/lib/upload-client";

/**
 * Montage rapide (2026-11-18) : un mini CapCut pour aller vite.
 *
 * Glisser une vidéo, couper le début et la fin, poser des textes qu'on
 * déplace à la souris sur l'aperçu, ajouter une musique, régler les deux
 * volumes, exporter en même qualité. Rien d'autre. L'aperçu est le vrai
 * lecteur du navigateur ; à l'export, chaque texte est rendu en PNG à la
 * taille exacte de la vidéo (même police que l'aperçu) et ffmpeg assemble le
 * tout côté serveur (lib/montage-rapide).
 */

interface Clip {
  url: string;
  name: string;
  width: number;
  height: number;
  duration: number;
}

interface TextLayer {
  id: string;
  text: string;
  /** Centre du texte, en fraction de la largeur / hauteur. */
  x: number;
  y: number;
  /** Hauteur de police, en fraction de la hauteur de la vidéo. */
  size: number;
  color: string;
  /** Bandeau sombre derrière le texte. */
  box: boolean;
  start: number;
  end: number;
}

interface Music {
  url: string;
  name: string;
  duration: number;
}

interface Exported {
  url: string;
  name: string;
  bytes: number;
  at: number;
}

const COLORS = ["#ffffff", "#ffe600", "#ff3b3b", "#1dd1a1", "#4da3ff", "#000000"];
const SHADOW = "0 2px 10px rgba(0,0,0,.65), 0 0 2px rgba(0,0,0,.8)";

const fmt = (s: number) => {
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r.toFixed(1).padStart(4, "0")}`;
};
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const uid = () => Math.random().toString(36).slice(2, 10);

/** Police réelle de la page, pour que le PNG exporté et l'aperçu soient identiques. */
function pageFont(): string {
  if (typeof document === "undefined") return "Inter, system-ui, sans-serif";
  return getComputedStyle(document.body).fontFamily || "Inter, system-ui, sans-serif";
}

/** Rend un texte en PNG transparent aux dimensions de la vidéo, comme dans l'aperçu. */
async function renderTextPng(t: TextLayer, width: number, height: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Impossible de dessiner le texte.");
  const px = Math.max(8, Math.round(t.size * height));
  const family = pageFont();
  try {
    await document.fonts.load(`700 ${px}px ${family.split(",")[0]}`);
  } catch {
    // Police non chargeable : le navigateur prendra la plus proche, comme l'aperçu.
  }
  ctx.font = `700 ${px}px ${family}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lines = t.text.split("\n");
  const lineH = px * 1.2;
  const cx = t.x * width;
  const top = t.y * height - ((lines.length - 1) * lineH) / 2;
  if (t.box) {
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width));
    const padX = px * 0.5;
    const padY = px * 0.25;
    const bw = w + padX * 2;
    const bh = lines.length * lineH + padY * 2 - (lineH - px);
    const bx = cx - bw / 2;
    const by = top - px / 2 - padY;
    ctx.fillStyle = "rgba(0,0,0,.55)";
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, px * 0.3);
    ctx.fill();
  }
  ctx.shadowColor = "rgba(0,0,0,.65)";
  ctx.shadowBlur = px * 0.25;
  ctx.shadowOffsetY = px * 0.05;
  ctx.fillStyle = t.color;
  lines.forEach((line, i) => ctx.fillText(line, cx, top + i * lineH));
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG vide."))), "image/png"));
}

export default function MontageRapidePage() {
  const toast = useToast();
  const [clip, setClip] = useState<Clip | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [texts, setTexts] = useState<TextLayer[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [music, setMusic] = useState<Music | null>(null);
  const [musicStart, setMusicStart] = useState(0);
  const [musicVolume, setMusicVolume] = useState(0.6);
  const [videoVolume, setVideoVolume] = useState(1);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [exporting, setExporting] = useState<{ step: string; since: number } | null>(null);
  const [exports, setExports] = useState<Exported[]>([]);
  const [outName, setOutName] = useState("");

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [boxH, setBoxH] = useState(0);

  /* ------------------------------ Chargement ------------------------------ */

  /** Ouvre une vidéo déjà sur le site (dimensions et durée lues par le navigateur). */
  const openClip = useCallback(async (url: string, name: string) => {
    const meta = await new Promise<{ w: number; h: number; d: number }>((resolve, reject) => {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.onloadedmetadata = () => resolve({ w: v.videoWidth, h: v.videoHeight, d: v.duration });
      v.onerror = () => reject(new Error("Le navigateur ne lit pas cette vidéo (format non pris en charge)."));
      v.src = url;
    });
    setClip({ url, name, width: meta.w, height: meta.h, duration: meta.d });
    setStart(0);
    setEnd(meta.d);
    setTexts([]);
    setSelected(null);
    setTime(0);
    setOutName(name.replace(/\.[^.]+$/, "") + "-montage");
  }, []);

  // `?video=/api/media/…` : ouvrir directement un rendu du site (lien depuis le Studio, par exemple).
  useEffect(() => {
    const url = new URLSearchParams(window.location.search).get("video") ?? "";
    if (!/^\/api\/media\/[A-Za-z0-9]+\.[A-Za-z0-9]+$/.test(url)) return;
    void openClip(url, url.split("/").pop() ?? "video").catch((e: Error) => toast(e.message, "err"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadVideo = async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    try {
      const up = await uploadFile(f, (fr, note) => setProgress({ name: f.name, index: 1, total: 1, fraction: fr, note }));
      setProgress(null);
      await openClip(up.url, f.name);
    } catch (e) {
      setProgress(null);
      toast((e as Error).message, "err");
    }
  };

  const loadMusic = async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    try {
      const up = await uploadFile(f, (fr, note) => setProgress({ name: f.name, index: 1, total: 1, fraction: fr, note }));
      setProgress(null);
      const d = await new Promise<number>((resolve) => {
        const a = document.createElement("audio");
        a.preload = "metadata";
        a.onloadedmetadata = () => resolve(a.duration);
        a.onerror = () => resolve(0);
        a.src = up.url;
      });
      setMusic({ url: up.url, name: f.name, duration: d });
      setMusicStart(0);
    } catch (e) {
      setProgress(null);
      toast((e as Error).message, "err");
    }
  };

  /* ------------------------------ Lecture ------------------------------ */

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBoxH(el.clientHeight));
    ro.observe(el);
    setBoxH(el.clientHeight);
    return () => ro.disconnect();
  }, [clip]);

  // Volumes appliqués à l'aperçu (le navigateur plafonne à 100 %).
  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = clamp(videoVolume, 0, 1);
  }, [videoVolume, clip]);
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = clamp(musicVolume, 0, 1);
  }, [musicVolume, music]);

  const syncMusic = useCallback(
    (t: number, play: boolean) => {
      const a = audioRef.current;
      if (!a || !music) return;
      const target = musicStart + (t - start);
      if (target < 0 || (music.duration && target >= music.duration)) {
        a.pause();
        return;
      }
      if (Math.abs(a.currentTime - target) > 0.25) a.currentTime = target;
      if (play && a.paused) void a.play().catch(() => {});
      if (!play && !a.paused) a.pause();
    },
    [music, musicStart, start],
  );

  const seek = useCallback(
    (t: number) => {
      const v = videoRef.current;
      if (!v) return;
      v.currentTime = t;
      setTime(t);
      syncMusic(t, !v.paused);
    },
    [syncMusic],
  );

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      if (v.currentTime < start || v.currentTime >= end - 0.05) v.currentTime = start;
      void v.play();
    } else v.pause();
  };

  const onTime = () => {
    const v = videoRef.current;
    if (!v) return;
    setTime(v.currentTime);
    if (!v.paused && v.currentTime >= end) {
      v.pause();
      v.currentTime = start;
      setTime(start);
      syncMusic(start, false);
      return;
    }
    if (!v.paused) syncMusic(v.currentTime, true);
  };

  /* ------------------------------ Textes ------------------------------ */

  const addText = () => {
    const t: TextLayer = { id: uid(), text: "Ton texte", x: 0.5, y: 0.5, size: 0.055, color: "#ffffff", box: false, start, end };
    setTexts((prev) => [...prev, t]);
    setSelected(t.id);
  };
  const patchText = (id: string, p: Partial<TextLayer>) => setTexts((prev) => prev.map((t) => (t.id === id ? { ...t, ...p } : t)));
  const removeText = (id: string) => {
    setTexts((prev) => prev.filter((t) => t.id !== id));
    if (selected === id) setSelected(null);
  };
  const current = texts.find((t) => t.id === selected) ?? null;

  /* Déplacement d'un texte à la souris sur l'aperçu. */
  const dragText = (e: React.PointerEvent, t: TextLayer) => {
    const box = boxRef.current;
    if (!box) return;
    e.preventDefault();
    e.stopPropagation();
    setSelected(t.id);
    const rect = box.getBoundingClientRect();
    const ox = t.x - (e.clientX - rect.left) / rect.width;
    const oy = t.y - (e.clientY - rect.top) / rect.height;
    const move = (ev: PointerEvent) => {
      patchText(t.id, {
        x: clamp((ev.clientX - rect.left) / rect.width + ox, 0.03, 0.97),
        y: clamp((ev.clientY - rect.top) / rect.height + oy, 0.03, 0.97),
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /* ------------------------------ Export ------------------------------ */

  const doExport = async () => {
    if (!clip || exporting) return;
    setExporting({ step: "Préparation des textes…", since: Date.now() });
    try {
      const layers: { url: string; start: number; end: number }[] = [];
      for (const [i, t] of texts.entries()) {
        if (!t.text.trim()) continue;
        const png = await renderTextPng(t, clip.width, clip.height);
        const file = new File([png], `texte-${i + 1}.png`, { type: "image/png" });
        const up = await uploadFile(file);
        layers.push({ url: up.url, start: t.start, end: t.end });
      }
      const res = await fetch("/api/montage-rapide/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoUrl: clip.url, start, end, texts: layers, musicUrl: music?.url, musicStart, musicVolume, videoVolume }),
      });
      const first = (await res.json()) as { jobId?: string; error?: string };
      if (!res.ok || !first.jobId) throw new Error(first.error ?? `Erreur ${res.status}`);
      for (;;) {
        await new Promise((r) => setTimeout(r, 2000));
        let body: { status?: string; step?: string; error?: string; result?: { url: string; bytes: number } };
        try {
          const r = await fetch(`/api/montage-rapide/export?job=${encodeURIComponent(first.jobId)}`, { cache: "no-store" });
          body = (await r.json()) as typeof body;
          if (r.status === 404) throw new Error(body.error ?? "Tâche perdue.");
        } catch (e) {
          if ((e as Error).message.includes("Tâche")) throw e;
          continue; // coupure passagère
        }
        if (body.status === "error") throw new Error(body.error ?? "Export échoué.");
        if (body.status === "done" && body.result) {
          const name = `${(outName.trim() || "montage").replace(/[\\/:*?"<>|]+/g, "-")}.mp4`;
          setExports((prev) => [{ url: body.result!.url, name, bytes: body.result!.bytes, at: Date.now() }, ...prev]);
          toast("Export terminé. Télécharge-le ci-dessous.");
          break;
        }
        setExporting({ step: body.step ?? "Export en cours…", since: Date.now() });
      }
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setExporting(null);
    }
  };

  /* ------------------------------ Rendu ------------------------------ */

  const visibleTexts = useMemo(
    () => texts.filter((t) => t.id === selected || (time >= t.start && time <= t.end)),
    [texts, selected, time],
  );

  return (
    <>
      <PageHeader
        title="Montage rapide"
        subtitle="Glisse une vidéo, coupe, pose un texte, ajoute une musique, règle le son, exporte en même qualité. Rien de plus."
        actions={
          clip ? (
            <button className="btn" onClick={() => { setClip(null); setMusic(null); setTexts([]); setExports([]); }}>
              Nouvelle vidéo
            </button>
          ) : undefined
        }
      />

      {!clip ? (
        <Card padded={false}>
          <div className="p-4 flex flex-col gap-3">
            <DropZone
              label="Glisse ta vidéo ici"
              hint="MP4, MOV, WEBM… Depuis ton téléphone ou ton PC. Elle est envoyée sur le site, puis tu montes directement dans l'aperçu."
              accept="video/*,.mp4,.mov,.m4v,.webm,.mkv"
              multiple={false}
              disabled={progress !== null}
              onFiles={(f) => void loadVideo(f)}
            />
            {progress && <ProgressBar p={progress} />}
          </div>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px] items-start">
          {/* Aperçu + timeline */}
          <Card padded={false}>
            <div className="p-3 flex flex-col gap-3">
              <div className="mx-auto w-full" style={{ maxWidth: clip.width >= clip.height ? "100%" : `calc(70vh * ${clip.width / clip.height})` }}>
                <div
                  ref={boxRef}
                  className="relative w-full overflow-hidden rounded-[10px] select-none"
                  style={{ aspectRatio: `${clip.width} / ${clip.height}`, background: "#000" }}
                  onPointerDown={() => setSelected(null)}
                >
                  <video
                    ref={videoRef}
                    src={clip.url}
                    playsInline
                    preload="auto"
                    className="absolute inset-0 w-full h-full"
                    onTimeUpdate={onTime}
                    onPlay={() => { setPlaying(true); syncMusic(videoRef.current?.currentTime ?? start, true); }}
                    onPause={() => { setPlaying(false); syncMusic(videoRef.current?.currentTime ?? start, false); }}
                    onClick={togglePlay}
                  />
                  {music && <audio ref={audioRef} src={music.url} preload="auto" />}
                  {visibleTexts.map((t) => (
                    <div
                      key={t.id}
                      onPointerDown={(e) => dragText(e, t)}
                      className="absolute whitespace-pre text-center font-bold leading-[1.2] cursor-move"
                      style={{
                        left: `${t.x * 100}%`,
                        top: `${t.y * 100}%`,
                        transform: "translate(-50%, -50%)",
                        fontSize: Math.max(8, t.size * boxH),
                        color: t.color,
                        textShadow: SHADOW,
                        background: t.box ? "rgba(0,0,0,.55)" : "transparent",
                        padding: t.box ? "0.25em 0.5em" : 0,
                        borderRadius: "0.3em",
                        outline: t.id === selected ? "2px dashed var(--accent)" : "none",
                        outlineOffset: 4,
                        opacity: time >= t.start && time <= t.end ? 1 : 0.35,
                        touchAction: "none",
                      }}
                    >
                      {t.text || " "}
                    </div>
                  ))}
                </div>
              </div>

              <Timeline duration={clip.duration} start={start} end={end} time={time} texts={texts} selected={selected} onSeek={seek} onStart={setStart} onEnd={setEnd} />

              <div className="flex flex-wrap items-center gap-2">
                <button className="btn btn-primary btn-sm" onClick={togglePlay}>{playing ? "❚❚ Pause" : "▶ Lecture"}</button>
                <span className="num text-[13px] tabular-nums">{fmt(time)} <span className="dim">/ {fmt(clip.duration)}</span></span>
                <span className="dim text-[12px]">·</span>
                <button className="btn btn-sm" title="Le début de la vidéo gardée = l'image affichée" onClick={() => setStart(clamp(time, 0, end - 0.1))}>⇤ Début ici</button>
                <button className="btn btn-sm" title="La fin de la vidéo gardée = l'image affichée" onClick={() => setEnd(clamp(time, start + 0.1, clip.duration))}>Fin ici ⇥</button>
                <span className="dim text-[12px]">Gardé : {fmt(start)} → {fmt(end)} ({fmt(end - start)})</span>
                <button className="btn btn-sm btn-ghost" onClick={() => { setStart(0); setEnd(clip.duration); }}>Tout garder</button>
              </div>
            </div>
          </Card>

          {/* Panneaux */}
          <div className="flex flex-col gap-4">
            <Card title="Texte" subtitle="Glisse-le à la souris sur la vidéo" padded={false} actions={<button className="btn btn-sm" onClick={addText}>+ Texte</button>}>
              <div className="p-3 flex flex-col gap-2.5">
                {!texts.length && <p className="dim text-[12.5px]">Aucun texte. « + Texte » en pose un au milieu, visible sur toute la partie gardée.</p>}
                {texts.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {texts.map((t, i) => (
                      <button
                        key={t.id}
                        className={`badge cursor-pointer ${t.id === selected ? "badge-accent" : ""}`}
                        onClick={() => { setSelected(t.id); if (time < t.start || time > t.end) seek(t.start); }}
                        title={t.text}
                      >
                        {i + 1} · {t.text.slice(0, 14) || "(vide)"}
                      </button>
                    ))}
                  </div>
                )}
                {current && (
                  <div className="flex flex-col gap-2.5 rounded-[10px] p-2.5" style={{ background: "var(--surface-2)" }}>
                    <textarea
                      className="input w-full font-semibold"
                      rows={2}
                      value={current.text}
                      data-nodraft
                      placeholder="Ton texte (Entrée = nouvelle ligne)"
                      onChange={(e) => patchText(current.id, { text: e.target.value })}
                    />
                    <div className="flex items-center gap-2 text-[12px]">
                      <span className="dim w-14 shrink-0">Taille</span>
                      <input type="range" min={0.025} max={0.14} step={0.005} value={current.size} onChange={(e) => patchText(current.id, { size: Number(e.target.value) })} className="flex-1" />
                      <span className="num w-10 text-right tabular-nums">{Math.round(current.size * 100)} %</span>
                    </div>
                    <div className="flex items-center gap-2 text-[12px]">
                      <span className="dim w-14 shrink-0">Couleur</span>
                      <div className="flex gap-1.5 flex-wrap">
                        {COLORS.map((c) => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => patchText(current.id, { color: c })}
                            className="rounded-full"
                            style={{ width: 22, height: 22, background: c, border: current.color === c ? "2px solid var(--accent)" : "1px solid var(--border-strong)" }}
                            title={c}
                          />
                        ))}
                        <input type="color" value={current.color} onChange={(e) => patchText(current.id, { color: e.target.value })} className="w-[26px] h-[22px] p-0 bg-transparent border-0 cursor-pointer" title="Autre couleur" />
                      </div>
                    </div>
                    <label className="flex items-center gap-2 text-[12px] cursor-pointer">
                      <input type="checkbox" checked={current.box} onChange={(e) => patchText(current.id, { box: e.target.checked })} />
                      Bandeau sombre derrière le texte
                    </label>
                    <div className="grid grid-cols-2 gap-2 text-[12px]">
                      <div className="flex items-center gap-1.5">
                        <span className="dim">De</span>
                        <span className="num tabular-nums">{fmt(current.start)}</span>
                        <button className="btn btn-sm" onClick={() => patchText(current.id, { start: clamp(time, 0, current.end - 0.1) })} title="Apparaît à l'image affichée">ici</button>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="dim">À</span>
                        <span className="num tabular-nums">{fmt(current.end)}</span>
                        <button className="btn btn-sm" onClick={() => patchText(current.id, { end: clamp(time, current.start + 0.1, clip.duration) })} title="Disparaît à l'image affichée">ici</button>
                      </div>
                    </div>
                    <div className="flex justify-between">
                      <button className="btn btn-sm btn-ghost" onClick={() => patchText(current.id, { start, end })}>Toute la vidéo</button>
                      <button className="btn btn-sm btn-danger" onClick={() => removeText(current.id)}>Supprimer</button>
                    </div>
                  </div>
                )}
              </div>
            </Card>

            <Card title="Son" padded={false}>
              <div className="p-3 flex flex-col gap-2.5">
                <div className="flex items-center gap-2 text-[12px]">
                  <span className="dim w-24 shrink-0">Son vidéo</span>
                  <input type="range" min={0} max={1.5} step={0.05} value={videoVolume} onChange={(e) => setVideoVolume(Number(e.target.value))} className="flex-1" />
                  <span className="num w-12 text-right tabular-nums">{Math.round(videoVolume * 100)} %</span>
                </div>
                {music ? (
                  <>
                    <div className="flex items-center gap-2 text-[12.5px] rounded-[8px] px-2.5 py-1.5" style={{ background: "var(--surface-2)" }}>
                      <span aria-hidden>🎵</span>
                      <span className="flex-1 min-w-0 truncate" title={music.name}>{music.name}</span>
                      {music.duration > 0 && <span className="dim text-[11px]">{fmt(music.duration)}</span>}
                      <button className="btn btn-sm btn-ghost" onClick={() => setMusic(null)} title="Retirer la musique">✕</button>
                    </div>
                    <div className="flex items-center gap-2 text-[12px]">
                      <span className="dim w-24 shrink-0">Musique</span>
                      <input type="range" min={0} max={1.5} step={0.05} value={musicVolume} onChange={(e) => setMusicVolume(Number(e.target.value))} className="flex-1" />
                      <span className="num w-12 text-right tabular-nums">{Math.round(musicVolume * 100)} %</span>
                    </div>
                    <div className="flex items-center gap-2 text-[12px]">
                      <span className="dim w-24 shrink-0">Départ musique</span>
                      <input type="range" min={0} max={Math.max(0, music.duration - 1)} step={0.5} value={musicStart} onChange={(e) => { setMusicStart(Number(e.target.value)); }} className="flex-1" />
                      <span className="num w-12 text-right tabular-nums">{fmt(musicStart)}</span>
                    </div>
                    <p className="dim text-[11px] leading-snug">La musique démarre au début de la partie gardée, depuis ce point du fichier, et s&apos;arrête avec la vidéo. Au-dessus de 100 %, l&apos;aperçu reste à 100 % mais l&apos;export applique le volume demandé.</p>
                  </>
                ) : (
                  <DropZone
                    label="Glisse une musique ici"
                    hint="MP3, WAV, M4A ou AAC"
                    accept="audio/*,.mp3,.wav,.m4a,.aac"
                    multiple={false}
                    compact
                    disabled={progress !== null}
                    onFiles={(f) => void loadMusic(f)}
                  />
                )}
                {progress && <ProgressBar p={progress} />}
              </div>
            </Card>

            <Card title="Export" subtitle="Même résolution, même cadence, H.264 quasi sans perte" padded={false}>
              <div className="p-3 flex flex-col gap-2.5">
                <input className="input w-full" value={outName} data-nodraft onChange={(e) => setOutName(e.target.value)} placeholder="Nom du fichier" />
                <button className="btn btn-primary w-full" onClick={() => void doExport()} disabled={exporting !== null}>
                  {exporting ? `${exporting.step}` : "⤓ Exporter la vidéo"}
                </button>
                {exporting && <ExportTimer since={exporting.since} />}
                {exports.length > 0 && (
                  <ul className="flex flex-col gap-1.5">
                    {exports.map((x) => (
                      <li key={x.url} className="flex items-center gap-2 text-[12.5px] rounded-[8px] px-2.5 py-1.5" style={{ background: "var(--surface-2)" }}>
                        <span className="flex-1 min-w-0 truncate" title={x.name}>{x.name}</span>
                        <span className="dim text-[11px] shrink-0">{formatBytes(x.bytes)}</span>
                        <a href={`${x.url}?download=1&name=${encodeURIComponent(x.name)}`} download={x.name} className="btn btn-sm btn-primary shrink-0">↓ Télécharger</a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Card>
          </div>
        </div>
      )}

      {!clip && exports.length > 0 && <Empty>Vidéo retirée. Les exports précédents restent dans la liste de la page tant qu&apos;elle n&apos;est pas rechargée.</Empty>}
    </>
  );
}

function ExportTimer({ since }: { since: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const s = Math.round((Date.now() - since) / 1000);
  return <p className="dim text-[11.5px]">Ça tourne sur le serveur ({fmt(s)}). Compte à peu près la durée de la vidéo, un peu plus si elle est en 4K.</p>;
}

/**
 * Timeline : la barre entière est la vidéo d'origine. La partie claire est ce
 * qui sera gardé, ses deux poignées se tirent à la souris, le trait est la
 * tête de lecture (clic pour s'y rendre). Les textes apparaissent en dessous
 * sur leur plage.
 */
function Timeline({
  duration,
  start,
  end,
  time,
  texts,
  selected,
  onSeek,
  onStart,
  onEnd,
}: {
  duration: number;
  start: number;
  end: number;
  time: number;
  texts: TextLayer[];
  selected: string | null;
  onSeek: (t: number) => void;
  onStart: (t: number) => void;
  onEnd: (t: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const pct = (t: number) => `${(duration ? t / duration : 0) * 100}%`;
  const at = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || !duration) return 0;
    return clamp(((clientX - r.left) / r.width) * duration, 0, duration);
  };
  const drag = (e: React.PointerEvent, which: "start" | "end" | "seek") => {
    e.preventDefault();
    e.stopPropagation();
    const apply = (x: number) => {
      const t = at(x);
      if (which === "start") onStart(clamp(t, 0, end - 0.1));
      else if (which === "end") onEnd(clamp(t, start + 0.1, duration));
      else onSeek(t);
    };
    apply(e.clientX);
    const move = (ev: PointerEvent) => apply(ev.clientX);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const handle = (which: "start" | "end") => (
    <div
      onPointerDown={(e) => drag(e, which)}
      className="absolute top-0 bottom-0 cursor-ew-resize"
      style={{ left: which === "start" ? pct(start) : pct(end), width: 12, marginLeft: -6, touchAction: "none", zIndex: 2 }}
      title={which === "start" ? "Début de la partie gardée" : "Fin de la partie gardée"}
    >
      <div className="absolute top-0 bottom-0 left-1/2 -ml-[2px] w-[4px] rounded-full" style={{ background: "var(--accent)" }} />
    </div>
  );
  return (
    <div className="flex flex-col gap-1">
      <div ref={ref} className="relative h-[34px] rounded-[8px] overflow-hidden" style={{ background: "var(--surface-3)", touchAction: "none" }} onPointerDown={(e) => drag(e, "seek")}>
        <div className="absolute top-0 bottom-0" style={{ left: pct(start), right: `${100 - (duration ? end / duration : 1) * 100}%`, background: "color-mix(in srgb, var(--accent) 22%, transparent)" }} />
        {handle("start")}
        {handle("end")}
        <div className="absolute top-0 bottom-0 w-[2px] pointer-events-none" style={{ left: pct(time), background: "var(--text)", zIndex: 3 }} />
      </div>
      {texts.length > 0 && (
        <div className="relative h-[10px]">
          {texts.map((t) => (
            <div
              key={t.id}
              className="absolute top-0 bottom-0 rounded-full"
              style={{ left: pct(t.start), width: pct(t.end - t.start), background: t.id === selected ? "var(--accent)" : "var(--border-strong)" }}
              title={t.text}
            />
          ))}
        </div>
      )}
    </div>
  );
}
