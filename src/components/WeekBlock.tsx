"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { Card, useToast } from "@/components/ui";
import { ThumbImg, VideoThumb } from "@/components/MediaThumb";
import { WEEK_STEPS, WEEK_STEP_LABEL, type WeekProgress } from "@/lib/swipe-week";
import type { ToEditRow } from "@/app/api/swipe/week/route";
import type { SwipeStage } from "@/lib/types";
import { SpeakersBadge } from "@/components/SwipeProduction";

/* eslint-disable @next/next/no-img-element */

export const STAGE_COLOR: Record<SwipeStage, string> = { TOFU: "#006DBC", MOFU: "#a855f7", BOFU: "#16a34a" };

interface Payload {
  progress: WeekProgress;
  toEdit: ToEditRow[];
}

/** Lecture partagee du bloc, rafraichie a l'ouverture et toutes les 60 s. */
export function useWeek(every = 60_000) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setData(await api<Payload>("/api/swipe/week"));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void reload();
    const t = setInterval(() => void reload(), every);
    const onChange = () => void reload();
    window.addEventListener("swipes:changed", onChange);
    return () => {
      clearInterval(t);
      window.removeEventListener("swipes:changed", onChange);
    };
  }, [reload, every]);
  return { data, error, reload };
}

function Bar({ n, target, color }: { n: number; target: number; color: string }) {
  const pct = target > 0 ? Math.min(100, Math.round((n / target) * 100)) : 0;
  return (
    <div className="h-[5px] rounded-full overflow-hidden" style={{ background: "var(--surface-3)" }}>
      <div className="h-full rounded-full transition-[width]" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

/**
 * « Semaine en cours » : le meme bloc partout (Dashboard, Swipe file,
 * Content, Production, Espace monteur). Par etape du funnel : source /
 * scripte / tourne / monte / publie en X/objectif avec barre, puis ce qu'il
 * reste a faire aujourd'hui. Cote monteur, la liste des Reels tournes a
 * monter, avec script, texte ecran, duree, rushs et assets IA.
 */
export function WeekBlock({ variant = "full", editor = false }: { variant?: "full" | "compact"; editor?: boolean }) {
  const { data, error, reload } = useWeek();
  const toast = useToast();
  const [busy, setBusy] = useState("");
  if (error) return null;
  if (!data) return null;
  const p = data.progress;
  const total = p.stages.reduce((a, s) => a + s.target, 0);
  const published = p.stages.reduce((a, s) => a + s.counts.publie, 0);
  const steps = variant === "compact" ? (["scripte", "tourne", "monte", "publie"] as const) : WEEK_STEPS;

  const markEdited = async (row: ToEditRow) => {
    setBusy(row.id);
    try {
      await api("/api/swipe/status", { method: "POST", body: JSON.stringify({ swipeId: row.id, status: "monte" }) });
      toast(`« ${row.title.slice(0, 40)} » marqué monté.`);
      window.dispatchEvent(new Event("swipes:changed"));
      void reload();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy("");
    }
  };

  return (
    <Card
      title="Semaine en cours"
      subtitle={`Semaine du ${p.bounds.monday.split("-").reverse().join("/")} · ${published}/${total} Reels publiés${p.todayLabel ? ` · aujourd'hui : ${p.todayLabel}` : published >= total && total > 0 ? " · objectif atteint ✓" : ""}`}
      className="mb-4"
      padded={false}
      actions={
        !editor ? (
          <Link href="/swipe/tournage" className="btn btn-sm" title="Tout ce qui est prêt à tourner, en mode prompteur">
            🎬 Mes tournages
          </Link>
        ) : undefined
      }
    >
      <div className="scroll-x">
        <table className="table">
          <thead>
            <tr>
              <th>Étape</th>
              {steps.map((st) => (
                <th key={st} className="text-right">
                  {WEEK_STEP_LABEL[st]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {p.stages.map((s) => (
              <tr key={s.stage}>
                <td>
                  <span className="inline-flex items-center gap-1.5 font-semibold text-[12.5px]" style={{ color: STAGE_COLOR[s.stage] }}>
                    <span className="w-2 h-2 rounded-full" style={{ background: STAGE_COLOR[s.stage] }} />
                    {s.stage}
                  </span>
                  <span className="dim text-[11px] ml-1.5">objectif {s.target}</span>
                </td>
                {steps.map((st) => (
                  <td key={st} className="text-right min-w-[84px]">
                    <div className="num text-[12.5px] font-medium">
                      {s.counts[st]}
                      <span className="dim">/{s.target}</span>
                    </div>
                    <Bar n={s.counts[st]} target={s.target} color={STAGE_COLOR[s.stage]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {p.totals && p.readyByStage && (
        <div className="px-4 py-2 text-[12px] flex flex-wrap gap-x-3 gap-y-1 dim" style={{ borderTop: "1px solid var(--border)" }}>
          <span>
            Prêts à tourner : <strong style={{ color: STAGE_COLOR.TOFU }}>{p.readyByStage.TOFU} TOFU</strong> · <strong style={{ color: STAGE_COLOR.MOFU }}>{p.readyByStage.MOFU} MOFU</strong> · <strong style={{ color: STAGE_COLOR.BOFU }}>{p.readyByStage.BOFU} BOFU</strong>
          </span>
          <span>· {p.totals.scripte} script{p.totals.scripte > 1 ? "s" : ""} prêt{p.totals.scripte > 1 ? "s" : ""}</span>
          <span>· {p.totals.tourne} montage{p.totals.tourne > 1 ? "s" : ""} en attente</span>
          <span>· {p.totals.validation} en validation</span>
          <span>· {p.totals.programme} programmé{p.totals.programme > 1 ? "s" : ""}</span>
          <span>· {p.totals.publie} publié{p.totals.publie > 1 ? "s" : ""}</span>
        </div>
      )}
      {(p.todayLabel || p.unclassified > 0) && (
        <div className="px-4 py-2.5 text-[12.5px] flex flex-wrap gap-x-4 gap-y-1" style={{ borderTop: "1px solid var(--border)" }}>
          {p.todayLabel && (
            <span>
              <span className="font-medium">Aujourd&apos;hui pour tenir la cadence :</span> {p.todayLabel}
            </span>
          )}
          {p.unclassified > 0 && !editor && (
            <span className="dim">
              {p.unclassified} swipe{p.unclassified > 1 ? "s" : ""} sans étape, hors objectifs ·{" "}
              <Link href="/swipe" className="link">
                classer
              </Link>
            </span>
          )}
        </div>
      )}

      {editor && (
        <div style={{ borderTop: "1px solid var(--border)" }}>
          <div className="px-4 pt-3 pb-1.5 flex items-baseline gap-2">
            <span className="text-[13px] font-semibold">Reels tournés, à monter</span>
            <span className="dim text-[12px]">{data.toEdit.length ? `${data.toEdit.length} en attente` : "rien pour l'instant"}</span>
          </div>
          {data.toEdit.length > 0 && (
            <ul>
              {data.toEdit.map((row) => (
                <li key={row.id} className="px-4 py-3 flex flex-col gap-2" style={{ borderTop: "1px solid var(--border)" }}>
                  <div className="flex items-center gap-2 flex-wrap">
                    {row.stage && (
                      <span className="badge !text-[10.5px] !py-0 font-semibold" style={{ color: STAGE_COLOR[row.stage] }}>
                        {row.stage}
                      </span>
                    )}
                    <span className="text-[13.5px] font-semibold">{row.script?.hook || row.title}</span>
                    {row.script?.durationSec ? <span className="dim text-[12px]">· {row.script.durationSec} s</span> : null}
                    <SpeakersBadge speakers={row.script?.speakers} />
                    <span className="ml-auto flex items-center gap-1.5">
                      {row.editJobId ? (
                        <Link href="/monteur" className="btn btn-sm" title={`Dossier « ${row.editJobTitle} »`}>
                          📁 Rushs
                        </Link>
                      ) : (
                        <span className="dim text-[11.5px]">pas encore de dossier de rushs</span>
                      )}
                      <button className="btn btn-sm btn-primary" disabled={busy === row.id} onClick={() => void markEdited(row)}>
                        ✓ Monté
                      </button>
                    </span>
                  </div>
                  {row.script?.bullets?.length ? (
                    <ul className="text-[12.5px] leading-relaxed list-disc pl-5">
                      {row.script.bullets.map((b, i) => (
                        <li key={i}>{b}</li>
                      ))}
                    </ul>
                  ) : null}
                  {row.script?.cta && <div className="text-[12.5px]">CTA : {row.script.cta}</div>}
                  {row.script?.screenText?.length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {row.script.screenText.map((t, i) => (
                        <span key={i} className="badge !text-[10.5px]">
                          {t}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {row.assets.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {row.assets.map((a) => (
                        <a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="block w-[64px] h-[96px] rounded-[6px] overflow-hidden" title={`${a.kind === "video" ? "B-roll IA" : "Image IA"} · ${a.prompt.slice(0, 80)}`} style={{ background: "var(--surface-3)" }}>
                          {a.kind === "video" ? <VideoThumb src={a.url} /> : <ThumbImg src={a.url} />}
                        </a>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
