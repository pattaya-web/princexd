/*
 * Mvdy Reels — script isole sur instagram.com.
 * Recoit les Reels trouves par inject.js et les passe au service worker
 * (background.js), qui parle au tool. Affiche un petit compteur discret en
 * bas a gauche pour que l'on voie que la capture tourne.
 */
(() => {
  let badge = null;
  let sent = 0;
  let paused = false;

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
    badge.textContent = paused ? "Mvdy Reels · en pause" : `Mvdy Reels · ${sent} envoyé${sent > 1 ? "s" : ""}`;
    badge.style.background = paused ? "#6b7280" : "#006DBC";
  }

  window.addEventListener("message", (ev) => {
    if (ev.source !== window || !ev.data || ev.data.type !== "MVDY_REELS" || !Array.isArray(ev.data.items)) return;
    try {
      chrome.runtime.sendMessage({ type: "reels", items: ev.data.items }, (res) => {
        if (chrome.runtime.lastError) return;
        if (res && typeof res.sent === "number") {
          sent += res.sent;
          paused = Boolean(res.paused);
          ensureBadge();
          render();
        }
      });
    } catch {
      /* extension rechargee : la page continue sans nous */
    }
  });

  chrome.storage.sync.get({ paused: false }, (v) => {
    paused = Boolean(v.paused);
  });
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.paused) {
      paused = Boolean(changes.paused.newValue);
      ensureBadge();
      render();
    }
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ensureBadge);
  else ensureBadge();
})();
