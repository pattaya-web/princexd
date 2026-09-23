"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { Card, CopyButton, ErrorNote, Field, InfoNote, PageHeader, Spinner, Toggle, useToast } from "@/components/ui";
import { label, WEEKDAYS } from "@/lib/format";
import type { Settings } from "@/lib/types";

type View = Settings & {
  kieApiKeyMask?: string;
  kieApiKeySource?: string;
  iclosedApiKeyMask?: string;
  iclosedApiKeySource?: string;
  igAccessTokenMask?: string;
  igAccessTokenSource?: string;
  openaiApiKeyMask?: string;
  openaiApiKeySource?: string;
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
  const [openaiKey, setOpenaiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
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
      // Le profil Instagram est écrit par la synchro, jamais par ce formulaire :
      // le renvoyer écraserait un instantané plus frais.
      delete payload.igProfile;
      if (apiKey.trim()) payload.kieApiKey = apiKey.trim();
      else delete payload.kieApiKey;
      if (iclosedKey.trim()) payload.iclosedApiKey = iclosedKey.trim();
      else delete payload.iclosedApiKey;
      if (openaiKey.trim()) payload.openaiApiKey = openaiKey.trim();
      else delete payload.openaiApiKey;
      const next = await api<View>("/api/settings", { method: "PATCH", body: JSON.stringify(payload) });
      setS(next);
      setApiKey("");
      setIclosedKey("");
      setOpenaiKey("");
      toast("Réglages enregistrés.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  /** Synchro complète : profil, historique 30 j, et stats de chaque publication. */
  const runSync = async () => {
    setSyncing(true);
    try {
      const r = await api<{ postsCreated: number; postsUpdated: number; followers: number }>(
        "/api/instagram/sync",
        { method: "POST", body: JSON.stringify({ mode: "full", limit: 100 }) },
      );
      toast(
        `Instagram synchronisé : ${r.followers} abonnés, ${r.postsCreated} post(s) créé(s), ${r.postsUpdated} mis à jour.`,
      );
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setSyncing(false);
    }
  };


  return (
    <>
      <PageHeader
        title="Réglages"
        actions={
          <button className="btn btn-primary" onClick={() => void save()} disabled={saving}>
            {saving ? <span className="spinner" /> : "Enregistrer"}
          </button>
        }
      />

      {error && <div className="mb-4"><ErrorNote>{error}</ErrorNote></div>}

      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <div className="flex flex-col gap-4">
          <Card title="Clé API KIE">
            <div className="flex flex-col gap-3.5">
              {s.kieApiKeyMask ? (
                <InfoNote>
                  Clé active : <code className="mono">{s.kieApiKeyMask}</code> — source :{" "}
                  <strong>{s.kieApiKeySource === "env" ? ".env.local" : "ces réglages"}</strong>.
                  {s.kieApiKeySource === "env" && " La variable d'environnement l'emporte sur ce champ."}
                </InfoNote>
              ) : (
                <ErrorNote>
                  Aucune clé configurée. Le Studio et les recommandations IA ne fonctionneront pas tant
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

          <Card title="Contexte de marque">
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
          <Card
            title="Instagram"
            actions={
              <button className="btn btn-sm btn-primary" onClick={() => void runSync()} disabled={syncing}>
                {syncing ? "Synchro…" : "Synchroniser"}
              </button>
            }
          >
            <div className="flex flex-col gap-3.5">
              {s.igAccessTokenMask ? (
                <InfoNote>
                  Token actif : <code className="mono">{s.igAccessTokenMask}</code> — source :{" "}
                  <strong>{s.igAccessTokenSource === "env" ? ".env.local" : "ces réglages"}</strong>. Le profil et
                  le relevé du jour se rafraîchissent tout seuls à l&apos;ouverture du dashboard (au plus une fois
                  toutes les 10 minutes). Ce bouton force en plus la relecture des publications.
                </InfoNote>
              ) : (
                <InfoNote>
                  Aucun token Instagram. Génère-le depuis Meta Business (Utilisateurs système) avec les
                  autorisations <code className="mono">instagram_basic</code>,{" "}
                  <code className="mono">instagram_manage_insights</code>,{" "}
                  <code className="mono">pages_show_list</code> et{" "}
                  <code className="mono">pages_read_engagement</code>, puis place-le dans{" "}
                  <code className="mono">.env.local</code> sous <code className="mono">IG_ACCESS_TOKEN</code>.
                </InfoNote>
              )}

              <Field
                label="Badge certifié"
                hint="L'API Instagram n'expose pas la certification : c'est donc à toi de l'indiquer."
              >
                <Toggle
                  checked={s.igVerified}
                  onChange={(v) => set("igVerified", v)}
                  label={s.igVerified ? "Affiché à côté de ton nom" : "Masqué"}
                />
              </Field>

              <Field
                label="Mots-clés des posts business"
                hint="Séparés par des virgules. Seules les publications dont la légende en contient un alimentent « Ce que disent tes chiffres ». Vide = tout garder."
              >
                <input
                  className="input"
                  placeholder="commente, shopify, ia"
                  value={s.postFilterKeywords}
                  onChange={(e) => set("postFilterKeywords", e.target.value)}
                />
              </Field>

              <Field
                label="Membres du canal de diffusion"
                hint="L'API Instagram n'expose pas les canaux : recopie le nombre depuis l'app. Affiché à côté de ton pseudo, masqué si 0."
              >
                <input
                  className="input num"
                  type="number"
                  min={0}
                  value={s.igChannelMembers}
                  onChange={(e) => set("igChannelMembers", Number(e.target.value) || 0)}
                />
              </Field>

              {s.igProfile && (
                <InfoNote>
                  Dernière synchro : <strong>{new Date(s.igProfile.fetchedAt).toLocaleString("fr-FR")}</strong> —{" "}
                  {s.igProfile.followers} abonnés, {s.igProfile.history.length} jours d&apos;historique.
                </InfoNote>
              )}
            </div>
          </Card>

          <Card
            title="Transcription (OpenAI)"
          >
            <div className="flex flex-col gap-3.5">
              {s.openaiApiKeyMask ? (
                <InfoNote>
                  Clé active : <code className="mono">{s.openaiApiKeyMask}</code> — source :{" "}
                  <strong>{s.openaiApiKeySource === "env" ? ".env.local" : "ces réglages"}</strong>. Le bouton
                  « Transcrire la vidéo » apparaît dans Take Script, sur le dashboard.
                </InfoNote>
              ) : (
                <InfoNote>
                  Aucune clé OpenAI. Crée-la sur platform.openai.com (API keys), elle commence par{" "}
                  <code className="mono">sk-</code>. Sans elle, les scripts restent reconstruits depuis la
                  légende et l&apos;image de couverture, sans les paroles.
                </InfoNote>
              )}

              <Field label={s.openaiApiKeyMask ? "Remplacer la clé OpenAI" : "Clé API OpenAI"} hint="Laisse vide pour conserver la clé actuelle.">
                <input
                  className="input mono"
                  type="password"
                  placeholder="sk-…"
                  value={openaiKey}
                  onChange={(e) => setOpenaiKey(e.target.value)}
                />
              </Field>

              <Field
                label="Modèle de transcription"
                hint="gpt-4o-mini-transcribe est le meilleur rapport prix/qualité. whisper-1 gère les horodatages."
              >
                <select
                  className="input"
                  value={s.transcribeModel}
                  onChange={(e) => set("transcribeModel", e.target.value)}
                >
                  {["gpt-4o-mini-transcribe", "gpt-4o-transcribe", "gpt-transcribe", "whisper-1"].map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </Field>

              <InfoNote>
                La vidéo est envoyée telle quelle à OpenAI, dans la limite de <strong>25 Mo</strong> par fichier.
                Une transcription est conservée : elle n&apos;est jamais refacturée deux fois pour le même reel.
              </InfoNote>
            </div>
          </Card>

          <Card title="iClosed">
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

          {/* Le module commercial raisonne dans sa propre devise : les offres se
              vendent en dollars alors que le reste du tool compte en euros. */}
          <Card title="Équipe commerciale">
            <Field label="Devise des ventes et commissions">
              <select
                className="select"
                value={s.salesCurrency ?? "USD"}
                onChange={(e) => set("salesCurrency", e.target.value)}
              >
                <option value="USD">USD — dollar américain</option>
                <option value="EUR">EUR — euro</option>
                <option value="GBP">GBP — livre sterling</option>
                <option value="CHF">CHF — franc suisse</option>
                <option value="CAD">CAD — dollar canadien</option>
              </select>
            </Field>
          </Card>

          <Card
            title="Plan éditorial de la semaine"
          >
            <div className="flex flex-col gap-3">
              {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                const entry = s.weekPlan?.[String(d)] ?? { theme: "", objectif: "" };
                const setEntry = (patch: Partial<{ theme: string; objectif: string }>) =>
                  set("weekPlan", { ...s.weekPlan, [String(d)]: { ...entry, ...patch } });
                return (
                  <div key={d} className="grid sm:grid-cols-[70px_1fr_180px] gap-2 items-center">
                    <span className="label-xs">{WEEKDAYS[d]}</span>
                    <input
                      className="input"
                      placeholder="Thème du jour"
                      value={entry.theme}
                      onChange={(e) => setEntry({ theme: e.target.value })}
                    />
                    <input
                      className="input"
                      placeholder="Objectif"
                      value={entry.objectif}
                      onChange={(e) => setEntry({ objectif: e.target.value })}
                    />
                  </div>
                );
              })}
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
