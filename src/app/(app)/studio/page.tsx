"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, useCollection } from "@/lib/client";
import { MODELS, type ModelDef } from "@/lib/models";
import { Card, CopyButton, Empty, ErrorNote, Field, InfoNote, PageHeader, Spinner, Tabs, useToast } from "@/components/ui";
import { fmtInt, fmtUsd, label, relative } from "@/lib/format";
import type { Generation } from "@/lib/types";

const CREDIT_USD = 0.005;

function defaultsFor(model: ModelDef): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of model.fields) out[f.key] = f.default ?? "";
  return out;
}

function StudioInner() {
  const params = useSearchParams();
  const toast = useToast();
  const { rows, setRows, reload } = useCollection<Generation>("generations");

  const [kind, setKind] = useState<"image" | "video">("image");
  const [modelId, setModelId] = useState(MODELS[0].id);
  const [input, setInput] = useState<Record<string, unknown>>(() => defaultsFor(MODELS[0]));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const model = useMemo(() => MODELS.find((m) => m.id === modelId) ?? MODELS[0], [modelId]);
  const visible = useMemo(() => MODELS.filter((m) => m.kind === kind), [kind]);

  // Le Swipe file peut envoyer un prompt tout prêt via l'URL.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    const prompt = params.get("prompt");
    const wanted = params.get("kind");
    if (wanted === "video" || wanted === "image") {
      setKind(wanted);
      const first = MODELS.find((m) => m.kind === wanted);
      if (first) {
        setModelId(first.id);
        setInput({ ...defaultsFor(first), ...(prompt ? { prompt } : {}) });
      }
    } else if (prompt) {
      setInput((v) => ({ ...v, prompt }));
    }
    if (prompt) seeded.current = true;
  }, [params]);

  const switchModel = (id: string) => {
    const next = MODELS.find((m) => m.id === id);
    if (!next) return;
    setModelId(id);
    // On conserve le prompt en changeant de modèle : c'est le travail qu'on ne veut pas reperdre.
    setInput((prev) => ({ ...defaultsFor(next), prompt: prev.prompt ?? "" }));
  };

  const switchKind = (k: "image" | "video") => {
    setKind(k);
    const first = MODELS.find((m) => m.kind === k);
    if (first) {
      setModelId(first.id);
      setInput((prev) => ({ ...defaultsFor(first), prompt: prev.prompt ?? "" }));
    }
  };

  const pending = rows.filter((g) => g.state !== "success" && g.state !== "fail");

  // Polling tant qu'une génération est en cours. KIE est asynchrone :
  // createTask ne renvoie qu'un identifiant, jamais le résultat.
  useEffect(() => {
    if (!pending.length) return;
    const id = setInterval(async () => {
      try {
        const res = await api<{ remaining: number; generations?: Generation[] }>("/api/kie/task");
        if (res.generations) setRows(res.generations);
      } catch {
        // Erreur réseau ponctuelle : le prochain tick réessaiera.
      }
    }, 6000);
    return () => clearInterval(id);
  }, [pending.length, setRows]);

  const launch = async () => {
    const missing = model.fields.filter((f) => f.required && !String(input[f.key] ?? "").trim());
    if (missing.length) {
      setError(`Champ obligatoire manquant : ${missing.map((f) => f.label).join(", ")}.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {};
      for (const f of model.fields) {
        const raw = input[f.key];
        if (raw === "" || raw === undefined) continue;
        if (f.type === "urls") {
          const urls = String(raw).split("\n").map((s) => s.trim()).filter(Boolean);
          if (urls.length) payload[f.key] = urls;
        } else if (raw === "true" || raw === "false") {
          payload[f.key] = raw === "true";
        } else {
          payload[f.key] = raw;
        }
      }
      const gen = await api<Generation>("/api/kie/generate", {
        method: "POST",
        body: JSON.stringify({ model: model.id, input: payload }),
      });
      setRows((prev) => [gen, ...prev]);
      toast("Génération lancée. Le résultat arrive dans la galerie.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Studio IA"
        subtitle="Génère tes visuels et tes plans de B-roll via KIE. Les tâches sont asynchrones : lance, et continue à bosser."
        actions={
          <>
            {pending.length > 0 && (
              <span className="badge badge-accent">
                <span className="spinner" /> {pending.length} en cours
              </span>
            )}
            <button className="btn" onClick={() => void reload()}>↻ Actualiser</button>
          </>
        }
      />

      <div className="grid lg:grid-cols-[380px_1fr] gap-4 items-start">
        <div className="flex flex-col gap-4 lg:sticky lg:top-[68px]">
          <Card title="Nouvelle génération">
            <div className="flex flex-col gap-3.5">
              <Tabs
                value={kind}
                onChange={switchKind}
                options={[
                  { value: "image", label: "Image" },
                  { value: "video", label: "Vidéo" },
                ]}
              />

              <Field label="Modèle" hint={model.blurb}>
                <select className="select" value={modelId} onChange={(e) => switchModel(e.target.value)}>
                  {visible.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} — {m.vendor}
                    </option>
                  ))}
                </select>
              </Field>

              {model.fields.map((f) => (
                <Field key={f.key} label={f.label} hint={f.help}>
                  {f.type === "textarea" ? (
                    <textarea
                      className="textarea"
                      style={{ minHeight: 120 }}
                      placeholder={f.placeholder}
                      value={String(input[f.key] ?? "")}
                      onChange={(e) => setInput((v) => ({ ...v, [f.key]: e.target.value }))}
                    />
                  ) : f.type === "select" ? (
                    <select
                      className="select"
                      value={String(input[f.key] ?? "")}
                      onChange={(e) => setInput((v) => ({ ...v, [f.key]: e.target.value }))}
                    >
                      {f.options?.map((o) => (
                        <option key={o} value={o}>{o}</option>
                      ))}
                    </select>
                  ) : f.type === "urls" ? (
                    <textarea
                      className="textarea mono !text-[12px]"
                      style={{ minHeight: 60 }}
                      placeholder="https://…"
                      value={String(input[f.key] ?? "")}
                      onChange={(e) => setInput((v) => ({ ...v, [f.key]: e.target.value }))}
                    />
                  ) : (
                    <input
                      className="input"
                      placeholder={f.placeholder}
                      value={String(input[f.key] ?? "")}
                      onChange={(e) => setInput((v) => ({ ...v, [f.key]: e.target.value }))}
                    />
                  )}
                </Field>
              ))}

              {error && <ErrorNote>{error}</ErrorNote>}

              <div className="flex items-center justify-between gap-3 pt-1">
                <span className="dim text-[12px]">
                  ≈ {fmtInt(model.approxCredits)} crédits · {fmtUsd(model.approxCredits * CREDIT_USD)}
                </span>
                <button className="btn btn-primary" onClick={() => void launch()} disabled={busy}>
                  {busy ? <span className="spinner" /> : "✦"} Générer
                </button>
              </div>
            </div>
          </Card>

          <InfoNote>
            Le coût affiché est un ordre de grandeur : KIE facture au modèle et à la durée. Le vrai débit apparaît sur
            chaque carte une fois la tâche terminée, et le solde en bas à gauche se met à jour tout seul.
          </InfoNote>
        </div>

        <Card title="Galerie" subtitle={`${rows.length} génération${rows.length > 1 ? "s" : ""}`} padded={false}>
          {!rows.length ? (
            <Empty>Rien de généré pour l&apos;instant. Lance ta première image à gauche.</Empty>
          ) : (
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3 p-3.5">
              {rows.map((g) => (
                <GenerationCard key={g.id} gen={g} />
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

function GenerationCard({ gen }: { gen: Generation }) {
  const done = gen.state === "success";
  const failed = gen.state === "fail";
  const url = gen.resultUrls[0];

  return (
    <article className="card-flat overflow-hidden flex flex-col">
      <div
        className="relative grid place-items-center"
        style={{ aspectRatio: "4 / 5", background: "var(--surface-3)" }}
      >
        {done && url ? (
          gen.kind === "video" ? (
            <video src={url} controls playsInline className="w-full h-full object-cover" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={gen.prompt.slice(0, 80)} className="w-full h-full object-cover" loading="lazy" />
          )
        ) : failed ? (
          <div className="text-center px-3">
            <div className="text-[20px] mb-1">⚠</div>
            <p className="text-[11.5px] leading-snug" style={{ color: "var(--critical)" }}>
              {gen.failMsg || "Génération échouée"}
            </p>
          </div>
        ) : (
          <Spinner label={label(gen.state)} />
        )}
      </div>

      <div className="p-2.5 flex flex-col gap-1.5 flex-1">
        <p className="text-[11.5px] leading-snug muted line-clamp-3" title={gen.prompt}>
          {gen.prompt || "(sans prompt)"}
        </p>
        <div className="flex items-center justify-between gap-2 mt-auto pt-1">
          <span className="dim text-[10.5px] truncate" title={gen.model}>
            {gen.model.split("/").pop()} · {relative(gen.createdAt)}
          </span>
          {gen.creditsConsumed > 0 && (
            <span className="badge !text-[10px] !py-0">{fmtInt(gen.creditsConsumed)} cr.</span>
          )}
        </div>
        {done && url && (
          <div className="flex gap-1.5">
            <a href={url} target="_blank" rel="noreferrer" className="btn btn-sm flex-1">
              Ouvrir ↗
            </a>
            <CopyButton text={url} label="Lien" />
          </div>
        )}
      </div>
    </article>
  );
}

export default function StudioPage() {
  return (
    <Suspense fallback={<Spinner label="Chargement du studio…" />}>
      <StudioInner />
    </Suspense>
  );
}
