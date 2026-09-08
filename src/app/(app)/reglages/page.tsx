"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { Card, CopyButton, ErrorNote, Field, InfoNote, PageHeader, Spinner, useToast } from "@/components/ui";
import { label, WEEKDAYS } from "@/lib/format";
import type { Settings } from "@/lib/types";

type View = Settings & {
  kieApiKeyMask?: string;
  kieApiKeySource?: string;
  iclosedApiKeyMask?: string;
  iclosedApiKeySource?: string;
};

const STORY_TYPES = [
  "value",
  "lifestyle",
  "daily-life",
  "proof-shopify",
  "coulisses",
  "engagement",
  "cta-call",
  "temoignage",
];

/** Modèles texte vérifiés comme disponibles sur le compte KIE. */
const TEXT_MODELS = ["gemini-3-pro", "gemini-2.5-pro", "gemini-2.5-flash"];

export default function ReglagesPage() {
  const toast = useToast();
  const [s, setS] = useState<View | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [iclosedKey, setIclosedKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
    void api<View>("/api/settings").then(setS).catch((e) => setError((e as Error).message));
  }, []);

  if (!s) return <Spinner label="Chargement des réglages…" />;

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s, [k]: v });

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload: Partial<Settings> = { ...s };
      if (apiKey.trim()) payload.kieApiKey = apiKey.trim();
      else delete payload.kieApiKey;
      if (iclosedKey.trim()) payload.iclosedApiKey = iclosedKey.trim();
      else delete payload.iclosedApiKey;
      const next = await api<View>("/api/settings", { method: "PATCH", body: JSON.stringify(payload) });
      setS(next);
      setApiKey("");
      setIclosedKey("");
      toast("Réglages enregistrés.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const setPlanSlot = (day: number, index: number, value: string) => {
    const plan = { ...s.storyPlan };
    const types = [...(plan[String(day)] ?? ["", "", ""])];
    while (types.length < 3) types.push("");
    types[index] = value;
    plan[String(day)] = types.filter(Boolean);
    set("storyPlan", plan);
  };

  return (
    <>
      <PageHeader
        title="Réglages"
        subtitle="Clés, objectifs, rotation des stories et intégrations."
        actions={
          <button className="btn btn-primary" onClick={() => void save()} disabled={saving}>
            {saving ? <span className="spinner" /> : "Enregistrer"}
          </button>
        }
      />

      {error && <div className="mb-4"><ErrorNote>{error}</ErrorNote></div>}

      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <div className="flex flex-col gap-4">
          <Card title="Clé API KIE" subtitle="Elle reste côté serveur : le navigateur ne la voit jamais.">
            <div className="flex flex-col gap-3.5">
              {s.kieApiKeyMask ? (
                <InfoNote>
                  Clé active : <code className="mono">{s.kieApiKeyMask}</code> — source :{" "}
                  <strong>{s.kieApiKeySource === "env" ? ".env.local" : "ces réglages"}</strong>.
                  {s.kieApiKeySource === "env" && " La variable d'environnement l'emporte sur ce champ."}
                </InfoNote>
              ) : (
                <ErrorNote>
                  Aucune clé configurée. Le Studio, le Swipe file et les recommandations IA ne fonctionneront pas tant
                  qu&apos;elle n&apos;est pas renseignée. Récupère-la sur kie.ai/api-key.
                </ErrorNote>
              )}

              <Field
                label={s.kieApiKeyMask ? "Remplacer la clé" : "Coller la clé"}
                hint="Laisse vide pour conserver la clé actuelle."
              >
                <input
                  className="input mono"
                  type="password"
                  placeholder="sk-…"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
              </Field>

              <Field label="Modèle texte" hint="Sert à la traduction des scripts et aux recommandations de format.">
                <select className="select" value={s.kieTextModel} onChange={(e) => set("kieTextModel", e.target.value)}>
                  {TEXT_MODELS.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Prix du crédit (USD)" hint="kie.ai facture ~0,005 $ le crédit.">
                  <input
                    className="input num"
                    type="number"
                    step="0.0001"
                    value={s.creditUsdRate}
                    onChange={(e) => set("creditUsdRate", Number(e.target.value))}
                  />
                </Field>
                <Field label="Taux USD → EUR">
                  <input
                    className="input num"
                    type="number"
                    step="0.01"
                    value={s.usdToEur}
                    onChange={(e) => set("usdToEur", Number(e.target.value))}
                  />
                </Field>
              </div>
            </div>
          </Card>

          <Card title="Objectif Instagram">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Point de départ">
                <input
                  className="input num"
                  type="number"
                  value={s.followersStart}
                  onChange={(e) => set("followersStart", Number(e.target.value))}
                />
              </Field>
              <Field label="Objectif">
                <input
                  className="input num"
                  type="number"
                  value={s.followersGoal}
                  onChange={(e) => set("followersGoal", Number(e.target.value))}
                />
              </Field>
              <Field label="Mon @" className="col-span-2">
                <input
                  className="input"
                  placeholder="@moncompte"
                  value={s.igHandle}
                  onChange={(e) => set("igHandle", e.target.value)}
                />
              </Field>
            </div>
          </Card>

          <Card title="Contexte de marque" subtitle="Injecté dans tous les prompts IA. Plus il est précis, meilleurs sont les scripts.">
            <textarea
              className="textarea"
              style={{ minHeight: 150 }}
              value={s.brandContext}
              onChange={(e) => set("brandContext", e.target.value)}
            />
          </Card>

          <Card title="Accès monteur">
            <div className="flex flex-col gap-3.5">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Nom du monteur">
                  <input className="input" value={s.editorName} onChange={(e) => set("editorName", e.target.value)} />
                </Field>
                <Field label="Code d'accès" hint="Vide = personne ne peut entrer.">
                  <input
                    className="input mono"
                    value={s.editorAccessCode}
                    placeholder="ex. MONTAGE-2026"
                    onChange={(e) => set("editorAccessCode", e.target.value)}
                  />
                </Field>
              </div>
              {s.editorAccessCode && (
                <InfoNote>
                  <span className="flex flex-wrap items-center gap-2">
                    Envoie-lui <code className="mono">{origin}/monteur</code>
                    <CopyButton text={`${origin}/monteur — code : ${s.editorAccessCode}`} label="Copier le lien + code" />
                  </span>
                </InfoNote>
              )}
            </div>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card title="Rotation des stories" subtitle="Trois slots par jour : matin, midi, soir.">
            <div className="flex flex-col gap-2.5">
              {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                const types = s.storyPlan[String(d)] ?? [];
                return (
                  <div key={d} className="grid items-center gap-2" style={{ gridTemplateColumns: "58px 1fr 1fr 1fr" }}>
                    <span className="text-[12px] font-medium">{WEEKDAYS[d].slice(0, 3)}</span>
                    {[0, 1, 2].map((i) => (
                      <select
                        key={i}
                        className="select !text-[12px] !py-1"
                        value={types[i] ?? ""}
                        onChange={(e) => setPlanSlot(d, i, e.target.value)}
                      >
                        <option value="">—</option>
                        {STORY_TYPES.map((t) => (
                          <option key={t} value={t}>{label(t)}</option>
                        ))}
                      </select>
                    ))}
                  </div>
                );
              })}
            </div>
          </Card>

          <Card title="iClosed" subtitle="L'API officielle ramène les appels, les réponses au questionnaire et crée les leads.">
            <div className="flex flex-col gap-3.5">
              {s.iclosedApiKeyMask ? (
                <InfoNote>
                  Clé active : <code className="mono">{s.iclosedApiKeyMask}</code> — source :{" "}
                  <strong>{s.iclosedApiKeySource === "env" ? ".env.local" : "ces réglages"}</strong>. Lance la
                  synchro depuis la page Calls.
                </InfoNote>
              ) : (
                <InfoNote>
                  Aucune clé iClosed. Génère-la sur app.iclosed.io (Paramètres → API), elle commence par{" "}
                  <code className="mono">iclosed_</code>.
                </InfoNote>
              )}

              <Field label={s.iclosedApiKeyMask ? "Remplacer la clé iClosed" : "Clé API iClosed"} hint="Laisse vide pour conserver la clé actuelle.">
                <input
                  className="input mono"
                  type="password"
                  placeholder="iclosed_…"
                  value={iclosedKey}
                  onChange={(e) => setIclosedKey(e.target.value)}
                />
              </Field>

              <Field
                label="Flux .ics du calendrier (optionnel)"
                hint="Repli si tu préfères ne pas utiliser l'API : Paramètres iClosed → Calendrier → lien iCal."
              >
                <input
                  className="input mono !text-[12px]"
                  placeholder="https://…/calendar.ics"
                  value={s.iclosedIcsUrl}
                  onChange={(e) => set("iclosedIcsUrl", e.target.value)}
                />
              </Field>
              <Field label="URL du webhook" hint="À coller dans iClosed pour recevoir les bookings en temps réel. Ne marche que si le tool est accessible depuis Internet.">
                <div className="flex gap-2">
                  <input className="input mono !text-[12px]" readOnly value={`${origin}/api/webhooks/iclosed`} />
                  <CopyButton text={`${origin}/api/webhooks/iclosed`} />
                </div>
              </Field>
            </div>
          </Card>

          <Card title="Fuseaux horaires">
            <InfoNote>
              Paris, New York et Dubaï sont affichés en haut de chaque page. Le point vert indique qu&apos;il est entre
              8 h et 23 h là-bas — pratique pour savoir si un lead est réveillé avant de lancer un DM.
            </InfoNote>
          </Card>

          <Card title="Où sont mes données ?">
            <InfoNote>
              Tout est stocké en local dans <code className="mono">data/db.json</code>, et les vidéos dans{" "}
              <code className="mono">data/media/</code>. Rien ne part sur un serveur tiers, sauf ce que tu envoies
              explicitement à KIE (prompts et transcriptions). Sauvegarde le dossier <code className="mono">data/</code>{" "}
              régulièrement : c&apos;est tout ton business.
              <br />
              <br />
              <strong>Le tool n&apos;a pas de mot de passe propriétaire.</strong> Garde-le en local. Si tu le déploies
              en ligne un jour, mets-le derrière une authentification au niveau de l&apos;hébergeur — sinon n&apos;importe
              qui avec l&apos;URL voit ton CRM.
            </InfoNote>
          </Card>
        </div>
      </div>

      <div className="flex justify-end mt-4">
        <button className="btn btn-primary" onClick={() => void save()} disabled={saving}>
          {saving ? <span className="spinner" /> : "Enregistrer les réglages"}
        </button>
      </div>
    </>
  );
}
