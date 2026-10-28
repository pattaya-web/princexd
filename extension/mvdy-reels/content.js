/*
 * Mvdy Reels — script isole sur instagram.com.
 *
 *  1. Recoit les Reels trouves par inject.js et les passe au service worker
 *     (background.js), qui parle au tool. Un petit compteur en bas a gauche
 *     montre que la capture tourne.
 *  2. Pilote automatique (option) : sur instagram.com/reels, fait defiler
 *     les Reels tout seul, a un rythme humain, pour que la file du tool se
 *     remplisse sans qu'on scrolle a la main. Plafonne a l'heure.
 *  3. Like (option) : quand le tool ouvre un Reel avec #mvdy-like, clique
 *     une fois sur « J'aime » de la page Instagram. Un vrai like, du compte
 *     connecte, un clic dans le tool = un like.
 */
(() => {
  let badge = null;
  let sent = 0;
  let settings = { paused: false, autopilot: false, autolike: false, token: "" };

  /* ------------------------------ Badge ------------------------------ */

  function ensureBadge() {
    if (badge || !document.body) return;
    badge = document.createElement("div");
    badge.id = "mvdy-reels-badge";
    badge.style.cssText =
      "position:fixed;left:14px;bottom:14px;z-index:2147483647;font:600 12px/1 system-ui,sans-serif;" +
      "color:#fff;background:#006DBC;border-radius:999px;padding:8px 12px;box-shadow:0 4px 14px rgba(0,0,0,.25);" +
      "opacity:.92;pointer-events:none;letter-spacing:.01em";
    document.body.appendChild(badge);
    render();
  }

  function render() {
    if (!badge) return;
    const off = settings.paused || !settings.token;
    const auto = settings.autopilot && onReelsFeed() && !off;
    badge.textContent = off ? (settings.token ? "Mvdy Reels · en pause" : "Mvdy Reels · jeton manquant") : `Mvdy Reels · ${sent} envoyé${sent > 1 ? "s" : ""}${auto ? ` · pilote auto${autoStopped ? " (plafond)" : ""}` : ""}`;
    badge.style.background = off ? "#6b7280" : auto ? "#7c3aed" : "#006DBC";
  }

  /* ----------------------------- Capture ----------------------------- */

  window.addEventListener("message", (ev) => {
    if (ev.source !== window || !ev.data || ev.data.type !== "MVDY_REELS" || !Array.isArray(ev.data.items)) return;
    try {
      chrome.runtime.sendMessage({ type: "reels", items: ev.data.items }, (res) => {
        if (chrome.runtime.lastError) return;
        if (res && typeof res.sent === "number") {
          sent += res.sent;
          ensureBadge();
          render();
        }
      });
    } catch {
      /* extension rechargee : la page continue sans nous */
    }
  });

  /* ------------------------- Pilote automatique ------------------------ */

  const onReelsFeed = () => /^\/reels\/?$/.test(location.pathname);
  const HOUR_CAP = 80;
  let autoTimer = null;
  let autoStopped = false;
  const ticks = [];

  function scrollContainer() {
    // Le flux des Reels est un conteneur a defilement par crans ; on prend
    // le plus grand element defilable qui contient une video.
    let best = null;
    for (const v of document.querySelectorAll("video")) {
      let el = v.parentElement;
      while (el && el !== document.body) {
        const st = getComputedStyle(el);
        if (/(auto|scroll)/.test(st.overflowY) && el.scrollHeight > el.clientHeight + 50) {
          if (!best || el.scrollHeight > best.scrollHeight) best = el;
          break;
        }
        el = el.parentElement;
      }
    }
    return best;
  }

  function autoStep() {
    autoTimer = null;
    if (!settings.autopilot || settings.paused || !settings.token || !onReelsFeed()) {
      render();
      return;
    }
    const now = Date.now();
    while (ticks.length && now - ticks[0] > 3600_000) ticks.shift();
    if (ticks.length >= HOUR_CAP) {
      autoStopped = true;
      render();
      autoTimer = setTimeout(autoStep, 60_000);
      return;
    }
    autoStopped = false;
    const el = scrollContainer();
    if (el) el.scrollBy({ top: el.clientHeight, behavior: "smooth" });
    else window.scrollBy({ top: window.innerHeight, behavior: "smooth" });
    ticks.push(now);
    render();
    // Rythme humain : 4 a 8 secondes par Reel.
    autoTimer = setTimeout(autoStep, 4000 + Math.random() * 4000);
  }

  function syncAutopilot() {
    if (settings.autopilot && !autoTimer && onReelsFeed()) autoTimer = setTimeout(autoStep, 2500);
    if (!settings.autopilot && autoTimer) {
      clearTimeout(autoTimer);
      autoTimer = null;
    }
    render();
  }

  // Instagram est une application d'une seule page : on suit l'adresse.
  let lastPath = location.pathname;
  setInterval(() => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      syncAutopilot();
      tryLike();
    }
  }, 1000);

  /* -------------------------------- Like ------------------------------- */

  let likeDone = "";

  function likeButton() {
    // Le bouton « J'aime » : un svg avec aria-label (FR « J’aime », EN « Like »),
    // dans la zone du Reel ouvert. « Je n'aime plus » / « Unlike » = deja like.
    const svgs = [...document.querySelectorAll('svg[aria-label]')];
    const liked = svgs.find((s) => /je n.aime plus|unlike/i.test(s.getAttribute("aria-label") || ""));
    if (liked) return { already: true };
    const svg = svgs.find((s) => /^j.aime$|^like$/i.test((s.getAttribute("aria-label") || "").trim()));
    if (!svg) return null;
    const btn = svg.closest('[role="button"], button');
    return btn ? { btn } : null;
  }

  function tryLike() {
    if (!settings.autolike || location.hash !== "#mvdy-like") return;
    const code = (location.pathname.match(/\/reels?\/([A-Za-z0-9_-]+)/) || [])[1] || "";
    if (!code || likeDone === code) return;
    let tries = 0;
    const tick = () => {
      const r = likeButton();
      if (r && r.already) {
        likeDone = code;
        flash("Déjà liké ✓");
        return;
      }
      if (r && r.btn) {
        r.btn.click();
        likeDone = code;
        flash("Liké ♥");
        return;
      }
      if (++tries < 30) setTimeout(tick, 500);
      else flash("Bouton J'aime introuvable : like à la main");
    };
    setTimeout(tick, 800);
  }

  function flash(text) {
    const el = document.createElement("div");
    el.textContent = `Mvdy Reels · ${text}`;
    el.style.cssText =
      "position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:2147483647;font:600 13px/1 system-ui,sans-serif;" +
      "color:#fff;background:#006DBC;border-radius:999px;padding:10px 16px;box-shadow:0 6px 18px rgba(0,0,0,.3)";
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  /* ------------------------------ Reglages ----------------------------- */

  chrome.storage.sync.get({ paused: false, autopilot: false, autolike: false, token: "" }, (v) => {
    settings = { ...settings, ...v };
    ensureBadge();
    syncAutopilot();
    tryLike();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    for (const k of ["paused", "autopilot", "autolike", "token"]) if (changes[k]) settings[k] = changes[k].newValue;
    ensureBadge();
    syncAutopilot();
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ensureBadge);
  else ensureBadge();
})();
