"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/client";
import { Card, Empty, ErrorNote, InfoNote, Modal, PageHeader, Spinner, Tabs, useToast } from "@/components/ui";
import type { YtVideo } from "@/lib/types";

/*
 * Vidéos YouTube US à adapter : on colle les liens, on voit les vignettes,
 * on récupère le transcript (sous-titres YouTube, sinon audio + whisper), et
 * le scénariste (prompt du coach, modifiable) écrit l'analyse + le script.
 * Tout se copie en un clic, pour Claude ou pour le tournage.
 */

const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "");
const fmtDur = (s: number) => (s ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")}` : "");

export default function YoutubePage() {
  const toast = useToast();
  const [videos, setVideos] = useState<YtVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [links, setLinks] = useState("");
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [defaultPrompt, setDefaultPrompt] = useState("");
  const [brandBlock, setBrandBlock] = useState("");
  const [promptSaving, setPromptSaving] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [v, p, b] = await Promise.all([
        api<YtVideo[]>("/api/youtube"),
        api<{ prompt: string; defaultPrompt: string }>("/api/youtube/prompt"),
        api<{ compiled: string }>("/api/brand").catch(() => ({ compiled: "" })),
      ]);
      setVideos(v);
      setPrompt(p.prompt);
      setDefaultPrompt(p.defaultPrompt);
      setBrandBlock(b.compiled ?? "");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function add() {
    if (!links.trim()) return;
    setAdding(true);
    try {
      const r = await api<{ added: number; skipped: number; videos: YtVideo[] }>("/api/youtube", { method: "POST", body: JSON.stringify({ text: links }) });
      setVideos(r.videos);
      setLinks("");
      toast(`${r.added} vidéo${r.added > 1 ? "s" : ""} ajoutée${r.added > 1 ? "s" : ""}${r.skipped ? `, ${r.skipped} déjà là` : ""}.`);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setAdding(false);
    }
  }

  async function remove(id: string) {
    try {
      await api(`/api/youtube?id=${id}`, { method: "DELETE" });
      setVideos((v) => v.filter((x) => x.id !== id));
      if (openId === id) setOpenId(null);
    } catch (e) {
      toast((e as Error).message, "err");
    }
  }

  async function savePrompt() {
    setPromptSaving(true);
    try {
      const p = await api<{ prompt: string }>("/api/youtube/prompt", { method: "PUT", body: JSON.stringify({ prompt }) });
      setPrompt(p.prompt);
      toast("Prompt du scénariste enregistré.");
      setPromptOpen(false);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setPromptSaving(false);
    }
  }

  const open = videos.find((v) => v.id === openId) ?? null;

  return (
    <>
      <PageHeader
        title="Vidéos YouTube"
        subtitle="Colle les liens des vidéos US qui marchent : vignette, transcript en un clic, puis le scénariste écrit l'analyse et ton script adapté."
        actions={
          <button className="btn btn-sm" onClick={() => setPromptOpen(true)}>
            Prompt du scénariste
          </button>
        }
      />

      <Card title="Ajouter des vidéos" subtitle="Un lien par ligne : watch?v=, youtu.be ou shorts. Les doublons sont ignorés.">
        <div className="flex flex-col gap-2">
          <textarea className="textarea" style={{ minHeight: 70 }} placeholder={"https://www.youtube.com/watch?v=…\nhttps://youtu.be/…"} value={links} onChange={(e) => setLinks(e.target.value)} disabled={adding} />
          <div>
            <button className="btn btn-primary btn-sm" onClick={add} disabled={adding || !links.trim()}>
              {adding ? "Ajout…" : "Ajouter"}
            </button>
          </div>
        </div>
      </Card>

      <div className="mt-5">
        {loading ? (
          <Spinner label="Chargement…" />
        ) : videos.length === 0 ? (
          <Card>
            <Empty>Aucune vidéo pour l&apos;instant. Colle un ou plusieurs liens ci-dessus.</Empty>
          </Card>
        ) : (
          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
            {videos.map((v) => (
              <VideoCard key={v.id} video={v} onOpen={() => setOpenId(v.id)} onRemove={() => remove(v.id)} />
            ))}
          </div>
        )}
      </div>

      {open && (
        <VideoModal
          video={open}
          onClose={() => setOpenId(null)}
          onUpdate={(nv) => setVideos((list) => list.map((x) => (x.id === nv.id ? nv : x)))}
          prompt={brandBlock ? `${prompt}

CONTEXTE DE MARQUE (source de vérité, prime sur toute autre description) :
${brandBlock}` : prompt}
        />
      )}

      <Modal
        open={promptOpen}
        onClose={() => setPromptOpen(false)}
        title="Prompt du scénariste"
        wide
        footer={
          <div className="flex gap-2 justify-between w-full">
            <button className="btn btn-sm btn-ghost" onClick={() => setPrompt(defaultPrompt)} disabled={promptSaving}>
              Revenir au prompt par défaut
            </button>
            <button className="btn btn-sm btn-primary" onClick={savePrompt} disabled={promptSaving}>
              {promptSaving ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        }
      >
        <div className="grid gap-2">
          <InfoNote>
            C&apos;est la consigne système envoyée au modèle avec chaque transcript (et copiée dans « Copier pour Claude »). Complète la ligne « Mes ressources pour le CTA indirect ».
          </InfoNote>
          <textarea className="textarea mono text-[12px]" style={{ minHeight: 460 }} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        </div>
      </Modal>
    </>
  );
}

/* ------------------------------- Carte --------------------------------- */

function VideoCard({ video: v, onOpen, onRemove }: { video: YtVideo; onOpen: () => void; onRemove: () => void }) {
  return (
    <div className="card p-0 overflow-hidden flex flex-col" style={{ cursor: "pointer" }}>
      <button className="text-left" onClick={onOpen} style={{ display: "block" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={v.thumbnail} alt="" className="w-full block" style={{ aspectRatio: "16/9", objectFit: "cover", background: "var(--surface-2)" }} loading="lazy" />
      </button>
      <div className="p-3 flex flex-col gap-1.5 flex-1">
        <button className="text-left font-semibold text-[13.5px] leading-snug" onClick={onOpen} style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {v.title || v.url}
        </button>
        <div className="dim text-[12px] truncate">
          {v.author || "—"}
          {v.durationSec ? ` · ${fmtDur(v.durationSec)}` : ""}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap mt-auto pt-1">
          <Badge on={Boolean(v.transcript)}>{v.transcript ? "Transcript ✓" : "Transcript"}</Badge>
          <Badge on={Boolean(v.script)}>{v.script ? "Script ✓" : "Script"}</Badge>
          {v.plan && <Badge on>Plan ✓</Badge>}
          {v.filmedAt && <Badge on>🎬 Tournée · rushs au monteur</Badge>}
          <button
            className="btn btn-sm btn-ghost ml-auto"
            onClick={(e) => {
              e.stopPropagation();
              if (window.confirm("Retirer cette vidéo de la liste ?")) onRemove();
            }}
            title="Retirer"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}

function Badge({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <span
      className="text-[11px] px-2 py-0.5 rounded-full"
      style={{
        border: `1px solid ${on ? "var(--accent-ring)" : "var(--border)"}`,
        background: on ? "var(--accent-soft)" : "var(--surface-2)",
        color: on ? "var(--accent)" : "var(--text-2)",
      }}
    >
      {children}
    </span>
  );
}

/* ------------------------------- Fiche --------------------------------- */

type Tab = "script" | "transcript" | "plan";

function VideoModal({ video: v, onClose, onUpdate, prompt }: { video: YtVideo; onClose: () => void; onUpdate: (v: YtVideo) => void; prompt: string }) {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>(v.plan ? "plan" : v.script ? "script" : "transcript");
  // Mon plan : le déroulé de ma vidéo, enregistré au bouton ; « vidéo tournée » bascule tout de suite.
  const [plan, setPlan] = useState(v.plan ?? "");
  const [planSaving, setPlanSaving] = useState(false);
  const planDirty = plan !== (v.plan ?? "");
  async function savePlan() {
    setPlanSaving(true);
    try {
      onUpdate(await api<YtVideo>("/api/youtube", { method: "PATCH", body: JSON.stringify({ id: v.id, plan }) }));
      toast("Plan enregistré.");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setPlanSaving(false);
    }
  }
  async function setFilmed(filmed: boolean) {
    try {
      onUpdate(await api<YtVideo>("/api/youtube", { method: "PATCH", body: JSON.stringify({ id: v.id, filmed, ...(planDirty ? { plan } : {}) }) }));
      toast(filmed ? "Vidéo tournée : rushs à envoyer au monteur." : "Remise en « à tourner ».");
    } catch (e) {
      toast((e as Error).message, "err");
    }
  }
  const [busy, setBusy] = useState<"" | "transcript" | "whisper" | "script">("");
  const [error, setError] = useState("");
  const [extra, setExtra] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [paste, setPaste] = useState("");
  const [step, setStep] = useState("");

  const transcriptWords = useMemo(() => (v.transcript ? v.transcript.split(/\s+/).length : 0), [v.transcript]);

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${label} copié.`);
    } catch {
      window.prompt("Copie :", text);
    }
  }

  async function getTranscript(force = false) {
    setBusy("transcript");
    setError("");
    try {
      const r = await api<{ video?: YtVideo; cached?: boolean; jobId?: string }>(`/api/youtube/${v.id}/transcript`, { method: "POST", body: JSON.stringify({ force }) });
      if (r.video) {
        onUpdate(r.video);
        setTab("transcript");
        toast("Transcript déjà là.");
        return;
      }
      // Sous-titres, sinon Gemini : tâche de fond suivie toutes les 3 s.
      setStep("Démarrage…");
      const deadline = Date.now() + 45 * 60_000;
      for (;;) {
        if (Date.now() > deadline) throw new Error("Toujours rien après 45 minutes : relance, ou colle le transcript à la main.");
        await new Promise((res) => setTimeout(res, 3000));
        let st: { status: string; step?: string; result?: { video: YtVideo; source: string; auto?: boolean } };
        try {
          st = await api<typeof st>(`/api/youtube/${v.id}/transcript?job=${r.jobId}`, { timeoutMs: 20_000 });
        } catch (e) {
          if (/serveur a été interrompu|Connexion au serveur impossible|n'a pas répondu/.test((e as Error).message)) continue;
          throw e;
        }
        if (st.step) setStep(st.step);
        if (st.status === "done" && st.result) {
          onUpdate(st.result.video);
          setTab("transcript");
          toast(st.result.source === "gemini" ? "Transcript récupéré par Gemini." : `Transcript récupéré (sous-titres ${st.result.auto ? "automatiques" : "manuels"}).`);
          break;
        }
      }
    } catch (e) {
      setError((e as Error).message);
      setPasteOpen(true);
    } finally {
      setBusy("");
      setStep("");
    }
  }

  /** Audio + OpenAI : tâche de fond suivie toutes les 3 s (Cloudflare coupe une requête à 100 s). */
  async function transcribeAudio() {
    setBusy("whisper");
    setError("");
    setStep("Démarrage…");
    try {
      const { jobId } = await api<{ jobId: string }>(`/api/youtube/${v.id}/transcript`, { method: "POST", body: JSON.stringify({ whisper: true }) });
      const deadline = Date.now() + 45 * 60_000;
      for (;;) {
        if (Date.now() > deadline) throw new Error("Toujours rien après 45 minutes : relance, ou colle le transcript à la main.");
        await new Promise((r) => setTimeout(r, 3000));
        const st = await api<{ status: string; step?: string; result?: { video: YtVideo }; error?: string }>(`/api/youtube/${v.id}/transcript?job=${jobId}`);
        if (st.step) setStep(st.step);
        if (st.status === "done" && st.result) {
          onUpdate(st.result.video);
          setTab("transcript");
          toast("Audio transcrit.");
          break;
        }
      }
    } catch (e) {
      setError((e as Error).message);
      setPasteOpen(true);
    } finally {
      setBusy("");
      setStep("");
    }
  }

  async function savePaste() {
    setBusy("transcript");
    setError("");
    try {
      const r = await api<{ video: YtVideo }>(`/api/youtube/${v.id}/transcript`, { method: "POST", body: JSON.stringify({ text: paste }) });
      onUpdate(r.video);
      setPaste("");
      setPasteOpen(false);
      setTab("transcript");
      toast("Transcript enregistré.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function writeScript() {
    setBusy("script");
    setError("");
    try {
      const r = await api<{ video: YtVideo }>(`/api/youtube/${v.id}/script`, { job: true, method: "POST", body: JSON.stringify({ extra }), timeoutMs: 6 * 60_000 });
      onUpdate(r.video);
      setTab("script");
      toast("Analyse et script prêts.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  const forClaude = `${prompt}\n\n----\n\nTRANSCRIPT DE LA VIDÉO\nTitre : ${v.title || "(sans titre)"}\nChaîne : ${v.author || "?"}${v.durationSec ? ` · ${fmtDur(v.durationSec)}` : ""}\n\n${v.transcript}`;

  return (
    <Modal open onClose={onClose} title={v.title || v.url} wide>
      <div className="grid gap-3">
        <div className="flex gap-3 items-start flex-wrap">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={v.thumbnail} alt="" style={{ width: 200, aspectRatio: "16/9", objectFit: "cover", borderRadius: 10, background: "var(--surface-2)" }} />
          <div className="grid gap-1 text-[13px] min-w-0 flex-1">
            <div className="dim">
              {v.author || "—"}
              {v.durationSec ? ` · ${fmtDur(v.durationSec)}` : ""}
            </div>
            <a className="mono text-[12px] truncate" href={v.url} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
              {v.url}
            </a>
            <div className="dim text-[12px]">
              {v.transcript
                ? `Transcript : ${transcriptWords} mots · ${v.transcriptSource === "captions" ? `sous-titres ${v.transcriptLang}` : v.transcriptSource === "manual" ? "collé à la main" : "audio transcrit"}`
                : "Pas encore de transcript."}
              {v.scriptAt ? ` · Script écrit le ${fmtDate(v.scriptAt)}` : ""}
              {v.filmedAt ? ` · Tournée le ${fmtDate(v.filmedAt)}, rushs à envoyer au monteur` : ""}
            </div>
            <div className="flex gap-1.5 flex-wrap mt-1">
              {!v.transcript ? (
                <>
                  <button className="btn btn-sm btn-primary" onClick={() => getTranscript()} disabled={Boolean(busy)}>
                    {busy === "transcript" ? "Récupération…" : "Récupérer le transcript"}
                  </button>
                  <button className="btn btn-sm" onClick={() => setPasteOpen((o) => !o)} disabled={Boolean(busy)} title="Sur YouTube : « …plus » → « Afficher la transcription », tout sélectionner, copier">
                    Coller le transcript
                  </button>
                </>
              ) : (
                <>
                  <button className="btn btn-sm btn-primary" onClick={writeScript} disabled={Boolean(busy)}>
                    {busy === "script" ? "Le scénariste écrit… (1 à 2 min)" : v.script ? "Réécrire le script" : "Écrire le script"}
                  </button>
                  <button className="btn btn-sm" onClick={() => copy(forClaude, "Prompt + transcript")} title="Le prompt du scénariste suivi du transcript, à coller dans Claude">
                    Copier pour Claude
                  </button>
                  <button className="btn btn-sm btn-ghost" onClick={() => getTranscript(true)} disabled={Boolean(busy)} title="Relire les sous-titres YouTube">
                    {busy === "transcript" ? "…" : "Refaire"}
                  </button>
                  <button className="btn btn-sm btn-ghost" onClick={() => setPasteOpen((o) => !o)} disabled={Boolean(busy)}>
                    Remplacer en collant
                  </button>
                </>
              )}
              <button className="btn btn-sm btn-ghost" onClick={transcribeAudio} disabled={Boolean(busy)} title="Télécharge l'audio et le transcrit avec OpenAI (1 à 3 min, si YouTube laisse passer le serveur)">
                {busy === "whisper" ? "Transcription audio…" : "Transcrire l'audio"}
              </button>
            </div>
          </div>
        </div>

        {v.transcript && (
          <div className="flex gap-2 items-end flex-wrap">
            <div className="flex-1 min-w-[240px]">
              <span className="label-xs">Consigne du jour (optionnel)</span>
              <input className="input" placeholder="Ex. angle « produit gagnant avec l'IA », 10 minutes, cas élève Loïc" value={extra} onChange={(e) => setExtra(e.target.value)} disabled={Boolean(busy)} />
            </div>
          </div>
        )}

        {pasteOpen && (
          <div className="grid gap-2 rounded-xl p-3" style={{ border: "1px solid var(--border)", background: "var(--surface-2)" }}>
            <span className="label-xs">Coller le transcript</span>
            <span className="dim text-[12px]">Sur YouTube, sous la vidéo : « …plus » → « Afficher la transcription ». Clique dans le panneau, Ctrl+A, Ctrl+C, puis colle ici. Les horodatages peuvent rester, ça ne gêne pas.</span>
            <textarea className="textarea mono text-[12px]" style={{ minHeight: 160 }} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="0:00 So the thing nobody tells you about…" disabled={Boolean(busy)} />
            <div className="flex gap-1.5">
              <button className="btn btn-sm btn-primary" onClick={savePaste} disabled={Boolean(busy) || paste.trim().length < 40}>
                Enregistrer le transcript
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => setPasteOpen(false)} disabled={Boolean(busy)}>
                Annuler
              </button>
            </div>
          </div>
        )}
        {error && <ErrorNote>{error}</ErrorNote>}
        {busy && <Spinner label={busy === "script" ? "Analyse puis script, dans ta façon de parler…" : busy === "whisper" ? step || "Audio téléchargé puis transcrit…" : step || "Lecture des sous-titres…"} />}

        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: "script", label: v.script ? "Analyse + script" : "Script (à écrire)" },
            { value: "transcript", label: v.transcript ? `Transcript (${transcriptWords} mots)` : "Transcript" },
            { value: "plan", label: v.filmedAt ? "Mon plan · tournée 🎬" : v.plan ? "Mon plan ✓" : "Mon plan" },
          ]}
        />

        {tab === "plan" ? (
          <div className="grid gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="dim text-[12.5px] flex-1 min-w-[200px]">Le déroulé de ta vidéo, collé ici tel quel.</span>
              <button className="btn btn-sm btn-primary" onClick={() => void savePlan()} disabled={planSaving || !planDirty}>
                {planSaving ? "Enregistrement…" : "Enregistrer le plan"}
              </button>
              {plan.trim() && (
                <button className="btn btn-sm" onClick={() => copy(plan, "Plan")}>
                  Copier
                </button>
              )}
            </div>
            <textarea className="textarea text-[13px]" style={{ minHeight: 360, fontFamily: "inherit" }} value={plan} onChange={(e) => setPlan(e.target.value)} placeholder={"Hook…\nPartie 1…\nPartie 2…\nCTA…"} />
            <div className="flex items-center gap-3 flex-wrap rounded-xl p-3" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
              {v.filmedAt ? (
                <>
                  <span className="text-[13px] font-semibold">🎬 Vidéo tournée le {fmtDate(v.filmedAt)} · rushs à envoyer au monteur</span>
                  <button className="btn btn-sm btn-ghost ml-auto" onClick={() => void setFilmed(false)}>
                    Pas encore tournée
                  </button>
                </>
              ) : (
                <>
                  <span className="dim text-[13px] flex-1">Dès que c&apos;est filmé :</span>
                  <button className="btn btn-sm" onClick={() => void setFilmed(true)}>
                    Vidéo tournée · rushs à envoyer au monteur
                  </button>
                </>
              )}
            </div>
          </div>
        ) : tab === "script" ? (
          v.script ? (
            <div className="grid gap-2">
              <div>
                <button className="btn btn-sm" onClick={() => copy(v.script, "Script")}>
                  Copier le script
                </button>
              </div>
              <pre className="text-[13px] leading-relaxed whitespace-pre-wrap rounded-xl p-4" style={{ background: "var(--surface-2)", border: "1px solid var(--border)", fontFamily: "inherit", maxHeight: 520, overflow: "auto" }}>
                {v.script}
              </pre>
            </div>
          ) : (
            <InfoNote>Récupère le transcript, puis « Écrire le script » : analyse en 10 lignes, 3 hooks, corps en blocs avec ce qu&apos;on montre à l&apos;écran, CTA, titres.</InfoNote>
          )
        ) : v.transcript ? (
          <div className="grid gap-2">
            <div>
              <button className="btn btn-sm" onClick={() => copy(v.transcript, "Transcript")}>
                Copier le transcript
              </button>
            </div>
            <pre className="text-[13px] leading-relaxed whitespace-pre-wrap rounded-xl p-4" style={{ background: "var(--surface-2)", border: "1px solid var(--border)", fontFamily: "inherit", maxHeight: 520, overflow: "auto" }}>
              {v.transcript}
            </pre>
          </div>
        ) : (
          <InfoNote>Les sous-titres YouTube arrivent en quelques secondes. Sinon Gemini lit la vidéo en entier : une vidéo longue est découpée en parties de 20 minutes, transcrites trois à la fois (compte 1 à 3 minutes par tranche de 20 minutes).</InfoNote>
        )}
      </div>
    </Modal>
  );
}
