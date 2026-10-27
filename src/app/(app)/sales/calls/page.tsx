"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { PageHeader, useToast } from "@/components/ui";
import { CallsBoard } from "@/components/sales/CallsBoard";
import { useSales } from "@/components/sales/context";

/**
 * Calls : la vue iClosed du CRM, pour l'admin.
 *
 * À venir d'abord (avec le lien pour rejoindre), puis les calls passés avec
 * presence, issue et compte-rendu Fathom ; chaque ligne ouvre la fiche pour
 * statuer. En haut, les actions Fathom (relire les enregistrements, poser le
 * webhook) pour ne plus passer par les Reglages.
 */

interface FathomState {
  configured: boolean;
  webhookId: string;
  webhookUrl: string;
  secretSet: boolean;
  lastSyncAt: string;
}

function FathomActions({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [st, setSt] = useState<FathomState | null>(null);
  const [busy, setBusy] = useState("");
  const load = () => api<FathomState>("/api/fathom").then(setSt).catch(() => setSt(null));
  useEffect(() => {
    void load();
  }, []);
  const webhook = async () => {
    setBusy("webhook");
    try {
      const r = await api<{ webhook: { id: string; url: string } }>("/api/fathom", { method: "POST", body: JSON.stringify({ action: "webhook", origin: window.location.origin }) });
      toast(`Webhook posé chez Fathom (${r.webhook.url}).`);
      void load();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy("");
    }
  };
  const sync = async (days: number) => {
    setBusy("sync");
    try {
      const r = await api<{ examined: number; attached: number; skipped: number; unmatched: string[] }>("/api/fathom", { method: "POST", body: JSON.stringify({ action: "sync", days }), timeoutMs: 180_000 });
      toast(`${r.examined} enregistrement${r.examined > 1 ? "s" : ""} lu${r.examined > 1 ? "s" : ""} · ${r.attached} compte${r.attached > 1 ? "s" : ""}-rendu${r.attached > 1 ? "s" : ""} ajouté${r.attached > 1 ? "s" : ""} · ${r.skipped} déjà là${r.unmatched.length ? ` · ${r.unmatched.length} sans rendez-vous trouvé (email manquant sur la fiche ?)` : ""}.`);
      void load();
      onDone();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy("");
    }
  };
  if (!st) return null;
  if (!st.configured) {
    return <span className="dim text-[12px]">Fathom : pas de clé (Réglages → Fathom).</span>;
  }
  return (
    <>
      <button className="btn" onClick={() => void sync(7)} disabled={busy !== ""} title="Relire les enregistrements Fathom des 7 derniers jours et poser les comptes-rendus manquants">
        {busy === "sync" ? "Lecture Fathom…" : "Relire Fathom (7 j)"}
      </button>
      <button className="btn" onClick={() => void webhook()} disabled={busy !== ""} title={st.webhookId ? `Webhook posé : ${st.webhookUrl}` : "Fathom enverra chaque compte-rendu dès la fin du call"}>
        {busy === "webhook" ? "…" : st.webhookId ? "Webhook Fathom ✓" : "Créer le webhook Fathom"}
      </button>
    </>
  );
}

export default function CallsPage() {
  const { version, bump } = useSales();
  const [tick, setTick] = useState(0);
  const refresh = () => {
    setTick((t) => t + 1);
    bump();
  };
  return (
    <>
      <PageHeader title="Calls" subtitle="Tes calls comme sur iClosed : à venir, puis passés avec présence, issue et compte-rendu. Clique un nom pour la fiche, « Statuer » pour poser l'issue." actions={<FathomActions onDone={refresh} />} />

      <h2 className="text-[15px] font-semibold mb-2">À venir</h2>
      <div className="mb-6">
        <CallsBoard scope="upcoming" refreshKey={version + tick} onChanged={refresh} />
      </div>

      <h2 className="text-[15px] font-semibold mb-2">Calls passés</h2>
      <CallsBoard scope="past" refreshKey={version + tick} onChanged={refresh} />
    </>
  );
}
