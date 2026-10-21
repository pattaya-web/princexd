"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { Card, Field, InfoNote, PageHeader, Spinner, useToast } from "@/components/ui";
import { BRAND_SECTIONS, EMPTY_BRAND } from "@/lib/brand";
import type { BrandProfile } from "@/lib/types";

/*
 * « Ma marque » : la source de vérité du contenu. Tout ce qui est écrit ici
 * part dans les prompts d'analyse, de scripts, de stories, de stratégie, de
 * pubs, du swipe file et du scénariste YouTube.
 */
export default function MarquePage() {
  const toast = useToast();
  const [brand, setBrand] = useState<BrandProfile>(EMPTY_BRAND);
  const [compiled, setCompiled] = useState("");
  const [legacy, setLegacy] = useState("");
  const [suggested, setSuggested] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<{ brand: BrandProfile; compiled: string; legacy: string; suggested: boolean }>("/api/brand");
      setBrand(r.brand);
      setCompiled(r.compiled);
      setLegacy(r.legacy);
      setSuggested(r.suggested);
      if (r.suggested) setDirty(true);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setSaving(true);
    try {
      const r = await api<{ brand: BrandProfile; compiled: string; legacy: string }>("/api/brand", { method: "PUT", body: JSON.stringify({ brand }) });
      setBrand(r.brand);
      setCompiled(r.compiled);
      setLegacy(r.legacy);
      setSuggested(false);
      setDirty(false);
      toast("Marque enregistrée : tous les prompts de contenu l'utilisent dès maintenant.");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setSaving(false);
    }
  }

  function set(key: keyof BrandProfile, value: string) {
    setBrand((b) => ({ ...b, [key]: value }));
    setDirty(true);
  }

  const filled = BRAND_SECTIONS.filter((s) => (brand[s.key] ?? "").trim()).length;

  return (
    <>
      <PageHeader
        title="Ma marque"
        subtitle="Personal brand, avatar client, offre, piliers, règles et SOP : écrits une fois, appliqués par toutes les IA du tool (analyse de Reels, scripts, stories, stratégie, pubs, swipe file, scénariste YouTube)."
        actions={
          <div className="flex gap-1.5">
            <button className="btn btn-sm" onClick={() => setPreview((v) => !v)}>
              {preview ? "Masquer l'aperçu" : "Voir ce que l'IA reçoit"}
            </button>
            <button className="btn btn-sm btn-primary" onClick={save} disabled={saving || !dirty}>
              {saving ? "Enregistrement…" : dirty ? "Enregistrer" : "Enregistré"}
            </button>
          </div>
        }
      />

      {loading ? (
        <Spinner label="Chargement…" />
      ) : (
        <div className="grid gap-5">
          {suggested && (
            <InfoNote>
              Fiche pré-remplie depuis tes documents : questionnaire personal brand, fiche avatar express, framework NESB 60 jours, SOP TOFU / MOFU / BOFU. Rien n&apos;est encore enregistré : relis, corrige ce qui a changé (ressources surtout), puis <b>Enregistrer la marque</b>. À partir de là, toutes les IA de contenu l&apos;utilisent.
            </InfoNote>
          )}
          {legacy && filled === 0 && !suggested && (
            <InfoNote>
              Pour l&apos;instant les prompts utilisent l&apos;ancien « Contexte de marque » des Réglages : « {legacy.slice(0, 160)}
              {legacy.length > 160 ? "…" : ""} ». Dès qu&apos;une section ci-dessous est remplie et enregistrée, c&apos;est cette fiche qui le remplace.
            </InfoNote>
          )}

          {preview && (
            <Card title="Ce que l'IA reçoit" subtitle="Le bloc ajouté à chaque prompt de contenu, tel quel.">
              <pre className="text-[12.5px] leading-relaxed whitespace-pre-wrap rounded-xl p-4" style={{ background: "var(--surface-2)", border: "1px solid var(--border)", fontFamily: "inherit" }}>
                {compiled || "(vide)"}
              </pre>
            </Card>
          )}

          <div className="grid gap-5 lg:grid-cols-2">
            {BRAND_SECTIONS.map((s) => (
              <Card key={s.key} title={s.title}>
                <Field label="" hint={s.hint}>
                  <textarea
                    className="textarea"
                    style={{ minHeight: s.key === "sops" || s.key === "rules" ? 200 : 140 }}
                    placeholder={s.placeholder}
                    value={brand[s.key] ?? ""}
                    onChange={(e) => set(s.key, e.target.value)}
                  />
                </Field>
              </Card>
            ))}
          </div>

          <div className="flex justify-end">
            <button className="btn btn-primary" onClick={save} disabled={saving || !dirty}>
              {saving ? "Enregistrement…" : "Enregistrer la marque"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
