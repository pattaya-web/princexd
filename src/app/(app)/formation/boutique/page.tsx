"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { ErrorNote, Spinner, useToast } from "@/components/ui";
import { PortalFooter, SectionLabel } from "@/components/formation/portal";
import { DropZone } from "@/components/upload-ui";
import { DEFAULT_THEME_PROMPT, fmtBytes } from "@/lib/formation-methode";
import type { MethodPayload } from "@/app/api/formation/methode/route";
import type { StudentMethodSettings, StudentThemeFile } from "@/lib/types";

/**
 * Ta boutique (Scale X) : l'élève télécharge le thème de Mady (zip), le met
 * dans son dossier, et colle à Claude Code (VS Code) le message qui lui fait
 * poser le thème et remplacer textes, images et vidéos par ceux de son
 * produit. La page est parfaite : on ne touche pas au design. L'admin
 * dépose le zip et modifie les textes sur place.
 */
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
      toast(`Thème déposé : ${body.theme?.fileName ?? file.name}. Les élèves peuvent le télécharger.`);
      await load();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setUploading(false);
    }
  };

  const removeTheme = async () => {
    if (!window.confirm("Retirer le thème ? Les élèves ne pourront plus le télécharger.")) return;
    try {
      await api("/api/formation/theme", { method: "DELETE" });
      toast("Thème retiré.");
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
  const prompt = data.theme ? m.themePrompt.replace("[NOM-DU-ZIP].zip", data.theme.fileName) : m.themePrompt;

  return (
    <div className="flex flex-col gap-5">
      <header>
        <div className="label-xs" style={{ letterSpacing: "0.12em" }}>
          Scale X / Ta boutique
        </div>
        <h1 className="text-[28px] sm:text-[34px] font-semibold leading-tight mt-2" style={{ letterSpacing: "-0.03em" }}>
          Le thème de Mady, sur ta boutique.
        </h1>
        <p className="muted text-[14px] mt-1 max-w-[64ch]">Tu télécharges le thème, tu le donnes à Claude Code, il met ton produit dedans. Tu ne touches pas au design.</p>
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
          <DropZone label={data.theme ? "Remplacer le thème (zip Shopify)" : "Déposer le thème (zip Shopify)"} hint="Boutique en ligne > Thèmes > ⋯ > Télécharger le fichier du thème. 200 Mo max. Un seul thème : le nouveau remplace l'ancien." accept=".zip,application/zip" multiple={false} disabled={uploading} onFiles={(f) => void uploadTheme(f)} compact />
          {uploading && <Spinner label="Envoi du thème…" />}
          {data.theme && (
            <div className="flex flex-wrap items-center gap-3 text-[13px]">
              <span>
                En place : <strong>{data.theme.fileName}</strong> · {fmtBytes(data.theme.size)}
              </span>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => void removeTheme()}>
                Retirer
              </button>
            </div>
          )}
          <label className="flex flex-col gap-1">
            <span className="label-xs">Ce que l&apos;élève doit savoir</span>
            <textarea className="input" rows={4} value={draft.themeNote} onChange={(e) => setDraft({ ...draft, themeNote: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="label-xs">Message à coller à Claude Code ([NOM-DU-ZIP].zip est remplacé par le vrai nom)</span>
            <textarea className="input" rows={14} value={draft.themePrompt} onChange={(e) => setDraft({ ...draft, themePrompt: e.target.value })} style={{ fontFamily: "inherit" }} />
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

      {/* 01 / Télécharger */}
      <section className="card p-5" style={{ borderColor: "var(--accent-ring)" }}>
        <SectionLabel n="01" title="Télécharge le thème" />
        <p className="muted text-[13.5px] mt-3 leading-relaxed max-w-[64ch]">{m.themeNote}</p>
        {data.theme ? (
          <div className="flex flex-wrap items-center gap-3 mt-4">
            <a href={data.theme.downloadUrl} className="btn btn-primary">
              Télécharger {data.theme.fileName}
            </a>
            <span className="dim text-[12.5px]">{fmtBytes(data.theme.size)}</span>
          </div>
        ) : (
          <div className="dim text-[12.5px] mt-4">{data.isAdmin ? "Dépose ton thème avec « Modifier la page »." : "Le thème arrive bientôt : demande à Mady si tu es prêt."}</div>
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

      {/* 02 / Mettre dans le dossier */}
      <section className="card p-5">
        <SectionLabel n="02" title="Mets le fichier dans ton dossier" />
        <ol className="list-decimal pl-5 mt-3 flex flex-col gap-1.5 text-[13.5px] leading-relaxed">
          <li>
            Ouvre ton dossier <strong>MA-BOUTIQUE</strong> (celui que tu as créé dans Démarrage).
          </li>
          <li>
            Glisse le fichier <strong>{data.theme?.fileName ?? "du thème (.zip)"}</strong> dedans. Ne l&apos;ouvre pas, ne le décompresse pas : Claude s&apos;en occupe.
          </li>
          <li>
            Crée un sous-dossier <strong>creatives</strong> et mets-y tes images et vidéos (celles du Studio IA). C&apos;est là que Claude ira les chercher.
          </li>
        </ol>
      </section>

      {/* 03 / Le message pour Claude */}
      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionLabel n="03" title="Colle ce message à Claude Code" />
          <button type="button" className="btn btn-sm btn-primary" onClick={() => void copy(prompt, "Message copié. Colle-le à Claude dans VS Code et remplis les crochets.")}>
            Copier le message
          </button>
        </div>
        <p className="muted text-[13.5px] mt-3 leading-relaxed max-w-[64ch]">Dans VS Code, panneau Claude Code. Remplis les crochets avec ton produit avant d&apos;envoyer. Puis tu dis oui quand il demande.</p>
        <pre className="mt-3 text-[13px] leading-relaxed whitespace-pre-wrap rounded-md p-3" style={{ background: "var(--surface-3)", fontFamily: "inherit" }}>
          {prompt}
        </pre>
      </section>

      {/* 04 / Vérifier et mettre en ligne */}
      <section className="card p-5">
        <SectionLabel n="04" title="Vérifie, puis mets en ligne" />
        <ul className="list-disc pl-5 mt-3 flex flex-col gap-1.5 text-[13.5px] leading-relaxed">
          <li>Claude te montre section par section. Tu regardes dans l&apos;aperçu (fenêtre 3, F5). Si un texte ne te plaît pas : « réécris ce titre, plus court ».</li>
          <li>Tu ne demandes pas de changer le design, les couleurs ou l&apos;ordre des sections. La page est faite pour vendre telle quelle.</li>
          <li>Quand tout est bon : « OK, mets en ligne ». Puis la commande test et le Pixel (Démarrage, sections 07 et 08).</li>
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
