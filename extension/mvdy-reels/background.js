/*
 * Mvdy Reels — service worker.
 *
 * Recoit les Reels captures sur instagram.com, les declare au tool
 * (POST /api/reels/ingest), puis envoie pour chaque nouveau Reel le fichier
 * video et la vignette (PUT /api/reels/ingest?id=&kind=). Les adresses
 * video du CDN Instagram sont signees et valables quelques heures : on les
 * recupere tout de suite, depuis le navigateur de l'utilisatrice, la ou
 * Instagram repond. Le tool, lui, ne contacte jamais Instagram.
 */

const DEFAULTS = { baseUrl: "https://mvdyprince.fr", token: "", paused: false };
const MAX_VIDEO = 120 * 1024 * 1024;
/** Codes deja traites (toutes sessions) : pour ne pas redeclarer 300 fois le meme Reel. */
const KNOWN_MAX = 3000;

let known = null;
let queue = [];
let running = false;
const stats = { declared: 0, uploaded: 0, errors: 0, lastError: "", lastAt: "" };

async function settings() {
  return new Promise((resolve) => chrome.storage.sync.get(DEFAULTS, (v) => resolve({ ...DEFAULTS, ...v })));
}

async function loadKnown() {
  if (known) return known;
  const v = await new Promise((resolve) => chrome.storage.local.get({ known: [] }, resolve));
  known = new Set(Array.isArray(v.known) ? v.known : []);
  return known;
}

async function saveKnown() {
  if (!known) return;
  const arr = [...known];
  const trimmed = arr.length > KNOWN_MAX ? arr.slice(arr.length - KNOWN_MAX) : arr;
  known = new Set(trimmed);
  await new Promise((resolve) => chrome.storage.local.set({ known: trimmed }, resolve));
}

function saveStats() {
  chrome.storage.local.set({ stats: { ...stats } });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "reels") return false;
  (async () => {
    const s = await settings();
    if (s.paused || !s.token) {
      sendResponse({ sent: 0, paused: s.paused || !s.token });
      return;
    }
    const k = await loadKnown();
    const fresh = msg.items.filter((it) => it && typeof it.code === "string" && !k.has(it.code));
    for (const it of fresh) k.add(it.code);
    if (fresh.length) {
      queue.push(...fresh);
      void saveKnown();
      void pump();
    }
    sendResponse({ sent: fresh.length, paused: false });
  })();
  return true;
});

/** Traite la file par paquets : une declaration, puis les fichiers un par un. */
async function pump() {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      const batch = queue.splice(0, 20);
      const s = await settings();
      if (!s.token) break;
      let results;
      try {
        results = await declare(s, batch);
      } catch (e) {
        stats.errors++;
        stats.lastError = String((e && e.message) || e);
        saveStats();
        // Jeton faux ou tool injoignable : on oublie ces codes pour les retenter plus tard.
        for (const it of batch) known && known.delete(it.code);
        await saveKnown();
        break;
      }
      const byCode = new Map(batch.map((it) => [it.code, it]));
      for (const r of results) {
        const it = byCode.get(r.code);
        if (!it) continue;
        if (!r.known) stats.declared++;
        if (r.needThumb && it.thumbUrl) await upload(s, r.id, "thumb", it.thumbUrl, 4 * 1024 * 1024);
        if (r.needVideo && it.videoUrl) await upload(s, r.id, "video", it.videoUrl, MAX_VIDEO);
      }
      stats.lastAt = new Date().toISOString();
      saveStats();
    }
  } finally {
    running = false;
  }
}

async function declare(s, items) {
  const res = await fetch(`${s.baseUrl.replace(/\/+$/, "")}/api/reels/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.token}` },
    body: JSON.stringify({
      items: items.map((it) => ({
        code: it.code,
        username: it.username,
        fullName: it.fullName,
        caption: it.caption,
        likes: it.likes,
        comments: it.comments,
        plays: it.plays,
        durationSec: it.durationSec,
        takenAt: it.takenAt,
      })),
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Erreur ${res.status}`);
  return Array.isArray(body.results) ? body.results : [];
}

async function upload(s, id, kind, url, max) {
  try {
    const src = await fetch(url, { credentials: "omit" });
    if (!src.ok) throw new Error(`CDN ${src.status}`);
    const blob = await src.blob();
    if (blob.size > max) throw new Error("fichier trop lourd");
    const res = await fetch(`${s.baseUrl.replace(/\/+$/, "")}/api/reels/ingest?id=${encodeURIComponent(id)}&kind=${kind}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${s.token}`, "Content-Type": kind === "video" ? "video/mp4" : "image/jpeg" },
      body: blob,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Erreur ${res.status}`);
    }
    if (kind === "video") stats.uploaded++;
  } catch (e) {
    stats.errors++;
    stats.lastError = `${kind} : ${String((e && e.message) || e)}`;
  }
}

/** Le popup demande l'etat ou un test de connexion. */
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "status") return false;
  sendResponse({ ...stats, pending: queue.length, running });
  return false;
});
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "test") return false;
  (async () => {
    const s = await settings();
    try {
      const res = await fetch(`${s.baseUrl.replace(/\/+$/, "")}/api/reels/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.token}` },
        body: JSON.stringify({ items: [] }),
      });
      const body = await res.json().catch(() => ({}));
      sendResponse(res.ok ? { ok: true } : { ok: false, error: body.error || `Erreur ${res.status}` });
    } catch (e) {
      sendResponse({ ok: false, error: "Tool injoignable : vérifie l'adresse." });
    }
  })();
  return true;
});
