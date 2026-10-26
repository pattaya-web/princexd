"use client";

import { useEffect, useRef } from "react";

/**
 * Habillage Scale X de l'espace élève : fond bleu nuit avec trois halos
 * dégradés qui dérivent lentement, et un point bleu qui suit le curseur
 * (souris seulement, pas au doigt). Posé une fois dans le Shell, sous le
 * contenu, sans jamais intercepter un clic.
 */
export function ScaleXBackdrop() {
  return (
    <div className="sx-bg" aria-hidden>
      <span className="sx-blob sx-blob-1" />
      <span className="sx-blob sx-blob-2" />
      <span className="sx-blob sx-blob-3" />
      <span className="sx-grain" />
    </div>
  );
}

export function ScaleXCursor() {
  const dot = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia("(pointer: fine)").matches) return;
    const d = dot.current;
    const r = ring.current;
    if (!d || !r) return;
    let x = window.innerWidth / 2;
    let y = window.innerHeight / 2;
    let rx = x;
    let ry = y;
    let shown = false;
    let raf = 0;
    const onMove = (e: MouseEvent) => {
      x = e.clientX;
      y = e.clientY;
      if (!shown) {
        shown = true;
        d.style.opacity = "1";
        r.style.opacity = "1";
      }
      d.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
    };
    const onLeave = () => {
      shown = false;
      d.style.opacity = "0";
      r.style.opacity = "0";
    };
    const onDown = () => d.classList.add("sx-dot-press");
    const onUp = () => d.classList.remove("sx-dot-press");
    const tick = () => {
      // L'anneau suit avec un temps de retard : c'est lui qui donne le mouvement.
      rx += (x - rx) * 0.16;
      ry += (y - ry) * 0.16;
      r.style.transform = `translate3d(${rx}px, ${ry}px, 0) translate(-50%, -50%)`;
      raf = requestAnimationFrame(tick);
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    document.documentElement.addEventListener("mouseleave", onLeave);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
      document.documentElement.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  return (
    <>
      <div ref={ring} className="sx-ring" aria-hidden />
      <div ref={dot} className="sx-dot" aria-hidden />
    </>
  );
}

/** Le logo Scale X : « Scale » en blanc, « X » en bleu, italique gras, comme le fichier de Mady. */
export function ScaleXLogo({ height = 22 }: { height?: number }) {
  return (
    <span className="inline-flex items-baseline select-none" style={{ fontStyle: "italic", fontWeight: 800, letterSpacing: "-0.04em", lineHeight: 1, fontSize: height }} aria-label="Scale X">
      <span style={{ color: "var(--text)" }}>Scale</span>
      <span style={{ color: "#1b74c9", marginLeft: height * 0.32 }}>X</span>
    </span>
  );
}
