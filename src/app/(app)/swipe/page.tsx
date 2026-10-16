"use client";

import { useMemo, useState } from "react";
import { api, useCollection } from "@/lib/client";
import { Card, CopyButton, Empty, ErrorNote, Field, InfoNote, PageHeader, Spinner, Tabs, useToast } from "@/components/ui";
import { label, relative } from "@/lib/format";
import { SWIPE_CONFIDENCE_MIN, SWIPE_PROD_LABEL, SWIPE_STAGES, swipeProdStatus, swipeStage, type Post, type Swipe, type SwipeAnalysis, type SwipeProdStatus, type SwipeScript, type SwipeStage } from "@/lib/types";
import { WeekBlock } from "@/components/WeekBlock";
import { MyScriptPanel, ProdStepper, PromptsInline, SpeakersBadge } from "@/components/SwipeProduction";

/*
 * Swipe file : les Reels de concurrents qu'on decortique.
 *
 * Page remise en place le 2026-10-15 (elle avait disparu dans la refonte du
 * dashboard) avec le classement funnel : chaque Reel analyse recoit une etape
 * TOFU / MOFU / BOFU, un format et une confiance. En dessous de 70 de
 * confiance, le badge passe en gris « a verifier » ; l'etape se corrige a la
 * main et la correction prime toujours sur l'auto (`etapeManuelle`).
 */

type Panel = "source" | "monscript" | "script" | "mecanique" | "plans" | "adaptation" | "prompts";
type Filter = "all" | SwipeStage | "check" | "none";

const STAGE_COLOR: Record<SwipeStage, string> = { TOFU: "#3b82f6", MOFU: "#a855f7", BOFU: "#22c55e" };
const STAGE_HINT: Record<SwipeStage, string> = {
  TOFU: "Attirer des inconnus : hook universel, zéro jargon, aucune offre.",
  MOFU: "Prouver la méthode : process, écran, vocabulaire e-commerce, « commente X ».",
  BOFU: "Lever les objections : offre, élèves, résultats, lien bio / réserve ton appel.",
};
const FORMAT_LABEL: Record<string, string> = {
  tier_list: "Tier list",
  choix_binaire: "Choix binaire",
  hot_take: "Hot take",
  reaction: "Réaction",
  anecdote_parcours: "Anecdote de parcours",
  chiffre_choc: "Chiffre choc",
  lifestyle_punchline: "Lifestyle + punchline",
  tuto_ecran: "Tuto écran",
  reponse_commentaire: "Réponse à un commentaire",
  decryptage: "Décryptage",
  erreur_correction: "Erreur + correction",
  a_ta_place: "À ta place",
  coulisses: "Coulisses",
  resultat_eleve: "Résultat élève",
  objection: "Objection",
  pour_qui: "Pour qui / pas pour qui",
  comment_ca_se_passe: "Comment ça se passe",
  garantie: "Garantie",
  urgence: "Urgence",
};

/** Le classement est-il a verifier (auto peu sur, pas corrige a la main) ? */
const needsCheck = (s: Swipe) => Boolean(s.analysis?.etape) && !s.etapeManuelle && (s.analysis?.confiance ?? 0) < SWIPE_CONFIDENCE_MIN;

function StageBadge({ s, small }: { s: Swipe; small?: boolean }) {
  const stage = swipeStage(s);
  if (!stage) return null;
  const check = needsCheck(s);
  const color = check ? "#6b7280" : STAGE_COLOR[stage];
  const size = small ? "!text-[10px] !py-0" : "!text-[11px]";
  return (
    <span
      className={`badge ${size} font-semibold`}
      style={{ background: `color-mix(in srgb, ${color} 16%, transparent)`, color, borderColor: `color-mix(in srgb, ${color} 40%, transparent)` }}
      title={check ? `Classé ${stage} par l'IA avec ${s.analysis?.confiance ?? 0} % de confiance : à vérifier` : s.etapeManuelle ? `${stage}, corrigé à la main` : `${stage} · ${s.analysis?.confiance ?? 0} % de confiance`}
    >
      {stage}
      {check ? " · à vérifier" : s.etapeManuelle ? " ✎" : ""}
    </span>
  );
}

