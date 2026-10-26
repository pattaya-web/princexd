"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { ErrorNote, Spinner, useToast } from "@/components/ui";
import { StepGate } from "@/components/formation/StepGate";
import { InstallProcess } from "@/components/formation/InstallProcess";
import { PortalFooter, SectionLabel, waHelpLink } from "@/components/formation/portal";
import { GUIDE_SECTIONS } from "@/lib/formation-guide";
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
    <StepGate tab="demarrage">
    <div className="flex flex-col gap-5">
      <header>
        <div className="label-xs" style={{ letterSpacing: "0.12em" }}>
          Scale X / Démarrage
        </div>
        <h1 className="text-[28px] sm:text-[34px] font-semibold leading-tight mt-2" style={{ letterSpacing: "-0.03em" }}>
          Commence ici.
        </h1>
        <p className="muted text-[14px] mt-1">Installe tes outils, étape par étape. Tu parles à Claude, il fait le reste.</p>
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

      {/* 00 / Les liens nécessaires. La vidéo de bienvenue et le formulaire sont sur l'accueil ; l'admin règle la vidéo ici. */}
      <section className="card p-5">
        <div className="flex items-center justify-between gap-3">
          <SectionLabel n="00" title="Les liens" />
          {data.isAdmin && !data.student && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setVideoUrl(data.welcomeVideoUrl); setEditVideo((v) => !v); }}>
              {data.welcomeVideoUrl ? "Changer la vidéo de bienvenue (accueil)" : "Ajouter la vidéo de bienvenue (accueil)"}
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
        {data.links.length > 0 && (
          <div className="mt-3">
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
      </section>

      {/* 01 / Le process d'installation, une rangée par étape, dépliable. */}
      <div className="label-xs" style={{ letterSpacing: "0.12em" }}>
        01 / INSTALLATION, ÉTAPE PAR ÉTAPE
      </div>
      <InstallProcess sections={GUIDE_SECTIONS} os={os} setOs={setOs} done={guideDone} onToggle={(k, d) => void toggleGuide(k, d)} />

      <section className="card p-5 flex flex-col sm:flex-row sm:items-center gap-3" style={{ borderColor: "var(--accent-ring)" }}>
        <div className="flex-1">
          <div className="label-xs" style={{ letterSpacing: "0.12em" }}>
            ET MAINTENANT
          </div>
          <div className="text-[17px] font-semibold mt-1 leading-snug">Tout est installé ? Passe à la recherche produit.</div>
        </div>
        <Link href="/formation/produit" className="btn btn-primary shrink-0">
          Recherche produit →
        </Link>
      </section>

      <section className="card-flat p-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 text-[13.5px] leading-relaxed">
          <strong>Bloqué ?</strong> Demande à Claude avec la capture d&apos;écran de l&apos;erreur. Vraie urgence : Mady.
        </div>
        {wa && (
          <a href={wa} target="_blank" rel="noreferrer" className="btn btn-sm shrink-0">
            WhatsApp Mady
          </a>
        )}
      </section>

      <PortalFooter quote="Plus vite tu lances, plus vite tu apprends. Le reste, c'est de l'optimisation." author="Mady" />
    </div>
    </StepGate>
  );
}
