"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { ErrorNote, Spinner, useToast } from "@/components/ui";
import { Annex } from "@/components/formation/Annex";
import { PortalFooter, SectionLabel, waHelpLink } from "@/components/formation/portal";
import { GUIDE_SECTIONS, type GuideNote, type GuideSection, type GuideStep } from "@/lib/formation-guide";
import { youtubeEmbedUrl, youtubeId } from "@/lib/formation";
import { DropZone, ProgressBar, uploadMany, type Progress } from "@/components/upload-ui";
import type { DemarragePayload } from "@/app/api/formation/demarrage/route";

/**
 * Démarrage (Scale X) : la première page qu'un élève doit lire.
 *
 * Le message de bienvenue (formulaire + outils), puis le guide complet pour
 * installer Claude Code, connecter Shopify, paramétrer la boutique, poser le
 * thème Aesthetic Lab et le Pixel Meta, et enfin le bouton « Demande ta
 * boutique à Mady ». Tout est copiable, l'élève avance seul.
 */

const NOTE_COLORS: Record<GuideNote["kind"], string> = {
  info: "var(--accent)",
  ok: "var(--good)",
  warn: "var(--warning)",
  danger: "var(--bad)",
};

function Note({ note }: { note: GuideNote }) {
  const c = NOTE_COLORS[note.kind];
  return (
    <div className="rounded-md px-3.5 py-2.5 text-[13.5px] leading-relaxed" style={{ borderLeft: `3px solid ${c}`, background: `color-mix(in srgb, ${c} 8%, transparent)` }}>
      <div className="font-semibold" style={{ color: c }}>
        {note.title}
      </div>
      <div className="mt-0.5">{note.text}</div>
    </div>
  );
}

function Cmd({ text }: { text: string }) {
  const toast = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copié. Colle-le à Claude dans VS Code.");
    } catch {
      toast("Copie impossible : sélectionne le texte à la main.", "err");
    }
  };
  return (
    <div className="flex items-stretch gap-2 rounded-md overflow-hidden border" style={{ borderColor: "var(--border)", background: "var(--surface-3)" }}>
      <div className="flex-1 min-w-0 px-3 py-2 text-[13.5px] leading-relaxed whitespace-pre-wrap break-words">
        <div className="label-xs mb-1" style={{ color: "var(--accent)" }}>
          À copier-coller à Claude
        </div>
        {text}
      </div>
      <button type="button" onClick={() => void copy()} className="btn btn-sm !rounded-none shrink-0" style={{ borderLeft: "1px solid var(--border)" }}>
        Copier
      </button>
    </div>
  );
}

function Step({ step, index, done, onToggle }: { step: GuideStep; index: number; done: boolean; onToggle: () => void }) {
  return (
    <div className="flex gap-3.5 py-4 border-b last:border-b-0" style={{ borderColor: "var(--border)", opacity: done ? 0.68 : 1 }}>
      <button
        type="button"
        onClick={onToggle}
        aria-label={done ? "Décocher" : "Marquer comme faite"}
        title={done ? "Fait. Clique pour décocher." : "Clique quand c'est fait."}
        className="shrink-0 w-[30px] h-[30px] rounded-md flex items-center justify-center text-[13px] font-bold transition-colors"
        style={{ background: done ? "var(--good)" : "var(--accent)", color: "var(--accent-on)" }}
      >
        {done ? "✓" : index}
      </button>
      <div className="min-w-0 flex-1 flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[15.5px] font-semibold leading-snug" style={{ textDecoration: done ? "line-through" : "none" }}>
            {step.title}
          </span>
          <button type="button" onClick={onToggle} className="text-[12px] font-medium hover:underline" style={{ color: done ? "var(--good)" : "var(--accent)" }}>
            {done ? "Fait" : "Marquer fait"}
          </button>
        </div>
        <Annex text={step.text} className="!text-[13.5px]" />
        {step.cmds?.map((c) => (
          <Cmd key={c} text={c} />
        ))}
        {step.link && (
          <a href={step.link.href} target="_blank" rel="noreferrer" className="btn btn-sm w-fit">
            {step.link.label} ↗
          </a>
        )}
        {step.note && <Note note={step.note} />}
      </div>
    </div>
  );
}

