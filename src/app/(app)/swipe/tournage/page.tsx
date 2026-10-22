"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, useCollection } from "@/lib/client";
import { Card, Empty, PageHeader, Spinner, useToast } from "@/components/ui";
import { useWeek } from "@/components/WeekBlock";
import { NEED_LABEL, needOf, STAGE_COLOR } from "@/components/swipe/panels";
import { SWIPE_STAGES, swipeProdStatus, swipeStage, type EditJob, type Swipe, type SwipeStage } from "@/lib/types";
import { editJobFromSwipe } from "@/lib/swipe-edit-job";

/**
 * Mes prochains tournages : tout ce qui est « Prêt à tourner », trié par date
 * de tournage puis par ancienneté. Chaque fiche montre la catégorie, le hook,
 * le script, la durée, le plan de tournage (B-roll, textes écran, notes) et
 * la référence. Le prompteur plein écran se lit au téléphone comme à
 * l'ordinateur ; « Tourné » fait passer le Reel au montage.
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
        .sort((a, b) => {
          const da = a.shootAt || "9999";
          const db = b.shootAt || "9999";
          if (da !== db) return da.localeCompare(db);
          return (a.prodDates?.["a-tourner"] ?? a.createdAt).localeCompare(b.prodDates?.["a-tourner"] ?? b.createdAt);
        }),
    [rows, filter],
  );
  const currentSwipe = todo.find((s) => s.id === current) ?? null;

  const remaining = useMemo(() => {
    if (!week) return null;
    return week.progress.stages.map((s) => ({ stage: s.stage, left: Math.max(0, s.target - s.counts.tourne), ready: s.pipeline["a-tourner"] }));
  }, [week]);

  /** Tourné → le dossier monteur est créé (référence + brief) et le Reel passe au montage. */
  const markShot = async (s: Swipe, openNext: boolean) => {
    setBusy(true);
    try {
      let editJobId = s.editJobId ?? "";
      if (!editJobId) {
        const job = await api<EditJob>("/api/data/edits", { method: "POST", body: JSON.stringify(editJobFromSwipe(s)) });
        editJobId = job.id;
        await api("/api/data/swipes", { method: "PATCH", body: JSON.stringify({ id: s.id, editJobId }) });
      }
      await api("/api/swipe/status", { method: "POST", body: JSON.stringify({ swipeId: s.id, status: "tourne" }) });
      const now = new Date().toISOString();
      setRows((prev) => prev.map((x) => (x.id === s.id ? { ...x, editJobId, prodStatus: "tourne", prodDates: { ...(x.prodDates ?? {}), tourne: now } } : x)));
      window.dispatchEvent(new Event("swipes:changed"));
      if (openNext) {
        const idx = todo.findIndex((x) => x.id === s.id);
        const next = todo[idx + 1] ?? todo[idx - 1] ?? null;
        setCurrent(next && next.id !== s.id ? next.id : null);
        if (!next || next.id === s.id) toast("Tout est tourné pour ce filtre. Bien joué.");
      } else {
        toast("Envoyé au monteur : dossier créé avec le brief, le Reel passe au montage.");
      }
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

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

  const fmtDay = (d?: string) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }) : "");

  return (
    <div style={{ "--accent": "#006DBC", "--accent-hover": "#005a9c", "--accent-soft": "#e6f1fa" } as React.CSSProperties}>
      <PageHeader
        title="Mes prochains tournages"
        subtitle="Tout ce qui est prêt à tourner, dans l'ordre. Ouvre le prompteur, lis, tourne, « Envoyer au monteur » : le dossier monteur est créé et le Reel passe au montage."
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
                <span className="num text-[22px] font-semibold">{r.ready}</span>
                <span className="dim text-[12px]">prêt{r.ready > 1 ? "s" : ""} à tourner</span>
              </div>
              <div className="dim text-[12px] mt-1">
                {r.left} encore à tourner cette semaine{r.ready < r.left ? ` · il manque ${r.left - r.ready} script${r.left - r.ready > 1 ? "s" : ""}` : ""}
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
            <button key={f} type="button" className="h-[30px] px-3 rounded-full text-[12.5px] font-medium inline-flex items-center gap-1.5" onClick={() => setFilter(f)} style={{ background: active ? (color ? `color-mix(in srgb, ${color} 24%, var(--surface))` : "var(--surface)") : "var(--surface-2)", border: `1px solid ${active ? (color ?? "var(--text-2)") : "var(--border)"}`, color: active ? "var(--text)" : "var(--text-2)" }}>
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
            Rien à tourner. Dans la Swipe file, génère ton script puis « Ajouter à mon tournage ».
          </Empty>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {todo.map((s) => {
            const st = swipeStage(s);
            const sc = s.script;
            return (
              <Card key={s.id} padded={false}>
                <div className="px-4 py-3 flex items-center gap-3 flex-wrap">
                  {st && (
                    <span className="badge !text-[10.5px] !py-0 font-semibold" style={{ color: STAGE_COLOR[st] }}>
                      {st}
                    </span>
                  )}
                  <span className="text-[14px] font-semibold min-w-0 flex-1 truncate">{s.title || sc?.hook || s.url}</span>
                  {needOf(s) && <span className="badge !text-[10.5px] !py-0" style={{ color: "var(--accent)" }}>{NEED_LABEL[needOf(s) as keyof typeof NEED_LABEL]}</span>}
                  {s.shootAt && <span className="badge !text-[10.5px] !py-0">📅 {fmtDay(s.shootAt)}</span>}
                  {sc?.durationSec ? <span className="dim text-[12px]">{sc.durationSec} s</span> : null}
                  {s.assignee && <span className="dim text-[12px]">· {s.assignee}</span>}
                  <a href={s.url} target="_blank" rel="noreferrer" className="btn btn-sm btn-ghost">
                    Référence ↗
                  </a>
                  <Link href={`/swipe?s=${s.id}`} className="btn btn-sm btn-ghost">
                    Fiche
                  </Link>
                  <button className="btn btn-sm" onClick={() => setCurrent(s.id)}>
                    Prompteur
                  </button>
                  <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void markShot(s, false)} title="Je l'ai filmé : crée le dossier monteur avec le brief et passe le Reel au montage">
                    📤 Envoyer au monteur
                  </button>
                </div>
                <div className="px-4 pb-4 grid md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-4">
                  <div>
                    <div className="label-xs mb-1">Hook</div>
                    <p className="text-[14px] font-medium leading-snug">{sc?.hook || "—"}</p>
                    {sc?.bullets?.length ? (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[12.5px] dim">Script ({sc.bullets.length} lignes)</summary>
                        <ol className="mt-1.5 pl-5 list-decimal text-[13px] leading-relaxed">
                          {sc.bullets.map((b, i) => (
                            <li key={i}>{b}</li>
                          ))}
                        </ol>
                        {sc.cta && <p className="text-[13px] mt-1.5" style={{ color: "var(--accent)" }}>CTA : {sc.cta}</p>}
                      </details>
                    ) : null}
                  </div>
                  <div className="text-[12.5px]">
                    <div className="label-xs mb-1">Plan de tournage</div>
                    {sc?.broll?.length ? (
                      <ul className="list-disc pl-4 leading-relaxed">
                        {sc.broll.map((b, i) => (
                          <li key={i}>{b}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="dim">Pas d&apos;indication de B-roll.</p>
                    )}
                    {sc?.screenText?.length ? (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {sc.screenText.map((t, i) => (
                          <span key={i} className="badge !text-[10.5px]">
                            {t}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {s.shootNotes && <p className="dim mt-1.5 whitespace-pre-line">{s.shootNotes}</p>}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {currentSwipe && (
        <div className="fixed inset-0 z-50 flex flex-col" style={{ background: "#0b0f14", color: "#fff" }}>
          <div className="flex items-center gap-3 px-4 md:px-5 py-3 text-[13px] flex-wrap" style={{ borderBottom: "1px solid rgb(255 255 255 / 0.12)" }}>
            {swipeStage(currentSwipe) && (
              <span className="font-semibold" style={{ color: STAGE_COLOR[swipeStage(currentSwipe) as SwipeStage] }}>
                {swipeStage(currentSwipe)}
              </span>
            )}
            <span className="opacity-70">
              {todo.findIndex((x) => x.id === currentSwipe.id) + 1} / {todo.length}
              {currentSwipe.script?.durationSec ? ` · ${currentSwipe.script.durationSec} s` : ""}
            </span>
            {needOf(currentSwipe) && <span className="opacity-80">{NEED_LABEL[needOf(currentSwipe) as keyof typeof NEED_LABEL]}</span>}
            <a href={currentSwipe.url} target="_blank" rel="noreferrer" className="opacity-70 underline hidden md:inline">
              référence ↗
            </a>
            <span className="ml-auto flex items-center gap-2">
              <button className="btn btn-sm" onClick={() => setCurrent(null)} style={{ background: "transparent", color: "#fff", borderColor: "rgb(255 255 255 / 0.3)" }}>
                Fermer
              </button>
              <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void markShot(currentSwipe, true)} title="Espace ou → : marque tourné et passe au suivant">
                {busy ? <span className="spinner" /> : "Envoyer au monteur → suivant"}
              </button>
            </span>
          </div>
          <div className="flex-1 overflow-y-auto px-5 md:px-16 py-6 md:py-8 flex flex-col gap-7 max-w-[1100px] w-full mx-auto">
            {currentSwipe.script ? (
              <>
                <div>
                  <div className="text-[12px] uppercase tracking-wide opacity-50 mb-2">Hook</div>
                  <p className="text-[30px] md:text-[48px] font-bold leading-tight">{currentSwipe.script.hook}</p>
                </div>
                <div>
                  <div className="text-[12px] uppercase tracking-wide opacity-50 mb-2">Corps</div>
                  <ul className="flex flex-col gap-3">
                    {currentSwipe.script.bullets.map((b, i) => (
                      <li key={i} className="text-[22px] md:text-[32px] leading-snug flex gap-4">
                        <span className="opacity-40 num">{i + 1}</span>
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                {currentSwipe.script.cta && (
                  <div>
                    <div className="text-[12px] uppercase tracking-wide opacity-50 mb-2">CTA</div>
                    <p className="text-[26px] md:text-[38px] font-semibold leading-tight" style={{ color: "#8ab4ff" }}>
                      {currentSwipe.script.cta}
                    </p>
                  </div>
                )}
                {(currentSwipe.script.broll?.length || currentSwipe.script.screenText?.length || currentSwipe.shootNotes) && (
                  <div className="text-[15px] md:text-[17px] opacity-80 leading-relaxed" style={{ borderTop: "1px solid rgb(255 255 255 / 0.12)", paddingTop: 16 }}>
                    {currentSwipe.script.broll?.length ? <p>🎥 B-roll : {currentSwipe.script.broll.join(" · ")}</p> : null}
                    {currentSwipe.script.screenText?.length ? <p>📝 Écran : {currentSwipe.script.screenText.join(" · ")}</p> : null}
                    {currentSwipe.shootNotes ? <p>📌 {currentSwipe.shootNotes}</p> : null}
                  </div>
                )}
              </>
            ) : (
              <p className="text-[24px] opacity-70">Pas de script sur cette fiche : génère « Mon script » dans la Swipe file.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
