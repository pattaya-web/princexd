"use client";

import { EntityView } from "@/components/EntityView";
import { InfoNote, StatTile } from "@/components/ui";
import { ADS } from "@/lib/schemas";
import { fmtEur, fmtInt } from "@/lib/format";
import type { AdCampaign } from "@/lib/types";

export default function AdsPage() {
  return (
    <>
      <div className="mb-4">
        <InfoNote>
          Phase 2 de ton écosystème. Pour l&apos;instant tu saisis les chiffres à la main depuis le Gestionnaire de
          publicités : ça suffit pour piloter les angles et voir lesquels sortent un ROAS. Le branchement direct de
          l&apos;API Marketing de Meta demande une app Business vérifiée — à faire quand les campagnes tourneront
          vraiment, pas avant.
        </InfoNote>
      </div>
      <EntityView
        spec={ADS}
        title="Meta Ads"
        summary={(rows) => {
          const ads = rows as unknown as AdCampaign[];
          const actives = ads.filter((a) => a.status === "actif");
          const spend = ads.reduce((a, c) => a + (c.spend || 0), 0);
          const revenue = ads.reduce((a, c) => a + (c.revenue || 0), 0);
          const calls = ads.reduce((a, c) => a + (c.calls || 0), 0);
          return (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatTile label="Campagnes actives" value={fmtInt(actives.length)} hint={`${ads.length} au total`} />
              <StatTile label="Dépensé" value={fmtEur(spend)} />
              <StatTile
                label="ROAS"
                value={spend > 0 ? `${(revenue / spend).toFixed(2).replace(".", ",")}×` : "—"}
                hint={`${fmtEur(revenue)} de CA`}
                accent={spend > 0 && revenue / spend >= 2 ? "var(--good)" : spend > 0 ? "var(--warning)" : undefined}
              />
              <StatTile
                label="Coût par call"
                value={calls > 0 ? fmtEur(spend / calls) : "—"}
                hint={`${calls} calls générés`}
              />
            </div>
          );
        }}
      />
    </>
  );
}
