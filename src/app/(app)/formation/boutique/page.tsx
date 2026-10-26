"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { ErrorNote, Spinner, useToast } from "@/components/ui";
import { PortalFooter, SectionLabel } from "@/components/formation/portal";
import { DropZone } from "@/components/upload-ui";
import { DEFAULT_THEME_PROMPT, fmtBytes, parseVideoSteps } from "@/lib/formation-methode";
import { youtubeEmbedUrl, youtubeId } from "@/lib/formation";
import type { MethodPayload } from "@/app/api/formation/methode/route";
import type { StudentMethodSettings, StudentThemeFile } from "@/lib/types";

/**
 * Ta boutique (Scale X) : l'élève télécharge le thème Aesthetic Lab de Mady
 * (zip), le met dans son dossier avec ses créatives, et colle à Claude Code
 * (VS Code) le message qui lui fait poser le thème avec Shopify CLI,
 * remplacer textes, images et vidéos par ceux de son produit, puis publier.
 * La page est parfaite : on ne touche pas au design. L'admin peut remplacer
 * le zip et modifier les textes sur place.
 */

/** Ce que Claude Code fait, dans l'ordre, une fois le message collé. L'élève ne tape aucune commande. */
const CLAUDE_STEPS = [
  { title: "Il décompresse le thème", text: "Le zip devient un dossier « theme » dans ton projet, avec les dossiers assets, sections, templates… Tu n'y touches pas." },
  { title: "Il le branche sur ta boutique avec Shopify CLI", text: "Il lance l'aperçu du thème (shopify theme dev) et te donne un lien qui commence par http://127.0.0.1:9292. Tu l'ouvres : c'est ta boutique avec le thème de Mady, en aperçu, chez toi." },
  { title: "Il remplace le contenu, section par section", text: "Nom de marque, e-mail support, textes du hero, bénéfices, avis, FAQ, pied de page. Tes images et vidéos du dossier « creatives » à la place des aplats gris. Ton produit à la place des exemples." },
  { title: "Tu vérifies dans l'aperçu (F5)", text: "À chaque section il te dit ce qu'il a changé. Un texte ne te plaît pas : « réécris ce titre, plus court ». Une image manque : il te dit laquelle et dans quel format." },
  { title: "Tu dis « OK, mets en ligne »", text: "Il envoie le thème sur ta boutique (shopify theme push) et le publie. Ta boutique est à jour. Puis commande test et Pixel." },
];

/** Les emplacements que le thème attend : ce que l'élève prépare à l'avance. */
const TO_PREPARE = [
  "Ton nom de marque et un e-mail support (ex. support@tamarque.com)",
  "Ta photo produit (celle du Studio, fond simple) + 3 photos lifestyle",
  "Une vidéo 9:16 pour le hero (la meilleure de tes vidéos IA) ou une image 16:9",
  "2 avant / après si ton produit s'y prête",
  "4 à 6 avis clients (prénom, âge, phrase) : Claude peut te les rédiger",
  "Prix, prix barré, délai de livraison",
];

