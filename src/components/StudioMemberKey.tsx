"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { useSession } from "@/lib/sales/client";
import { useToast } from "@/components/ui";
import type { StudioMemberMe } from "@/app/api/studio-members/me/route";

/**
 * Bandeau « Ma clé KIE » du membre Studio IA, en haut de son Studio.
 *
 * Sans clé, c'est la première chose à faire : le bandeau s'ouvre en grand
 * avec les trois étapes. Avec une clé, une ligne : clé masquée, solde,
 * Recharger (kie.ai/billing), Changer. La clé est vérifiée auprès de KIE
 * avant d'être gardée et n'est jamais réaffichée en clair.
 *
 * Écrit dans les deux langues (translate="no" : la traduction automatique
 * du reste du Studio n'y touche pas).
 */
const TEXT = {
  fr: {
    previewToast: "Aperçu : la clé du membre n'est pas modifiée.",
    cleared: "Clé effacée.",
    saved: (n: number) => `Clé enregistrée et vérifiée : ${n} crédits KIE sur ton compte.`,
    newKey: "Nouvelle clé (remplace l'actuelle)",
    pasteKey: "Colle ta clé API KIE",
    checking: "Vérification…",
    replace: "Remplacer",
    save: "Enregistrer",
    cancel: "Annuler",
    before: "Avant de commencer",
    welcome: (n: string) => `Bienvenue ${n}, pose ta clé KIE.`,
    intro:
      "Le Studio tourne sur KIE, la plateforme qui fait tourner les modèles (GPT Image 2, Nano Banana, Kling, Seedance, Wan…). Tu paies tes générations toi-même, en crédits, à l'usage. Tes créations sont sauvegardées ici et visibles par toi seul.",
    step1: ["Crée ton compte sur", "(e-mail ou Google)."],
    step2: ["Recharge des crédits sur", "(carte bancaire, 20 à 30 € pour démarrer)."],
    step3: "Ouvre « API Key » dans le menu de KIE, copie la clé et colle-la ci-dessous. Elle est vérifiée puis gardée pour toi, personne ne la revoit en clair.",
    preview: (n: string) => `Aperçu : tu vois le Studio comme ${n}.`,
    myKey: "Ma clé KIE",
    credits: (n: number) => `${n} crédits`,
    refused: "clé refusée par KIE",
    topUp: "Recharger ↗",
    topUpTitle: "Acheter des crédits sur kie.ai (page Billing)",
    change: "Changer de clé",
    private: "Tes créations sont sauvegardées ici, toi seul les vois.",
    previewShort: (n: string) => `Aperçu : ${n}`,
    flaggedTitle: "Ton compte KIE est bloqué par KIE",
    flagged:
      "KIE a signalé ton compte pour « activité inhabituelle » et refuse toutes les générations. Ça vient de KIE, pas du Studio : écris au support KIE (chat ou e-mail sur kie.ai) pour faire lever le blocage. Une fois débloqué, tout remarche avec la même clé, tes créations restent ici.",
    contact: "Ouvrir kie.ai ↗",
  },
  en: {
    previewToast: "Preview: the member's key is not changed.",
    cleared: "Key removed.",
    saved: (n: number) => `Key saved and verified: ${n} KIE credits on your account.`,
    newKey: "New key (replaces the current one)",
    pasteKey: "Paste your KIE API key",
    checking: "Checking…",
    replace: "Replace",
    save: "Save",
    cancel: "Cancel",
    before: "Before you start",
    welcome: (n: string) => `Welcome ${n}, add your KIE key.`,
    intro:
      "The Studio runs on KIE, the platform that powers the models (GPT Image 2, Nano Banana, Kling, Seedance, Wan…). You pay for your own generations, in credits, as you go. Your creations are saved here and only you can see them.",
    step1: ["Create your account on", "(email or Google)."],
    step2: ["Top up credits on", "(credit card, €20 to €30 is enough to start)."],
    step3: "Open \"API Key\" in the KIE menu, copy the key and paste it below. It is verified, then kept for you only: nobody sees it in full again.",
    preview: (n: string) => `Preview: you are seeing the Studio as ${n}.`,
    myKey: "My KIE key",
    credits: (n: number) => `${n} credits`,
    refused: "key rejected by KIE",
    topUp: "Top up ↗",
    topUpTitle: "Buy credits on kie.ai (Billing page)",
    change: "Change key",
    private: "Your creations are saved here, only you can see them.",
    previewShort: (n: string) => `Preview: ${n}`,
    flaggedTitle: "Your KIE account is blocked by KIE",
    flagged:
      "KIE flagged your account for \"unusual activity\" and is refusing every generation. This comes from KIE, not from the Studio: contact KIE support (chat or email on kie.ai) to get it lifted. Once it's unblocked, everything works again with the same key, and your creations stay here.",
    contact: "Open kie.ai ↗",
  },
};

