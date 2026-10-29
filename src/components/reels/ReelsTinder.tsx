"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { igEmbedUrl } from "@/components/CreatorPlayer";
import { fmtCompact, relative } from "@/lib/format";
import type { Reel, ReelDecision } from "@/lib/types";

/**
 * Le Tinder des Reels : une carte 9:16 avec la video, le createur, la
 * legende et les chiffres ; on glisse a droite (garder) ou a gauche
 * (passer), au doigt, a la souris ou au clavier. La carte suivante est
 * deja dessous et sa video prechargee : le Reel suivant apparait tout de
 * suite. Aucun formulaire : le classement se fait apres, a cote.
 */

const THRESHOLD = 110;

/** Ouvre le feed Reels dans Chrome avec le pilote automatique de l'extension (lu dans l'adresse). */
export const AUTOPILOT_URL = "https://www.instagram.com/reels/#mvdy-autopilot";

export function ReelsTinder({ queue, onDecide, onUndo, canUndo, muted, onToggleMuted, skippedRecent, onRequeue, lastCaptureAt }: { queue: Reel[]; onDecide: (reel: Reel, decision: Exclude<ReelDecision, "">) => void; onUndo: () => void; canUndo: boolean; muted: boolean; onToggleMuted: () => void; skippedRecent?: number; onRequeue?: () => void; lastCaptureAt?: string }) {
  const feeding = Boolean(lastCaptureAt) && Date.now() - Date.parse(lastCaptureAt as string) < 2 * 60_000;
  const current = queue[0] ?? null;
  const next = queue[1] ?? null;
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  const [leaving, setLeaving] = useState<{ id: string; dir: 1 | -1 } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setExpanded(false);
    setDrag(null);
  }, [current?.id]);

  const fly = useCallback(
    (dir: 1 | -1) => {
      if (!current || leaving) return;
      const reel = current;
      setLeaving({ id: reel.id, dir });
      window.setTimeout(() => {
        setLeaving(null);
        setDrag(null);
        onDecide(reel, dir === 1 ? "keep" : "skip");
      }, 220);
    },
    [current, leaving, onDecide],
  );

  // Clavier : → garder, ← passer, retour arrière / Z annuler, O Instagram, M son.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        fly(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        fly(-1);
      } else if (e.key === "Backspace" || e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (canUndo) onUndo();
      } else if (e.key.toLowerCase() === "o" && current) {
        window.open(current.url, "_blank", "noopener");
      } else if (e.key.toLowerCase() === "l" && current) {
        window.open(`${current.url}#mvdy-like`, "_blank", "noopener");
      } else if (e.key.toLowerCase() === "m") {
        onToggleMuted();
      } else if (e.key === " ") {
        e.preventDefault();
        const v = cardRef.current?.querySelector("video");
        if (v) {
          if (v.paused) void v.play().catch(() => undefined);
          else v.pause();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fly, canUndo, onUndo, current, onToggleMuted]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (leaving) return;
    const t = e.target as HTMLElement;
    if (t.closest("a, button")) return;
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!start.current || start.current.id !== e.pointerId) return;
    setDrag({ dx: e.clientX - start.current.x, dy: e.clientY - start.current.y });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!start.current || start.current.id !== e.pointerId) return;
    const dx = e.clientX - start.current.x;
    start.current = null;
    if (Math.abs(dx) > THRESHOLD) fly(dx > 0 ? 1 : -1);
    else setDrag(null);
  };

  const dx = leaving ? leaving.dir * 900 : (drag?.dx ?? 0);
  const dy = leaving ? -40 : (drag?.dy ?? 0) * 0.25;
  const rot = leaving ? leaving.dir * 25 : dx / 18;
  const keepOpacity = Math.min(1, Math.max(0, dx / THRESHOLD));
  const skipOpacity = Math.min(1, Math.max(0, -dx / THRESHOLD));
  const moving = Boolean(drag) || Boolean(leaving);

  return (
    <div className="flex flex-col items-center gap-3 select-none">
      <div className="relative" style={{ height: "min(calc(100vh - 330px), 680px)", minHeight: 420, aspectRatio: "9 / 16", margin: "0 auto" }}>
        {/* Carte suivante, dessous. */}
        {next && (
          <div className="absolute inset-0 rounded-[22px] overflow-hidden" style={{ background: "#0b0d16", transform: "scale(0.955) translateY(10px)", boxShadow: "0 10px 30px rgba(0,0,0,.25)" }}>
            {next.thumbnail ? <img src={next.thumbnail} alt="" className="w-full h-full object-cover opacity-70" draggable={false} /> : null}
          </div>
        )}
        {/* Precharge des videos qui suivent, sans les afficher. */}
        {queue.slice(1, 3).map((r) => (r.video ? <video key={r.id} src={r.video} preload="auto" muted className="hidden" /> : null))}

        {current ? (
          <div
            ref={cardRef}
            className="absolute inset-0 rounded-[22px] overflow-hidden touch-none"
            style={{
              background: "#0b0d16",
              boxShadow: "0 18px 50px rgba(0,0,0,.35)",
              transform: `translate(${dx}px, ${dy}px) rotate(${rot}deg)`,
              transition: moving && !leaving ? "none" : "transform .22s ease-out, opacity .22s",
              opacity: leaving ? 0 : 1,
              cursor: drag ? "grabbing" : "grab",
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => {
              start.current = null;
              setDrag(null);
            }}
          >
            <Player reel={current} muted={muted} onToggleMuted={onToggleMuted} />

            {/* Tampons GARDER / PASSER pendant le geste. */}
            <div className="absolute top-6 left-5 px-3 py-1.5 rounded-lg border-[3px] font-black text-[22px] tracking-wider rotate-[-14deg]" style={{ color: "#22c55e", borderColor: "#22c55e", opacity: keepOpacity, background: "rgba(0,0,0,.35)" }}>
              GARDER
            </div>
            <div className="absolute top-6 right-5 px-3 py-1.5 rounded-lg border-[3px] font-black text-[22px] tracking-wider rotate-[14deg]" style={{ color: "#ef4444", borderColor: "#ef4444", opacity: skipOpacity, background: "rgba(0,0,0,.35)" }}>
              PASSER
            </div>

            {/* Createur, legende, chiffres. */}
            <div className="absolute inset-x-0 bottom-0 p-4 pt-16 text-white" style={{ background: "linear-gradient(to top, rgba(0,0,0,.88) 0%, rgba(0,0,0,.55) 55%, transparent 100%)" }}>
              <div className="flex items-center justify-between gap-2">
                <a href={current.author ? `https://www.instagram.com/${current.author}/` : current.url} target="_blank" rel="noreferrer" className="font-semibold text-[14px] hover:underline truncate">
                  {current.author ? `@${current.author}` : "Créateur inconnu"}
                </a>
                <a href={current.url} target="_blank" rel="noreferrer" className="shrink-0 text-[12px] px-2 py-1 rounded-md" style={{ background: "rgba(255,255,255,.16)" }} title="Ouvrir le Reel sur Instagram (O)">
                  Instagram ↗
                </a>
              </div>
              {current.authorName && <div className="text-[12px] opacity-80 truncate">{current.authorName}</div>}
              {current.caption && (
                <p className={`text-[12.5px] leading-snug mt-1.5 whitespace-pre-line ${expanded ? "max-h-[40vh] overflow-y-auto" : "line-clamp-3"}`} onClick={() => setExpanded((v) => !v)} title={expanded ? "Réduire" : "Lire toute la légende"}>
                  {current.caption}
                </p>
              )}
              <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[12px] opacity-90 num">
                {current.plays !== null && <span title="Lectures">▶ {fmtCompact(current.plays)}</span>}
                {current.likes !== null && <span title="J'aime">♥ {fmtCompact(current.likes)}</span>}
                {current.comments !== null && <span title="Commentaires">💬 {fmtCompact(current.comments)}</span>}
                {current.durationSec !== null && <span title="Durée">⏱ {Math.round(current.durationSec)} s</span>}
                {current.takenAt && <span title="Publié">{relative(current.takenAt)}</span>}
              </div>
            </div>
          </div>
        ) : (
          <div className="absolute inset-0 rounded-[22px] flex items-center justify-center p-6 text-center" style={{ background: "var(--surface-2)", border: "1px dashed var(--border-strong)" }}>
            <div>
              <div className="text-[34px] mb-2">🎬</div>
              <div className="font-semibold text-[15px]">{feeding ? "Les prochains Reels arrivent…" : "Plus rien à trier."}</div>
              <p className="muted text-[13px] mt-1.5 leading-relaxed">
                {feeding ? (
                  <>Ton onglet Instagram envoie encore des Reels (dernier reçu il y a moins de 2 min). Cette page se met à jour toute seule.</>
                ) : (
                  <>Les Reels viennent de ton feed Instagram. Clique ci-dessous : Instagram s&apos;ouvre dans un onglet, l&apos;extension scrolle à ta place, et ta file se remplit en continu tant que l&apos;onglet reste ouvert.</>
                )}
              </p>
              {!feeding && (
                <a className="btn btn-primary mt-3" href={AUTOPILOT_URL} target="_blank" rel="noreferrer" title="Ouvre instagram.com/reels avec le pilote automatique de l'extension">
                  ▶ Remplir ma file (ouvre Instagram)
                </a>
              )}
              {skippedRecent && onRequeue ? (
                <button type="button" className="btn btn-sm mt-3" onClick={onRequeue} title="← = passer. Si c'était un accident, on les remet dans la file.">
                  Revoir les {skippedRecent} Reels passés aujourd&apos;hui
                </button>
              ) : null}
            </div>
          </div>
        )}
      </div>

      {/* Boutons. */}
      <div className="flex items-center gap-2.5">
        <button type="button" className="btn !rounded-full !w-[44px] !h-[44px] !p-0 text-[18px]" onClick={onUndo} disabled={!canUndo} title="Annuler le dernier choix (retour arrière)">
          ↶
        </button>
        <button type="button" className="btn !rounded-full !w-[62px] !h-[62px] !p-0 text-[26px] font-bold" style={{ color: "#ef4444", borderColor: "color-mix(in srgb, #ef4444 45%, transparent)" }} onClick={() => fly(-1)} disabled={!current} title="Passer (←)">
          ✕
        </button>
        <button type="button" className="btn !rounded-full !w-[62px] !h-[62px] !p-0 text-[26px] font-bold" style={{ color: "#22c55e", borderColor: "color-mix(in srgb, #22c55e 45%, transparent)" }} onClick={() => fly(1)} disabled={!current} title="Garder : à produire (→)">
          ✓
        </button>
        <a className={`btn !rounded-full !w-[44px] !h-[44px] !p-0 text-[18px] ${current ? "" : "pointer-events-none opacity-50"}`} style={{ color: "#e1306c", borderColor: "color-mix(in srgb, #e1306c 45%, transparent)" }} href={current ? `${current.url}#mvdy-like` : "#"} target="_blank" rel="noreferrer" title="Liker : ouvre le Reel sur Instagram et l'extension clique J'aime (L) · option « Liker depuis le tool » à activer dans l'extension">
          ♥
        </a>
        <a className={`btn !rounded-full !w-[44px] !h-[44px] !p-0 text-[16px] ${current ? "" : "pointer-events-none opacity-50"}`} href={current?.url ?? "#"} target="_blank" rel="noreferrer" title="Ouvrir sur Instagram (O)">
          ↗
        </a>
      </div>
      <div className="dim text-[11.5px] text-center">
        ← passer · → garder · retour = annuler · L = liker · O = Instagram · M = son · espace = pause · ou glisse la carte
      </div>
    </div>
  );
}

