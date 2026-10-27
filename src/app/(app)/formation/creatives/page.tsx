"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { ErrorNote, Spinner, useToast } from "@/components/ui";
import { Annex } from "@/components/formation/Annex";
import { StepGate } from "@/components/formation/StepGate";
import { PortalFooter, SectionLabel } from "@/components/formation/portal";
import { MethodVideoLesson } from "@/components/formation/VideoLesson";
import { DropZone, ProgressBar, uploadMany, type Progress } from "@/components/upload-ui";
import { CREATIVE_FOLDERS, DEFAULT_CREATIVE_PROMPTS, DEFAULT_EXAMPLES, DEFAULT_VIDEO_EXAMPLE, type CreativeFolder } from "@/lib/formation-creatives";
import type { CreativesPayload } from "@/app/api/formation/creatives/route";
import type { CreativeExample, CreativePrompt, StudentCreativesSettings } from "@/lib/types";

/**
 * Créatives (Scale X) : après la validation du produit. L'accès au Studio IA
 * (ouvert par Mady, crédits KIE à acheter), comment faire une créative
 * (onglet Image : photo de référence + prompt, ratios 3:4 / 1:1 / 9:16,
 * vidéo en 9:16), des exemples, et les prompts à copier dans Claude ou GPT
 * pour qu'ils écrivent les prompts du Studio. L'admin modifie tout sur place.
 *
 * Depuis le 2026-10-27 : sous la vidéo, pourquoi les créatives passent avant
 * tout, l'histoire d'Alison (collier Venom, 10 jours, 1 000 $ / jour), puis
 * les familles de créatives (punchy sales, native ads, Notes iPhone,
 * ChatGPT, tweet, avant / après, badge, vidéo) avec leurs exemples
 * (`CreativeExample.folder`). Les exemples sans famille restent dans
 * « Des exemples, avec leur prompt ».
 */

const KIND_LABEL: Record<CreativePrompt["kind"], string> = { strategie: "Stratégie", image: "Image", video: "Vidéo" };

function PromptCard({ p }: { p: CreativePrompt }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(p.text);
      toast(/studio/i.test(p.target) && !/claude|gpt/i.test(p.target) ? "Prompt copié. Colle-le dans le Studio IA." : "Prompt copié. Colle-le dans Claude ou GPT et remplis les crochets.");
    } catch {
      toast("Copie impossible : ouvre le prompt et sélectionne le texte.", "err");
    }
  };
  return (
    <div className="card-flat p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="badge !text-[10.5px]">{KIND_LABEL[p.kind]}</span>
        <span className="text-[15px] font-semibold leading-snug flex-1 min-w-[200px]">{p.title}</span>
        <button type="button" className="btn btn-sm btn-primary" onClick={() => void copy()}>
          Copier le prompt
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen((v) => !v)}>
          {open ? "Replier" : "Voir"}
        </button>
      </div>
      {p.target && <div className="dim text-[12.5px] mt-1">Où le coller : {p.target}</div>}
      {open && (
        <pre className="mt-3 text-[13px] leading-relaxed whitespace-pre-wrap rounded-md p-3" style={{ background: "var(--surface-3)", fontFamily: "inherit" }}>
          {p.text}
        </pre>
      )}
    </div>
  );
}

