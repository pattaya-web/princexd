"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { useToast } from "@/components/ui";
import type { StudioMemberMe } from "@/app/api/studio-members/me/route";

/**
 * Bandeau « Ma clé KIE » du membre Studio IA, en haut de son Studio.
 *
 * Sans clé, c'est la première chose à faire : le bandeau s'ouvre en grand
 * avec les trois étapes. Avec une clé, une ligne : clé masquée, solde,
 * Recharger (kie.ai/billing), Changer. La clé est vérifiée auprès de KIE
 * avant d'être gardée et n'est jamais réaffichée en clair.
 */
export function StudioMemberKey() {
  const toast = useToast();
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
      if (r.preview) toast("Aperçu : la clé du membre n'est pas modifiée.");
      else if (value === "CLEAR") toast("Clé effacée.");
      else toast(`Clé enregistrée et vérifiée : ${r.credits ?? 0} crédits KIE sur ton compte.`);
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
        placeholder={me.hasKey ? "Nouvelle clé (remplace l'actuelle)" : "Colle ta clé API KIE"}
        value={key}
        onChange={(e) => setKey(e.target.value)}
      />
      <button type="submit" className="btn btn-primary" disabled={saving || key.trim().length < 10}>
        {saving ? "Vérification…" : me.hasKey ? "Remplacer" : "Enregistrer"}
      </button>
      {me.hasKey && (
        <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)} disabled={saving}>
          Annuler
        </button>
      )}
    </form>
  );

  if (!me.hasKey) {
    return (
      <section className="card p-5" style={{ borderColor: "var(--accent-ring)" }}>
        <div className="label-xs">Avant de commencer</div>
        <h2 className="text-[19px] font-semibold mt-1.5">Bienvenue {me.firstName}, pose ta clé KIE.</h2>
        <p className="muted text-[13.5px] mt-2 leading-relaxed max-w-[70ch]">
          Le Studio tourne sur KIE, la plateforme qui fait tourner les modèles (GPT Image 2, Nano Banana, Kling, Seedance, Wan…). Tu paies tes générations toi-même, en crédits, à l&apos;usage. Tes créations sont sauvegardées ici et visibles par toi seul.
        </p>
        <ol className="list-decimal pl-5 mt-3 flex flex-col gap-1.5 text-[13.5px]">
          <li>
            Crée ton compte sur{" "}
            <a href="https://kie.ai" target="_blank" rel="noreferrer" className="underline" style={{ color: "var(--accent)" }}>
              kie.ai
            </a>{" "}
            (e-mail ou Google).
          </li>
          <li>
            Recharge des crédits sur{" "}
            <a href="https://kie.ai/billing" target="_blank" rel="noreferrer" className="underline" style={{ color: "var(--accent)" }}>
              kie.ai/billing
            </a>{" "}
            (carte bancaire, 20 à 30 € pour démarrer).
          </li>
          <li>Ouvre « API Key » dans le menu de KIE, copie la clé et colle-la ci-dessous. Elle est vérifiée puis gardée pour toi, personne ne la revoit en clair.</li>
        </ol>
        <div className="mt-4 max-w-[620px]">{form}</div>
        {me.preview && <div className="badge badge-warn w-fit !text-[11.5px] mt-3">Aperçu : tu vois le Studio comme {me.name}.</div>}
      </section>
    );
  }

  return (
    <section className="card px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13.5px]">
        <span className="label-xs">Ma clé KIE</span>
        <span className="mono">{me.keyMask}</span>
        <span className={`badge !text-[10.5px] ${me.credits !== null ? (me.credits < 100 ? "badge-warn" : "badge-good") : "badge-danger"}`}>
          {me.credits !== null ? `${me.credits} crédits` : "clé refusée par KIE"}
        </span>
        <a href="https://kie.ai/billing" target="_blank" rel="noreferrer" className="btn btn-sm btn-primary" title="Acheter des crédits sur kie.ai (page Billing)">
          Recharger ↗
        </a>
        {!editing && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing(true)}>
            Changer de clé
          </button>
        )}
        <span className="dim text-[12px] ml-auto">Tes créations sont sauvegardées ici, toi seul les vois.</span>
        {me.preview && <span className="badge badge-warn !text-[11px]">Aperçu : {me.name}</span>}
      </div>
      {me.creditsError && <div className="dim text-[12px] mt-1.5">{me.creditsError}</div>}
      {editing && <div className="mt-3 max-w-[620px]">{form}</div>}
    </section>
  );
}
