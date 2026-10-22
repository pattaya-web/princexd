"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client";
import { fmtDateTime, fmtUsdInEur } from "@/lib/format";
import { getModel } from "@/lib/models";
import { CopyButton, Empty, useToast } from "@/components/ui";
import { ThumbImg } from "@/components/MediaThumb";
import { nextProdStatus } from "@/lib/swipe-week";
import { SWIPE_PROD_LABEL, SWIPE_PROD_STATUSES, swipeProdStatus, type Swipe, type SwipeAnalysis, type SwipeProdStatus, type SwipeScript } from "@/lib/types";

/* eslint-disable @next/next/no-img-element */

/* ----------------------------- Statut de production ----------------------------- */

/**
 * Le pipeline Swipe file → Script prêt → Prêt à tourner → Tourné → Monté → Validation → Programmé → Publié, avec la
 * date de chaque passage. Un clic sur une etape y place le swipe (en avant
 * comme en arriere : une erreur se corrige).
 */
export function ProdStepper({ s, onChange }: { s: Swipe; onChange: (status: SwipeProdStatus, dates: Swipe["prodDates"]) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const current = swipeProdStatus(s);
  const idx = SWIPE_PROD_STATUSES.indexOf(current);
  const next = nextProdStatus(current);

  const go = async (status: SwipeProdStatus) => {
    setBusy(true);
    try {
      const r = await api<{ swipe: Swipe }>("/api/swipe/status", { method: "POST", body: JSON.stringify({ swipeId: s.id, status }) });
      onChange(status, r.swipe.prodDates);
      window.dispatchEvent(new Event("swipes:changed"));
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {SWIPE_PROD_STATUSES.map((st, i) => {
        const done = i <= idx;
        const at = s.prodDates?.[st] || (st === "source" ? s.createdAt : "");
        return (
          <button
            key={st}
            type="button"
            disabled={busy || st === current}
            onClick={() => void go(st)}
            className="h-[26px] px-2.5 rounded-full text-[11.5px] font-medium inline-flex items-center gap-1"
            title={at ? `${SWIPE_PROD_LABEL[st]} le ${fmtDateTime(at)}` : `Passer en « ${SWIPE_PROD_LABEL[st]} »`}
            style={{
              background: st === current ? "var(--accent)" : done ? "var(--accent-soft)" : "var(--surface-2)",
              color: st === current ? "var(--accent-on, #fff)" : done ? "var(--accent)" : "var(--text-2)",
              border: `1px solid ${done ? "var(--accent)" : "var(--border)"}`,
            }}
          >
            {done ? "✓ " : ""}
            {SWIPE_PROD_LABEL[st]}
          </button>
        );
      })}
      {next && (
        <button className="btn btn-sm btn-primary !h-[26px] !text-[11.5px] ml-1" disabled={busy} onClick={() => void go(next)}>
          → {SWIPE_PROD_LABEL[next]}
        </button>
      )}
    </div>
  );
}

/* --------------------------------- Badges --------------------------------- */

/** « 1 personne » / « 2 personnes qui se parlent ». */
export function SpeakersBadge({ speakers, className = "" }: { speakers?: SwipeScript["speakers"]; className?: string }) {
  if (!speakers) return null;
  const two = speakers === "dialogue";
  return (
    <span className={`badge !text-[10.5px] !py-0 ${className}`} title={two ? "Deux personnes se parlent : les lignes sont préfixées A : / B :" : "Une seule personne face caméra"}>
      {two ? "👥 2 personnes qui se parlent" : "👤 1 personne"}
    </span>
  );
}

/* ------------------------------ Prompts IA inline ------------------------------ */

const IMAGE_MODEL = "gpt-image-2-text-to-image";
const VIDEO_MODEL = "bytedance/seedance-2-5";
const VIDEO_FALLBACK = "bytedance/seedance-2";
const VIDEO_SECONDS = 6;

interface AssetRow {
  id: string;
  taskId: string;
  model: string;
  kind: "image" | "video";
  prompt: string;
  state: "waiting" | "queuing" | "generating" | "success" | "fail";
  progress: number;
  resultUrls: string[];
  creditsConsumed: number;
  failMsg: string;
  swipeSlot: string;
  createdAt: string;
}

/** Cout estime d'un prompt, en credits. */
function estimate(kind: "image" | "video"): number {
  if (kind === "image") return getModel(IMAGE_MODEL)?.approxCredits ?? 6;
  const def = getModel(VIDEO_MODEL);
  return def?.creditsPerSec ? def.creditsPerSec * VIDEO_SECONDS : (def?.approxCredits ?? 300);
}

/**
 * Chaque prompt d'image et de B-roll se genere sur place : clic, tache KIE
 * lancee, resultat sous le prompt. Images : GPT Image 2 (9:16). B-roll :
 * Seedance 2.5, 6 s, 9:16, sans son ; si KIE refuse l'identifiant, repli
 * sur Seedance 2. Les resultats restent rattaches au swipe : le monteur
 * les retrouve a cote des rushs.
 */
export function PromptsInline({ a, swipeId }: { a: SwipeAnalysis; swipeId: string }) {
  const toast = useToast();
  const [rows, setRows] = useState<AssetRow[]>([]);
  const [pending, setPending] = useState(0);
  const [launching, setLaunching] = useState<string>("");

  const refresh = useCallback(async () => {
    try {
      const r = await api<{ rows: AssetRow[]; pending: number }>(`/api/swipe/assets?swipeId=${encodeURIComponent(swipeId)}`);
      setRows(r.rows);
      setPending(r.pending);
    } catch {
      // Un sondage rate n'est pas grave : le suivant reprend.
    }
  }, [swipeId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, [pending, refresh]);

  const launch = async (kind: "image" | "video", index: number, prompt: string) => {
    const slot = `${kind}:${index}`;
    setLaunching(slot);
    const body = (model: string) => ({
      model,
      swipeId,
      swipeSlot: slot,
      input:
        kind === "image"
          ? { prompt, aspect_ratio: "9:16", resolution: "1K" }
          : { prompt, aspect_ratio: "9:16", resolution: "720p", duration: VIDEO_SECONDS, generate_audio: "false" },
    });
    try {
      try {
        await api("/api/kie/generate", { method: "POST", body: JSON.stringify(body(kind === "image" ? IMAGE_MODEL : VIDEO_MODEL)) });
      } catch (e) {
        const msg = (e as Error).message.toLowerCase();
        if (kind === "video" && (msg.includes("inconnu") || msg.includes("model") || msg.includes("not found"))) {
          await api("/api/kie/generate", { method: "POST", body: JSON.stringify(body(VIDEO_FALLBACK)) });
          toast("Seedance 2.5 refusé par KIE : lancé avec Seedance 2.");
        } else throw e;
      }
      toast(kind === "image" ? "Image en cours de génération." : "B-roll en cours de génération (1 à 3 min).");
      await refresh();
      setPending((n) => n + 1);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setLaunching("");
    }
  };

  const bySlot = useMemo(() => {
    const m = new Map<string, AssetRow[]>();
    for (const r of rows) {
      const list = m.get(r.swipeSlot) ?? [];
      list.push(r);
      m.set(r.swipeSlot, list);
    }
    return m;
  }, [rows]);

  const section = (title: string, prompts: string[], kind: "image" | "video") =>
    prompts?.length ? (
      <div>
        <div className="flex items-baseline justify-between gap-2 mb-2">
          <span className="label-xs">{title}</span>
          <span className="dim text-[11.5px]">
            {kind === "image" ? `${getModel(IMAGE_MODEL)?.name ?? "GPT Image 2"} · 9:16` : `${getModel(VIDEO_MODEL)?.name ?? "Seedance 2.5"} · ${VIDEO_SECONDS} s · 9:16`} · ≈ {estimate(kind)} crédits ({fmtUsdInEur(estimate(kind) * 0.005)}) par génération
          </span>
        </div>
        <div className="flex flex-col gap-2">
          {prompts.map((p, i) => {
            const slot = `${kind}:${i}`;
            const results = bySlot.get(slot) ?? [];
            const running = results.some((r) => r.state !== "success" && r.state !== "fail");
            return (
              <div key={i} className="card-flat p-2.5 flex flex-col gap-2">
                <p className="mono text-[12px] leading-relaxed muted">{p}</p>
                <div className="flex gap-1.5 justify-end items-center flex-wrap">
                  <CopyButton text={p} />
                  <button className="btn btn-sm btn-primary" disabled={launching === slot || running} onClick={() => void launch(kind, i, p)} title={`Lance la génération tout de suite, ≈ ${estimate(kind)} crédits`}>
                    {launching === slot ? <span className="spinner" /> : running ? "En cours…" : results.length ? "Régénérer" : "Générer"}
                    {!running && launching !== slot ? ` · ≈ ${estimate(kind)} cr.` : ""}
                  </button>
                </div>
                {results.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-1" style={{ borderTop: "1px solid var(--border)" }}>
                    {results.map((r) => (
                      <div key={r.id} className="flex flex-col gap-1 w-[120px]">
                        <div className="rounded-[8px] overflow-hidden grid place-items-center" style={{ aspectRatio: "9 / 16", background: "var(--surface-3)" }}>
                          {r.state === "success" && r.resultUrls[0] ? (
                            r.kind === "video" ? (
                              <video src={r.resultUrls[0]} controls playsInline muted className="w-full h-full object-cover" />
                            ) : (
                              <a href={r.resultUrls[0]} target="_blank" rel="noreferrer" className="block w-full h-full">
                                <ThumbImg src={r.resultUrls[0]} />
                              </a>
                            )
                          ) : r.state === "fail" ? (
                            <span className="text-[11px] px-2 text-center" style={{ color: "var(--critical)" }} title={r.failMsg}>
                              Échec{r.failMsg ? ` : ${r.failMsg.slice(0, 60)}` : ""}
                            </span>
                          ) : (
                            <span className="text-[11px] dim text-center px-2">
                              <span className="spinner block mx-auto mb-1" />
                              En cours{r.progress ? ` ${r.progress} %` : ""}
                            </span>
                          )}
                        </div>
                        <div className="dim text-[10.5px] leading-snug">
                          {r.state === "success" ? `${r.creditsConsumed || estimate(r.kind)} cr.` : r.state === "fail" ? "0 cr." : "…"}
                          {r.state === "success" && r.resultUrls[0] && (
                            <>
                              {" "}
                              ·{" "}
                              <a className="link" href={r.resultUrls[0]} target="_blank" rel="noreferrer" download>
                                ouvrir
                              </a>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    ) : null;

  return (
    <div className="flex flex-col gap-5">
      {section("Prompts image", a.imagePrompts, "image")}
      {section("Prompts vidéo (B-roll)", a.videoPrompts, "video")}
      {!a.imagePrompts?.length && !a.videoPrompts?.length && <Empty>Aucun prompt généré pour ce contenu.</Empty>}
    </div>
  );
}
