"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ExtensionSetup } from "@/components/reels/ExtensionSetup";
import { ReelsTable } from "@/components/reels/ReelsTable";
import { AUTOPILOT_URL, ReelsTinder } from "@/components/reels/ReelsTinder";
import { STAGE_COLOR } from "@/components/swipe/panels";
import { ErrorNote, PageHeader, Spinner, Tabs, useToast } from "@/components/ui";
import { api, useLocalState } from "@/lib/client";
import type { KeptReel, ReelStats } from "@/lib/reels";
import type { ReelsPayload } from "@/app/api/reels/route";
import { SWIPE_STAGES, type Reel, type ReelDecision, type SwipeStage } from "@/lib/types";

/**
 * Tinder des Reels (/swipe/reels) : les Reels de mon feed Instagram,
 * captures par l'extension Chrome, a trier d'un geste. Droite = dans mes
 * contenus a faire (un swipe est cree sur-le-champ, classement apres),
 * gauche = passe. Onglets : Decouvrir, Contenus a faire, Extension.
 */

type Tab = "discover" | "kept" | "extension";
type History = { reel: Reel; decision: Exclude<ReelDecision, "">; swipeId?: string };

/** Accent bleu #006DBC, comme la Swipe file. */
const BLUE: React.CSSProperties & Record<string, string> = { "--accent": "#006DBC", "--accent-soft": "rgba(0, 109, 188, 0.12)" };

