"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, useCollection } from "@/lib/client";
import { Card, Empty, PageHeader, Spinner, useToast } from "@/components/ui";
import { STAGE_COLOR, useWeek } from "@/components/WeekBlock";
import { SWIPE_STAGES, swipeProdStatus, swipeStage, type Swipe, type SwipeStage } from "@/lib/types";

/**
 * Vue « Tournage » (2026-10-15) : tous les swipes « A tourner », filtres par
 * etape, et un prompteur plein ecran (hook, bullets, CTA en gros). « Suivant »
 * passe le Reel en « Tourne » et ouvre le suivant : on enchaine les prises
 * sans toucher a la souris entre deux.
 */
export default function TournagePage() {
  const { rows, loading, setRows } = useCollection<Swipe>("swipes");
  const { data: week } = useWeek();
  const toast = useToast();
  const [filter, setFilter] = useState<SwipeStage | "all">("all");
  const [current, setCurrent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const todo = useMemo(
    () =>
      rows
        .filter((s) => swipeProdStatus(s) === "a-tourner" && (filter === "all" || swipeStage(s) === filter))
        .sort((a, b) => (a.prodDates?.["a-tourner"] ?? a.createdAt).localeCompare(b.prodDates?.["a-tourner"] ?? b.createdAt)),
    [rows, filter],
  );
  const currentSwipe = todo.find((s) => s.id === current) ?? null;

  /** Ce qu'il reste a tourner cette semaine, par etape : objectif moins les tournes de la semaine. */
  const remaining = useMemo(() => {
    if (!week) return null;
    return week.progress.stages.map((s) => ({ stage: s.stage, left: Math.max(0, s.target - s.counts.tourne), ready: s.pipeline["a-tourner"] }));
  }, [week]);

  const markShot = async (s: Swipe, openNext: boolean) => {
    setBusy(true);
    try {
      await api("/api/swipe/status", { method: "POST", body: JSON.stringify({ swipeId: s.id, status: "tourne" }) });
      const now = new Date().toISOString();
      setRows((prev) => prev.map((x) => (x.id === s.id ? { ...x, prodStatus: "tourne", prodDates: { ...(x.prodDates ?? {}), tourne: now } } : x)));
      window.dispatchEvent(new Event("swipes:changed"));
      if (openNext) {
        const idx = todo.findIndex((x) => x.id === s.id);
        const next = todo[idx + 1] ?? todo[idx - 1] ?? null;
        setCurrent(next && next.id !== s.id ? next.id : null);
        if (!next || next.id === s.id) toast("Tout est tourné pour ce filtre. Bien joué.");
      } else {
        toast("Marqué tourné.");
      }
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  // Raccourcis du prompteur : Espace ou flèche droite = suivant, Échap = fermer.
  useEffect(() => {
    if (!currentSwipe) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCurrent(null);
      if ((e.key === " " || e.key === "ArrowRight") && !busy) {
        e.preventDefault();
        void markShot(currentSwipe, true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSwipe, busy]);

  return (
    <>
      <PageHeader
        title="Tournage"
        subtitle="Les Reels « À tourner ». Ouvre le prompteur, lis, tourne, « Suivant » : le Reel passe en « Tourné » et le suivant s'affiche."
        actions={
          <Link href="/swipe" className="btn btn-sm">
            ← Swipe file
          </Link>
        }
      />

      {remaining && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          {remaining.map((r) => (
            <Card key={r.stage}>
              <div className="flex items-baseline gap-2">
                <span className="font-semibold" style={{ color: STAGE_COLOR[r.stage] }}>
                  {r.stage}
                </span>
                <span className="num text-[22px] font-semibold">{r.left}</span>
                <span className="dim text-[12px]">à tourner cette semaine</span>
              </div>
              <div className="dim text-[12px] mt-1">
                {r.ready} prêt{r.ready > 1 ? "s" : ""} (scriptés, à tourner)
                {r.ready < r.left ? ` · il manque ${r.left - r.ready} script${r.left - r.ready > 1 ? "s" : ""}` : ""}
              </div>
            </Card>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 mb-3">
        {(["all", ...SWIPE_STAGES] as const).map((f) => {
          const n = f === "all" ? rows.filter((s) => swipeProdStatus(s) === "a-tourner").length : rows.filter((s) => swipeProdStatus(s) === "a-tourner" && swipeStage(s) === f).length;
          const active = filter === f;
          const color = f === "all" ? undefined : STAGE_COLOR[f];
          return (
            <button
              key={f}
              type="button"
              className="h-[30px] px-3 rounded-full text-[12.5px] font-medium inline-flex items-center gap-1.5"
              onClick={() => setFilter(f)}
              style={{
                background: active ? (color ? `color-mix(in srgb, ${color} 24%, var(--surface))` : "var(--surface)") : "var(--surface-2)",
                border: `1px solid ${active ? (color ?? "var(--text-2)") : "var(--border)"}`,
                color: active ? "var(--text)" : "var(--text-2)",
              }}
            >
              {f === "all" ? "Tous" : f}
              <span className="num opacity-70">{n}</span>
            </button>
          );
        })}
        {todo.length > 0 && (
          <button className="btn btn-sm btn-primary ml-auto" onClick={() => setCurrent(todo[0].id)}>
            ▶ Lancer le prompteur ({todo.length})
          </button>
        )}
      </div>

      {loading && !rows.length ? (
        <Card>
          <Spinner label="Chargement…" />
        </Card>
      ) : !todo.length ? (
        <Card>
          <Empty
            action={
              <Link href="/swipe" className="btn btn-primary">
                Ouvrir la Swipe file
              </Link>
            }
          >
            Rien à tourner. Dans la Swipe file, génère « Mon script » puis passe le Reel en « À tourner ».
          </Empty>
        </Card>
      ) : (
        <Card padded={false}>
          <ul>
            {todo.map((s, i) => {
              const st = swipeStage(s);
              return (
                <li key={s.id} className="px-4 py-3 flex items-center gap-3 flex-wrap" style={{ borderTop: i ? "1px solid var(--border)" : undefined }}>
                  {st && (
                    <span className="badge !text-[10.5px] !py-0 font-semibold" style={{ color: STAGE_COLOR[st] }}>
                      {st}
                    </span>
                  )}
                  <span className="text-[13.5px] font-medium min-w-0 flex-1 truncate">{s.script?.hook || s.title || s.url}</span>
                  {s.script?.durationSec ? <span className="dim text-[12px]">{s.script.durationSec} s</span> : null}
                  <button className="btn btn-sm" onClick={() => setCurrent(s.id)}>
                    Prompteur
                  </button>
                  <button className="btn btn-sm" disabled={busy} onClick={() => void markShot(s, false)}>
                    ✓ Tourné
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {currentSwipe && (
        <div className="fixed inset-0 z-50 flex flex-col" style={{ background: "#0b0f14", color: "#fff" }}>
          <div className="flex items-center gap-3 px-5 py-3 text-[13px]" style={{ borderBottom: "1px solid rgb(255 255 255 / 0.12)" }}>
            {swipeStage(currentSwipe) && (
              <span className="font-semibold" style={{ color: STAGE_COLOR[swipeStage(currentSwipe) as SwipeStage] }}>
                {swipeStage(currentSwipe)}
              </span>
            )}
            <span className="opacity-70">
              {todo.findIndex((x) => x.id === currentSwipe.id) + 1} / {todo.length}
              {currentSwipe.script?.durationSec ? ` · ${currentSwipe.script.durationSec} s` : ""}
            </span>
            {currentSwipe.script?.screenText?.length ? (
              <span className="opacity-70 hidden md:inline truncate">Écran : {currentSwipe.script.screenText.join(" · ")}</span>
            ) : null}
            <span className="ml-auto flex items-center gap-2">
              <button className="btn btn-sm" onClick={() => setCurrent(null)} style={{ background: "transparent", color: "#fff", borderColor: "rgb(255 255 255 / 0.3)" }}>
                Fermer (Échap)
              </button>
              <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void markShot(currentSwipe, true)} title="Espace ou → : marque tourné et passe au suivant">
                {busy ? <span className="spinner" /> : "Suivant → (tourné)"}
              </button>
            </span>
          </div>
          <div className="flex-1 overflow-y-auto px-6 md:px-16 py-8 flex flex-col gap-8 max-w-[1100px] w-full mx-auto">
            {currentSwipe.script ? (
              <>
                <div>
                  <div className="text-[12px] uppercase tracking-wide opacity-50 mb-2">Hook</div>
                  <p className="text-[34px] md:text-[48px] font-bold leading-tight">{currentSwipe.script.hook}</p>
                </div>
                <div>
                  <div className="text-[12px] uppercase tracking-wide opacity-50 mb-2">Corps</div>
                  <ul className="flex flex-col gap-3">
                    {currentSwipe.script.bullets.map((b, i) => (
                      <li key={i} className="text-[24px] md:text-[32px] leading-snug flex gap-4">
                        <span className="opacity-40 num">{i + 1}</span>
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="text-[12px] uppercase tracking-wide opacity-50 mb-2">CTA</div>
                  <p className="text-[28px] md:text-[38px] font-semibold leading-tight" style={{ color: "#8ab4ff" }}>
                    {currentSwipe.script.cta}
                  </p>
                </div>
              </>
            ) : (
              <p className="text-[24px] opacity-70">Pas de script court sur ce swipe : génère « Mon script » dans la Swipe file.</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
