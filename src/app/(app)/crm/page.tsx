"use client";

import { EntityView } from "@/components/EntityView";
import { StatTile } from "@/components/ui";
import { LEADS } from "@/lib/schemas";
import { fmtEur, fmtInt, fmtPct } from "@/lib/format";
import type { Lead } from "@/lib/types";

export default function CrmPage() {
  return (
    <EntityView
      spec={LEADS}
      title="CRM"
      subtitle="Chaque lead qui sort d'un contenu, jusqu'au closing. Glisse une carte d'une colonne à l'autre pour changer son étape."
      summary={(rows) => {
        const leads = rows as unknown as Lead[];
        const won = leads.filter((l) => l.stage === "closed-won");
        const lost = leads.filter((l) => l.stage === "closed-lost");
        const inPipe = leads.filter((l) => !l.stage.startsWith("closed"));
        const decided = won.length + lost.length;
        return (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile label="Pipeline ouvert" value={fmtEur(inPipe.reduce((a, l) => a + (l.dealValue || 0), 0))} hint={`${inPipe.length} leads actifs`} />
            <StatTile label="Closé" value={fmtEur(won.reduce((a, l) => a + (l.dealValue || 0), 0))} hint={`${won.length} ventes`} accent="var(--good)" />
            <StatTile label="Taux de closing" value={decided ? fmtPct((won.length / decided) * 100) : "—"} hint={decided ? `${won.length} / ${decided} décidés` : "Aucun deal tranché"} />
            <StatTile label="Calls bookés" value={fmtInt(leads.filter((l) => l.stage === "call-book").length)} hint="En attente de call" />
          </div>
        );
      }}
    />
  );
}