function ExampleCard({ e }: { e: CreativeExample }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const external = /^https?:\/\//i.test(e.url);
  const copyPrompt = async () => {
    if (!e.prompt) return;
    try {
      await navigator.clipboard.writeText(e.prompt);
      toast("Prompt copié. Dans le Studio : onglet Image, ta photo de référence, colle, choisis le ratio.");
    } catch {
      toast("Copie impossible : ouvre le prompt et sélectionne le texte.", "err");
    }
  };
  const media = /\.(mp4|webm|mov)(\?|$)/i.test(e.url) || e.kind === "video";
  const embeddable = e.url.startsWith("/api/media/") || /\.(jpe?g|png|webp|gif|mp4|webm)(\?|$)/i.test(e.url);
  return (
    <div className="card-flat overflow-hidden flex flex-col">
      {embeddable ? (
        media ? (
          <video src={e.url} controls playsInline preload="metadata" className="w-full max-h-[420px] bg-black" />
        ) : (
          <a href={e.url} target="_blank" rel="noreferrer" style={{ background: "var(--surface-3)" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={e.url} alt={e.title} className="w-full max-h-[420px] object-contain" loading="lazy" />
          </a>
        )
      ) : null}
      <div className="p-3 flex flex-col gap-2">
        <div className="flex items-start gap-2">
          <div className="text-[14px] font-semibold leading-snug flex-1">{e.title || (e.kind === "video" ? "Vidéo exemple" : "Image exemple")}</div>
          {e.ratio && <span className="badge !text-[10.5px] num shrink-0">{e.ratio}</span>}
        </div>
        {e.note && <div className="muted text-[12.5px] leading-relaxed">{e.note}</div>}
        <div className="flex flex-wrap gap-2">
          {e.prompt && (
            <>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => void copyPrompt()}>
                Copier le prompt
              </button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen((v) => !v)}>
                {open ? "Replier" : "Voir le prompt"}
              </button>
            </>
          )}
          {(!embeddable || external) && (
            <a href={e.url} target="_blank" rel="noreferrer" className="btn btn-sm">
              Ouvrir ↗
            </a>
          )}
        </div>
        {open && e.prompt && (
          <pre className="text-[12.5px] leading-relaxed whitespace-pre-wrap rounded-md p-3" style={{ background: "var(--surface-3)", fontFamily: "inherit" }}>
            {e.prompt}
          </pre>
        )}
      </div>
    </div>
  );
}

function VideoExample() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(DEFAULT_VIDEO_EXAMPLE);
      toast("Prompt vidéo copié. Onglet Vidéo, ton image de base en entrée, 9:16. Remplace le produit et les phrases.");
    } catch {
      toast("Copie impossible : ouvre le prompt et sélectionne le texte.", "err");
    }
  };
  return (
    <div className="card-flat p-4 mt-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="badge !text-[10.5px]">Vidéo</span>
        <span className="text-[15px] font-semibold leading-snug flex-1 min-w-[200px]">L&apos;exemple de prompt vidéo de Mady (collier, 15 s, 5 plans)</span>
        <button type="button" className="btn btn-sm btn-primary" onClick={() => void copy()}>
          Copier le prompt
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen((v) => !v)}>
          {open ? "Replier" : "Voir"}
        </button>
      </div>
      <div className="dim text-[12.5px] mt-1">Garde la structure (voix, précision produit, 5 plans, sons, négatifs). Change le produit, la personne et les phrases. Pour l&apos;adapter à ton produit sans te tromper : prompt 5 ci-dessous, Claude le réécrit pour toi.</div>
      {open && (
        <pre className="mt-3 text-[12.5px] leading-relaxed whitespace-pre-wrap rounded-md p-3" style={{ background: "var(--surface-3)", fontFamily: "inherit" }}>
          {DEFAULT_VIDEO_EXAMPLE}
        </pre>
      )}
    </div>
  );
}

/** Une famille de créatives : l'idée, le détail (replié), ses exemples. */
function FolderSection({ folder, examples, open, onToggle }: { folder: CreativeFolder; examples: CreativeExample[]; open: boolean; onToggle: () => void }) {
  return (
    <div className="card-flat p-4">
      <div className="flex flex-wrap items-start gap-2">
        <div className="flex-1 min-w-[220px]">
          <div className="text-[15.5px] font-semibold leading-snug">{folder.title}</div>
          <div className="muted text-[13px] mt-0.5 leading-relaxed">{folder.tagline}</div>
        </div>
        <span className="badge !text-[10.5px] num shrink-0">{examples.length ? `${examples.length} exemple${examples.length > 1 ? "s" : ""}` : "exemples à venir"}</span>
        <button type="button" className="btn btn-sm btn-ghost shrink-0" onClick={onToggle}>
          {open ? "Replier" : "Voir"}
        </button>
      </div>
      {open && (
        <div className="mt-3 flex flex-col gap-3">
          <Annex text={folder.text} className="max-w-[72ch]" />
          {examples.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {examples.map((e) => (
                <ExampleCard key={e.id} e={e} />
              ))}
            </div>
          ) : (
            <div className="dim text-[13px]">Mady ajoute les exemples de cette famille au fil de l&apos;eau.</div>
          )}
        </div>
      )}
    </div>
  );
}

function Ratio({ label, w, h, note }: { label: string; w: number; h: number; note: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="shrink-0 rounded-sm" style={{ width: w, height: h, background: "var(--accent)", opacity: 0.85 }} />
      <div>
        <div className="text-[14px] font-semibold num">{label}</div>
        <div className="dim text-[12px]">{note}</div>
      </div>
    </div>
  );
}