export default function ReelsPage() {
  const toast = useToast();
  const [tab, setTab] = useLocalState<Tab>("reels.tab", "discover");
  const [muted, setMuted] = useLocalState<boolean>("reels.muted", true);
  const [queue, setQueue] = useState<Reel[]>([]);
  const [kept, setKept] = useState<KeptReel[]>([]);
  const [stats, setStats] = useState<ReelStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<History[]>([]);
  const [session, setSession] = useState<{ seen: number; kept: number }>({ seen: 0, kept: 0 });
  /** Reels arrives du feed depuis l'ouverture de la page (affiche dans le compteur). */
  const [freshCount, setFreshCount] = useState(0);
  const [last, setLast] = useState<{ reel: Reel; swipeId: string; stage: SwipeStage | ""; note: string } | null>(null);
  const noteTimer = useRef<number | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const r = await api<ReelsPayload>("/api/reels");
      setStats(r.stats);
      setKept(r.kept);
      // On ne bouscule pas la carte en cours, mais les nouveaux Reels passent juste derriere elle :
      // ce qui vient d'arriver du feed se trie en premier, pas apres tout le reste.
      setQueue((cur) => {
        if (!cur.length) return r.queue;
        const have = new Set(cur.map((x) => x.id));
        const fresh = r.queue.filter((x) => !have.has(x.id));
        const byId = new Map(r.queue.map((x) => [x.id, x]));
        // Les videos arrivees entre-temps remplacent les fiches sans video.
        const refreshed = cur.map((x) => byId.get(x.id) ?? x).filter((x) => byId.has(x.id) || !x.decision);
        if (!fresh.length) return refreshed;
        setFreshCount((n) => n + fresh.length);
        return [refreshed[0], ...fresh, ...refreshed.slice(1)];
      });
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  // Le feed se remplit pendant que l'extension tourne : synchro toutes les 5 s, et des que l'onglet revient au premier plan.
  useEffect(() => {
    const t = window.setInterval(() => void load(true), 5_000);
    const onVisible = () => document.visibilityState === "visible" && void load(true);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [load]);

  const decide = useCallback(
    async (reel: Reel, decision: Exclude<ReelDecision, "">) => {
      setQueue((q) => q.filter((x) => x.id !== reel.id));
      setSession((s) => ({ seen: s.seen + 1, kept: s.kept + (decision === "keep" ? 1 : 0) }));
      setHistory((h) => [...h.slice(-30), { reel, decision }]);
      try {
        const r = await api<{ reel: Reel; swipe: { id: string; etapeManuelle?: SwipeStage | ""; notes?: string } | null }>("/api/reels/decide", { method: "POST", body: JSON.stringify({ id: reel.id, decision }) });
        if (decision === "keep" && r.swipe) {
          const swipeId = r.swipe.id;
          setHistory((h) => h.map((x) => (x.reel.id === reel.id ? { ...x, swipeId } : x)));
          setLast({ reel: r.reel, swipeId, stage: r.swipe.etapeManuelle ?? "", note: r.swipe.notes ?? "" });
          setStats((s) => (s ? { ...s, kept: s.kept + 1, keptToday: s.keptToday + 1, queue: Math.max(0, s.queue - 1) } : s));
          setKept((k) => [{ reel: r.reel, swipe: { id: swipeId, prodStatus: "source", etapeManuelle: r.swipe?.etapeManuelle ?? "", notes: r.swipe?.notes ?? "", hasScript: false, hasAnalysis: false, stageAuto: "" } }, ...k.filter((x) => x.reel.id !== reel.id)]);
        } else {
          setStats((s) => (s ? { ...s, skipped: s.skipped + 1, queue: Math.max(0, s.queue - 1) } : s));
        }
      } catch (e) {
        toast(`Choix non enregistré : ${(e as Error).message}`, "err");
        setQueue((q) => [reel, ...q]);
        setHistory((h) => h.filter((x) => x.reel.id !== reel.id));
      }
    },
    [toast],
  );

  const undo = useCallback(async () => {
    const lastMove = history[history.length - 1];
    if (!lastMove) return;
    setHistory((h) => h.slice(0, -1));
    setQueue((q) => [{ ...lastMove.reel, decision: "" }, ...q.filter((x) => x.id !== lastMove.reel.id)]);
    setSession((s) => ({ seen: Math.max(0, s.seen - 1), kept: Math.max(0, s.kept - (lastMove.decision === "keep" ? 1 : 0)) }));
    if (last?.reel.id === lastMove.reel.id) setLast(null);
    if (lastMove.decision === "keep") setKept((k) => k.filter((x) => x.reel.id !== lastMove.reel.id));
    try {
      await api("/api/reels/decide", { method: "POST", body: JSON.stringify({ id: lastMove.reel.id, decision: "" }) });
      void load(true);
    } catch (e) {
      toast((e as Error).message, "err");
    }
  }, [history, last, load, toast]);

  const annotate = (patch: { stage?: SwipeStage | ""; note?: string }, immediate = true) => {
    if (!last) return;
    const nextLast = { ...last, ...(patch.stage !== undefined ? { stage: patch.stage } : {}), ...(patch.note !== undefined ? { note: patch.note } : {}) };
    setLast(nextLast);
    const send = async () => {
      try {
        await api("/api/reels", { method: "PATCH", body: JSON.stringify({ id: nextLast.reel.id, ...patch }) });
        setKept((k) => k.map((x) => (x.reel.id === nextLast.reel.id && x.swipe ? { ...x, swipe: { ...x.swipe, ...(patch.stage !== undefined ? { etapeManuelle: patch.stage } : {}), ...(patch.note !== undefined ? { notes: patch.note } : {}) } } : x)));
      } catch (e) {
        toast((e as Error).message, "err");
      }
    };
    if (immediate) void send();
    else {
      if (noteTimer.current) window.clearTimeout(noteTimer.current);
      noteTimer.current = window.setTimeout(() => void send(), 600);
    }
  };

  const onKeptChange = (next: KeptReel) => setKept((k) => k.map((x) => (x.reel.id === next.reel.id ? next : x)));

  return (
    <div style={BLUE}>
      <PageHeader
        title="Tinder des Reels"
        subtitle="Ton feed Instagram, à trier d'un geste : → à produire, ← passer. Le Reel gardé entre tout de suite dans tes contenus à faire."
        actions={
          <div className="flex items-center gap-2">
            <a className="btn btn-sm btn-primary" href={AUTOPILOT_URL} target="_blank" rel="noreferrer" title="Ouvre instagram.com/reels dans un onglet : l'extension scrolle à ta place et remplit la file tant que l'onglet est ouvert">
              ▶ Remplir ma file
            </a>
            <button type="button" className="btn btn-sm" onClick={() => void load(true)} title="Recharger la file maintenant (sinon toutes les 5 s)">
              ↻ Actualiser
            </button>
            <Tabs
              value={tab}
              onChange={setTab}
              options={[
                { value: "discover", label: "Découvrir", count: queue.length },
                { value: "kept", label: "Contenus à faire", count: kept.length },
                { value: "extension", label: "Extension" },
              ]}
            />
          </div>
        }
      />
      {error && (
        <div className="mb-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      {loading && !stats && <Spinner label="Chargement des Reels…" />}

      {tab === "discover" && stats && (
        <div className="grid lg:grid-cols-[minmax(0,1fr)_300px] gap-5 items-start">
          <div>
            {stats.queue === 0 && stats.kept === 0 && stats.skipped === 0 && !stats.lastCaptureAt ? (
              <div className="card p-5 mb-4 text-[13.5px] leading-relaxed">
                <div className="font-semibold text-[15px] mb-1">Première fois ? Installe l&apos;extension Chrome.</div>
                Elle envoie ici les Reels de ton feed pendant que tu scrolles.{" "}
                <button type="button" className="underline" onClick={() => setTab("extension")}>
                  Voir comment (2 minutes)
                </button>
                .
              </div>
            ) : null}
            <ReelsTinder
              queue={queue}
              onDecide={decide}
              onUndo={undo}
              canUndo={history.length > 0}
              muted={muted}
              onToggleMuted={() => setMuted(!muted)}
              skippedRecent={stats.skippedRecent}
              lastCaptureAt={stats.lastCaptureAt}
              onRequeue={() => {
                api<{ requeued: number }>("/api/reels/decide", { method: "POST", body: JSON.stringify({ action: "requeue-recent" }) })
                  .then((r) => {
                    toast(`${r.requeued} Reel${r.requeued > 1 ? "s" : ""} remis dans la file.`);
                    setHistory([]);
                    void load(true);
                  })
                  .catch((e: Error) => toast(e.message, "err"));
              }}
            />
          </div>

          <aside className="flex flex-col gap-3 lg:sticky lg:top-4">
            <div className="card p-4">
              <div className="grid grid-cols-3 gap-2 text-center">
                <Stat label="À trier" value={queue.length} sub={freshCount ? `+${freshCount} arrivés` : undefined} />
                <Stat label="Vus (session)" value={session.seen} />
                <Stat label="Gardés (session)" value={session.kept} color="var(--good)" />
              </div>
              <div className="dim text-[11.5px] mt-2.5 text-center">
                {stats.lastCaptureAt ? `Dernier Reel reçu ${new Date(stats.lastCaptureAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : "Aucun Reel reçu pour l'instant"} · {stats.keptToday} gardé{stats.keptToday > 1 ? "s" : ""} aujourd&apos;hui
              </div>
            </div>

            <div className="card p-4">
              <div className="label-xs mb-2">Dernier gardé : classe-le (facultatif)</div>
              {last ? (
                <>
                  <div className="flex gap-2.5 items-start">
                    <div className="shrink-0 rounded-md overflow-hidden" style={{ width: 40, height: 70, background: "#0b0d16" }}>
                      {last.reel.thumbnail ? <img src={last.reel.thumbnail} alt="" className="w-full h-full object-cover" /> : null}
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold text-[13px] truncate">{last.reel.author ? `@${last.reel.author}` : "Créateur inconnu"}</div>
                      <div className="muted text-[11.5px] line-clamp-2">{last.reel.caption || last.reel.authorName}</div>
                    </div>
                  </div>
                  <div className="flex gap-1.5 mt-3">
                    {SWIPE_STAGES.map((s) => (
                      <button key={s} type="button" className="flex-1 py-1.5 rounded-md text-[11.5px] font-bold" style={{ background: last.stage === s ? STAGE_COLOR[s] : "var(--surface-3)", color: last.stage === s ? "#fff" : "var(--muted)" }} onClick={() => annotate({ stage: last.stage === s ? "" : s })}>
                        {s}
                      </button>
                    ))}
                  </div>
                  <textarea className="input mt-2 !h-auto !py-2 text-[12.5px] w-full" rows={3} placeholder="Note, hook, idée d'adaptation…" value={last.note} onChange={(e) => annotate({ note: e.target.value }, false)} />
                  <div className="flex items-center justify-between mt-2">
                    <Link href={`/swipe?s=${last.swipeId}`} className="text-[12px] underline">
                      Ouvrir la fiche →
                    </Link>
                    <a href={last.reel.url} target="_blank" rel="noreferrer" className="text-[12px] underline">
                      Instagram ↗
                    </a>
                  </div>
                </>
              ) : (
                <p className="dim text-[12.5px] leading-relaxed">Swipe à droite : le Reel est enregistré tout de suite dans « Contenus à faire ». Tu pourras lui donner ici sa catégorie TOFU / MOFU / BOFU et une note, sans arrêter le tri.</p>
              )}
            </div>

            {history.length > 0 && (
              <div className="card p-4">
                <div className="label-xs mb-2">Cette session</div>
                <div className="flex flex-wrap gap-1.5">
                  {[...history].reverse().slice(0, 24).map((h) => (
                    <div key={h.reel.id} className="rounded-md overflow-hidden relative" style={{ width: 30, height: 52, background: "#0b0d16", outline: `2px solid ${h.decision === "keep" ? "#22c55e" : "#ef4444"}` }} title={`${h.decision === "keep" ? "Gardé" : "Passé"} · @${h.reel.author}`}>
                      {h.reel.thumbnail ? <img src={h.reel.thumbnail} alt="" className="w-full h-full object-cover" style={{ opacity: h.decision === "keep" ? 1 : 0.45 }} /> : null}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </aside>
        </div>
      )}

      {tab === "kept" && <ReelsTable rows={kept} onChange={onKeptChange} />}
      {tab === "extension" && <ExtensionSetup stats={stats} />}
    </div>
  );
}

function Stat({ label, value, color, sub }: { label: string; value: number; color?: string; sub?: string }) {
  return (
    <div>
      <div className="text-[22px] font-semibold num leading-none" style={{ color }}>
        {value}
      </div>
      <div className="label-xs mt-1">{label}</div>
      {sub && (
        <div className="text-[11px] font-semibold mt-0.5" style={{ color: "var(--good)" }}>
          {sub}
        </div>
      )}
    </div>
  );
}
