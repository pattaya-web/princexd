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
}

/** Plateforme = utm_source. */
const PLATFORMS: { key: string; label: string }[] = [
  { key: "youtube", label: "YouTube" },
  { key: "instagram", label: "Instagram" },
  { key: "tiktok", label: "TikTok" },
  { key: "facebook", label: "Facebook" },
  { key: "newsletter", label: "Newsletter" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "autre", label: "Autre" },
];

/** Emplacement = utm_medium, selon la plateforme. */
const PLACEMENTS: Record<string, { key: string; label: string }[]> = {
  youtube: [
    { key: "description", label: "Description" },
    { key: "comment", label: "Commentaire épinglé" },
    { key: "short", label: "Short" },
    { key: "vsl", label: "VSL" },
  ],
  instagram: [
    { key: "bio", label: "Bio" },
    { key: "story", label: "Story" },
    { key: "reel", label: "Reel" },
    { key: "dm", label: "DM" },
    { key: "post", label: "Post" },
  ],
  tiktok: [
    { key: "bio", label: "Bio" },
    { key: "video", label: "Vidéo" },
    { key: "comment", label: "Commentaire" },
  ],
  facebook: [
    { key: "post", label: "Post" },
    { key: "group", label: "Groupe" },
    { key: "ad", label: "Pub" },
  ],
  newsletter: [{ key: "email", label: "Email" }],
  whatsapp: [
    { key: "dm", label: "Message" },
    { key: "status", label: "Statut" },
  ],
  autre: [{ key: "lien", label: "Lien" }],
};

const CUSTOM = "__custom__";

/**
 * Liens UTM, en deux gestes : coller un lien déjà traqué pour qu'il compte
 * ici, ou créer un lien en choisissant la plateforme et l'emplacement (le
 * tool pose les utm). Chaque lead qui arrive avec exactement ces paramètres
 * est rattaché au lien.
 */
