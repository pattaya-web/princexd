/*
 * Mvdy Reels — script dans la page Instagram (monde principal).
 *
 * Instagram charge son feed de Reels par des appels reseau (fetch / XHR)
 * dont les reponses JSON contiennent, pour chaque Reel, son code, son
 * createur, sa legende, ses compteurs et l'adresse de son fichier video.
 * On regarde passer ces reponses (sans rien changer) et on transmet ce
 * qu'on y trouve au script isole (content.js) par postMessage. Aucune
 * requete supplementaire vers Instagram, aucun clic simule.
 */
(() => {
  if (window.__mvdyReelsHooked) return;
  window.__mvdyReelsHooked = true;

  const SEEN = new Set();
  const MAX_DEPTH = 14;

  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

  /** Un objet « media » Instagram de type video (Reel) ? */
  function asReel(o) {
    if (!o || typeof o !== "object") return null;
    const code = typeof o.code === "string" ? o.code : typeof o.shortcode === "string" ? o.shortcode : null;
    if (!code) return null;
    const versions = Array.isArray(o.video_versions) ? o.video_versions : null;
    const videoUrl = versions && versions.length ? pickVideo(versions) : typeof o.video_url === "string" ? o.video_url : null;
    if (!videoUrl) return null;
    const user = o.user || o.owner || {};
    const captionText = o.caption && typeof o.caption === "object" ? o.caption.text : typeof o.caption === "string" ? o.caption : "";
    const thumbs = o.image_versions2 && Array.isArray(o.image_versions2.candidates) ? o.image_versions2.candidates : [];
    const thumb = thumbs.length ? thumbs[0].url : typeof o.thumbnail_url === "string" ? o.thumbnail_url : typeof o.display_url === "string" ? o.display_url : "";
    return {
      code,
      username: typeof user.username === "string" ? user.username : "",
      fullName: typeof user.full_name === "string" ? user.full_name : "",
      caption: typeof captionText === "string" ? captionText : "",
      likes: num(o.like_count),
      comments: num(o.comment_count),
      plays: num(o.play_count) ?? num(o.ig_play_count) ?? num(o.view_count),
      durationSec: num(o.video_duration),
      takenAt: num(o.taken_at),
      videoUrl,
      thumbUrl: thumb || "",
    };
  }

  /** La meilleure version lisible sans etre enorme : la plus grande largeur <= 1080. */
  function pickVideo(versions) {
    const ok = versions.filter((v) => v && typeof v.url === "string");
    if (!ok.length) return null;
    const sized = ok.filter((v) => num(v.width) !== null).sort((a, b) => b.width - a.width);
    const best = sized.find((v) => v.width <= 1080) || sized[sized.length - 1] || ok[0];
    return best.url;
  }

  function walk(node, depth, found) {
    if (!node || typeof node !== "object" || depth > MAX_DEPTH) return;
    const reel = asReel(node);
    if (reel) {
      if (!SEEN.has(reel.code)) {
        SEEN.add(reel.code);
        found.push(reel);
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const x of node) walk(x, depth + 1, found);
      return;
    }
    for (const k in node) {
      const v = node[k];
      if (v && typeof v === "object") walk(v, depth + 1, found);
    }
  }

  function scanText(text) {
    if (!text || text.length < 200 || !(text.includes("video_versions") || text.includes("video_url"))) return;
    let data;
    try {
      data = JSON.parse(text.replace(/^for\s*\(;;\);/, ""));
    } catch {
      return;
    }
    const found = [];
    walk(data, 0, found);
    if (found.length) window.postMessage({ type: "MVDY_REELS", items: found }, "*");
  }

  // 1. fetch (GraphQL et API v1).
  const origFetch = window.fetch;
  window.fetch = function (...args) {
    const p = origFetch.apply(this, args);
    try {
      const url = typeof args[0] === "string" ? args[0] : args[0] && args[0].url ? args[0].url : "";
      if (/\/api\/v1\/|\/graphql/.test(url)) {
        p.then((res) => {
          try {
            res.clone().text().then(scanText).catch(() => {});
          } catch {
            /* flux non clonable */
          }
        }).catch(() => {});
      }
    } catch {
      /* jamais bloquer Instagram */
    }
    return p;
  };

  // 2. XHR.
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    try {
      if (typeof url === "string" && /\/api\/v1\/|\/graphql/.test(url)) {
        this.addEventListener("load", () => {
          try {
            if (this.responseType === "" || this.responseType === "text") scanText(this.responseText);
          } catch {
            /* ignore */
          }
        });
      }
    } catch {
      /* ignore */
    }
    return origOpen.call(this, method, url, ...rest);
  };

  // 3. Les donnees deja dans la page au chargement (premiers Reels du feed).
  function scanInlineScripts() {
    for (const s of document.querySelectorAll('script[type="application/json"]')) {
      scanText(s.textContent || "");
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scanInlineScripts);
  else scanInlineScripts();
  new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n && n.tagName === "SCRIPT" && n.getAttribute("type") === "application/json") scanText(n.textContent || "");
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
