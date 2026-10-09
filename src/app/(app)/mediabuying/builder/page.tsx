"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useMb } from "@/components/mediabuying/context";
import { ConfirmModal, PhaseBadge, PostIdChip, WinnerTag } from "@/components/mediabuying/bits";
import { Card, Empty, Field, InfoNote, Modal, PageHeader, Spinner, useToast } from "@/components/ui";
import { api } from "@/lib/client";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import { fmtMetric } from "@/lib/mediabuying/metrics";
import { adsetName, campaignName, nextAdName } from "@/lib/mediabuying/naming";
import { PHASE_LABEL, PHASES, type CampaignDraft, type DraftAdSet, type EntityRow, type Phase } from "@/lib/mediabuying/types";

type BuildPhase = Exclude<Phase, "unclassified">;

interface Form {
  phase: BuildPhase;
  offer: string;
  suffix: string;
  objective: string;
  country: string;
  budgetType: "daily" | "lifetime";
  budget: number;
  adsets: DraftAdSet[];
}

const blank = (phase: BuildPhase): Form => ({
  phase,
  offer: "MASTERCLASS ECOM AI",
  suffix: "",
  objective: "OUTCOME_LEADS",
  country: "FR",
  budgetType: "daily",
  budget: phase === "hyper-scaling" ? 900 : 0,
  adsets:
    phase === "hyper-scaling"
      ? [
          { name: "POST-ID-SALES", budget: 0, ads: [] },
          { name: "POST-ID-BOOKINGS", budget: 0, ads: [] },
        ]
      : [{ name: adsetName({ format: "VIDEO", country: "FR" }), budget: phase === "testing" ? 100 : 300, ads: phase === "testing" ? ["V1", "V2", "V3", "V4", "V5", "V6"].map((n) => ({ name: n, postId: "", sourceAdId: "" })) : [] }],
});

/**
 * Builder : Testing (nouvelles creatives), Scaling-Testing (winners + batch),
 * Hyper-Scaling (CBO sur les Post IDs des winners). Tout est enregistre en
 * brouillon dans l'outil ; « Create draft » cree chez Meta EN PAUSE apres
 * confirmation. Rien ne diffuse sans activation manuelle.
 */