export default function BoutiquePage() {
  const toast = useToast();
  const [data, setData] = useState<MethodPayload | null>(null);
  const [error, setError] = useState("");
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState<StudentMethodSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<MethodPayload>("/api/formation/methode"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const r = await api<{ method: StudentMethodSettings }>("/api/formation/methode", { method: "PATCH", body: JSON.stringify(draft) });
      setData((d) => (d ? { ...d, method: r.method } : d));
      setEdit(false);
      toast("Page enregistrée : les élèves la voient.");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setSaving(false);
    }
  };

  const uploadTheme = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/formation/theme", { method: "POST", body: fd });
      const body = (await res.json().catch(() => ({}))) as { error?: string; theme?: StudentThemeFile };
      if (!res.ok) throw new Error(body.error || `Erreur ${res.status}`);
      toast(`Thème déposé : ${body.theme?.fileName ?? file.name}. Les élèves le téléchargent à la place de celui du dépôt.`);
      await load();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setUploading(false);
    }
  };

  const removeTheme = async () => {
    if (!window.confirm("Retirer ce zip ? Les élèves retrouveront le thème Aesthetic Lab livré avec la plateforme.")) return;
    try {
      await api("/api/formation/theme", { method: "DELETE" });
      toast("Zip retiré : retour au thème livré avec la plateforme.");
      await load();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  const copy = async (text: string, msg: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(msg);
    } catch {
      toast("Copie impossible : sélectionne le texte à la main.", "err");
    }
  };

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Spinner label="Chargement…" />;

  const m = data.method;
  const zipName = data.theme?.fileName ?? "aesthetic-lab-template.zip";
  const prompt = m.themePrompt.replace("[NOM-DU-ZIP].zip", zipName);
  const vid = youtubeId(m.shopVideoUrl);
  const videoSteps = parseVideoSteps(m.shopVideoSteps);
  const summaryParas = m.shopVideoSummary.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

  return (
    <div className="flex flex-col gap-5">
      <header>
        <div className="label-xs" style={{ letterSpacing: "0.12em" }}>
          Scale X / Ta boutique
        </div>
        <h1 className="text-[28px] sm:text-[34px] font-semibold leading-tight mt-2" style={{ letterSpacing: "-0.03em" }}>
          Le thème de Mady, sur ta boutique.
        </h1>
        <p className="muted text-[14px] mt-1 max-w-[64ch]">Tu télécharges le thème Aesthetic Lab, tu le donnes à Claude Code, il le pose sur ta boutique avec Shopify CLI et met ton produit dedans. Tu ne touches pas au design.</p>
        {data.preview && <div className="badge badge-warn w-fit !text-[11.5px] mt-3">Aperçu : tu vois Scale X comme {data.student?.name}.</div>}
        {data.isAdmin && !edit && (
          <button
            type="button"
            className="btn btn-sm mt-3"
            onClick={() => {
              setDraft({ ...m });
              setEdit(true);
            }}
          >
            Modifier la page
          </button>
        )}
      </header>

      {edit && draft && (
        <section className="card p-5 flex flex-col gap-3">
          <SectionLabel n="Admin" title="Le thème et les textes" />
          <p className="muted text-[13px] leading-relaxed">Le thème Aesthetic Lab est livré avec la plateforme. Dépose un zip ici seulement pour le remplacer par une version plus récente.</p>
          <DropZone label="Remplacer le thème (zip Shopify)" hint="Le zip doit contenir assets / config / layout / locales / sections / snippets / templates à sa racine. 200 Mo max." accept=".zip,application/zip" multiple={false} disabled={uploading} onFiles={(f) => void uploadTheme(f)} compact />
          {uploading && <Spinner label="Envoi du thème…" />}
          {data.theme && (
            <div className="flex flex-wrap items-center gap-3 text-[13px]">
              <span>
                En place : <strong>{data.theme.fileName}</strong> · {fmtBytes(data.theme.size)} · {data.theme.bundled ? "livré avec la plateforme" : "déposé par toi"}
              </span>
              {!data.theme.bundled && (
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => void removeTheme()}>
                  Retirer (retour au thème livré)
                </button>
              )}
            </div>
          )}
          <label className="flex flex-col gap-1">
            <span className="label-xs">Vidéo « la boutique avec Claude » (lien YouTube, vide = pas de vidéo)</span>
            <input className="input" value={draft.shopVideoUrl} onChange={(e) => setDraft({ ...draft, shopVideoUrl: e.target.value })} placeholder="https://youtu.be/…" inputMode="url" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="label-xs">Résumé de la vidéo (sous le lecteur ; une ligne vide = nouveau paragraphe)</span>
            <textarea className="input" rows={6} value={draft.shopVideoSummary} onChange={(e) => setDraft({ ...draft, shopVideoSummary: e.target.value })} placeholder="Ce que Mady explique dans la vidéo, en quelques phrases." />
          </label>
          <label className="flex flex-col gap-1">
            <span className="label-xs">Les étapes de la vidéo (une par ligne, « Titre : détail »)</span>
            <textarea className="input" rows={8} value={draft.shopVideoSteps} onChange={(e) => setDraft({ ...draft, shopVideoSteps: e.target.value })} placeholder={"Télécharge le thème : le zip, tel quel, dans MA-BOUTIQUE\nColle le message à Claude : …"} style={{ fontFamily: "inherit" }} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="label-xs">Ce que l&apos;élève doit savoir</span>
            <textarea className="input" rows={4} value={draft.themeNote} onChange={(e) => setDraft({ ...draft, themeNote: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="label-xs">Message à coller à Claude Code ([NOM-DU-ZIP].zip est remplacé par le vrai nom)</span>
            <textarea className="input" rows={18} value={draft.themePrompt} onChange={(e) => setDraft({ ...draft, themePrompt: e.target.value })} style={{ fontFamily: "inherit" }} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving}>
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setEdit(false)} disabled={saving}>
              Annuler
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setDraft({ ...draft, themePrompt: DEFAULT_THEME_PROMPT })}>
              Remettre le message par défaut
            </button>
          </div>
        </section>
      )}

      {/* 00 / La vidéo : Mady crée la boutique avec Claude, puis le résumé et les étapes. */}
      {(vid || m.shopVideoUrl || summaryParas.length > 0 || videoSteps.length > 0) && (
        <section className="card p-5">
          <SectionLabel n="00" title="Regarde Mady créer la boutique avec Claude" />
          <p className="muted text-[13.5px] mt-3 leading-relaxed max-w-[64ch]">Toute la méthode en vidéo, du zip à la boutique en ligne. Regarde-la une fois en entier, puis suis les étapes 01 à 05 ci-dessous avec ton produit.</p>
          {vid ? (
            <div className="relative w-full mt-4 rounded-md overflow-hidden" style={{ aspectRatio: "16 / 9", background: "#000" }}>
              <iframe
                key={vid}
                className="absolute inset-0 w-full h-full"
                src={youtubeEmbedUrl(vid)}
                title="Créer ta boutique avec Claude Code"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            </div>
          ) : m.shopVideoUrl ? (
            <a href={m.shopVideoUrl} target="_blank" rel="noreferrer" className="btn btn-primary btn-sm mt-4">
              Voir la vidéo ↗
            </a>
          ) : null}
          {summaryParas.length > 0 && (
            <div className="mt-4">
              <div className="label-xs">En résumé</div>
              <div className="flex flex-col gap-2 mt-2 text-[13.5px] leading-relaxed max-w-[70ch]">
                {summaryParas.map((p, i) => (
                  <p key={i} className="whitespace-pre-wrap">
                    {p}
                  </p>
                ))}
              </div>
            </div>
          )}
          {videoSteps.length > 0 && (
            <div className="mt-4">
              <div className="label-xs">Les étapes à suivre, comme dans la vidéo</div>
              <div className="flex flex-col mt-1">
                {videoSteps.map((s, i) => (
                  <div key={`${i}-${s.title}`} className="flex gap-3.5 py-3 border-b last:border-b-0" style={{ borderColor: "var(--border)" }}>
                    <div className="shrink-0 w-[28px] h-[28px] rounded-md flex items-center justify-center text-[12.5px] font-bold" style={{ background: "var(--accent)", color: "var(--accent-on)" }}>
                      {i + 1}
                    </div>
                    <div className="min-w-0">
                      <div className="text-[14px] font-semibold leading-snug">{s.title}</div>
                      {s.text && <div className="muted text-[13px] mt-0.5 leading-relaxed">{s.text}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {data.isAdmin && summaryParas.length === 0 && videoSteps.length === 0 && (
            <div className="dim text-[12.5px] mt-3">Le résumé et les étapes de la vidéo se remplissent avec « Modifier la page ».</div>
          )}
        </section>
      )}

      {/* 01 / Télécharger */}
      <section className="card p-5" style={{ borderColor: "var(--accent-ring)" }}>
        <SectionLabel n="01" title="Télécharge le thème Aesthetic Lab" />
        <p className="muted text-[13.5px] mt-3 leading-relaxed max-w-[64ch]">{m.themeNote}</p>
        {data.theme ? (
          <div className="flex flex-wrap items-center gap-3 mt-4">
            <a href={data.theme.downloadUrl} className="btn btn-primary">
              Télécharger {data.theme.fileName}
            </a>
            <span className="dim text-[12.5px]">{fmtBytes(data.theme.size)} · ne l&apos;ouvre pas, ne le décompresse pas</span>
          </div>
        ) : (
          <div className="dim text-[12.5px] mt-4">{data.isAdmin ? "Aucun thème disponible : dépose un zip avec « Modifier la page »." : "Le thème arrive bientôt : demande à Mady si tu es prêt."}</div>
        )}
        {data.exampleShopUrl && (
          <p className="text-[13px] mt-3">
            À quoi ça ressemble en vrai :{" "}
            <a href={data.exampleShopUrl} target="_blank" rel="noreferrer" className="underline" style={{ color: "var(--accent)" }}>
              la boutique exemple de Mady ↗
            </a>
          </p>
        )}
      </section>

      {/* 02 / Préparer le dossier */}
      <section className="card p-5">
        <SectionLabel n="02" title="Prépare ton dossier" />
        <ol className="list-decimal pl-5 mt-3 flex flex-col gap-1.5 text-[13.5px] leading-relaxed">
          <li>
            Ouvre ton dossier <strong>MA-BOUTIQUE</strong> (celui de Démarrage, déjà ouvert dans VS Code).
          </li>
          <li>
            Glisse le fichier <strong>{zipName}</strong> dedans, tel quel.
          </li>
          <li>
            Crée un sous-dossier <strong>creatives</strong> et mets-y tes images et vidéos du Studio IA.
          </li>
        </ol>
        <div className="mt-4">
          <div className="label-xs">Ce que le thème attend de toi (prépare-le avant, Claude te le demandera)</div>
          <ul className="list-disc pl-5 mt-2 flex flex-col gap-1 text-[13.5px] leading-relaxed">
            {TO_PREPARE.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      </section>

      {/* 03 / Le message pour Claude */}
      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionLabel n="03" title="Colle ce message à Claude Code" />
          <button type="button" className="btn btn-sm btn-primary" onClick={() => void copy(prompt, "Message copié. Colle-le à Claude dans VS Code et remplis les crochets.")}>
            Copier le message
          </button>
        </div>
        <p className="muted text-[13.5px] mt-3 leading-relaxed max-w-[64ch]">Dans VS Code, panneau Claude Code. Remplis les crochets avec ton produit avant d&apos;envoyer. Ensuite tu dis oui quand il demande, et tu regardes l&apos;aperçu.</p>
        <pre className="mt-3 text-[13px] leading-relaxed whitespace-pre-wrap rounded-md p-3" style={{ background: "var(--surface-3)", fontFamily: "inherit" }}>
          {prompt}
        </pre>
      </section>

      {/* 04 / Ce que Claude fait */}
      <section className="card p-5">
        <SectionLabel n="04" title="Ce qui se passe ensuite (Shopify CLI, c'est Claude qui s'en occupe)" />
        <p className="muted text-[13.5px] mt-3 leading-relaxed max-w-[64ch]">Tu ne tapes aucune commande. Tu lis ce qu&apos;il fait, tu dis oui, tu vérifies dans l&apos;aperçu. Si un message rouge apparaît : capture d&apos;écran, « voilà l&apos;erreur, corrige et continue ».</p>
        <div className="flex flex-col mt-3">
          {CLAUDE_STEPS.map((s, i) => (
            <div key={s.title} className="flex gap-3.5 py-3 border-b last:border-b-0" style={{ borderColor: "var(--border)" }}>
              <div className="shrink-0 w-[28px] h-[28px] rounded-md flex items-center justify-center text-[12.5px] font-bold" style={{ background: "var(--accent)", color: "var(--accent-on)" }}>
                {i + 1}
              </div>
              <div className="min-w-0">
                <div className="text-[14px] font-semibold leading-snug">{s.title}</div>
                <div className="muted text-[13px] mt-0.5 leading-relaxed">{s.text}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 05 / Règles et suite */}
      <section className="card p-5">
        <SectionLabel n="05" title="Les règles, puis la suite" />
        <ul className="list-disc pl-5 mt-3 flex flex-col gap-1.5 text-[13.5px] leading-relaxed">
          <li>
            <strong>On ne change pas le design.</strong> Ni les couleurs, ni les polices, ni l&apos;ordre des sections. La page est faite pour vendre telle quelle : ton seul travail, c&apos;est ton produit, tes textes, tes images.
          </li>
          <li>
            <strong>Une section à la fois.</strong> Tu valides dans l&apos;aperçu avant de passer à la suivante. Tu peux aussi corriger un texte ou une image à la souris dans Shopify &gt; Personnaliser.
          </li>
          <li>
            <strong>Pas encore de créatives ?</strong> Claude pose le thème quand même, avec les aplats gris. Tu remplaces les médias quand ils sont prêts.
          </li>
          <li>
            <strong>Quand c&apos;est en ligne :</strong> commande test depuis ton téléphone, puis le Pixel Meta (Démarrage, sections 07 et 08).
          </li>
        </ul>
        <div className="flex flex-wrap items-center gap-3 mt-4">
          <Link href="/formation/demarrage#parametrer" className="btn btn-sm">
            Les réglages Shopify →
          </Link>
          <Link href="/formation/creatives" className="text-[13px] font-medium hover:underline">
            Il te manque des images ? Créatives
          </Link>
        </div>
      </section>

      <PortalFooter quote="La page est faite. Ton seul travail : ton produit, tes textes, tes images." author="Mady" />
    </div>
  );
}
