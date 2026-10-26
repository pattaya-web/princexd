"use client";

import { useCallback, useEffect, useState } from "react";
import { api, useLocalState } from "@/lib/client";
import { ErrorNote, Spinner, useToast } from "@/components/ui";
import { StepGate } from "@/components/formation/StepGate";
import { VideoLock } from "@/components/formation/VideoLock";
import { PortalFooter, SectionLabel } from "@/components/formation/portal";
import { youtubeEmbedUrl, youtubeId } from "@/lib/formation";
import { emptyProductRows, PRODUCT_COLUMNS, productsAsText, type ProductRow } from "@/lib/formation-methode";
import type { MethodPayload } from "@/app/api/formation/methode/route";
import type { StudentMethodSettings } from "@/lib/types";

/**
 * Recherche produit (Scale X) : la vidéo BrandSearch de Mady, puis le
 * tableau des 10 produits que l'élève remplit et envoie à Mady sur WhatsApp.
 * Mady valide le produit avec lui, puis il passe aux créatives. Le tableau
 * reste dans le navigateur de l'élève (pas de validation dans l'outil : elle
 * se fait sur WhatsApp). L'admin modifie la vidéo et la consigne sur place.
 */

/** Les filtres BrandSearch de Mady (captures dans public/formation/brandsearch), tels qu'ils doivent être posés. */
const BRANDSEARCH_SHOTS = [
  { src: "/formation/brandsearch/filtres-marque.jpg", title: "Onglet Marque", note: "Épingle Marchés cibles, Trafic, Pubs Meta et Catalogue produits. Puis règle : Marchés cibles = US · Trafic 5k à 50k · Pubs Meta 25 à 90 · Catalogue produits 39 à 350 $." },
  { src: "/formation/brandsearch/filtres-pub.jpg", title: "Onglet Pub", note: "Actifs uniq. activé (Partenariat et Abonnement éteints), Format = Tous. Le reste, tu n'y touches pas." },
  { src: "/formation/brandsearch/filtre-date.jpg", title: "La date, en haut à droite", note: "Clique sur la date, choisis « Pub lancée » et prends les 3 derniers mois (ici du 1er août au 23 octobre). Tu veux des pubs récentes." },
  { src: "/formation/brandsearch/filtres-actifs.jpg", title: "Résultat : 6 filtres actifs", note: "Marchés US · Prix 39 à 350 $ · Trafic 5k à 50k · Pubs actives 25 à 90 · Pub lancée sur 3 mois · Status Active ads. Enregistre-le en preset pour ne plus le refaire." },
];

/** Les 6 réglages, en clair, pour copier le preset à la main. */
const BRANDSEARCH_FILTERS = [
  ["Marchés cibles", "US"],
  ["Prix du catalogue", "39 à 350 $"],
  ["Trafic", "5k à 50k"],
  ["Pubs Meta actives", "25 à 90"],
  ["Pub lancée", "les 3 derniers mois"],
  ["Status", "Active ads (Actifs uniq.)"],
];