export function StudioMemberKey() {
  const toast = useToast();
  const { session } = useSession();
  const t = TEXT[session?.lang === "en" ? "en" : "fr"];
  const [me, setMe] = useState<StudioMemberMe | null>(null);
  const [key, setKey] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setMe(await api<StudioMemberMe>("/api/studio-members/me"));
    } catch {
      setMe(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (value: string) => {
    setSaving(true);
    try {
      const r = await api<{ preview: boolean; credits: number | null }>("/api/studio-members/me", { method: "PATCH", body: JSON.stringify({ kieApiKey: value }) });
      if (r.preview) toast(t.previewToast);
      else if (value === "CLEAR") toast(t.cleared);
      else toast(t.saved(r.credits ?? 0));
      setKey("");
      setEditing(false);
      await load();
      // Le widget « Crédits KIE » du menu relit le solde au prochain passage ; on le force.
      window.dispatchEvent(new Event("kie:credits"));
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setSaving(false);
    }
  };

  if (!me) return null;

  const form = (
    <form
      className="flex gap-2 flex-wrap"
      onSubmit={(e) => {
        e.preventDefault();
        void save(key);
      }}
    >
      <input
        className="input flex-1 min-w-[220px]"
        type="password"
        autoComplete="off"
        data-nodraft
        placeholder={me.hasKey ? t.newKey : t.pasteKey}
        value={key}
        onChange={(e) => setKey(e.target.value)}
      />
      <button type="submit" className="btn btn-primary" disabled={saving || key.trim().length < 10}>
        {saving ? t.checking : me.hasKey ? t.replace : t.save}
      </button>
      {me.hasKey && (
        <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)} disabled={saving}>
          {t.cancel}
        </button>
      )}
    </form>
  );

  if (!me.hasKey) {
    return (
      <section className="card p-5" translate="no" style={{ borderColor: "var(--accent-ring)" }}>
        <div className="label-xs">{t.before}</div>
        <h2 className="text-[19px] font-semibold mt-1.5">{t.welcome(me.firstName)}</h2>
        <p className="muted text-[13.5px] mt-2 leading-relaxed max-w-[70ch]">{t.intro}</p>
        <ol className="list-decimal pl-5 mt-3 flex flex-col gap-1.5 text-[13.5px]">
          <li>
            {t.step1[0]}{" "}
            <a href="https://kie.ai" target="_blank" rel="noreferrer" className="underline" style={{ color: "var(--accent)" }}>
              kie.ai
            </a>{" "}
            {t.step1[1]}
          </li>
          <li>
            {t.step2[0]}{" "}
            <a href="https://kie.ai/billing" target="_blank" rel="noreferrer" className="underline" style={{ color: "var(--accent)" }}>
              kie.ai/billing
            </a>{" "}
            {t.step2[1]}
          </li>
          <li>{t.step3}</li>
        </ol>
        <div className="mt-4 max-w-[620px]">{form}</div>
        {me.preview && <div className="badge badge-warn w-fit !text-[11.5px] mt-3">{t.preview(me.name)}</div>}
      </section>
    );
  }

  return (
    <section className="card px-4 py-3" translate="no">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13.5px]">
        <span className="label-xs">{t.myKey}</span>
        <span className="mono">{me.keyMask}</span>
        <span className={`badge !text-[10.5px] ${me.credits !== null ? (me.credits < 100 ? "badge-warn" : "badge-good") : "badge-danger"}`}>
          {me.credits !== null ? t.credits(me.credits) : t.refused}
        </span>
        <a href="https://kie.ai/billing" target="_blank" rel="noreferrer" className="btn btn-sm btn-primary" title={t.topUpTitle}>
          {t.topUp}
        </a>
        {!editing && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing(true)}>
            {t.change}
          </button>
        )}
        <span className="dim text-[12px] ml-auto">{t.private}</span>
        {me.preview && <span className="badge badge-warn !text-[11px]">{t.previewShort(me.name)}</span>}
      </div>
      {me.creditsError && /unusual account activity/i.test(me.creditsError) ? (
        // Compte KIE du membre signale par KIE : rien a corriger cote Studio, il doit passer par leur support.
        <div className="mt-2.5 rounded-[10px] px-3.5 py-3" style={{ background: "color-mix(in srgb, var(--critical) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--critical) 35%, transparent)" }}>
          <div className="text-[13px] font-semibold" style={{ color: "var(--critical)" }}>
            {t.flaggedTitle}
          </div>
          <p className="text-[12.5px] mt-1 leading-relaxed max-w-[80ch]">{t.flagged}</p>
          <a href="https://kie.ai" target="_blank" rel="noreferrer" className="btn btn-sm mt-2">
            {t.contact}
          </a>
        </div>
      ) : (
        me.creditsError && <div className="dim text-[12px] mt-1.5">{me.creditsError}</div>
      )}
      {editing && <div className="mt-3 max-w-[620px]">{form}</div>}
    </section>
  );
}
