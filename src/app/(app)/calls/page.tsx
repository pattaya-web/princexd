"use client";

import { useState } from "react";
import { EntityView } from "@/components/EntityView";
import { InfoNote, StatTile, useToast } from "@/components/ui";
import { CALLS } from "@/lib/schemas";
import { api } from "@/lib/client";
import { fmtEur, fmtInt, fmtPct } from "@/lib/format";
import type { CallEvent } from "@/lib/types";

export default function CallsPage() {
  const toast = useToast();
  const [syncing, setSyncing] = useState(false);
  const [months, setMonths] = useState(6);

  const sync = async () => {
    setSyncing(true);
    try {
      const r = await api<{ retenus: number; callsCreated: number; callsUpdated: number }>(
        "/api/iclosed/sync",
        { method: "POST", body: JSON.stringify({ months }) },
      );
      toast(`iClosed : ${r.retenus} appels traités — ${r.callsCreated} nouveaux, ${r.callsUpdated} mis à jour.`);
      window.location.reload();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2 justify-between">
        <InfoNote>
          Branché sur l&apos;<strong>API iClosed</strong> : la synchro ramène ton calendrier — appels passés et à
          venir, coordonnées, réponses au questionnaire de qualification et issue du call. Elle{" "}
          <strong>ne crée aucun lead</strong> : le CRM reste ce que tu y mets. Ouvre un call pour lire ses réponses,
          et crée le lead toi-même quand la personne mérite d&apos;entrer dans le pipeline.
        </InfoNote>
        <div className="flex items-center gap-2 shrink-0">
          <select
            className="select !w-[120px]"
            value={months}
            onChange={(e) => setMonths(Number(e.target.value))}
            aria-label="Profondeur d'historique"
          >
            <option value={1}>1 mois</option>
            <option value={3}>3 mois</option>
            <option value={6}>6 mois</option>
            <option value={12}>12 mois</option>
            <option value={36}>Tout</option>
          </select>
          <button className="btn btn-primary" onClick={() => void sync()} disabled={syncing}>
            {syncing ? <span className="spinner" /> : "↻"} Synchroniser iClosed
          </button>
        </div>
      </div>

      <EntityView
        spec={CALLS}
        title="Calls"
        subtitle="Tous tes appels de vente, leur issue et le montant closé."
        summary={(rows) => {
          const calls = rows as unknown as CallEvent[];
          const now = Date.now();
          const upcoming = calls.filter((c) => c.status === "book" && new Date(c.at).getTime() > now);
          // Un call passé resté en « booké » = issue jamais renseignée dans iClosed.
          // On l'exclut des taux plutôt que de le compter comme un no-show.
          const aQualifier = calls.filter((c) => c.status === "book" && new Date(c.at).getTime() <= now);
          const qualifies = calls.filter((c) => c.status !== "book");
          const shows = calls.filter((c) => c.status === "show" || c.status === "closed");
          const closed = calls.filter((c) => c.status === "closed");
          return (
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              <StatTile label="À venir" value={fmtInt(upcoming.length)} hint="Calls bookés non passés" />
              <StatTile
                label="À qualifier"
                value={fmtInt(aQualifier.length)}
                hint="Passés sans issue renseignée"
                accent={aQualifier.length ? "var(--warning)" : undefined}
              />
              <StatTile
                label="Taux de présence"
                value={qualifies.length ? fmtPct((shows.length / qualifies.length) * 100) : "—"}
                hint={qualifies.length ? `${shows.length} présents / ${qualifies.length} qualifiés` : "Aucune issue renseignée"}
              />
              <StatTile
                label="Taux de closing"
                value={shows.length ? fmtPct((closed.length / shows.length) * 100) : "—"}
                hint={`${closed.length} closés`}
                accent="var(--good)"
              />
              <StatTile label="CA généré" value={fmtEur(closed.reduce((a, c) => a + (c.value || 0), 0))} />
            </div>
          );
        }}
      />
    </>
  );
}