/** La video locale si l'extension l'a envoyee ; sinon l'embed Instagram, le temps du transfert. */
/**
 * Le son est actif par defaut. Si le navigateur refuse de lancer une video
 * sonore sans geste de l'utilisateur (premiere ouverture de la page), on la
 * lance muette et on affiche un bandeau « clique pour le son » : un clic
 * remet le son, et le navigateur accepte ensuite tous les Reels suivants.
 */
function Player({ reel, muted, onToggleMuted }: { reel: Reel; muted: boolean; onToggleMuted: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    setFailed(false);
    setBlocked(false);
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = 0;
    v.muted = muted;
    void v.play().catch(() => {
      if (muted || !videoRef.current) return;
      // Autoplay sonore refuse : on joue muet, le bandeau propose le son.
      videoRef.current.muted = true;
      setBlocked(true);
      void videoRef.current.play().catch(() => undefined);
    });
  }, [reel.id, muted]);

  const unblock = () => {
    const v = videoRef.current;
    if (v) {
      v.muted = false;
      void v.play().catch(() => undefined);
    }
    setBlocked(false);
    if (muted) onToggleMuted();
  };

  if (reel.video && !failed) {
    return (
      <>
        <video ref={videoRef} src={reel.video} poster={reel.thumbnail || undefined} className="absolute inset-0 w-full h-full object-cover" autoPlay loop playsInline muted={muted} onError={() => setFailed(true)} />
        {blocked ? (
          <button type="button" className="absolute top-3 right-3 h-[34px] px-3 rounded-full text-[12.5px] font-semibold text-white" style={{ background: "rgba(0,0,0,.6)" }} onClick={unblock} title="Le navigateur a lancé la vidéo sans son : clique pour l'activer">
            🔇 Clique pour le son
          </button>
        ) : (
          <button type="button" className={`absolute top-3 right-3 h-[34px] rounded-full text-white ${muted ? "px-3 text-[12.5px] font-semibold" : "w-[34px] text-[15px]"}`} style={{ background: "rgba(0,0,0,.45)" }} onClick={onToggleMuted} title={muted ? "Activer le son (M)" : "Couper le son (M)"}>
            {muted ? "🔇 Son coupé" : "🔊"}
          </button>
        )}
      </>
    );
  }
  const embed = igEmbedUrl(reel.url);
  const fresh = Date.now() - Date.parse(reel.capturedAt) < 3 * 60_000;
  return (
    <div className="absolute inset-0 flex flex-col" style={{ background: "#000" }}>
      {embed ? <iframe src={embed} className="flex-1 w-full border-0 bg-white" allow="autoplay; encrypted-media" title="Reel Instagram" /> : null}
      <div className="absolute top-3 left-3 right-3 text-[11.5px] text-white px-2.5 py-1.5 rounded-md" style={{ background: "rgba(0,0,0,.55)" }}>
        {fresh ? "Vidéo en cours de transfert depuis Chrome… (lecture Instagram en attendant)" : "Vidéo non reçue : lecture par Instagram. Si rien ne s'affiche, ouvre le Reel sur Instagram."}
      </div>
    </div>
  );
}
