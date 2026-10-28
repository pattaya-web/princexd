const $ = (id) => document.getElementById(id);
const DEFAULTS = { baseUrl: "https://mvdyprince.fr", token: "", paused: false };

function setStatus(text, cls) {
  const el = $("status");
  el.textContent = text;
  el.className = `status ${cls || ""}`;
}

function refresh() {
  chrome.runtime.sendMessage({ type: "status" }, (st) => {
    if (chrome.runtime.lastError || !st) return;
    const lines = [`Reels déclarés : ${st.declared} · vidéos envoyées : ${st.uploaded}`];
    if (st.pending || st.running) lines.push(`En cours : ${st.pending} en attente`);
    if (st.lastAt) lines.push(`Dernier envoi : ${new Date(st.lastAt).toLocaleTimeString("fr-FR")}`);
    if (st.lastError) lines.push(`Dernière erreur : ${st.lastError}`);
    setStatus(lines.join("\n"), st.lastError ? "err" : "");
  });
}

chrome.storage.sync.get(DEFAULTS, (v) => {
  $("baseUrl").value = v.baseUrl || DEFAULTS.baseUrl;
  $("token").value = v.token || "";
  $("paused").checked = Boolean(v.paused);
  if (!v.token) setStatus("Colle le jeton du tool, puis Enregistrer.", "err");
  else refresh();
});

$("save").addEventListener("click", () => {
  const baseUrl = ($("baseUrl").value || DEFAULTS.baseUrl).trim().replace(/\/+$/, "");
  const token = $("token").value.trim();
  chrome.storage.sync.set({ baseUrl, token }, () => {
    setStatus("Enregistré.", "ok");
    setTimeout(refresh, 400);
  });
});

$("test").addEventListener("click", () => {
  const baseUrl = ($("baseUrl").value || DEFAULTS.baseUrl).trim().replace(/\/+$/, "");
  const token = $("token").value.trim();
  chrome.storage.sync.set({ baseUrl, token }, () => {
    setStatus("Test…");
    chrome.runtime.sendMessage({ type: "test" }, (r) => {
      if (chrome.runtime.lastError || !r) return setStatus("Extension injoignable : recharge-la.", "err");
      setStatus(r.ok ? "Connexion OK : le tool reconnaît le jeton." : `Échec : ${r.error}`, r.ok ? "ok" : "err");
    });
  });
});

$("paused").addEventListener("change", (e) => {
  chrome.storage.sync.set({ paused: e.target.checked });
});

setInterval(refresh, 2000);
