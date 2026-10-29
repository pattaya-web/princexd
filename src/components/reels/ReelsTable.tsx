"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Empty, Modal, useToast } from "@/components/ui";
import { CopyLinkButton } from "@/components/CopyLinkButton";
import { STAGE_COLOR } from "@/components/swipe/panels";
import { api } from "@/lib/client";
import { fmtCompact, fmtDate } from "@/lib/format";
import type { KeptReel } from "@/lib/reels";
import { SWIPE_PROD_LABEL, SWIPE_PROD_STATUSES, SWIPE_STAGES, type Reel, type SwipeProdStatus, type SwipeStage } from "@/lib/types";

/**
 * « Contenus à faire » : tous les Reels gardes, avec leur etape du funnel,
 * leur statut dans la chaine de production (la meme que la Swipe file), la
 * note, et les filtres par categorie, createur, mois et statut.
 */

const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return `${MONTHS[(m || 1) - 1]} ${y}`;
};

export function ReelsTable({ rows, onChange }: { rows: KeptReel[]; onChange: (next: KeptReel) => void }) {
  const toast = useToast();
  const [stage, setStage] = useState<"" | SwipeStage | "none">("");
  const [author, setAuthor] = useState("");
  const [status, setStatus] = useState<"" | SwipeProdStatus>("");
  const [month, setMonth] = useState("");
  const [q, setQ] = useState("");
  const [playing, setPlaying] = useState<Reel | null>(null);
  const [busy, setBusy] = useState<string>("");

  const authors = useMemo(() => [...new Set(rows.map((r) => r.reel.author).filter(Boolean))].sort(), [rows]);
  const months = useMemo(() => [...new Set(rows.map((r) => (r.reel.decidedAt ?? "").slice(0, 7)).filter(Boolean))].sort().reverse(), [rows]);

  const filtered = rows.filter((r) => {
    const st = r.swipe?.etapeManuelle || r.swipe?.stageAuto || "";
    if (stage === "none" ? st !== "" : stage && st !== stage) return false;
    if (author && r.reel.author !== author) return false;
    if (status && (r.swipe?.prodStatus ?? "source") !== status) return false;
    if (month && (r.reel.decidedAt ?? "").slice(0, 7) !== month) return false;
    if (q) {
      const hay = `${r.reel.author} ${r.reel.authorName} ${r.reel.caption} ${r.swipe?.notes ?? ""}`.toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  });

  const setStageOf = async (row: KeptReel, v: SwipeStage | "") => {
    if (!row.swipe) return;
    setBusy(row.reel.id);
    try {
      await api("/api/reels", { method: "PATCH", body: JSON.stringify({ id: row.reel.id, stage: v }) });
      onChange({ ...row, swipe: { ...row.swipe, etapeManuelle: v } });
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy("");
    }
  };
  const setStatusOf = async (row: KeptReel, v: SwipeProdStatus) => {
    if (!row.swipe) return;
    setBusy(row.reel.id);
    try {
      await api("/api/swipe/status", { method: "POST", body: JSON.stringify({ swipeId: row.swipe.id, status: v }) });
      onChange({ ...row, swipe: { ...row.swipe, prodStatus: v } });
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy("");
    }
  };
  const setNoteOf = async (row: KeptReel, v: string) => {
    if (!row.swipe || (row.swipe.notes ?? "") === v) return;
    try {
      await api("/api/reels", { method: "PATCH", body: JSON.stringify({ id: row.reel.id, note: v }) });
      onChange({ ...row, swipe: { ...row.swipe, notes: v } });
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <select className="select select-sm !w-auto" value={stage} onChange={(e) => setStage(e.target.value as typeof stage)}>
          <option value="">Toutes les catégories</option>
          {SWIPE_STAGES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
          <option value="none">Sans catégorie</option>
        </select>
        <select className="select select-sm !w-auto" value={author} onChange={(e) => setAuthor(e.target.value)}>
          <option value="">Tous les créateurs</option>
          {authors.map((a) => (
            <option key={a} value={a}>
              @{a}
            </option>
          ))}
        </select>
        <select className="select select-sm !w-auto" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="">Tous les statuts</option>
          {SWIPE_PROD_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s === "source" ? "À faire" : SWIPE_PROD_LABEL[s]}
            </option>
          ))}
        </select>
        <select className="select select-sm !w-auto" value={month} onChange={(e) => setMonth(e.target.value)}>
          <option value="">Toutes les dates</option>
          {months.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
            </option>
          ))}
        </select>
        <input className="input !h-[30px] !w-[180px] !text-[12.5px]" placeholder="Rechercher…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="dim text-[12px] ml-auto num">
          {filtered.length} / {rows.length}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="card">
          <Empty>{rows.length ? "Aucun Reel ne correspond à ces filtres." : "Aucun Reel gardé pour l'instant : swipe à droite dans Découvrir."}</Empty>
        </div>
      ) : (
        <div className="card overflow-x-auto" style={{ padding: 0 }}>
          <table className="table w-full text-[13px]">
            <thead>
              <tr>
                <th className="text-left">Reel</th>
                <th className="text-left">Catégorie</th>
                <th className="text-left">Statut</th>
                <th className="text-left">Note / hook / idée</th>
                <th className="text-left whitespace-nowrap">Gardé le</th>
                <th className="text-right"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const r = row.reel;
                const st = row.swipe?.etapeManuelle || row.swipe?.stageAuto || "";
                return (
                  <tr key={r.id} className={busy === r.id ? "opacity-60" : ""}>
                    <td className="min-w-[260px]">
                      <div className="flex gap-3">
                        <button type="button" className="shrink-0 rounded-md overflow-hidden relative" style={{ width: 48, height: 84, background: "#0b0d16" }} onClick={() => setPlaying(r)} title="Voir la vidéo">
                          {r.thumbnail ? <img src={r.thumbnail} alt="" className="w-full h-full object-cover" /> : null}
                          <span className="absolute inset-0 flex items-center justify-center text-white text-[16px]" style={{ textShadow: "0 1px 4px rgba(0,0,0,.6)" }}>
                            ▶
                          </span>
                        </button>
                        <div className="min-w-0">
                          <div className="font-semibold truncate">{r.author ? `@${r.author}` : "Créateur inconnu"}</div>
                          <div className="muted text-[12px] line-clamp-2 max-w-[360px]">{r.caption || r.authorName || "—"}</div>
                          <div className="dim text-[11px] mt-0.5 num flex gap-2">
                            {r.plays !== null && <span>▶ {fmtCompact(r.plays)}</span>}
                            {r.likes !== null && <span>♥ {fmtCompact(r.likes)}</span>}
                            {r.comments !== null && <span>💬 {fmtCompact(r.comments)}</span>}
                            {row.swipe?.hasScript && <span style={{ color: "var(--good)" }}>script ✓</span>}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="flex gap-1">
                        {SWIPE_STAGES.map((s) => (
                          <button
                            key={s}
                            type="button"
                            className="px-2 py-1 rounded-md text-[11px] font-bold"
                            style={{ background: st === s ? STAGE_COLOR[s] : "var(--surface-3)", color: st === s ? "#fff" : "var(--muted)", opacity: row.swipe?.etapeManuelle === "" && row.swipe?.stageAuto === s ? 0.85 : 1 }}
                            onClick={() => void setStageOf(row, row.swipe?.etapeManuelle === s ? "" : s)}
                            title={row.swipe?.etapeManuelle ? "Classement manuel" : row.swipe?.stageAuto === s ? "Proposé par l'analyse IA" : s}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td>
                      <select className="select select-sm !w-auto" value={row.swipe?.prodStatus ?? "source"} onChange={(e) => void setStatusOf(row, e.target.value as SwipeProdStatus)} disabled={!row.swipe}>
                        {SWIPE_PROD_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s === "source" ? "À faire" : SWIPE_PROD_LABEL[s]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="min-w-[220px]">
                      <input className="input !h-[30px] !text-[12.5px] w-full" placeholder="hook, angle, idée d'adaptation…" defaultValue={row.swipe?.notes ?? ""} onBlur={(e) => void setNoteOf(row, e.target.value)} disabled={!row.swipe} />
                    </td>
                    <td className="whitespace-nowrap num dim text-[12px]">{r.decidedAt ? fmtDate(r.decidedAt) : "—"}</td>
                    <td className="text-right whitespace-nowrap">
                      <CopyLinkButton url={r.url} label="Copier" />{" "}
                      <a className="btn btn-sm" href={r.url} target="_blank" rel="noreferrer" title="Ouvrir sur Instagram (liker, commenter)">
                        Instagram ↗
                      </a>{" "}
                      {row.swipe && (
                        <Link className="btn btn-sm btn-primary" href={`/swipe?s=${row.swipe.id}`} title="La fiche dans la Swipe file : transcription, analyse, script, prompts">
                          Fiche →
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={Boolean(playing)} onClose={() => setPlaying(null)} title={playing?.author ? `@${playing.author}` : "Reel"}>
        {playing && (
          <div className="mx-auto rounded-xl overflow-hidden" style={{ width: 300, aspectRatio: "9 / 16", background: "#000" }}>
            {playing.video ? (
              <video src={playing.video} poster={playing.thumbnail || undefined} className="w-full h-full object-cover" controls autoPlay playsInline />
            ) : (
              <iframe src={`https://www.instagram.com/reel/${playing.code}/embed/`} className="w-full h-full border-0 bg-white" title="Reel Instagram" />
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