function BuilderInner() {
  const mb = useMb();
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const o = mb.overview;

  const [drafts, setDrafts] = useState<CampaignDraft[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(() => blank((params.get("phase") as BuildPhase) || "testing"));
  const [pickFor, setPickFor] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [publish, setPublish] = useState<CampaignDraft | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [open, setOpen] = useState(Boolean(params.get("phase")));

  const loadDrafts = async () => {
    if (!mb.connection) return;
    try {
      setDrafts((await api<{ rows: CampaignDraft[] }>(`/api/mediabuying/drafts?connectionId=${mb.connection.id}`)).rows);
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  useEffect(() => {
    void loadDrafts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mb.connection?.id]);

  // Arrivee depuis « Promote to Scaling-Testing » : les ads choisies sont deja la.
  useEffect(() => {
    const ids = params.get("ads")?.split(",").filter(Boolean) ?? [];
    if (!ids.length || !o) return;
    const picked = o.ads.filter((a) => ids.includes(a.id));
    setForm((f) => ({ ...f, adsets: [{ name: adsetName({ country: "FR", batch: 1 }), budget: 300, ads: picked.map((a) => ({ name: a.name, postId: a.postId, sourceAdId: a.id })) }] }));
    setOpen(true);
  }, [params, o]);

  const name = useMemo(() => campaignName(form.phase, form.offer, form.suffix), [form.phase, form.offer, form.suffix]);
  const cbo = form.phase === "hyper-scaling";
  const winners = useMemo(() => (o?.ads ?? []).filter((a) => a.winnerStatus === "winner" || a.winnerStatus === "potential-winner" || (a.metrics.bookings ?? 0) > 0).sort((a, b) => (b.metrics.sales ?? 0) - (a.metrics.sales ?? 0) || (b.metrics.bookings ?? 0) - (a.metrics.bookings ?? 0) || b.metrics.leads - a.metrics.leads), [o]);

  const setAdset = (i: number, patch: Partial<DraftAdSet>) => setForm((f) => ({ ...f, adsets: f.adsets.map((a, j) => (j === i ? { ...a, ...patch } : a)) }));
  const addAdset = () => setForm((f) => ({ ...f, adsets: [...f.adsets, { name: adsetName({ country: f.country, batch: f.adsets.length + 1 }), budget: cbo ? 0 : 100, ads: [] }] }));
  const addAd = (i: number) => setAdset(i, { ads: [...form.adsets[i].ads, { name: nextAdName(form.adsets.flatMap((a) => a.ads.map((x) => x.name))), postId: "", sourceAdId: "" }] });
  const addWinner = (i: number, w: EntityRow) => {
    if (form.adsets[i].ads.some((a) => a.sourceAdId === w.id)) return;
    setAdset(i, { ads: [...form.adsets[i].ads, { name: w.name, postId: w.postId, sourceAdId: w.id }] });
  };

  const save = async (): Promise<CampaignDraft | null> => {
    if (!mb.connection) return null;
    setSaving(true);
    try {
      const d = await api<CampaignDraft>("/api/mediabuying/drafts", {
        method: "POST",
        body: JSON.stringify({
          id: editing ?? undefined,
          connectionId: mb.connection.id,
          phase: form.phase,
          name,
          objective: form.objective,
          country: form.country,
          budgetType: form.budgetType,
          budgetLevel: cbo ? "campaign" : "adset",
          budget: form.budget,
          adsets: form.adsets,
        }),
      });
      setEditing(d.id);
      await loadDrafts();
      toast("Brouillon enregistré.");
      return d;
    } catch (e) {
      toast((e as Error).message, "err");
      return null;
    } finally {
      setSaving(false);
    }
  };

  const edit = (d: CampaignDraft) => {
    const parts = d.name.split("|").map((s) => s.trim());
    setForm({ phase: d.phase, offer: parts[1] ?? d.name, suffix: parts.length > 3 ? parts.slice(2, -1).join(" | ") : "", objective: d.objective, country: d.country, budgetType: d.budgetType, budget: d.budget, adsets: d.adsets });
    setEditing(d.id);
    setOpen(true);
  };

  const doPublish = async () => {
    if (!publish || !mb.connection) return;
    setPublishing(true);
    try {
      const r = await api<{ campaignId: string }>(`/api/mediabuying/drafts/${publish.id}/publish`, { method: "POST", body: JSON.stringify({ connectionId: mb.connection.id }), timeoutMs: 120_000 });
      toast("Campagne créée chez Meta, en pause. Active-la quand tu es prêt.");
      setPublish(null);
      setOpen(false);
      setEditing(null);
      await loadDrafts();
      void mb.reload();
      router.push(`/mediabuying/campaigns?campaign=${r.campaignId}`);
    } catch (e) {
      toast((e as Error).message, "err");
      await loadDrafts();
    } finally {
      setPublishing(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Builder"
        subtitle="Prépare tes structures Testing, Scaling-Testing et Hyper-Scaling. Tout est créé en brouillon puis chez Meta en pause."
        actions={
          <div className="flex gap-1.5 flex-wrap">
            {PHASES.map((p) => (
              <button
                key={p}
                className="btn btn-sm btn-primary"
                onClick={() => {
                  setEditing(null);
                  setForm(blank(p as BuildPhase));
                  setOpen(true);
                }}
              >
                + {PHASE_LABEL[p]}
              </button>
            ))}
          </div>
        }
      />
      {!o && <Spinner label="Chargement…" />}

      <Card title="Brouillons" subtitle="Structures préparées, publiées ou en échec." padded={false}>
        {drafts.length === 0 ? (
          <Empty>Aucun brouillon. Commence par « + Testing », « + Scaling-Testing » ou « + Hyper-Scaling ».</Empty>
        ) : (
          <ul>
            {drafts.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-4 py-2.5 row-hover" style={{ borderBottom: "1px solid var(--border)" }}>
                <PhaseBadge phase={d.phase} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium truncate">{d.name || "(sans nom)"}</div>
                  <div className="dim text-[11.5px] num">
                    {d.adsets.length} ad set{d.adsets.length > 1 ? "s" : ""} · {d.adsets.reduce((n, a) => n + a.ads.length, 0)} ads · {d.budgetLevel === "campaign" ? `CBO ${fmtMoney(d.budget, mb.currency)}` : `ABO ${fmtMoney(d.adsets.reduce((n, a) => n + a.budget, 0), mb.currency)}`}/{d.budgetType === "daily" ? "jour" : "total"} · {fmtDateTime(d.updatedAt)}
                  </div>
                  {d.error && <div className="text-[11.5px]" style={{ color: "var(--critical)" }}>{d.error}</div>}
                </div>
                <span className={`badge !text-[10px] !py-0 ${d.status === "published" ? "badge-good" : d.status === "failed" ? "badge-danger" : ""}`}>{d.status === "published" ? "Publié (en pause)" : d.status === "failed" ? "Échec" : "Brouillon"}</span>
                {d.status !== "published" && (
                  <>
                    <button className="btn btn-sm" onClick={() => edit(d)}>Modifier</button>
                    <button className="btn btn-sm btn-primary" onClick={() => setPublish(d)}>Create draft chez Meta</button>
                  </>
                )}
                {d.status === "published" && (
                  <button className="btn btn-sm" onClick={() => router.push(`/mediabuying/campaigns?campaign=${d.publishedCampaignId}`)}>Voir</button>
                )}
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={async () => {
                    if (!mb.connection) return;
                    await api(`/api/mediabuying/drafts?connectionId=${mb.connection.id}&id=${d.id}`, { method: "DELETE" }).catch((e) => toast((e as Error).message, "err"));
                    await loadDrafts();
                  }}
                  title="Supprimer le brouillon"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`${PHASE_LABEL[form.phase]} builder`}
        wide
        footer={
          <>
            <button className="btn" onClick={() => setOpen(false)}>Fermer</button>
            <button className="btn" onClick={() => void save()} disabled={saving}>
              {saving ? <span className="spinner" /> : "Enregistrer le brouillon"}
            </button>
            <button
              className="btn btn-primary"
              disabled={saving}
              onClick={async () => {
                const d = await save();
                if (d) setPublish(d);
              }}
            >
              Create draft
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="grid sm:grid-cols-3 gap-3">
            <Field label="Phase">
              <select className="select" value={form.phase} onChange={(e) => setForm(blank(e.target.value as BuildPhase))}>
                {PHASES.map((p) => (
                  <option key={p} value={p}>
                    {PHASE_LABEL[p]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Offre">
              <input className="input" value={form.offer} onChange={(e) => setForm({ ...form, offer: e.target.value })} />
            </Field>
            <Field label="Suffixe (batch, angle…)">
              <input className="input" value={form.suffix} placeholder="BATCH 03" onChange={(e) => setForm({ ...form, suffix: e.target.value })} />
            </Field>
          </div>
          <div className="card-flat px-3 py-2 mono text-[12.5px]">{name}</div>
          <div className="grid sm:grid-cols-4 gap-3">
            <Field label="Objective">
              <select className="select" value={form.objective} onChange={(e) => setForm({ ...form, objective: e.target.value })}>
                <option value="OUTCOME_LEADS">Leads</option>
                <option value="OUTCOME_SALES">Sales</option>
                <option value="OUTCOME_TRAFFIC">Traffic</option>
              </select>
            </Field>
            <Field label="Pays">
              <input className="input" value={form.country} maxLength={2} onChange={(e) => setForm({ ...form, country: e.target.value.toUpperCase() })} />
            </Field>
            <Field label="Type de budget">
              <select className="select" value={form.budgetType} onChange={(e) => setForm({ ...form, budgetType: e.target.value as Form["budgetType"] })}>
                <option value="daily">Quotidien</option>
                <option value="lifetime">Total (lifetime)</option>
              </select>
            </Field>
            {cbo ? (
              <Field label={`Budget campagne (CBO, ${mb.currency})`}>
                <input className="input num" inputMode="decimal" value={String(form.budget || "")} onChange={(e) => setForm({ ...form, budget: Number(e.target.value) || 0 })} />
              </Field>
            ) : (
              <div className="dim text-[12px] self-end pb-2">ABO : budget par ad set.</div>
            )}
          </div>

          <div className="flex items-center justify-between">
            <h3 className="text-[14px] font-semibold">Ad sets</h3>
            <button className="btn btn-sm" onClick={addAdset}>+ Ad set</button>
          </div>
          {form.adsets.map((a, i) => (
            <div key={i} className="card-flat p-3 flex flex-col gap-2.5">
              <div className="grid sm:grid-cols-[1fr_140px_auto] gap-2 items-end">
                <Field label="Nom de l'ad set">
                  <input className="input" value={a.name} onChange={(e) => setAdset(i, { name: e.target.value })} />
                </Field>
                {!cbo && (
                  <Field label={`Budget (${mb.currency})`}>
                    <input className="input num" inputMode="decimal" value={String(a.budget || "")} onChange={(e) => setAdset(i, { budget: Number(e.target.value) || 0 })} />
                  </Field>
                )}
                <button className="btn btn-ghost btn-sm" onClick={() => setForm({ ...form, adsets: form.adsets.filter((_, j) => j !== i) })} title="Retirer l'ad set">✕</button>
              </div>
              <div className="flex flex-wrap gap-1.5 items-center">
                {a.ads.map((ad, k) => (
                  <span key={k} className="inline-flex items-center gap-1.5 pl-2 pr-1 h-[28px] rounded-full text-[12px]" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                    <input className="bg-transparent outline-none w-[60px] font-semibold" value={ad.name} onChange={(e) => setAdset(i, { ads: a.ads.map((x, j) => (j === k ? { ...x, name: e.target.value } : x)) })} />
                    {ad.postId ? <PostIdChip postId={ad.postId} /> : <span className="dim text-[10.5px]">nouvelle créa</span>}
                    <button className="btn btn-ghost btn-sm !h-[20px] !px-1" onClick={() => setAdset(i, { ads: a.ads.filter((_, j) => j !== k) })}>✕</button>
                  </span>
                ))}
                <button className="btn btn-sm" onClick={() => addAd(i)}>+ Créative</button>
                <button className="btn btn-sm" onClick={() => setPickFor(i)}>+ Winner existant (Post ID)</button>
              </div>
            </div>
          ))}
          <InfoNote>Chaque élément est créé en pause chez Meta. Les ads ajoutées depuis un winner réutilisent son Post ID : likes et commentaires suivent.</InfoNote>
        </div>
      </Modal>

      <Modal open={pickFor !== null} onClose={() => setPickFor(null)} title="Choisir des winners">
        {winners.length === 0 ? (
          <Empty>Aucune ad marquée winner ni avec booking sur la période. Marque tes winners dans Campagnes → Ads.</Empty>
        ) : (
          <ul className="flex flex-col">
            {winners.map((w) => {
              const already = pickFor !== null && form.adsets[pickFor]?.ads.some((x) => x.sourceAdId === w.id);
              return (
                <li key={w.id} className="flex items-center gap-3 py-2 row-hover" style={{ borderBottom: "1px solid var(--border)" }}>
                  <div className="rounded-[6px] overflow-hidden shrink-0" style={{ width: 32, height: 40, background: "var(--surface-3)" }}>
                    {w.creative?.thumbnailUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={w.creative.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-[13px] font-semibold">
                      {w.name} <WinnerTag value={w.winnerStatus} />
                    </div>
                    <div className="dim text-[11.5px] num">
                      {w.metrics.leads} leads · {w.metrics.bookings ?? 0} bookings · CPL {fmtMetric("cpl", w.metrics.cpl, mb.currency)} · {o?.campaigns.find((c) => c.id === w.campaignId)?.name.split("|")[0]?.trim()}
                    </div>
                  </div>
                  <PostIdChip postId={w.postId} />
                  <button className="btn btn-sm btn-primary" disabled={already} onClick={() => pickFor !== null && addWinner(pickFor, w)}>
                    {already ? "Ajouté" : "Ajouter"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Modal>

      <ConfirmModal open={publish !== null} title="Créer chez Meta (en pause) ?" busy={publishing} onClose={() => setPublish(null)} onConfirm={() => void doPublish()} confirmLabel="Create draft">
        {publish && (
          <>
            <p>
              Tu vas créer <strong>{publish.name}</strong> chez Meta : {publish.adsets.length} ad set{publish.adsets.length > 1 ? "s" : ""}, {publish.adsets.reduce((n, a) => n + a.ads.length, 0)} ads.
            </p>
            <p className="dim text-[12.5px] mt-2">Tout reste en pause : aucune diffusion, aucune dépense tant que tu n&apos;actives pas depuis Campagnes.</p>
          </>
        )}
      </ConfirmModal>
    </>
  );
}

export default function BuilderPage() {
  return (
    <Suspense fallback={<Spinner label="Chargement…" />}>
      <BuilderInner />
    </Suspense>
  );
}
