"use client";

import { useState } from "react";
import Link from "next/link";
import { api, useCollection } from "@/lib/client";
import { Card, CopyButton, Empty, ErrorNote, Field, InfoNote, PageHeader, Spinner, Tabs, useToast } from "@/components/ui";
import { label, relative } from "@/lib/format";
import type { Post, Swipe, SwipeAnalysis } from "@/lib/types";

type Panel = "source" | "script" | "mecanique" | "plans" | "adaptation" | "prompts";

export default function SwipePage() {
  const { rows, loading, create, patch, destroy, setRows } = useCollection<Swipe>("swipes");
  const posts = useCollection<Post>("posts");
  const toast = useToast();

  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>("source");
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");

  const selected = rows.find((s) => s.id === selectedId) ?? null;

  const open = (s: Swipe) => {
    setSelectedId(s.id);
    setTranscript(s.transcriptInput);
    setPanel(s.analysis ? "script" : "source");
    setError(null);
  };

  const addSwipe = async () => {
    if (!url.trim()) return;
    setAdding(true);
    setError(null);
    try {
      const meta = await api<{
        platform: string;
        author: string;
        title: string;
        caption: string;
        thumbnail: string;
        warning: string;
      }>("/api/swipe/extract", { method: "POST", body: JSON.stringify({ url: url.trim() }) });

      const row = await create({
        url: url.trim(),
        platform: meta.platform,
        author: meta.author,
        title: meta.title,
        caption: meta.caption,
        thumbnail: meta.thumbnail,
        transcriptInput: "",
        tags: "",
        analysis: null,
        status: "a-analyser",
      });
      setUrl("");
      open(row);
      if (meta.warning) toast(meta.warning);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAdding(false);
    }
  };

  const analyze = async () => {
    if (!selected) return;
    setAnalyzing(true);
    setError(null);
    try {
      await patch(selected.id, { transcriptInput: transcript });
      const res = await api<{ analysis: SwipeAnalysis }>("/api/ai/analyze", {
        method: "POST",
        body: JSON.stringify({ swipeId: selected.id }),
      });
      setRows((prev) =>
        prev.map((s) =>
          s.id === selected.id ? { ...s, analysis: res.analysis, status: "analyse", transcriptInput: transcript } : s,
        ),
      );
      setPanel("script");
      toast("Contenu décortiqué.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAnalyzing(false);
    }
  };

  const toPost = async () => {
    if (!selected?.analysis) return;
    const a = selected.analysis;
    try {
      await posts.create({
        title: a.adaptation.hook.slice(0, 90) || selected.title,
        format: "reel-face-cam",
        angle: "value",
        status: "script",
        hook: a.adaptation.hook,
        script: a.adaptation.script,
        cta: a.adaptation.cta,
        plannedAt: "",
        publishedAt: "",
        url: "",
        swipeId: selected.id,
        views: 0, likes: 0, comments: 0, saves: 0, shares: 0,
        followersGained: 0, profileVisits: 0, linkClicks: 0, callsBooked: 0,
        notes: `Inspiré de ${selected.url}`,
      });
      await patch(selected.id, { status: "a-tourner" });
      toast("Post créé dans le calendrier de contenu, au statut « Script ».");
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  return (
    <>
      <PageHeader
        title="Swipe file"
        subtitle="Colle le lien d'un contenu qui marche. Le tool sort le script complet, le traduit, isole les plans à filmer et te le réécrit pour ta niche."
      />

      <Card className="mb-4">
        <div className="flex flex-wrap gap-2">
          <input
            className="input flex-1 min-w-[260px]"
            placeholder="https://www.instagram.com/reel/… ou TikTok, YouTube Shorts…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void addSwipe();
            }}
          />
          <button className="btn btn-primary" onClick={() => void addSwipe()} disabled={adding || !url.trim()}>
            {adding ? <span className="spinner" /> : "⇥"} Récupérer
          </button>
        </div>
        {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
      </Card>

      <div className="grid lg:grid-cols-[300px_1fr] gap-4 items-start">
        <Card title="Ma swipe file" subtitle={`${rows.length} contenu${rows.length > 1 ? "s" : ""}`} padded={false}>
          {loading ? (
            <div className="p-4"><Spinner label="Chargement…" /></div>
          ) : !rows.length ? (
            <Empty>Colle ton premier lien au-dessus.</Empty>
          ) : (
            <ul className="max-h-[70vh] overflow-y-auto">
              {rows.map((s, i) => (
                <li key={s.id} style={{ borderBottom: i < rows.length - 1 ? "1px solid var(--border)" : "none" }}>
                  <button
                    onClick={() => open(s)}
                    className="w-full text-left px-3 py-2.5 flex gap-2.5 transition-colors"
                    style={{ background: selectedId === s.id ? "var(--accent-soft)" : "transparent" }}
                  >
                    {s.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={s.thumbnail}
                        alt=""
                        className="w-[38px] h-[48px] object-cover rounded-[6px] shrink-0"
                        loading="lazy"
                      />
                    ) : (
                      <span
                        className="w-[38px] h-[48px] rounded-[6px] shrink-0 grid place-items-center text-[15px]"
                        style={{ background: "var(--surface-3)" }}
                      >
                        ▶
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12.5px] font-medium leading-snug line-clamp-2">
                        {s.title || s.caption || s.url}
                      </span>
                      <span className="flex items-center gap-1.5 mt-1">
                        <span className="badge !text-[10px] !py-0">{s.platform}</span>
                        <span
                          className={`badge !text-[10px] !py-0 ${s.analysis ? "badge-good" : "badge-warn"}`}
                        >
                          {label(s.status)}
                        </span>
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {!selected ? (
          <Card>
            <Empty>Sélectionne un contenu à gauche, ou colle un nouveau lien.</Empty>
          </Card>
        ) : (
          <div className="flex flex-col gap-4">
            <Card
              title={selected.title || "Contenu swipé"}
              subtitle={`${selected.platform}${selected.author ? ` · @${selected.author}` : ""} · ajouté ${relative(selected.createdAt)}`}
              actions={
                <>
                  <a href={selected.url} target="_blank" rel="noreferrer" className="btn btn-sm">
                    Voir ↗
                  </a>
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={async () => {
                      if (!window.confirm("Supprimer ce contenu de la swipe file ?")) return;
                      await destroy(selected.id);
                      setSelectedId(null);
                    }}
                  >
                    Supprimer
                  </button>
                </>
              }
              padded={false}
            >
              <div className="px-4 pt-3.5">
                <Tabs
                  value={panel}
                  onChange={setPanel}
                  options={[
                    { value: "source", label: "Source" },
                    ...(selected.analysis
                      ? ([
                          { value: "script", label: "Script + traduction" },
                          { value: "mecanique", label: "Mécanique" },
                          { value: "plans", label: "Plans à filmer" },
                          { value: "adaptation", label: "Mon script" },
                          { value: "prompts", label: "Prompts IA" },
                        ] as { value: Panel; label: string }[])
                      : []),
                  ]}
                />
              </div>

              <div className="p-4">
                {panel === "source" && (
                  <div className="flex flex-col gap-3.5">
                    <InfoNote>
                      Aucune plateforme n&apos;expose la transcription d&apos;une vidéo par API. Le plus rapide :
                      ouvre le reel dans l&apos;app Instagram, active les sous-titres, ou passe par la transcription
                      automatique — puis colle le texte ici. La légende récupérée seule suffit pour un carrousel,
                      pas pour un reel.
                    </InfoNote>

                    {selected.caption && (
                      <Field label="Légende récupérée">
                        <p className="prose-sm p-2.5 rounded-[8px]" style={{ background: "var(--surface-2)" }}>
                          {selected.caption}
                        </p>
                      </Field>
                    )}

                    <Field
                      label="Transcription / script brut"
                      hint="Colle le texte tel quel, même avec les hésitations : l'IA nettoie."
                    >
                      <textarea
                        className="textarea"
                        style={{ minHeight: 190 }}
                        value={transcript}
                        onChange={(e) => setTranscript(e.target.value)}
                        placeholder="Colle ici tout ce qui est dit dans la vidéo…"
                      />
                    </Field>

                    {error && <ErrorNote>{error}</ErrorNote>}

                    <div className="flex justify-end">
                      <button className="btn btn-primary" onClick={() => void analyze()} disabled={analyzing}>
                        {analyzing ? <span className="spinner" /> : "✦"}{" "}
                        {analyzing ? "Analyse en cours…" : "Décortiquer avec l'IA"}
                      </button>
                    </div>
                  </div>
                )}

                {selected.analysis && panel === "script" && <ScriptPanel a={selected.analysis} />}
                {selected.analysis && panel === "mecanique" && <MechanicsPanel a={selected.analysis} />}
                {selected.analysis && panel === "plans" && <ShotsPanel a={selected.analysis} />}
                {selected.analysis && panel === "adaptation" && (
                  <AdaptationPanel a={selected.analysis} onCreatePost={() => void toPost()} />
                )}
                {selected.analysis && panel === "prompts" && <PromptsPanel a={selected.analysis} />}
              </div>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}

/* ------------------------------- Panneaux ------------------------------- */

function Block({ title, text, mono }: { title: string; text: string; mono?: boolean }) {
  if (!text?.trim()) return null;
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="label-xs">{title}</span>
        <CopyButton text={text} />
      </div>
      <p
        className={`prose-sm p-3 rounded-[8px] ${mono ? "mono !text-[12px]" : ""}`}
        style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
      >
        {text}
      </p>
    </div>
  );
}

function ScriptPanel({ a }: { a: SwipeAnalysis }) {
  const translated = a.language && !a.language.toLowerCase().startsWith("fr");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="badge">Langue détectée : {a.language || "?"}</span>
        {translated && <span className="badge badge-accent">Traduit automatiquement en français</span>}
        {a.scoreViralite > 0 && (
          <span className={`badge ${a.scoreViralite >= 70 ? "badge-good" : "badge-warn"}`}>
            Potentiel {a.scoreViralite}/100
          </span>
        )}
      </div>
      {translated && <Block title="Script original" text={a.transcriptOriginal} />}
      <Block title={translated ? "Traduction française" : "Script nettoyé"} text={a.transcriptFr || a.transcriptOriginal} />
    </div>
  );
}

function MechanicsPanel({ a }: { a: SwipeAnalysis }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="card-flat p-3">
          <div className="label-xs mb-1.5">Hook ({a.hookType})</div>
          <p className="text-[13px] leading-relaxed font-medium">{a.hook}</p>
        </div>
        <div className="card-flat p-3">
          <div className="label-xs mb-1.5">Promesse</div>
          <p className="text-[13px] leading-relaxed">{a.promise}</p>
        </div>
      </div>
      <Block title="Corps de l'argumentation" text={a.body} />
      <Block title="Preuve utilisée" text={a.proof} />
      <Block title="Appel à l'action" text={a.cta} />

      {a.whyItWorks?.length > 0 && (
        <div>
          <span className="label-xs block mb-2">Pourquoi ça marche</span>
          <ul className="flex flex-col gap-1.5">
            {a.whyItWorks.map((w, i) => (
              <li key={i} className="flex gap-2.5 text-[13px] leading-relaxed">
                <span className="dim num shrink-0">{String(i + 1).padStart(2, "0")}</span>
                <span className="muted">{w}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {a.onScreenText?.length > 0 && (
        <div>
          <span className="label-xs block mb-2">Textes incrustés</span>
          <div className="flex flex-wrap gap-1.5">
            {a.onScreenText.map((t, i) => (
              <span key={i} className="badge">{t}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ShotsPanel({ a }: { a: SwipeAnalysis }) {
  return (
    <div className="flex flex-col gap-5">
      {a.timeline?.length > 0 && (
        <div>
          <span className="label-xs block mb-2">Découpage seconde par seconde</span>
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 74 }}>Temps</th>
                  <th>Ce qui est dit</th>
                  <th>Plan filmé</th>
                </tr>
              </thead>
              <tbody>
                {a.timeline.map((t, i) => (
                  <tr key={i}>
                    <td className="num dim">{t.t}</td>
                    <td>{t.beat}</td>
                    <td className="muted">{t.shot}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {a.shotList?.length > 0 && (
        <div>
          <span className="label-xs block mb-2">Les plans à mettre en avant</span>
          <div className="grid sm:grid-cols-2 gap-3">
            {a.shotList.map((s, i) => (
              <div key={i} className="card-flat p-3">
                <div className="flex items-baseline gap-2 mb-1.5">
                  <span className="dim num text-[11px]">{String(i + 1).padStart(2, "0")}</span>
                  <span className="text-[13px] font-semibold">{s.plan}</span>
                </div>
                <p className="text-[12.5px] leading-relaxed muted">{s.description}</p>
                <p
                  className="text-[12px] leading-relaxed mt-2 pt-2"
                  style={{ borderTop: "1px solid var(--border)", color: "var(--accent)" }}
                >
                  {s.pourquoi}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AdaptationPanel({ a, onCreatePost }: { a: SwipeAnalysis; onCreatePost: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="badge badge-accent">Format conseillé : {a.formatRecommande}</span>
        <button className="btn btn-primary btn-sm" onClick={onCreatePost}>
          → Créer le post dans mon calendrier
        </button>
      </div>

      <Block title="Mon hook" text={a.adaptation?.hook ?? ""} />
      <Block title="Mon script à lire" text={a.adaptation?.script ?? ""} />
      <Block title="Mon CTA" text={a.adaptation?.cta ?? ""} />
      <Block title="Ma légende" text={a.adaptation?.caption ?? ""} />

      {a.adaptation?.hashtags?.length > 0 && (
        <div>
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className="label-xs">Hashtags</span>
            <CopyButton text={a.adaptation.hashtags.join(" ")} />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {a.adaptation.hashtags.map((h, i) => (
              <span key={i} className="badge">{h}</span>
            ))}
          </div>
        </div>
      )}

      {a.altHooks?.length > 0 && (
        <div>
          <span className="label-xs block mb-2">Hooks alternatifs à tester</span>
          <ul className="flex flex-col gap-1.5">
            {a.altHooks.map((h, i) => (
              <li
                key={i}
                className="flex items-center justify-between gap-3 px-3 py-2 rounded-[8px] text-[13px]"
                style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
              >
                <span>{h}</span>
                <CopyButton text={h} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function PromptsPanel({ a }: { a: SwipeAnalysis }) {
  const section = (title: string, prompts: string[], kind: "image" | "video") =>
    prompts?.length ? (
      <div>
        <span className="label-xs block mb-2">{title}</span>
        <div className="flex flex-col gap-2">
          {prompts.map((p, i) => (
            <div key={i} className="card-flat p-2.5 flex flex-col gap-2">
              <p className="mono text-[12px] leading-relaxed muted">{p}</p>
              <div className="flex gap-1.5 justify-end">
                <CopyButton text={p} />
                <Link
                  href={`/studio?kind=${kind}&prompt=${encodeURIComponent(p)}`}
                  className="btn btn-sm btn-primary"
                >
                  Générer →
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    ) : null;

  return (
    <div className="flex flex-col gap-5">
      {section("Prompts image", a.imagePrompts, "image")}
      {section("Prompts vidéo (B-roll)", a.videoPrompts, "video")}
      {!a.imagePrompts?.length && !a.videoPrompts?.length && (
        <Empty>Aucun prompt généré pour ce contenu.</Empty>
      )}
    </div>
  );
}
