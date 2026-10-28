"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { ErrorNote, Spinner, useToast } from "@/components/ui";
import { PortalFooter, SectionLabel } from "@/components/formation/portal";
import type { StudentStudioPayload } from "@/app/api/formation/studio/route";

/**
 * Studio IA (Scale X) : la porte d'entrée de l'élève vers le Studio.
 *
 * Ouvert dès le premier jour pour tout élève. L'élève crée son compte KIE,
 * colle sa clé API ici (vérifiée auprès de KIE, jamais réaffichée en clair),
 * voit son solde, et entre dans le Studio : il y génère images et vidéos sur
 * ses propres crédits, et ne voit que ses résultats.
 */
export default function StudentStudioPage() {
  const toast = useToast();
  const [data, setData] = useState<StudentStudioPayload | null>(null);
  const [error, setError] = useState("");
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<StudentStudioPayload>("/api/formation/studio"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (value: string) => {
    setSaving(true);
    try {
      const r = await api<{ preview: boolean; credits: number | null }>("/api/formation/studio", { method: "PATCH", body: JSON.stringify({ kieApiKey: value }) });
      if (r.preview) toast("Aperçu : la clé de l'élève n'est pas modifiée.");
      else if (value === "CLEAR") toast("Clé effacée.");
      else toast(`Clé enregistrée et vérifiée : ${r.credits ?? 0} crédits KIE sur ton compte.`);
      setKey("");
      await load();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setSaving(false);
    }
  };

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Spinner label="Chargement…" />;

  const ready = data.access && data.hasKey;

  return (
    <div className="flex flex-col gap-5">
      <header>
        <div className="label-xs" style={{ letterSpacing: "0.12em" }}>
          Scale X / Studio IA
        </div>
        <h1 className="text-[28px] sm:text-[34px] font-semibold leading-tight mt-2" style={{ letterSpacing: "-0.03em" }}>
          Ton Studio IA.
        </h1>
        <p className="muted text-[14px] mt-1 max-w-[64ch]">Images produit, pubs statiques, vidéos à partir d&apos;une image : les mêmes modèles que Mady (GPT Image 2 pour les images, Seedance 2.5 pour les vidéos), sur ta propre clé KIE et tes crédits. Tes résultats ne sont visibles que par toi.</p>
        {data.preview && <div className="badge badge-warn w-fit !text-[11.5px] mt-3">Aperçu : tu vois Scale X comme {data.student?.name}.</div>}
      </header>

      {/* 01 / Accès */}
      <section className="card p-5">
        <div className="flex items-center justify-between gap-3">
          <SectionLabel n="01" title="Accès" />
          <span className={`badge !text-[10.5px] ${data.access ? "badge-good" : "badge-warn"}`}>{data.access ? "Ouvert" : "Ouvert dès le premier jour"}</span>
        </div>
        <p className="muted text-[13.5px] mt-3 leading-relaxed">
          Ton Studio IA est ouvert dès le premier jour : crée ton compte KIE, pose ta clé sur la page Studio IA, 20 à 30 € de crédits.{" "}
          {!data.hasKey && "Il te reste à poser ta clé KIE ci-dessous, puis tu entres."} Les prompts sont sur la page{" "}
          <Link href="/formation/creatives" className="underline">
            Créatives
          </Link>
          .
        </p>
      </section>

      {/* 02 / Clé KIE */}
      <section className="card p-5">
        <SectionLabel n="02" title="Ta clé KIE" />
        <p className="muted text-[13.5px] mt-3 leading-relaxed max-w-[64ch]">
          KIE est la plateforme qui fait tourner les modèles. Tu paies tes générations toi-même, en crédits, à l&apos;usage : 0,03 € l&apos;image (GPT Image 2), 2 à 3 € la vidéo de 15 s (Seedance 2.5). Compte 20 à 30 € de crédits pour tes premières créatives.
        </p>
        <ol className="list-decimal pl-5 mt-3 flex flex-col gap-1.5 text-[13.5px]">
          <li>
            Crée ton compte sur{" "}
            <a href="https://kie.ai" target="_blank" rel="noreferrer" className="underline" style={{ color: "var(--accent)" }}>
              kie.ai
            </a>{" "}
            (e-mail ou Google).
          </li>
          <li>Recharge des crédits : menu Billing / Credits, carte bancaire.</li>
          <li>Ouvre « API Key » dans le menu, clique « Create / Copy » et copie la clé (une longue suite de lettres et de chiffres).</li>
          <li>Colle-la ci-dessous. Elle est vérifiée auprès de KIE puis gardée pour toi ; personne ne la revoit en clair.</li>
        </ol>
        <div className="mt-4 flex flex-col gap-2 max-w-[560px]">
          {data.hasKey && (
            <div className="flex flex-wrap items-center gap-3 text-[13.5px]">
              <span>
                Clé en place : <span className="mono">{data.keyMask}</span>
              </span>
              <span className={`badge !text-[10.5px] ${data.credits !== null ? "badge-good" : "badge-warn"}`}>{data.credits !== null ? `${data.credits} crédits` : "clé refusée"}</span>
              {data.creditsError && <span className="dim text-[12px] w-full">{data.creditsError}</span>}
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => void save("CLEAR")} disabled={saving}>
                Effacer
              </button>
            </div>
          )}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void save(key);
            }}
          >
            <input className="input flex-1" type="password" autoComplete="off" placeholder={data.hasKey ? "Nouvelle clé (remplace l'actuelle)" : "Colle ta clé API KIE"} value={key} onChange={(e) => setKey(e.target.value)} />
            <button type="submit" className="btn btn-primary" disabled={saving || key.trim().length < 10}>
              {saving ? "Vérification…" : data.hasKey ? "Remplacer" : "Enregistrer"}
            </button>
          </form>
        </div>
      </section>

      {/* 03 / Entrer */}
      <section className="card p-5" style={{ borderColor: ready ? "var(--accent-ring)" : undefined }}>
        <SectionLabel n="03" title="Entrer dans le Studio" />
        <p className="muted text-[13.5px] mt-3 leading-relaxed max-w-[64ch]">
          Onglet <strong>Image</strong> : choisis GPT Image 2, importe ta photo de référence produit, colle le prompt écrit par Claude (page Créatives), choisis le ratio <strong>3:4</strong>, <strong>1:1</strong> ou <strong>9:16</strong>, génère. Onglet <strong>Création</strong> (Seedance 2.5) : pars d&apos;une image générée en 9:16, colle le prompt vidéo, toujours en <strong>9:16</strong>, 15 secondes, 5 plans de 3 s (réglage 16 s pour une vidéo de 15 s). Les résultats arrivent dans la galerie en haut, tu les télécharges avec la flèche.
        </p>
        <div className="flex flex-wrap items-center gap-3 mt-4">
          {ready ? (
            <Link href="/studio?kind=image" className="btn btn-primary">
              Ouvrir le Studio IA
            </Link>
          ) : (
            <button type="button" className="btn btn-primary" disabled>
              Ouvrir le Studio IA
            </button>
          )}
          <Link href="/formation/creatives" className="btn btn-ghost">
            Les prompts (Créatives)
          </Link>
          {!ready && <span className="dim text-[12.5px]">Pose d&apos;abord ta clé KIE.</span>}
        </div>
      </section>

      <PortalFooter quote="Pas de perfection : on teste vite et on garde ce qui marche." author="Mady" />
    </div>
  );
}
