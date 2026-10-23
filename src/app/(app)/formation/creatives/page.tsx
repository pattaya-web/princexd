"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { ErrorNote, Spinner, useToast } from "@/components/ui";
import { Annex } from "@/components/formation/Annex";
import { PortalFooter, SectionLabel } from "@/components/formation/portal";
import { DropZone, ProgressBar, uploadMany, type Progress } from "@/components/upload-ui";
import { DEFAULT_CREATIVE_PROMPTS } from "@/lib/formation-creatives";
import type { CreativesPayload } from "@/app/api/formation/creatives/route";
import type { CreativeExample, CreativePrompt, StudentCreativesSettings } from "@/lib/types";

/**
 * Créatives (Scale X) : la boutique exemple de Mady, des créatives exemples,
 * la méthode, et les prompts que l'élève copie dans Claude ou GPT pour se
 * faire écrire ses prompts d'images, ses scripts UGC et ses prompts vidéo.
 * L'admin modifie tout depuis cette page (bouton « Modifier »).
 */

const KIND_LABEL: Record<CreativePrompt["kind"], string> = { strategie: "Stratégie", image: "Image", video: "Vidéo" };

function PromptCard({ p }: { p: CreativePrompt }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(p.text);
      toast("Prompt copié. Colle-le dans Claude ou GPT et remplis les crochets.");
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
  const external = !e.url.startsWith("/");
  const media = /\.(mp4|webm|mov)(\?|$)/i.test(e.url) || e.kind === "video";
  const embeddable = e.url.startsWith("/api/media/") || /\.(jpe?g|png|webp|gif|mp4|webm)(\?|$)/i.test(e.url);
  return (
    <div className="card-flat overflow-hidden flex flex-col">
      {embeddable ? (
        media ? (
          <video src={e.url} controls playsInline preload="metadata" className="w-full max-h-[420px] bg-black" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={e.url} alt={e.title} className="w-full max-h-[420px] object-contain" style={{ background: "var(--surface-3)" }} />
        )
      ) : null}
      <div className="p-3">
        <div className="text-[14px] font-semibold leading-snug">{e.title || (e.kind === "video" ? "Vidéo exemple" : "Image exemple")}</div>
        {e.note && <div className="muted text-[12.5px] mt-1 leading-relaxed">{e.note}</div>}
        {(!embeddable || external) && (
          <a href={e.url} target="_blank" rel="noreferrer" className="btn btn-sm mt-2">
            Ouvrir ↗
          </a>
        )}
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
    <div className="flex flex-col gap-5">
      <header>
        <div className="label-xs" style={{ letterSpacing: "0.12em" }}>
          Scale X / Créatives
        </div>
        <h1 className="text-[28px] sm:text-[34px] font-semibold leading-tight mt-2" style={{ letterSpacing: "-0.03em" }}>
          Tes créatives, avec l&apos;IA.
        </h1>
        <p className="muted text-[14px] mt-1 max-w-[64ch]">La boutique exemple, des créatives qui marchent, la méthode, et les prompts à copier dans Claude ou GPT. Tu remplis les crochets, il t&apos;écrit tes prompts d&apos;images et de vidéos, tu génères.</p>
        {data.preview && <div className="badge badge-warn w-fit !text-[11.5px] mt-3">Aperçu : tu vois Scale X comme {data.student?.name}.</div>}
        {data.isAdmin && !edit && (
          <div className="flex flex-wrap gap-2 mt-3">
            <button type="button" className="btn btn-sm" onClick={startEdit}>
              Modifier la page
            </button>
            <Link href="/formation/parcours" className="btn btn-sm btn-ghost">
              Parcours &amp; étapes
            </Link>
          </div>
        )}
      </header>

      {edit && draft ? (
        <div className="flex flex-col gap-4">
          <section className="card p-5 flex flex-col gap-3">
            <SectionLabel n="01" title="Boutique exemple" />
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
            <SectionLabel n="02" title="Créatives exemples" />
            <DropZone label="Déposer des images ou vidéos exemples" hint="JPG, PNG, MP4. Elles sont visibles des élèves." accept="image/*,video/*" onFiles={(f) => void addFiles(f)} compact />
            {progress && <ProgressBar p={progress} />}
            <div className="grid gap-3 sm:grid-cols-2">
              {draft.examples.map((e, i) => (
                <div key={e.id} className="card-flat p-3 flex flex-col gap-2">
                  <input className="input" value={e.title} onChange={(ev) => setExample(i, { title: ev.target.value })} placeholder="Titre" />
                  <input className="input" value={e.url} onChange={(ev) => setExample(i, { url: ev.target.value })} placeholder="Lien (ou fichier déposé)" />
                  <textarea className="input" rows={2} value={e.note} onChange={(ev) => setExample(i, { note: ev.target.value })} placeholder="Pourquoi elle marche (une phrase)" />
                  <div className="flex items-center gap-2">
                    <select className="input !w-auto" value={e.kind} onChange={(ev) => setExample(i, { kind: ev.target.value as CreativeExample["kind"] })}>
                      <option value="image">Image</option>
                      <option value="video">Vidéo</option>
                    </select>
                    <span className="flex-1" />
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => setD("examples", draft.examples.filter((_, j) => j !== i))}>
                      Retirer
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button type="button" className="btn btn-sm w-fit" onClick={() => setD("examples", [...draft.examples, { id: `ex-${Math.random().toString(36).slice(2, 10)}`, title: "", kind: "image", url: "", note: "" }])}>
              + Ajouter un lien (Instagram, Drive, TikTok…)
            </button>
          </section>

          <section className="card p-5 flex flex-col gap-3">
            <SectionLabel n="03" title="Méthode" />
            <textarea className="input" rows={9} value={draft.method} onChange={(e) => setD("method", e.target.value)} />
          </section>

          <section className="card p-5 flex flex-col gap-3">
            <SectionLabel n="04" title="Prompts" />
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
                <input className="input" value={p.target} onChange={(ev) => setPrompt(i, { target: ev.target.value })} placeholder="Où le coller (ex. Claude ou GPT → puis Higgsfield)" />
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
          {/* 01 / Boutique exemple */}
          <section className="card p-5">
            <SectionLabel n="01" title="La boutique exemple" />
            <p className="muted text-[14px] mt-3 leading-relaxed max-w-[64ch]">{c.exampleShopNote}</p>
            {c.exampleShopUrl ? (
              <a href={c.exampleShopUrl} target="_blank" rel="noreferrer" className="btn btn-primary btn-sm mt-4">
                Ouvrir la boutique exemple ↗
              </a>
            ) : (
              <div className="dim text-[12.5px] mt-4">{data.isAdmin ? "Ajoute le lien de ta boutique exemple avec « Modifier la page »." : "Lien à venir."}</div>
            )}
          </section>

          {/* 02 / Créatives exemples */}
          <section className="card p-5">
            <SectionLabel n="02" title="Des créatives qui marchent" />
            {c.examples.length === 0 ? (
              <p className="dim text-[13.5px] mt-3">{data.isAdmin ? "Dépose tes exemples avec « Modifier la page »." : "Exemples à venir."}</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 mt-3">
                {c.examples.map((e) => (
                  <ExampleCard key={e.id} e={e} />
                ))}
              </div>
            )}
          </section>

          {/* 03 / Méthode */}
          <section className="card p-5">
            <SectionLabel n="03" title="La méthode" />
            <div className="mt-3">
              <Annex text={c.method} />
            </div>
          </section>

          {/* 04 / Prompts */}
          <section className="card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <SectionLabel n="04" title="Les prompts à copier" />
              <div className="flex gap-1 p-1 rounded-md" style={{ background: "var(--surface-3)" }}>
                {(["tous", "strategie", "image", "video"] as const).map((k) => (
                  <button key={k} type="button" onClick={() => setFilter(k)} className="tab-btn px-3 py-1 rounded text-[12.5px] font-medium" style={filter === k ? { background: "var(--surface)", boxShadow: "0 1px 2px rgb(0 0 0 / 0.08)" } : { color: "var(--muted)" }}>
                    {k === "tous" ? "Tous" : KIND_LABEL[k]}
                  </button>
                ))}
              </div>
            </div>
            <p className="muted text-[13.5px] mt-2 leading-relaxed max-w-[64ch]">Dans l&apos;ordre : stratégie d&apos;abord (tes angles), puis images, puis vidéos. Chaque prompt se colle dans Claude ou GPT. Remplis les crochets avec ton produit, ta cible, ton angle. Le résultat, tu le colles ensuite dans l&apos;outil de génération indiqué.</p>
            <div className="flex flex-col gap-3 mt-4">
              {prompts.map((p) => (
                <PromptCard key={p.id} p={p} />
              ))}
            </div>
          </section>
        </>
      )}

      <PortalFooter quote="Pas de perfection : on teste vite et on garde ce qui marche." author="Mady" />
    </div>
  );
}
