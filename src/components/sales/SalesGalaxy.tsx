"use client";

import { useEffect, useRef } from "react";

/**
 * Habillage « galaxie » du Sales Dashboard.
 *
 * Sombre : un noir profond, des étoiles qui scintillent et dérivent, des
 * étincelles filantes de temps en temps, trois nébuleuses qui respirent.
 * Clair : un blanc net, les mêmes particules mais bleutées et discrètes,
 * des halos bleus (la couleur du dashboard) qui dérivent. Le thème est relu
 * quand il change (bouton du Shell ou réglage système). Jamais un clic
 * intercepté, et plus rien ne bouge si le système demande moins de mouvement.
 */

function isDarkTheme(): boolean {
  const t = document.documentElement.getAttribute("data-theme");
  if (t === "dark") return true;
  if (t === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Appelle `cb` tout de suite puis à chaque changement de thème. */
function watchTheme(cb: (dark: boolean) => void): () => void {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const fire = () => cb(isDarkTheme());
  fire();
  const obs = new MutationObserver(fire);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  mq.addEventListener("change", fire);
  return () => {
    obs.disconnect();
    mq.removeEventListener("change", fire);
  };
}

interface Star {
  x: number;
  y: number;
  r: number;
  a: number;
  da: number;
  vx: number;
  vy: number;
  tint: 0 | 1 | 2;
}
interface Streak {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
}

const DARK_TINTS = ["255, 255, 255", "150, 205, 255", "52, 211, 153"];
const LIGHT_TINTS = ["0, 109, 188", "42, 143, 216", "16, 185, 129"];

export function SalesGalaxyBackdrop() {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let w = 0;
    let h = 0;
    let dpr = 1;
    let dark = true;
    let stars: Star[] = [];
    let streaks: Streak[] = [];
    let raf = 0;
    let nextStreak = 0;
    let mx = 0;
    let my = 0;
    let px = 0;
    let py = 0;

    const seed = () => {
      const n = Math.min(240, Math.max(90, Math.floor((w * h) / 8000)));
      stars = Array.from({ length: n }, () => {
        const r = Math.random() < 0.12 ? 1.6 + Math.random() * 1.4 : 0.5 + Math.random() * 1;
        return {
          x: Math.random() * w,
          y: Math.random() * h,
          r,
          a: 0.2 + Math.random() * 0.7,
          da: (0.002 + Math.random() * 0.008) * (Math.random() < 0.5 ? 1 : -1),
          vx: (Math.random() - 0.5) * 0.06 * r,
          vy: (Math.random() - 0.5) * 0.06 * r,
          tint: Math.random() < 0.72 ? 0 : Math.random() < 0.7 ? 1 : 2,
        };
      });
    };

    const draw = (dt: number) => {
      ctx.clearRect(0, 0, w, h);
      const tints = dark ? DARK_TINTS : LIGHT_TINTS;
      const gain = dark ? 1 : 0.72;
      // Parallaxe douce : la souris décale un peu le ciel, les grosses étoiles plus que les petites.
      px += (mx - px) * 0.04;
      py += (my - py) * 0.04;
      for (const s of stars) {
        if (!reduced) {
          s.a += s.da * dt;
          if (s.a > 0.95 || s.a < 0.12) s.da = -s.da;
          s.x += s.vx * dt;
          s.y += s.vy * dt;
          if (s.x < -4) s.x = w + 4;
          else if (s.x > w + 4) s.x = -4;
          if (s.y < -4) s.y = h + 4;
          else if (s.y > h + 4) s.y = -4;
        }
        const x = s.x + px * s.r * 6;
        const y = s.y + py * s.r * 6;
        const a = Math.max(0, Math.min(1, s.a)) * gain;
        const rgb = tints[s.tint];
        if (s.r > 1.5) {
          const g = ctx.createRadialGradient(x, y, 0, x, y, s.r * 5);
          g.addColorStop(0, `rgba(${rgb}, ${a})`);
          g.addColorStop(0.35, `rgba(${rgb}, ${a * 0.35})`);
          g.addColorStop(1, `rgba(${rgb}, 0)`);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(x, y, s.r * 5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = `rgba(${rgb}, ${a})`;
        ctx.beginPath();
        ctx.arc(x, y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      if (reduced) return;
      streaks = streaks.filter((k) => k.life < k.max);
      for (const k of streaks) {
        k.life += dt;
        k.x += k.vx * dt;
        k.y += k.vy * dt;
        const t = k.life / k.max;
        const fade = t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8;
        const len = 90 + 40 * fade;
        const norm = Math.hypot(k.vx, k.vy) || 1;
        const tx = k.x - (k.vx / norm) * len;
        const ty = k.y - (k.vy / norm) * len;
        const rgb = dark ? "255, 255, 255" : "0, 109, 188";
        const g = ctx.createLinearGradient(tx, ty, k.x, k.y);
        g.addColorStop(0, `rgba(${rgb}, 0)`);
        g.addColorStop(1, `rgba(${rgb}, ${(dark ? 0.9 : 0.55) * fade})`);
        ctx.strokeStyle = g;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(k.x, k.y);
        ctx.stroke();
        ctx.fillStyle = `rgba(${rgb}, ${fade})`;
        ctx.beginPath();
        ctx.arc(k.x, k.y, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = window.innerWidth;
      h = window.innerHeight;
      c.width = Math.floor(w * dpr);
      c.height = Math.floor(h * dpr);
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
      if (reduced) draw(0);
    };

    const spawnStreak = () => {
      const fromLeft = Math.random() < 0.5;
      const speed = 9 + Math.random() * 7;
      streaks.push({
        x: fromLeft ? -20 : Math.random() * w,
        y: fromLeft ? Math.random() * h * 0.6 : -20,
        vx: speed * (0.7 + Math.random() * 0.4),
        vy: speed * (0.35 + Math.random() * 0.35),
        life: 0,
        max: 40 + Math.random() * 30,
      });
    };

    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(3, (now - last) / 16.67);
      last = now;
      if (now > nextStreak) {
        spawnStreak();
        nextStreak = now + 2500 + Math.random() * 4500;
      }
      draw(dt);
      raf = requestAnimationFrame(loop);
    };
    const start = () => {
      if (reduced || raf) return;
      last = performance.now();
      raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    const onMove = (e: MouseEvent) => {
      mx = (e.clientX / w - 0.5) * 2;
      my = (e.clientY / h - 0.5) * 2;
    };

    const unwatch = watchTheme((d) => {
      dark = d;
      c.style.opacity = d ? "1" : "0.9";
      if (reduced) draw(0);
    });
    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("mousemove", onMove, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    start();
    return () => {
      stop();
      unwatch();
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <div className="sd-bg" aria-hidden>
      <span className="sd-nebula sd-nebula-1" />
      <span className="sd-nebula sd-nebula-2" />
      <span className="sd-nebula sd-nebula-3" />
      <canvas ref={canvas} className="sd-stars" />
    </div>
  );
}

/** Le curseur : un rond sombre qui scintille (thème sombre) ou un point bleu lumineux (clair), et un anneau qui suit avec retard. */
export function SalesCursor() {
  const dot = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches) return;
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
    const onDown = () => d.classList.add("sd-dot-press");
    const onUp = () => d.classList.remove("sd-dot-press");
    const tick = () => {
      rx += (x - rx) * 0.18;
      ry += (y - ry) * 0.18;
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
      <div ref={ring} className="sd-ring" aria-hidden />
      <div ref={dot} className="sd-dot" aria-hidden />
    </>
  );
}