function Section({ s, os, setOs, done, onToggle }: { s: GuideSection; os: "windows" | "mac"; setOs: (v: "windows" | "mac") => void; done: Set<string>; onToggle: (key: string, done: boolean) => void }) {
  const steps = s.os ? s.os[os] : (s.steps ?? []);
  const keyOf = (i: number) => `${s.id}:${s.os ? os : ""}:${i}`;
  const doneCount = steps.filter((_, i) => done.has(keyOf(i))).length;
  return (
    <section id={s.id} className="card p-5 scroll-mt-4">
      <div className="flex items-center justify-between gap-3">
        <SectionLabel n={s.n} title={s.title} />
        {steps.length > 0 && (
          <span className={`label-xs num ${doneCount === steps.length ? "" : "dim"}`} style={doneCount === steps.length ? { color: "var(--good)" } : undefined}>
            {doneCount} / {steps.length} {doneCount === steps.length ? "✓" : ""}
          </span>
        )}
      </div>
      <h2 className="text-[22px] font-semibold leading-tight mt-2" style={{ letterSpacing: "-0.02em" }}>
        {s.title}
      </h2>
      {s.intro && <p className="muted text-[14px] mt-2 leading-relaxed">{s.intro}</p>}
      {s.notes && (
        <div className="flex flex-col gap-2 mt-4">
          {s.notes.map((n) => (
            <Note key={n.title} note={n} />
          ))}
        </div>
      )}
      {s.defs && (
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 mt-4">
          {s.defs.map((d) => (
            <div key={d.term}>
              <dt className="text-[13.5px] font-semibold">{d.term}</dt>
              <dd className="muted text-[13px] leading-relaxed mt-0.5">{d.text}</dd>
            </div>
          ))}
        </dl>
      )}
      {s.os && (
        <div className="flex gap-1 mt-4 p-1 rounded-md w-fit" style={{ background: "var(--surface-3)" }}>
          {(["windows", "mac"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setOs(k)}
              className="tab-btn px-3.5 py-1.5 rounded text-[13px] font-medium"
              style={os === k ? { background: "var(--surface)", boxShadow: "0 1px 2px rgb(0 0 0 / 0.08)" } : { color: "var(--muted)" }}
            >
              {k === "windows" ? "Windows" : "Mac"}
            </button>
          ))}
        </div>
      )}
      {steps.length > 0 && (
        <div className="mt-2">
          {steps.map((st, i) => (
            <Step key={st.title} step={st} index={i + 1} done={done.has(keyOf(i))} onToggle={() => onToggle(keyOf(i), !done.has(keyOf(i)))} />
          ))}
        </div>
      )}
      {s.fixes && (
        <div className="mt-4">
          <div className="label-xs mb-2">Si quelque chose ne fonctionne pas</div>
          <ul className="flex flex-col gap-1.5 text-[13.5px]">
            {s.fixes.map((f) => (
              <li key={f.problem}>
                <span className="font-semibold" style={{ color: "var(--warning)" }}>
                  {f.problem} :
                </span>{" "}
                {f.fix}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export default function DemarragePage() {
  const toast = useToast();
  const [data, setData] = useState<DemarragePayload | null>(null);
  const [error, setError] = useState("");
  const [os, setOs] = useState<"windows" | "mac">("windows");
  const [editVideo, setEditVideo] = useState(false);
  const [videoUrl, setVideoUrl] = useState("");
  const [savingVideo, setSavingVideo] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<DemarragePayload>("/api/formation/demarrage"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
    if (typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent)) setOs("mac");
  }, [load]);

  const toggleGuide = async (key: string, done: boolean) => {
    if (!data?.student) {
      toast("Tu es admin : les coches sont celles des élèves.");
      return;
    }
    // Optimiste : la coche répond tout de suite, le serveur confirme.
    setData((d) => (d ? { ...d, guideDone: done ? [...d.guideDone, key] : d.guideDone.filter((k) => k !== key) } : d));
    try {
      const r = await api<{ preview: boolean; guideDone: string[] }>("/api/formation/demarrage", { method: "PATCH", body: JSON.stringify({ key, done }) });
      if (r.preview) toast("Aperçu : la progression de l'élève n'est pas modifiée.");
      else setData((d) => (d ? { ...d, guideDone: r.guideDone } : d));
    } catch (e) {
      toast((e as Error).message, "err");
      await load();
    }
  };

  const saveVideo = async (url: string) => {
    if (!data?.portal) return;
    setSavingVideo(true);
    try {
      await api("/api/settings", { method: "PATCH", body: JSON.stringify({ studentPortal: { ...data.portal, welcomeVideoUrl: url.trim() } }) });
      toast(url.trim() ? "Vidéo enregistrée : les élèves la voient en haut de Démarrage." : "Vidéo retirée.");
      setEditVideo(false);
      await load();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setSavingVideo(false);
    }
  };

  const dropVideo = async (files: File[]) => {
    try {
      const up = await uploadMany(files.slice(0, 1), setProgress);
      if (up[0]) await saveVideo(up[0].url);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setProgress(null);
    }
  };

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Spinner label="Chargement…" />;

  const name = data.student?.firstName ?? "Mady";
  const wa = waHelpLink(data.whatsapp, name);
  const guideDone = new Set(data.guideDone);

  return (
    <div className="flex flex-col gap-5">
      <header>
        <div className="label-xs" style={{ letterSpacing: "0.12em" }}>
          Scale X / Démarrage
        </div>
        <h1 className="text-[28px] sm:text-[34px] font-semibold leading-tight mt-2" style={{ letterSpacing: "-0.03em" }}>
          Commence ici.
        </h1>
        <p className="muted text-[14px] mt-1 max-w-[62ch]">Dans l&apos;ordre : le formulaire, VS Code, Claude Code, ta boutique. Pas de code, pas de commande : tu parles à Claude, il fait. Coche chaque étape quand elle est faite (clique sur son numéro).</p>
        {data.preview && <div className="badge badge-warn w-fit !text-[11.5px] mt-3">Aperçu : tu vois Scale X comme {data.student?.name}. Rien n&apos;est enregistré.</div>}
        {data.isAdmin && !data.student && (
          <div className="flex flex-wrap gap-2 mt-3">
            <Link href="/eleves/onboarding" className="btn btn-sm">
              Modifier le message d&apos;onboarding
            </Link>
            <Link href="/formation/parcours" className="btn btn-sm btn-ghost">
              Parcours &amp; étapes
            </Link>
          </div>
        )}
      </header>

      {/* 00 / Bienvenue : la vidéo d'accompagnement, les liens utiles, le message d'onboarding */}
      <section className="card p-5">
        <div className="flex items-center justify-between gap-3">
          <SectionLabel n="00" title="Bienvenue" />
          {data.isAdmin && !data.student && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setVideoUrl(data.welcomeVideoUrl); setEditVideo((v) => !v); }}>
              {data.welcomeVideoUrl ? "Changer la vidéo" : "Ajouter la vidéo d'accompagnement"}
            </button>
          )}
        </div>
        {editVideo && data.portal && (
          <div className="card-flat p-3 mt-3 flex flex-col gap-2">
            <div className="label-xs">Vidéo d&apos;accompagnement</div>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void saveVideo(videoUrl);
              }}
            >
              <input className="input flex-1" placeholder="Lien YouTube (non répertorié) ou lien d'un fichier vidéo" value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} inputMode="url" />
              <button type="submit" className="btn btn-sm btn-primary" disabled={savingVideo}>
                {savingVideo ? "…" : "Enregistrer"}
              </button>
              {data.welcomeVideoUrl && (
                <button type="button" className="btn btn-sm btn-ghost" disabled={savingVideo} onClick={() => void saveVideo("")}>
                  Retirer
                </button>
              )}
            </form>
            <DropZone label="Ou dépose le fichier vidéo ici (MP4)" hint="Hébergé sur la plateforme. YouTube non répertorié reste plus léger pour les élèves." accept="video/*" multiple={false} onFiles={(f) => void dropVideo(f)} compact />
            {progress && <ProgressBar p={progress} />}
          </div>
        )}
        {data.welcomeVideoUrl && (
          <div className="mt-3 rounded-lg overflow-hidden" style={{ background: "#000" }}>
            {youtubeId(data.welcomeVideoUrl) ? (
              <div style={{ position: "relative", paddingTop: "56.25%" }}>
                <iframe
                  src={youtubeEmbedUrl(youtubeId(data.welcomeVideoUrl)!)}
                  title="Vidéo d'accompagnement"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
                />
              </div>
            ) : (
              <video src={data.welcomeVideoUrl} controls playsInline preload="metadata" className="w-full max-h-[70vh]" />
            )}
          </div>
        )}
        {!data.welcomeVideoUrl && data.isAdmin && !data.student && <p className="dim text-[12.5px] mt-3">Pas encore de vidéo : ajoute ta vidéo d&apos;accompagnement, elle s&apos;affiche ici avec les liens en dessous.</p>}
        {data.links.length > 0 && (
          <div className="mt-4">
            <div className="label-xs mb-2">Les liens</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {data.links.map((l) => (
                <a key={l.href + l.label} href={l.href} target="_blank" rel="noreferrer" className="card-flat px-3 py-2.5 flex items-center justify-between gap-3 hover:underline">
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-semibold leading-snug">{l.label}</span>
                    <span className="dim text-[12px]">{l.note}</span>
                  </span>
                  <span className="shrink-0 text-[13px]">↗</span>
                </a>
              ))}
            </div>
          </div>
        )}
        <div className="mt-4 text-[14.5px] leading-relaxed whitespace-pre-wrap">
          <Annex text={data.welcome} className="!text-[14.5px]" />
        </div>
      </section>

      {/* Sommaire */}
      <nav className="card-flat p-4 flex flex-wrap gap-x-4 gap-y-1.5 text-[13px]">
        {GUIDE_SECTIONS.map((s) => (
          <a key={s.id} href={`#${s.id}`} className="font-medium hover:underline">
            <span className="dim num mr-1">{s.n}</span>
            {s.title}
          </a>
        ))}
      </nav>

      {GUIDE_SECTIONS.map((s) => (
        <Section key={s.id} s={s} os={os} setOs={setOs} done={guideDone} onToggle={(k, d) => void toggleGuide(k, d)} />
      ))}

      <section className="card p-5 flex flex-col sm:flex-row sm:items-center gap-3" style={{ borderColor: "var(--accent-ring)" }}>
        <div className="flex-1">
          <div className="label-xs" style={{ letterSpacing: "0.12em" }}>
            ET MAINTENANT
          </div>
          <div className="text-[17px] font-semibold mt-1 leading-snug">Tout est installé ? Passe à la recherche produit.</div>
          <div className="muted text-[13.5px] mt-1 leading-relaxed">La vidéo BrandSearch, tes 10 produits envoyés à Mady, la validation. Ensuite les créatives, puis le thème de Mady sur ta boutique.</div>
        </div>
        <Link href="/formation/produit" className="btn btn-primary shrink-0">
          Recherche produit →
        </Link>
      </section>

      <section className="card-flat p-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 text-[13.5px] leading-relaxed">
          <strong>Bloqué ?</strong> Demande d&apos;abord à Claude (section 09), avec la capture d&apos;écran de l&apos;erreur. Si c&apos;est une vraie urgence, écris à Mady.
        </div>
        {wa && (
          <a href={wa} target="_blank" rel="noreferrer" className="btn btn-sm shrink-0">
            Urgence : WhatsApp Mady
          </a>
        )}
        {data.bookingUrl && (
          <a href={data.bookingUrl} target="_blank" rel="noreferrer" className="btn btn-sm btn-ghost shrink-0">
            Réserver un call
          </a>
        )}
      </section>

      <PortalFooter quote="Plus vite tu lances, plus vite tu apprends. Le reste, c'est de l'optimisation." author="Mady" />
    </div>
  );
}
