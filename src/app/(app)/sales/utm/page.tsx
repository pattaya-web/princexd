"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { api } from "@/lib/client";
import { useSalesData } from "@/lib/sales/client";
import { Card, ErrorNote, Field, PageHeader, Spinner, useToast } from "@/components/ui";
import { useSales } from "@/components/sales/context";
import { UtmLinksTable } from "@/components/sales/UtmLinksTable";
import { buildUtmUrl, utmValue } from "@/lib/sales/utm-url";
import type { UtmLinkRow } from "@/lib/sales/utm-links";

const ACCENT = { "--accent": "#006dbc", "--accent-hover": "#005a9c", "--accent-soft": "#e6f1fa", "--accent-ring": "#9cc9ea", "--grad-accent": "linear-gradient(135deg, #006dbc 0%, #2a8fd8 100%)" } as CSSProperties;

interface Payload {
  rows: UtmLinkRow[];
  destinations: { label: string; url: string }[];
  sources: readonly string[];
  mediums: readonly string[];
}

const CUSTOM = "__custom__";

/**
 * Générateur de liens UTM.
 *
 * Un lien par endroit où on pose un lien (vidéo YouTube, post, story,
 * newsletter…) : destination + source + medium + campagne (+ contenu, terme).
 * Le lien se copie tel quel. Chaque lead qui s'inscrit ou réserve avec ces
 * paramètres exacts est rattaché au lien : le tableau en bas dit lequel a
 * amené combien de leads, quel jour, et ce qu'ils sont devenus.
 */