function waLink(phone: string, text: string): string {
  let d = (phone ?? "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 10 && d.startsWith("0")) d = `33${d.slice(1)}`;
  if (!d) return "";
  return `https://wa.me/${d}?text=${encodeURIComponent(text)}`;
}

export default function ProduitPage() {
  const toast = useToast();
  const [data, setData] = useState<MethodPayload | null>(null);
  const [error, setError] = useState("");
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState<StudentMethodSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useLocalState<ProductRow[]>("scalex-produits", emptyProductRows(10));

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

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Spinner label="Chargement…" />;

  const m = data.method;
  const count = m.productCount;
  const table = rows.length === count ? rows : [...rows, ...emptyProductRows(Math.max(0, count - rows.length))].slice(0, count);
  const filled = table.filter((r) => r.name.trim() || r.link.trim()).length;
  const firstName = data.student?.firstName ?? "Mady";
  const text = productsAsText(table, firstName);
  const wa = waLink(data.whatsapp, text);
  const vid = youtubeId(m.productVideoUrl);

  const setCell = (i: number, key: keyof ProductRow, v: string) => setRows(table.map((r, j) => (j === i ? { ...r, [key]: v } : r)));

  const copyTable = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast("Tableau copié. Colle-le à Mady sur WhatsApp.");
    } catch {
      toast("Copie impossible : sélectionne le texte à la main.", "err");
    }
  };

  return (
    <StepGate tab="produit">
    <div className="flex flex-col gap-5">
      <header>
        <div className="label-xs" style={{ letterSpacing: "0.12em" }}>
          Scale X / Recherche produit
        </div>
        <h1 className="text-[28px] sm:text-[34px] font-semibold leading-tight mt-2" style={{ letterSpacing: "-0.03em" }}>
          Trouve ton produit.
        </h1>
        <p className="muted text-[14px] mt-1 max-w-[64ch]">
          Une vidéo, les bons filtres sur BrandSearch, {count} produits dans le tableau, tu envoies à Mady. Il valide avec toi, et tu passes aux créatives.
        </p>
        {data.brandsearchUrl && (
          <a href={data.brandsearchUrl} target="_blank" rel="noreferrer" className="btn btn-primary btn-sm mt-3 w-fit">
            Ouvrir BrandSearch (plan Starter) ↗
          </a>
        )}
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
          <SectionLabel n="Admin" title="Réglages de la page" />
          <label className="flex flex-col gap-1">
            <span className="label-xs">Vidéo BrandSearch (lien YouTube)</span>
            <input className="input" value={draft.productVideoUrl} onChange={(e) => setDraft({ ...draft, productVideoUrl: e.target.value })} placeholder="https://youtu.be/…" inputMode="url" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="label-xs">Nombre de produits à envoyer</span>
            <input className="input !w-[120px]" type="number" min={1} max={30} value={draft.productCount} onChange={(e) => setDraft({ ...draft, productCount: Number(e.target.value) || 10 })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="label-xs">Consigne</span>
            <textarea className="input" rows={3} value={draft.productNote} onChange={(e) => setDraft({ ...draft, productNote: e.target.value })} />
          </label>
          <p className="dim text-[12.5px]">Le numéro WhatsApp qui reçoit les tableaux se règle dans Formation → Parcours (réglages du portail).</p>
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving}>
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setEdit(false)} disabled={saving}>
              Annuler
            </button>
          </div>
        </section>
      )}

      {/* 01 / La vidéo */}
      <section className="card p-5" style={{ borderColor: "var(--accent-ring)" }}>
        <SectionLabel n="01" title="Regarde la vidéo BrandSearch" />
        <p className="muted text-[13.5px] mt-3 leading-relaxed max-w-[64ch]">{m.productNote}</p>
        {vid ? (
          <VideoLock>
            <div className="mt-4 rounded-lg overflow-hidden" style={{ background: "#000" }}>
              <div style={{ position: "relative", paddingTop: "56.25%" }}>
                <iframe
                  src={youtubeEmbedUrl(vid)}
                  title="Recherche produit avec BrandSearch"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
                />
              </div>
            </div>
          </VideoLock>
        ) : m.productVideoUrl ? (
          <VideoLock>
            <a href={m.productVideoUrl} target="_blank" rel="noreferrer" className="btn btn-primary btn-sm mt-4">
              Ouvrir la vidéo ↗
            </a>
          </VideoLock>
        ) : (
          <div className="dim text-[12.5px] mt-4">Vidéo à venir.</div>
        )}
      </section>

      {/* 02 / Les filtres BrandSearch */}
      <section className="card p-5">
        <SectionLabel n="02" title="Les filtres à mettre sur BrandSearch" />
        <p className="muted text-[13.5px] mt-3 leading-relaxed max-w-[64ch]">Exactement ces réglages, pas d&apos;autres. Fais-le une fois, enregistre en preset. Clique sur une capture pour l&apos;agrandir.</p>
        {data.brandsearchUrl && (
          <a href={data.brandsearchUrl} target="_blank" rel="noreferrer" className="btn btn-sm mt-3 w-fit">
            Ouvrir BrandSearch ↗
          </a>
        )}
        <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-3 text-[13px]">
          {BRANDSEARCH_FILTERS.map(([k, v]) => (
            <span key={k}>
              <span className="dim">{k} : </span>
              <strong>{v}</strong>
            </span>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 mt-4">
          {BRANDSEARCH_SHOTS.map((sh, i) => (
            <figure key={sh.src} className="card-flat overflow-hidden flex flex-col">
              <a href={sh.src} target="_blank" rel="noreferrer" style={{ background: "var(--surface-3)" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={sh.src} alt={sh.title} className="w-full max-h-[360px] object-contain object-top" loading="lazy" />
              </a>
              <figcaption className="p-3">
                <div className="text-[14px] font-semibold leading-snug">
                  <span className="dim num mr-1.5">{i + 1}.</span>
                  {sh.title}
                </div>
                <div className="muted text-[12.5px] mt-1 leading-relaxed">{sh.note}</div>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      {/* 03 / Le tableau */}
      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionLabel n="03" title={`Tes ${count} produits`} />
          <span className="label-xs num">
            {filled} / {count} remplis
          </span>
        </div>
        <p className="muted text-[13.5px] mt-3 leading-relaxed max-w-[64ch]">
          Une ligne par produit. Le lien, c&apos;est la pub ou la boutique qui le vend déjà (tu le trouves dans BrandSearch). Le tableau est gardé sur cet ordinateur, tu peux revenir le finir.
        </p>
        <div className="mt-4 overflow-x-auto -mx-2 px-2">
          <table className="w-full text-[13px]" style={{ minWidth: 760 }}>
            <thead>
              <tr className="text-left">
                <th className="label-xs pb-2 pr-2 w-[34px]">#</th>
                {PRODUCT_COLUMNS.map((c) => (
                  <th key={c.key} className="label-xs pb-2 pr-2">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.map((r, i) => (
                <tr key={i}>
                  <td className="py-1 pr-2 num dim">{i + 1}</td>
                  {PRODUCT_COLUMNS.map((c) => (
                    <td key={c.key} className="py-1 pr-2">
                      <input className="input !py-1.5 !text-[13px] w-full" value={r[c.key]} placeholder={i === 0 ? c.placeholder : ""} onChange={(e) => setCell(i, c.key, e.target.value)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-4">
          {wa ? (
            <a href={filled ? wa : undefined} target="_blank" rel="noreferrer" className={`btn btn-primary ${filled ? "" : "opacity-50 pointer-events-none"}`} aria-disabled={!filled}>
              Envoyer mes {filled || count} produits à Mady sur WhatsApp
            </a>
          ) : (
            <button type="button" className="btn btn-primary" onClick={() => void copyTable()} disabled={!filled}>
              Copier le tableau pour WhatsApp
            </button>
          )}
          {wa && (
            <button type="button" className="btn btn-ghost" onClick={() => void copyTable()} disabled={!filled}>
              Copier le tableau
            </button>
          )}
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => {
              if (window.confirm("Vider le tableau ?")) setRows(emptyProductRows(count));
            }}
          >
            Vider
          </button>
        </div>
        {!wa && <p className="dim text-[12.5px] mt-2">Colle le tableau dans ta conversation WhatsApp avec Mady.</p>}
      </section>

      <PortalFooter quote="Le produit fait 80 % du résultat. Prends le temps de bien choisir, puis va vite." author="Mady" />
    </div>
    </StepGate>
  );
}