export default function SwipePage() {
  const { rows, loading, create, patch, destroy, setRows } = useCollection<Swipe>("swipes");
  const posts = useCollection<Post>("posts");
  const toast = useToast();

  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>("source");
  const [analyzing, setAnalyzing] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");
  const [screenText, setScreenText] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const selected = rows.find((s) => s.id === selectedId) ?? null;

  const counts = useMemo(() => {
    const c: Record<SwipeStage, number> & { check: number; none: number } = { TOFU: 0, MOFU: 0, BOFU: 0, check: 0, none: 0 };
    for (const s of rows) {
      const st = swipeStage(s);
      if (st) c[st]++;
      else c.none++;
      if (needsCheck(s)) c.check++;
    }
    return c;
  }, [rows]);

  const shown = useMemo(
    () =>
      rows.filter((s) => {
        if (filter === "all") return true;
        if (filter === "check") return needsCheck(s);
        if (filter === "none") return !swipeStage(s);
        return swipeStage(s) === filter;
      }),
    [rows, filter],
  );

  const open = (s: Swipe) => {
    setSelectedId(s.id);
    setTranscript(s.transcriptInput);
    setScreenText(s.screenTextInput ?? "");
    setPanel(s.script ? "monscript" : s.analysis ? "mecanique" : "source");
    setError(null);
  };

  const addSwipe = async () => {
    if (!url.trim()) return;
    setAdding(true);
    setError(null);
    try {
      const meta = await api<{ platform: string; author: string; title: string; caption: string; thumbnail: string; warning: string }>("/api/swipe/extract", {
        method: "POST",
        body: JSON.stringify({ url: url.trim() }),
      });
      const row = await create({
        url: url.trim(),
        platform: meta.platform,
        author: meta.author,
        title: meta.title,
        caption: meta.caption,
        thumbnail: meta.thumbnail,
        transcriptInput: "",
        screenTextInput: "",
        tags: "",
        analysis: null,
        status: "a-analyser",
        etapeManuelle: "",
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

  /** Transcription Whisper depuis l'URL (API officielle, puis yt-dlp en dernier recours). */
  const transcribe = async () => {
    if (!selected) return;
    setTranscribing(true);
    setError(null);
    try {
      const r = await api<{ transcript: string }>("/api/ai/transcribe-url", { method: "POST", body: JSON.stringify({ url: selected.url }), timeoutMs: 300_000 });
      setTranscript(r.transcript);
      await patch(selected.id, { transcriptInput: r.transcript });
      toast("Transcription récupérée. Relis-la vite, puis décortique.");
    } catch (e) {
      setError(`Transcription impossible : ${(e as Error).message} Colle le texte à la main.`);
    } finally {
      setTranscribing(false);
    }
  };

  /** Contenu US (ou autre) : traduction fidele en francais, l'original reste accessible. */
  const translate = async () => {
    if (!selected || !transcript.trim()) return;
    setTranslating(true);
    setError(null);
    try {
      const r = await api<{ fr: string; language: string; speakers: "solo" | "dialogue" }>("/api/swipe/translate", {
        method: "POST",
        body: JSON.stringify({ swipeId: selected.id, text: transcript }),
        timeoutMs: 120_000,
      });
      const original = selected.transcriptSourceInput || transcript;
      setTranscript(r.fr);
      setRows((prev) => prev.map((s) => (s.id === selected.id ? { ...s, transcriptInput: r.fr, transcriptSourceInput: r.fr !== original ? original : s.transcriptSourceInput, transcriptLang: r.language } : s)));
      toast(r.language && !r.language.startsWith("fr") ? `Traduit depuis « ${r.language} ». L'original reste sous le texte.` : "Déjà en français : juste nettoyé et aéré.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTranslating(false);
    }
  };

  const restoreSource = async () => {
    if (!selected?.transcriptSourceInput) return;
    const original = selected.transcriptSourceInput;
    setTranscript(original);
    await patch(selected.id, { transcriptInput: original, transcriptSourceInput: "", transcriptLang: "" });
    setShowSource(false);
    toast("Original rétabli.");
  };

  const analyze = async () => {
    if (!selected) return;
    setAnalyzing(true);
    setError(null);
    try {
      await patch(selected.id, { transcriptInput: transcript, screenTextInput: screenText });
      const res = await api<{ analysis: SwipeAnalysis }>("/api/ai/analyze", { method: "POST", body: JSON.stringify({ swipeId: selected.id }), timeoutMs: 300_000 });
      setRows((prev) => prev.map((s) => (s.id === selected.id ? { ...s, analysis: res.analysis, status: "analyse", transcriptInput: transcript, screenTextInput: screenText } : s)));
      setPanel("mecanique");
      const st = res.analysis.etape;
      toast(st ? `Décortiqué : ${st} (${res.analysis.confiance ?? 0} % de confiance).` : "Contenu décortiqué.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAnalyzing(false);
    }
  };

  /** Correction manuelle de l'etape : stockee, prime sur l'auto. Vide = on revient a l'auto. */
  const setStage = async (s: Swipe, stage: SwipeStage | "") => {
    try {
      await patch(s.id, { etapeManuelle: stage });
      toast(stage ? `Étape corrigée : ${stage}.` : "Retour au classement automatique.");
    } catch (e) {
      toast((e as Error).message, "err");
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
        views: 0,
        likes: 0,
        comments: 0,
        saves: 0,
        shares: 0,
        followersGained: 0,
        profileVisits: 0,
        linkClicks: 0,
        callsBooked: 0,
        notes: `Inspiré de ${selected.url}`,
      });
      await patch(selected.id, { status: "a-tourner" });
      toast("Post créé dans le calendrier de contenu, au statut « Script ».");
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  const FILTERS: { key: Filter; label: string; n: number; color?: string }[] = [
    { key: "all", label: "Tous", n: rows.length },
    { key: "TOFU", label: "TOFU", n: counts.TOFU, color: STAGE_COLOR.TOFU },
    { key: "MOFU", label: "MOFU", n: counts.MOFU, color: STAGE_COLOR.MOFU },
    { key: "BOFU", label: "BOFU", n: counts.BOFU, color: STAGE_COLOR.BOFU },
    { key: "check", label: "À vérifier", n: counts.check, color: "#6b7280" },
    { key: "none", label: "Non classés", n: counts.none },
  ];

  return (
    <>
      <PageHeader
        title="Swipe file"
        subtitle="Colle le lien d'un Reel qui marche. Le tool sort le script, le classe TOFU / MOFU / BOFU, isole les plans à filmer et te le réécrit pour ta niche."
      />

      <WeekBlock />

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
        {error && !selected && (
          <div className="mt-3">
            <ErrorNote>{error}</ErrorNote>
          </div>
        )}
      </Card>

      <div className="grid lg:grid-cols-[320px_1fr] gap-4 items-start">
        <Card
          title="Ma swipe file"
          subtitle={`${counts.TOFU} TOFU · ${counts.MOFU} MOFU · ${counts.BOFU} BOFU${counts.check ? ` · ${counts.check} à vérifier` : ""}${counts.none ? ` · ${counts.none} non classé${counts.none > 1 ? "s" : ""}` : ""}`}
          padded={false}
        >
          <div className="flex flex-wrap gap-1 px-3 pt-3 pb-2" style={{ borderBottom: "1px solid var(--border)" }}>
            {FILTERS.map((f) => {
              const active = filter === f.key;
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  className="h-[26px] px-2.5 rounded-full text-[11.5px] font-medium inline-flex items-center gap-1.5"
                  style={{
                    background: active ? (f.color ? `color-mix(in srgb, ${f.color} 24%, var(--surface))` : "var(--surface)") : "var(--surface-2)",
                    border: `1px solid ${active ? (f.color ?? "var(--text-2)") : "var(--border)"}`,
                    color: active ? "var(--text)" : "var(--text-2)",
                  }}
                >
                  {f.label}
                  <span className="num opacity-70">{f.n}</span>
                </button>
              );
            })}
          </div>
          {loading ? (
            <div className="p-4">
              <Spinner label="Chargement…" />
            </div>
          ) : !rows.length ? (
            <Empty>Colle ton premier lien au-dessus.</Empty>
          ) : !shown.length ? (
            <Empty>Rien dans ce filtre.</Empty>
          ) : (
            <ul className="max-h-[70vh] overflow-y-auto">
              {shown.map((s, i) => (
                <li key={s.id} style={{ borderBottom: i < shown.length - 1 ? "1px solid var(--border)" : "none" }}>
                  <button onClick={() => open(s)} className="w-full text-left px-3 py-2.5 flex gap-2.5 transition-colors" style={{ background: selectedId === s.id ? "var(--accent-soft)" : "transparent" }}>
                    {s.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={s.thumbnail} alt="" className="w-[38px] h-[48px] object-cover rounded-[6px] shrink-0" loading="lazy" />
                    ) : (
                      <span className="w-[38px] h-[48px] rounded-[6px] shrink-0 grid place-items-center text-[15px]" style={{ background: "var(--surface-3)" }}>
                        ▶
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12.5px] font-medium leading-snug line-clamp-2">{s.title || s.caption || s.url}</span>
                      <span className="flex items-center gap-1.5 mt-1 flex-wrap">
                        <StageBadge s={s} small />
                        {s.analysis?.format && <span className="badge !text-[10px] !py-0">{FORMAT_LABEL[s.analysis.format] ?? s.analysis.format}</span>}
                        {swipeProdStatus(s) !== "source" && <span className="badge badge-accent !text-[10px] !py-0">{SWIPE_PROD_LABEL[swipeProdStatus(s)]}</span>}
                        <span className="badge !text-[10px] !py-0">{s.platform}</span>
                        {!s.analysis && <span className="badge badge-warn !text-[10px] !py-0">{label(s.status)}</span>}
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
              {selected.analysis?.etape && (
                <div className="px-4 pt-3.5 flex items-center gap-2.5 flex-wrap">
                  <StageBadge s={selected} />
                  <SpeakersBadge speakers={selected.script?.speakers ?? selected.analysis.speakers} />
                  <span className="dim text-[12px]">
                    IA : {selected.analysis.etape} à {selected.analysis.confiance ?? 0} %{selected.analysis.format ? ` · ${FORMAT_LABEL[selected.analysis.format] ?? selected.analysis.format}` : ""}
                  </span>
                  <span className="dim text-[12px] hidden md:inline" title={STAGE_HINT[swipeStage(selected) || "TOFU"]}>
                    {STAGE_HINT[swipeStage(selected) || "TOFU"]}
                  </span>
                  <select
                    className="select select-sm !w-auto ml-auto"
                    value={selected.etapeManuelle ?? ""}
                    onChange={(e) => void setStage(selected, e.target.value as SwipeStage | "")}
                    title="Corriger l'étape à la main : la correction prime sur le classement automatique"
                  >
                    <option value="">Auto ({selected.analysis.etape})</option>
                    {SWIPE_STAGES.map((st) => (
                      <option key={st} value={st}>
                        {st} (corrigé)
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="px-4 pt-3">
                <ProdStepper
                  s={selected}
                  onChange={(status, dates) => setRows((prev) => prev.map((x) => (x.id === selected.id ? { ...x, prodStatus: status, prodDates: dates } : x)))}
                />
              </div>
              <div className="px-4 pt-3">
                <Tabs
                  value={panel}
                  onChange={setPanel}
                  options={[
                    { value: "source", label: "Source" },
                    { value: "monscript", label: "Mon script" },
                    ...(selected.analysis
                      ? ([
                          { value: "mecanique", label: "Mécanique" },
                          { value: "script", label: "Script + traduction" },
                          { value: "plans", label: "Plans à filmer" },
                          { value: "adaptation", label: "Adaptation IA" },
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
                      La transcription Whisper se tente depuis le lien (bouton ci-dessous). Si la plateforme bloque, ouvre le Reel, active les sous-titres et colle le texte. La
                      légende seule suffit pour un carrousel, pas pour un Reel.
                    </InfoNote>

                    {selected.caption && (
                      <Field label="Légende récupérée">
                        <p className="prose-sm p-2.5 rounded-[8px]" style={{ background: "var(--surface-2)" }}>
                          {selected.caption}
                        </p>
                      </Field>
                    )}

                    <Field label="Transcription / script brut" hint="Colle le texte tel quel, même avec les hésitations : l'IA nettoie.">
                      <textarea className="textarea" style={{ minHeight: 190 }} value={transcript} onChange={(e) => setTranscript(e.target.value)} placeholder="Colle ici tout ce qui est dit dans la vidéo…" />
                    </Field>
                    <div className="flex items-center gap-2 flex-wrap -mt-1.5">
                      <button className="btn btn-sm" onClick={() => void transcribe()} disabled={transcribing || translating || analyzing} title="Récupère l'audio du Reel et le transcrit avec Whisper">
                        {transcribing ? <span className="spinner" /> : "≡"} {transcribing ? "Transcription…" : "Transcrire la vidéo (Whisper)"}
                      </button>
                      <button className="btn btn-sm" onClick={() => void translate()} disabled={translating || transcribing || analyzing || !transcript.trim()} title="Contenu US ou autre : traduction fidèle en français parlé, sans réécrire. L'original reste accessible.">
                        {translating ? <span className="spinner" /> : "🌐"} {translating ? "Traduction…" : "Traduire en français"}
                      </button>
                      {selected.transcriptSourceInput && (
                        <>
                          <button className="btn btn-sm btn-ghost" onClick={() => setShowSource((v) => !v)}>
                            {showSource ? "Masquer l'original" : `Voir l'original${selected.transcriptLang ? ` (${selected.transcriptLang})` : ""}`}
                          </button>
                          <button className="btn btn-sm btn-ghost" onClick={() => void restoreSource()} title="Remet le texte d'origine dans la transcription">
                            Rétablir l'original
                          </button>
                        </>
                      )}
                    </div>
                    {showSource && selected.transcriptSourceInput && (
                      <Field label={`Original${selected.transcriptLang ? ` · ${selected.transcriptLang}` : ""}`}>
                        <p className="prose-sm p-3 rounded-[8px] whitespace-pre-line leading-[1.8]" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                          {selected.transcriptSourceInput}
                        </p>
                      </Field>
                    )}

                    <Field label="Texte à l'écran (optionnel)" hint="Les textes incrustés, s'il y en a : ils aident le classement TOFU / MOFU / BOFU.">
                      <textarea className="textarea" style={{ minHeight: 70 }} value={screenText} onChange={(e) => setScreenText(e.target.value)} placeholder="Ex. « 3 erreurs qui tuent ton ROAS »" />
                    </Field>

                    {error && <ErrorNote>{error}</ErrorNote>}

                    <div className="flex justify-end">
                      <button className="btn btn-primary" onClick={() => void analyze()} disabled={analyzing || transcribing}>
                        {analyzing ? <span className="spinner" /> : "✦"} {analyzing ? "Analyse en cours…" : selected.analysis ? "Décortiquer à nouveau" : "Décortiquer avec l'IA"}
                      </button>
                    </div>
                  </div>
                )}

                {panel === "monscript" && (
                  <MyScriptPanel
                    key={selected.id}
                    s={selected}
                    onPatch={async (p) => {
                      await patch(selected.id, p);
                    }}
                    onGenerated={(script: SwipeScript, status: SwipeProdStatus, dates) =>
                      setRows((prev) => prev.map((x) => (x.id === selected.id ? { ...x, script, prodStatus: status, prodDates: dates, status: x.status === "a-analyser" ? "analyse" : x.status } : x)))
                    }
                  />
                )}
                {selected.analysis && panel === "script" && <ScriptPanel a={selected.analysis} />}
                {selected.analysis && panel === "mecanique" && <MechanicsPanel a={selected.analysis} />}
                {selected.analysis && panel === "plans" && <ShotsPanel a={selected.analysis} />}
                {selected.analysis && panel === "adaptation" && <AdaptationPanel a={selected.analysis} onCreatePost={() => void toPost()} />}
                {selected.analysis && panel === "prompts" && <PromptsInline a={selected.analysis} swipeId={selected.id} />}
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
      <p className={`prose-sm p-3.5 rounded-[8px] whitespace-pre-line leading-[1.8] ${mono ? "mono !text-[12px]" : "text-[13.5px]"}`} style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
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
        <SpeakersBadge speakers={a.speakers} />
        {translated && <span className="badge badge-accent">Traduit automatiquement en français</span>}
        {a.scoreViralite > 0 && <span className={`badge ${a.scoreViralite >= 70 ? "badge-good" : "badge-warn"}`}>Potentiel {a.scoreViralite}/100</span>}
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
              <span key={i} className="badge">
                {t}
              </span>
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
                <p className="text-[12px] leading-relaxed mt-2 pt-2" style={{ borderTop: "1px solid var(--border)", color: "var(--accent)" }}>
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
              <span key={i} className="badge">
                {h}
              </span>
            ))}
          </div>
        </div>
      )}

      {a.altHooks?.length > 0 && (
        <div>
          <span className="label-xs block mb-2">Hooks alternatifs à tester</span>
          <ul className="flex flex-col gap-1.5">
            {a.altHooks.map((h, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-3 py-2 rounded-[8px] text-[13px]" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
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