export default function UtmLinksPage() {
  const { session, currency } = useSales();
  const toast = useToast();
  const { data, loading, error, reload } = useSalesData<Payload>("/api/sales/utm");

  const [label, setLabel] = useState("");
  const [dest, setDest] = useState("");
  const [customUrl, setCustomUrl] = useState("");
  const [source, setSource] = useState("youtube");
  const [medium, setMedium] = useState("video");
  const [campaign, setCampaign] = useState("");
  const [content, setContent] = useState("");
  const [term, setTerm] = useState("");
  const [placement, setPlacement] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!dest && data?.destinations.length) setDest(data.destinations[0].url);
  }, [data, dest]);

  const baseUrl = dest === CUSTOM ? customUrl : dest;
  const preview = useMemo(() => buildUtmUrl(baseUrl, { source, medium, campaign, content, term }), [baseUrl, source, medium, campaign, content, term]);

  const copy = async (v: string) => {
    try {
      await navigator.clipboard.writeText(v);
      toast("Lien copié.");
    } catch {
      toast("Copie impossible ici : sélectionne le lien et copie-le à la main.", "err");
    }
  };

  const create = async () => {
    setSaving(true);
    try {
      await api("/api/sales/utm", { method: "POST", body: JSON.stringify({ label, baseUrl, source, medium, campaign, content, term, placement, notes }) });
      toast("Lien créé. Copie-le et pose-le.");
      setLabel("");
      setCampaign("");
      setContent("");
      setTerm("");
      setPlacement("");
      setNotes("");
      void reload();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await api("/api/sales/utm", { method: "DELETE", body: JSON.stringify({ id }) });
      toast("Lien supprimé.");
      void reload();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  const totalLeads = (data?.rows ?? []).reduce((n, r) => n + r.stats.leads, 0);

  return (
    <div style={ACCENT}>
      <PageHeader
        title="Liens UTM"
        subtitle="Un lien par endroit où tu poses un lien : vidéo YouTube, post, story, newsletter. Chaque lead qui passe par là t'est rattaché, avec le jour et ce qu'il devient."
      />
      {error && <ErrorNote>{error}</ErrorNote>}

      {session.isAdmin && (
        <Card title="Nouveau lien" subtitle="Les valeurs sont nettoyées automatiquement (minuscules, sans accents, soulignés) : c'est ce qui permet le rattachement exact." className="mb-4">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <Field label="Nom du lien" hint="Pour toi : « YouTube · Lancer sa boutique (oct. 2026) »">
              <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="YouTube · Lancer sa boutique" />
            </Field>
            <Field label="Destination" hint="La page où le lien envoie">
              <select className="select" value={dest} onChange={(e) => setDest(e.target.value)}>
                {(data?.destinations ?? []).map((d) => (
                  <option key={d.url} value={d.url}>
                    {d.label} · {d.url.replace(/^https?:\/\//, "")}
                  </option>
                ))}
                <option value={CUSTOM}>Autre adresse…</option>
              </select>
            </Field>
            {dest === CUSTOM && (
              <Field label="Adresse complète">
                <input className="input mono !text-[12.5px]" value={customUrl} onChange={(e) => setCustomUrl(e.target.value)} placeholder="https://royalscalebymady.fr/…" />
              </Field>
            )}
            <Field label="Source (utm_source)" hint="D'où vient le clic">
              <input className="input" list="utm-sources" value={source} onChange={(e) => setSource(e.target.value)} placeholder="youtube" />
              <datalist id="utm-sources">{(data?.sources ?? []).map((s) => <option key={s} value={s} />)}</datalist>
            </Field>
            <Field label="Support (utm_medium)" hint="Vidéo, short, bio, story, description…">
              <input className="input" list="utm-mediums" value={medium} onChange={(e) => setMedium(e.target.value)} placeholder="video" />
              <datalist id="utm-mediums">{(data?.mediums ?? []).map((m) => <option key={m} value={m} />)}</datalist>
            </Field>
            <Field label="Campagne (utm_campaign)" hint="Le contenu précis : titre de la vidéo, du post">
              <input className="input" value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="lancer_sa_boutique_oct26" />
            </Field>
            <Field label="Contenu (utm_content) · optionnel" hint="Pour distinguer deux liens d'un même contenu : description vs commentaire épinglé">
              <input className="input" value={content} onChange={(e) => setContent(e.target.value)} placeholder="description" />
            </Field>
            <Field label="Terme (utm_term) · optionnel">
              <input className="input" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="" />
            </Field>
            <Field label="Où il est posé · mémo" hint="Pour te souvenir : « description YouTube », « lien bio TikTok »">
              <input className="input" value={placement} onChange={(e) => setPlacement(e.target.value)} placeholder="description YouTube" />
            </Field>
            <Field label="Notes" className="sm:col-span-2 lg:col-span-3">
              <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optionnel" />
            </Field>
          </div>
          <div className="mt-4 rounded-[10px] px-3.5 py-3 flex flex-wrap items-center gap-3" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
            <div className="min-w-0 flex-1">
              <div className="label-xs mb-1">Aperçu du lien</div>
              <div className="mono text-[12.5px] break-all" style={{ color: preview ? "var(--text)" : "var(--text-3)" }}>
                {preview || "Choisis une destination et remplis source + campagne."}
              </div>
              {campaign && utmValue(campaign) !== campaign.trim() && <div className="dim text-[11px] mt-1">Campagne enregistrée comme « {utmValue(campaign)} ».</div>}
            </div>
            <div className="flex items-center gap-2">
              <button className="btn btn-sm" disabled={!preview} onClick={() => void copy(preview)}>
                Copier l&apos;aperçu
              </button>
              <button className="btn btn-sm btn-primary" disabled={!preview || saving || !campaign.trim()} onClick={() => void create()}>
                {saving ? "…" : "Créer le lien"}
              </button>
            </div>
          </div>
        </Card>
      )}

      <div className="flex items-baseline justify-between gap-3 mb-2">
        <h2 className="text-[15px] font-semibold">
          Mes liens <span className="dim font-normal text-[12px]">· {data?.rows.length ?? 0} lien{(data?.rows.length ?? 0) > 1 ? "s" : ""} · {totalLeads} lead{totalLeads > 1 ? "s" : ""} rattaché{totalLeads > 1 ? "s" : ""}</span>
        </h2>
        <span className="dim text-[11.5px]">Clique un lien pour voir qui est venu par là, quel jour, et ce qu&apos;il est devenu.</span>
      </div>
      {loading && !data ? <Spinner label="Chargement…" /> : <UtmLinksTable rows={data?.rows ?? []} currency={currency} onDelete={session.isAdmin ? remove : undefined} />}
    </div>
  );
}