export default function UtmLinksPage() {
  const { session, currency } = useSales();
  const toast = useToast();
  const { data, loading, error, reload } = useSalesData<Payload>("/api/sales/utm");

  /* --- Importer des liens existants --- */
  const [pasted, setPasted] = useState("");
  const [importing, setImporting] = useState(false);
  const importLinks = async () => {
    const urls = pasted
      .split(/\s+/)
      .map((x) => x.trim())
      .filter((x) => /^https?:\/\//i.test(x));
    if (!urls.length) return toast("Colle au moins un lien complet (https://…).", "err");
    setImporting(true);
    let ok = 0;
    const errors: string[] = [];
    for (const u of urls) {
      try {
        await api("/api/sales/utm", { method: "POST", body: JSON.stringify({ importUrl: u }) });
        ok++;
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
    setImporting(false);
    setPasted("");
    toast(ok ? `${ok} lien${ok > 1 ? "s" : ""} importé${ok > 1 ? "s" : ""}.${errors.length ? ` ${errors.length} refusé${errors.length > 1 ? "s" : ""} : ${errors[0]}` : ""}` : errors[0] ?? "Rien importé.", ok ? "ok" : "err");
    void reload();
  };

  /* --- Créer un lien --- */
  const [dest, setDest] = useState("");
  const [customUrl, setCustomUrl] = useState("");
  const [platform, setPlatform] = useState("instagram");
  const [placement, setPlacement] = useState("bio");
  const [campaign, setCampaign] = useState("");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!dest && data?.destinations.length) setDest(data.destinations[0].url);
  }, [data, dest]);
  useEffect(() => {
    const list = PLACEMENTS[platform] ?? [];
    if (!list.some((p) => p.key === placement)) setPlacement(list[0]?.key ?? "lien");
  }, [platform, placement]);
  const baseUrl = dest === CUSTOM ? customUrl : dest;
  const preview = useMemo(() => buildUtmUrl(baseUrl, { source: platform, medium: placement, campaign, content: "", term: "" }), [baseUrl, platform, placement, campaign]);
  const placementLabel = PLACEMENTS[platform]?.find((p) => p.key === placement)?.label ?? placement;
  const platformLabel = PLATFORMS.find((p) => p.key === platform)?.label ?? platform;

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
      await api("/api/sales/utm", { method: "POST", body: JSON.stringify({ label: label || `${platformLabel} · ${placementLabel}${campaign ? ` · ${campaign}` : ""}`, baseUrl, source: platform, medium: placement, campaign: campaign || placement, content: "", term: "", placement: `${platformLabel} · ${placementLabel}` }) });
      toast("Lien créé. Copie-le et pose-le.");
      setCampaign("");
      setLabel("");
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
  const Chip = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button type="button" className={`btn btn-sm ${active ? "btn-primary" : ""}`} onClick={onClick}>
      {children}
    </button>
  );

  return (
    <div style={ACCENT}>
      <PageHeader title="Liens UTM" subtitle="Un lien par endroit où tu poses un lien. Chaque lead qui passe par là t'est rattaché, avec le jour et ce qu'il devient." />
      {error && <ErrorNote>{error}</ErrorNote>}

      {session.isAdmin && (
        <div className="grid lg:grid-cols-2 gap-4 mb-4 items-start">
          <Card title="J'ai déjà un lien UTM" subtitle="Colle-le tel quel (un par ligne) : il est enregistré et ses leads comptent ici.">
            <textarea className="textarea w-full mono !text-[12.5px]" rows={4} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder={"https://royalscalebymady.fr/lp-orga?utm_source=youtube&utm_medium=description&utm_campaign=…"} />
            <div className="mt-2 flex justify-end">
              <button className="btn btn-primary btn-sm" onClick={() => void importLinks()} disabled={importing || !pasted.trim()}>
                {importing ? "Import…" : "Importer"}
              </button>
            </div>
          </Card>

          <Card title="Créer un lien" subtitle="Choisis où il va, où tu le poses, donne-lui un nom. Le tool pose les paramètres.">
            <div className="flex flex-col gap-3">
              <Field label="Il envoie vers">
                <div className="flex flex-wrap gap-1.5">
                  {(data?.destinations ?? []).map((d) => (
                    <Chip key={d.url} active={dest === d.url} onClick={() => setDest(d.url)}>
                      {d.label}
                    </Chip>
                  ))}
                  <Chip active={dest === CUSTOM} onClick={() => setDest(CUSTOM)}>
                    Autre lien…
                  </Chip>
                </div>
                {dest === CUSTOM && <input className="input mono !text-[12.5px] mt-2" value={customUrl} onChange={(e) => setCustomUrl(e.target.value)} placeholder="https://…" />}
              </Field>
              <Field label="Plateforme">
                <div className="flex flex-wrap gap-1.5">
                  {PLATFORMS.map((p) => (
                    <Chip key={p.key} active={platform === p.key} onClick={() => setPlatform(p.key)}>
                      {p.label}
                    </Chip>
                  ))}
                </div>
              </Field>
              <Field label="Emplacement">
                <div className="flex flex-wrap gap-1.5">
                  {(PLACEMENTS[platform] ?? []).map((p) => (
                    <Chip key={p.key} active={placement === p.key} onClick={() => setPlacement(p.key)}>
                      {p.label}
                    </Chip>
                  ))}
                </div>
              </Field>
              <Field label="Nom du contenu" hint="Titre de la vidéo, du post, de la story… Laisse vide pour un lien générique (bio).">
                <input className="input" value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="Comment lancer sa boutique" />
              </Field>
              <div className="rounded-[10px] px-3.5 py-3 flex flex-wrap items-center gap-3" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                <div className="min-w-0 flex-1 mono text-[12px] break-all" style={{ color: preview ? "var(--text)" : "var(--text-3)" }}>
                  {preview || "Choisis une destination."}
                </div>
                <div className="flex items-center gap-2">
                  <button className="btn btn-sm" disabled={!preview} onClick={() => void copy(preview)}>
                    Copier
                  </button>
                  <button className="btn btn-sm btn-primary" disabled={!preview || saving} onClick={() => void create()}>
                    {saving ? "…" : "Enregistrer le lien"}
                  </button>
                </div>
              </div>
              {campaign && utmValue(campaign) !== campaign.trim() && <div className="dim text-[11px]">Enregistré comme « {utmValue(campaign)} ».</div>}
            </div>
          </Card>
        </div>
      )}

      <div className="flex items-baseline justify-between gap-3 mb-2">
        <h2 className="text-[15px] font-semibold">
          Mes liens <span className="dim font-normal text-[12px]">· {data?.rows.length ?? 0} lien{(data?.rows.length ?? 0) > 1 ? "s" : ""} · {totalLeads} lead{totalLeads > 1 ? "s" : ""}</span>
        </h2>
        <span className="dim text-[11.5px]">Clique un lien pour voir qui est venu par là.</span>
      </div>
      {loading && !data ? <Spinner label="Chargement…" /> : <UtmLinksTable rows={data?.rows ?? []} currency={currency} onDelete={session.isAdmin ? remove : undefined} />}
    </div>
  );
}