export default function CreativesPage() {
  const toast = useToast();
  const [data, setData] = useState<CreativesPayload | null>(null);
  const [error, setError] = useState("");
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState<StudentCreativesSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [filter, setFilter] = useState<"tous" | CreativePrompt["kind"]>("tous");
  // Familles de créatives : la première (punchy sales, les créatives d'Alison) est ouverte d'office.
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({ punchy: true });

  const load = useCallback(async () => {
    try {
      setData(await api<CreativesPayload>("/api/formation/creatives"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const startEdit = () => {
    if (!data) return;
    setDraft(JSON.parse(JSON.stringify(data.creatives)) as StudentCreativesSettings);
    setEdit(true);
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const r = await api<{ creatives: StudentCreativesSettings }>("/api/formation/creatives", { method: "PATCH", body: JSON.stringify(draft) });
      setData((d) => (d ? { ...d, creatives: r.creatives } : d));
      setEdit(false);
      toast("Page Créatives enregistrée : les élèves la voient.");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setSaving(false);
    }
  };

  const addFiles = async (files: File[]) => {
    if (!draft) return;
    try {
      const up = await uploadMany(files, setProgress);
      const added: CreativeExample[] = up.map((u) => ({
        id: `ex-${Math.random().toString(36).slice(2, 10)}`,
        title: u.name.replace(/\.[^.]+$/, ""),
        kind: /\.(mp4|webm|mov)$/i.test(u.name) ? "video" : "image",
        url: u.url,
        note: "",
      }));
      setDraft({ ...draft, examples: [...draft.examples, ...added] });
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setProgress(null);
    }
  };

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Spinner label="Chargement…" />;

  const c = data.creatives;
  const prompts = c.prompts.filter((p) => filter === "tous" || p.kind === filter);
  const freeExamples = c.examples.filter((e) => !e.folder);
  const folderExamples = (id: string) => c.examples.filter((e) => e.folder === id);
  const studio = data.studio;
  const studioState = !studio.access ? "fermé" : !studio.hasKey ? "sans clé" : "prêt";

  const setD = <K extends keyof StudentCreativesSettings>(k: K, v: StudentCreativesSettings[K]) => draft && setDraft({ ...draft, [k]: v });
  const setExample = (i: number, patch: Partial<CreativeExample>) => draft && setD("examples", draft.examples.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  const setPrompt = (i: number, patch: Partial<CreativePrompt>) => draft && setD("prompts", draft.prompts.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const move = (i: number, dir: -1 | 1) => {
    if (!draft) return;
    const arr = draft.prompts.slice();
    const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    setD("prompts", arr);
  };

  return (
    <StepGate tab="creatives">
    <div className="flex flex-col gap-5">
      <header>
        <div className="label-xs" style={{ letterSpacing: "0.12em" }}>
          Scale X / Créatives
        </div>
        <h1 className="text-[28px] sm:text-[34px] font-semibold leading-tight mt-2" style={{ letterSpacing: "-0.03em" }}>
          Tes créatives, dans le Studio IA.
        </h1>
        <p className="muted text-[14px] mt-1 max-w-[64ch]">Produit validé ? Mady t&apos;ouvre le Studio IA. Tu achètes tes crédits, tu demandes tes prompts à Claude ou GPT, tu génères : images en 3:4, 1:1 ou 9:16, vidéos en 9:16.</p>
        {data.preview && <div className="badge badge-warn w-fit !text-[11.5px] mt-3">Aperçu : tu vois Scale X comme {data.student?.name}.</div>}
        {data.isAdmin && !edit && (
          <div className="flex flex-wrap gap-2 mt-3">
            <button type="button" className="btn btn-sm" onClick={startEdit}>
              Modifier la page
            </button>
            <Link href="/formation/eleves" className="btn btn-sm btn-ghost">
              Ouvrir le Studio à un élève
            </Link>
          </div>
        )}
      </header>

      {/* La vidéo de Mady sur les créatives (lien, résumé replié, étapes), quand elle est tournée. */}
      <MethodVideoLesson lesson="creatives" n="00" title="Regarde Mady faire ses créatives" intro="Toute la méthode en vidéo, puis les étapes à suivre avec ton produit dans le Studio IA." />

      {edit && draft ? (
        <div className="flex flex-col gap-4">
          <section className="card p-5 flex flex-col gap-3">
            <SectionLabel n="01" title="Boutique exemple (affichée sur Ta boutique)" />
            <label className="flex flex-col gap-1">
              <span className="label-xs">Lien de ta boutique exemple</span>
              <input className="input" value={draft.exampleShopUrl} onChange={(e) => setD("exampleShopUrl", e.target.value)} placeholder="https://…" inputMode="url" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="label-xs">Ce qu&apos;il faut regarder</span>
              <textarea className="input" rows={3} value={draft.exampleShopNote} onChange={(e) => setD("exampleShopNote", e.target.value)} />
            </label>
          </section>

          <section className="card p-5 flex flex-col gap-3">
            <SectionLabel n="02" title="Comment faire une créative (texte)" />
            <textarea className="input" rows={10} value={draft.method} onChange={(e) => setD("method", e.target.value)} />
          </section>

          <section className="card p-5 flex flex-col gap-3">
            <SectionLabel n="06" title="Créatives exemples (avec leur prompt, ou rangées dans une famille)" />
            <p className="muted text-[12.5px] leading-relaxed">Le dernier menu de chaque carte range l&apos;exemple dans une famille (punchy sales, native ads…). Les créatives d&apos;Alison livrées avec la plateforme reviennent toujours, même retirées ici.</p>
            <DropZone label="Déposer des images ou vidéos exemples" hint="JPG, PNG, MP4. Elles sont visibles des élèves." accept="image/*,video/*" onFiles={(f) => void addFiles(f)} compact />
            {progress && <ProgressBar p={progress} />}
            <div className="grid gap-3 sm:grid-cols-2">
              {draft.examples.map((e, i) => (
                <div key={e.id} className="card-flat p-3 flex flex-col gap-2">
                  <input className="input" value={e.title} onChange={(ev) => setExample(i, { title: ev.target.value })} placeholder="Titre" />
                  <input className="input" value={e.url} onChange={(ev) => setExample(i, { url: ev.target.value })} placeholder="Lien (ou fichier déposé)" />
                  <textarea className="input" rows={2} value={e.note} onChange={(ev) => setExample(i, { note: ev.target.value })} placeholder="Pourquoi elle marche (une phrase)" />
                  <textarea className="input" rows={6} value={e.prompt ?? ""} onChange={(ev) => setExample(i, { prompt: ev.target.value })} placeholder="Le prompt qui la reproduit (bouton « Copier le prompt » côté élève)" style={{ fontFamily: "inherit" }} />
                  <div className="flex items-center gap-2">
                    <select className="input !w-auto" value={e.kind} onChange={(ev) => setExample(i, { kind: ev.target.value as CreativeExample["kind"] })}>
                      <option value="image">Image</option>
                      <option value="video">Vidéo</option>
                    </select>
                    <select className="input !w-auto" value={e.ratio ?? ""} onChange={(ev) => setExample(i, { ratio: ev.target.value })}>
                      <option value="">Ratio</option>
                      <option value="3:4">3:4</option>
                      <option value="1:1">1:1</option>
                      <option value="9:16">9:16</option>
                      <option value="16:9">16:9</option>
                    </select>
                    <select className="input !w-auto" value={e.folder ?? ""} onChange={(ev) => setExample(i, { folder: ev.target.value })} title="Famille de créatives">
                      <option value="">Avec prompt (section exemples)</option>
                      {CREATIVE_FOLDERS.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.title}
                        </option>
                      ))}
                    </select>
                    <span className="flex-1" />
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => setD("examples", draft.examples.filter((_, j) => j !== i))}>
                      Retirer
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-sm" onClick={() => setD("examples", [...draft.examples, { id: `ex-${Math.random().toString(36).slice(2, 10)}`, title: "", kind: "image", url: "", note: "", ratio: "", prompt: "" }])}>
                + Ajouter un lien (Instagram, Drive, TikTok…)
              </button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setD("examples", DEFAULT_EXAMPLES)}>
                Remettre les exemples par défaut
              </button>
            </div>
          </section>

          <section className="card p-5 flex flex-col gap-3">
            <SectionLabel n="07" title="Prompts" />
            {draft.prompts.map((p, i) => (
              <div key={p.id} className="card-flat p-3 flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <select className="input !w-auto" value={p.kind} onChange={(ev) => setPrompt(i, { kind: ev.target.value as CreativePrompt["kind"] })}>
                    <option value="strategie">Stratégie</option>
                    <option value="image">Image</option>
                    <option value="video">Vidéo</option>
                  </select>
                  <input className="input flex-1 min-w-[220px]" value={p.title} onChange={(ev) => setPrompt(i, { title: ev.target.value })} placeholder="Titre" />
                  <button type="button" className="btn btn-sm btn-ghost !px-2" onClick={() => move(i, -1)} title="Monter">
                    ↑
                  </button>
                  <button type="button" className="btn btn-sm btn-ghost !px-2" onClick={() => move(i, 1)} title="Descendre">
                    ↓
                  </button>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setD("prompts", draft.prompts.filter((_, j) => j !== i))}>
                    Retirer
                  </button>
                </div>
                <input className="input" value={p.target} onChange={(ev) => setPrompt(i, { target: ev.target.value })} placeholder="Où le coller (ex. Claude ou GPT → puis Studio IA)" />
                <textarea className="input" rows={8} value={p.text} onChange={(ev) => setPrompt(i, { text: ev.target.value })} style={{ fontFamily: "inherit" }} />
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-sm" onClick={() => setD("prompts", [...draft.prompts, { id: `p-${Math.random().toString(36).slice(2, 10)}`, kind: "image", title: "", target: "Claude ou GPT", text: "" }])}>
                + Nouveau prompt
              </button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setD("prompts", DEFAULT_CREATIVE_PROMPTS)}>
                Remettre les prompts par défaut
              </button>
            </div>
          </section>

          <div className="flex gap-2 sticky bottom-3">
            <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving}>
              {saving ? "Enregistrement…" : "Enregistrer la page"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setEdit(false)} disabled={saving}>
              Annuler
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* 01 / Pourquoi les créatives d'abord, et l'histoire d'Alison */}
          <section className="card p-5" style={{ borderColor: "var(--accent-ring)" }}>
            <SectionLabel n="01" title="Les créatives, c'est ce que les gens voient en premier" />
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] mt-3">
              <div className="text-[14px] leading-relaxed flex flex-col gap-3 max-w-[66ch]">
                <p>
                  <strong>Personne n&apos;achète sans avoir vu une créative.</strong> C&apos;est la première chose que ton client voit, avant ta boutique, avant ton prix. Une bonne créative avec une page produit moyenne vend. Une page produit parfaite avec une créative bâclée ne vend rien, parce que personne ne clique.
                </p>
                <p>
                  Les deux comptent : la créative arrête le scroll, la page produit transforme le clic en commande. Mais tu ne bâcles jamais tes créatives. Tu en fais plusieurs, tu les déclines, tu laisses Meta choisir.
                </p>
                <p>
                  Pour ça tu as le <strong>Studio IA</strong> sur ta plateforme : images, vidéos, swap, création. Toutes les créatives de cette page peuvent se faire dedans. Je l&apos;améliore tous les jours. Pas d&apos;excuse.
                </p>
                <div className="flex flex-wrap gap-2 mt-1">
                  <Link href="/formation/studio" className="btn btn-sm btn-primary">
                    Ouvrir le Studio IA
                  </Link>
                  {data.exampleShop && (
                    <a href={data.exampleShop} target="_blank" rel="noreferrer" className="btn btn-sm">
                      Voir une boutique d&apos;exemple ↗
                    </a>
                  )}
                  <Link href="/formation/boutique" className="btn btn-sm btn-ghost">
                    Création de la boutique →
                  </Link>
                </div>
                <div className="dim text-[12.5px]">Un dossier de prompts prêts à coller arrive ici bientôt. En attendant : les prompts à copier, plus bas sur cette page.</div>
              </div>
              <div className="card-flat p-4 flex flex-col gap-2">
                <div className="label-xs" style={{ color: "var(--accent)" }}>
                  L&apos;histoire d&apos;Alison
                </div>
                <div className="text-[18px] font-semibold leading-tight" style={{ letterSpacing: "-0.02em" }}>
                  10 jours d&apos;accompagnement. Ses premiers 1 000 $ par jour.
                </div>
                <p className="text-[13.5px] leading-relaxed">
                  Alison est élève Scale X. Son produit : le collier <strong>Venom</strong> (elle m&apos;autorise à le montrer). Ses créatives : exactement celles que tu vois en dessous, des <strong>punchy sales</strong> faites dans le Studio IA à partir d&apos;une seule photo du produit.
                </p>
                <p className="muted text-[13px] leading-relaxed">Voici quelques créatives d&apos;exemple que j&apos;ai pu réaliser avec elle. Regarde-les, puis fais pareil avec ton produit.</p>
              </div>
            </div>
          </section>

          {/* 02 / Les familles de créatives */}
          <section className="card p-5">
            <SectionLabel n="02" title="Les familles de créatives" />
            <p className="muted text-[13.5px] mt-3 leading-relaxed max-w-[66ch]">
              Deux grandes familles : les <strong>punchy sales</strong>, qui vendent frontalement, et les <strong>native ads</strong>, qui ne ressemblent pas à une pub. Puis des formats précis à copier. Sur une créative statique tu es en <strong>1:1 ou 3:4</strong> (9:16 pour les stories), en vidéo <strong>toujours 9:16</strong>.
            </p>
            <div className="flex flex-col gap-3 mt-4">
              {CREATIVE_FOLDERS.map((f) => (
                <FolderSection key={f.id} folder={f} examples={folderExamples(f.id)} open={Boolean(openFolders[f.id])} onToggle={() => setOpenFolders((o) => ({ ...o, [f.id]: !o[f.id] }))} />
              ))}
            </div>
          </section>

          {/* 03 / Studio IA */}
          <section className="card p-5" style={{ borderColor: studioState === "prêt" ? "var(--accent-ring)" : undefined }}>
            <div className="flex items-center justify-between gap-3">
              <SectionLabel n="03" title="Ton accès au Studio IA" />
              <span className={`badge !text-[10.5px] ${studioState === "prêt" ? "badge-good" : "badge-warn"}`}>{studioState === "prêt" ? "Prêt" : studioState === "sans clé" ? "Ouvert · clé à poser" : "Pas encore ouvert"}</span>
            </div>
            <ol className="list-decimal pl-5 mt-3 flex flex-col gap-1.5 text-[13.5px] leading-relaxed">
              <li>
                <strong>Mady t&apos;ouvre le Studio</strong> une fois ton produit validé sur WhatsApp. {!studio.access && "Pas encore fait ? Envoie-lui tes produits (page Recherche produit)."}
              </li>
              <li>
                <strong>Tu achètes tes crédits</strong> sur kie.ai (20 à 30 € pour tes premières créatives) et tu colles ta clé sur la page Studio IA.
              </li>
              <li>
                <strong>Tu génères</strong> : onglet Image pour les visuels, onglet Vidéo pour les vidéos. Tes résultats ne sont visibles que par toi.
              </li>
            </ol>
            <div className="flex flex-wrap items-center gap-3 mt-4">
              <Link href="/formation/studio" className="btn btn-primary btn-sm">
                {studioState === "prêt" ? "Ouvrir le Studio IA" : studioState === "sans clé" ? "Poser ma clé KIE" : "Voir la page Studio IA"}
              </Link>
              {!studio.access && (
                <Link href="/formation/produit" className="text-[13px] font-medium hover:underline">
                  Recherche produit →
                </Link>
              )}
            </div>
          </section>

          {/* 04 / Comment faire */}
          <section className="card p-5">
            <SectionLabel n="04" title="Comment faire une créative" />
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] mt-3">
              <Annex text={c.method} />
              <div className="card-flat p-4 flex flex-col gap-4">
                <div className="label-xs">Les formats, et rien d&apos;autre</div>
                <div className="label-xs" style={{ color: "var(--accent)" }}>
                  Images (statiques)
                </div>
                <Ratio label="3:4" w={30} h={40} note="Feed Facebook et Instagram" />
                <Ratio label="1:1" w={36} h={36} note="Carré, boutique et feed" />
                <Ratio label="9:16" w={24} h={42} note="Story, Reel, TikTok" />
                <div className="label-xs mt-1" style={{ color: "var(--accent)" }}>
                  Vidéos
                </div>
                <Ratio label="9:16" w={24} h={42} note="Toujours vertical" />
              </div>
            </div>
          </section>

          {/* 05 / Les vidéos */}
          <section className="card p-5">
            <SectionLabel n="05" title="Les vidéos (Seedance 2.5), en deux temps" />
            <p className="muted text-[13.5px] mt-3 leading-relaxed max-w-[64ch]">Une vidéo ne part jamais de rien : elle part d&apos;une image que tu as générée. Toujours en 9:16, 15 secondes, 5 plans de 3 secondes.</p>
            <div className="grid gap-3 sm:grid-cols-3 mt-4">
              <div className="card-flat p-4">
                <div className="label-xs num">01 · Onglet Image</div>
                <div className="text-[14px] font-semibold mt-1 leading-snug">L&apos;image de base</div>
                <p className="muted text-[12.5px] mt-1 leading-relaxed">Une personne dans une scène, ton produit <strong>porté ou en main</strong>, bien visible. Ta photo de référence en entrée, ratio 9:16. Prompt écrit par Claude (prompt 5) ou l&apos;exemple ci-dessous.</p>
              </div>
              <div className="card-flat p-4">
                <div className="label-xs num">02 · Onglet Vidéo</div>
                <div className="text-[14px] font-semibold mt-1 leading-snug">Image + prompt vidéo</div>
                <p className="muted text-[12.5px] mt-1 leading-relaxed">Tu mets <strong>l&apos;image que tu viens de faire</strong> en entrée, tu colles le prompt vidéo (modèle Seedance 2.5, 9:16). Le prompt décrit la voix, le produit, les 5 plans, les sons et ce qu&apos;il faut éviter.</p>
              </div>
              <div className="card-flat p-4">
                <div className="label-xs num">03 · Tu gardes la meilleure</div>
                <div className="text-[14px] font-semibold mt-1 leading-snug">Deux ou trois essais</div>
                <p className="muted text-[12.5px] mt-1 leading-relaxed">Si le produit change de forme ou la voix est plate : relance avec le même prompt. Télécharge, range dans « creatives ».</p>
              </div>
            </div>
            <VideoExample />
          </section>

          {/* 06 / Exemples */}
          <section className="card p-5">
            <SectionLabel n="06" title="Des exemples, avec leur prompt" />
            <p className="muted text-[13.5px] mt-3 leading-relaxed max-w-[64ch]">Les créatives de Mady. Sous chacune, le prompt qui la reproduit : tu le copies, tu remplaces le produit, les textes et l&apos;offre par les tiens, et tu le colles dans l&apos;onglet Image avec ta photo de référence.</p>
            {freeExamples.length === 0 ? (
              <p className="dim text-[13.5px] mt-3">{data.isAdmin ? "Dépose tes exemples avec « Modifier la page »." : "Exemples à venir."}</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 mt-3">
                {freeExamples.map((e) => (
                  <ExampleCard key={e.id} e={e} />
                ))}
              </div>
            )}
          </section>

          {/* 07 / Prompts */}
          <section className="card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <SectionLabel n="07" title="Les prompts à copier" />
              <div className="flex gap-1 p-1 rounded-md" style={{ background: "var(--surface-3)" }}>
                {(["tous", "strategie", "image", "video"] as const).map((k) => (
                  <button key={k} type="button" onClick={() => setFilter(k)} className="tab-btn px-3 py-1 rounded text-[12.5px] font-medium" style={filter === k ? { background: "var(--surface)", boxShadow: "0 1px 2px rgb(0 0 0 / 0.08)" } : { color: "var(--muted)" }}>
                    {k === "tous" ? "Tous" : KIND_LABEL[k]}
                  </button>
                ))}
              </div>
            </div>
            <p className="muted text-[13.5px] mt-2 leading-relaxed max-w-[64ch]">
              Le plus important : tu ne rédiges pas tes prompts toi-même. Tu copies un prompt ci-dessous dans <strong>Claude ou GPT</strong>, tu remplis les crochets avec ton produit, et c&apos;est lui qui t&apos;écrit les prompts à coller dans le Studio IA. Les prompts marqués « Exemple » se collent directement dans le Studio.
            </p>
            <div className="flex flex-col gap-3 mt-4">
              {prompts.map((p) => (
                <PromptCard key={p.id} p={p} />
              ))}
            </div>
          </section>

          <section className="card-flat p-4 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex-1 text-[13.5px] leading-relaxed">
              <strong>Tes créatives sont prêtes ?</strong> Mets-les dans le dossier « creatives » de ton projet et passe à ta boutique : le thème de Mady, avec ton produit dedans.
            </div>
            <Link href="/formation/boutique" className="btn btn-sm shrink-0">
              Étape suivante : Création de la boutique →
            </Link>
          </section>
        </>
      )}

      <PortalFooter quote="Pas de perfection : on teste vite et on garde ce qui marche." author="Mady" />
    </div>
    </StepGate>
  );
}
