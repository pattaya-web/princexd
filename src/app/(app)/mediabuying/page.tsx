"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMb } from "@/components/mediabuying/context";
import { CreativeModal, Delta, KpiCard, MetricValue } from "@/components/mediabuying/bits";
import { PhaseBoard, TopCreatives } from "@/components/mediabuying/PhaseBoard";
import { ErrorNote, InfoNote, PageHeader, Spinner } from "@/components/ui";
import { METRIC_BY_KEY } from "@/lib/mediabuying/metrics";
import type { EntityRow, MetricKey, Phase, RankingMetric } from "@/lib/mediabuying/types";

const KPIS: { key: MetricKey; label: string }[] = [
  { key: "spend", label: "Spend" },
  { key: "leads", label: "Leads" },
  { key: "cpl", label: "CPL" },
  { key: "bookings", label: "Bookings" },
  { key: "costPerBooking", label: "Cost / Booking" },
  { key: "shows", label: "Shows" },
  { key: "showRate", label: "Show rate" },
  { key: "sales", label: "Sales" },
  { key: "cac", label: "CAC" },
  { key: "roas", label: "ROAS" },
];

/**
 * Cockpit : les cartes du compte, les trois phases, le top des creatives.
 * Tout vient de la vue agregee ; aucune action automatique.
 */
export default function MediaBuyingCockpit() {
  const mb = useMb();
  const router = useRouter();
  const o = mb.overview;
  const [creative, setCreative] = useState<EntityRow | null>(null);
  const [ranking, setRanking] = useState<RankingMetric>("costPerBooking");

  if (!mb.connections.length && !mb.loading) {
    return (
      <>
        <PageHeader title="Media buying" subtitle="Pilote tes campagnes Meta Ads depuis l'outil : testing, scaling, hyper-scaling." />
        <InfoNote>
          Aucun compte Meta connecté. Ajoute-en un dans{" "}
          <Link href="/mediabuying/connections" className="link">
            Connexions
          </Link>{" "}
          : sans Access Token, un compte simulé te permet déjà de prendre l&apos;outil en main.
        </InfoNote>
      </>
    );
  }

  const setPhase = (campaignId: string, phase: Phase) => {
    if (!mb.connection) return;
    const current = o?.campaigns.find((c) => c.id === campaignId);
    if (!current || current.phase === phase) return;
    void mb.act("/api/mediabuying/internal", { method: "PATCH", body: JSON.stringify({ connectionId: mb.connection.id, campaignId, phase }) }, `${current.name} → ${phase} (classification interne).`);
  };

  return (
    <>
      <PageHeader
        title="Media buying"
        subtitle={o ? `${o.campaigns.filter((c) => c.status === "active").length} campagnes actives · ${o.ads.length} ads · ${o.connection.accountName || o.connection.name}` : "Chargement…"}
        actions={
          <>
            <Link href="/mediabuying/builder" className="btn btn-primary">
              + Create campaign
            </Link>
            <Link href="/mediabuying/campaigns" className="btn">
              Campagnes
            </Link>
          </>
        }
      />
      {mb.error && <div className="mb-3"><ErrorNote>{mb.error}</ErrorNote></div>}
      {!o && mb.loading && <Spinner label="Première synchronisation Meta…" />}
      {o && (
        <>
          {o.connection.status === "error" && (
            <div className="mb-3">
              <ErrorNote>
                Compte en erreur : {o.connection.lastError || "connexion Meta refusée"}.{" "}
                <Link href="/mediabuying/connections" className="link">
                  Vérifier la connexion
                </Link>
              </ErrorNote>
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 mb-4">
            {KPIS.map((k) => {
              const def = METRIC_BY_KEY.get(k.key);
              const notConnected = Boolean(def?.business) && !o.conversionsConnected;
              return (
                <KpiCard
                  key={k.key}
                  label={k.label}
                  notConnected={notConnected}
                  action={
                    notConnected ? (
                      <Link href="/sales/dashboard" className="btn btn-sm !h-[24px] !text-[11px]">
                        Connect data source
                      </Link>
                    ) : undefined
                  }
                  value={<MetricValue k={k.key} v={o.totals[k.key]} currency={o.currency} />}
                  sub={<Delta now={o.totals[k.key]} before={o.prevTotals[k.key]} lowerIsBetter={def?.lowerIsBetter} />}
                />
              );
            })}
          </div>
          {o.conversionsConnected && (
            <div className="dim text-[11.5px] mb-4 -mt-2">
              Bookings, shows et ventes viennent du CRM ({o.conversionSource === "crm" ? "leads attribués à chaque ad" : o.conversionSource}) ; Meta ne fournit que leads, clics et dépense.
            </div>
          )}

          <div className="mb-4">
            <PhaseBoard campaigns={o.campaigns} settings={o.settings} currency={o.currency} conversionsConnected={o.conversionsConnected} onPhase={setPhase} onOpen={(id) => router.push(`/mediabuying/campaigns?campaign=${id}`)} />
          </div>

          <div className="grid lg:grid-cols-2 gap-3">
            <TopCreatives ads={o.ads} currency={o.currency} conversionsConnected={o.conversionsConnected} ranking={ranking} onRanking={setRanking} onOpen={setCreative} />
            <section className="card">
              <div className="px-4 pt-3.5 pb-2.5" style={{ borderBottom: "1px solid var(--border)" }}>
                <h3 className="text-[15px] font-semibold">À regarder</h3>
                <p className="dim text-[12px]">Recommandations KILL et WATCH sur les ads actives. Rien n&apos;est coupé sans toi.</p>
              </div>
              <ul>
                {o.ads
                  .filter((a) => a.status === "active" && (a.recommendation.verdict === "kill" || a.recommendation.verdict === "watch"))
                  .sort((a, b) => (a.recommendation.verdict === "kill" ? -1 : 1) - (b.recommendation.verdict === "kill" ? -1 : 1) || b.metrics.spend - a.metrics.spend)
                  .slice(0, 8)
                  .map((a) => (
                    <li key={a.id} className="flex items-center gap-3 px-4 py-2 row-hover cursor-pointer" style={{ borderBottom: "1px solid var(--border)" }} onClick={() => setCreative(a)}>
                      <span className="mono text-[10.5px] font-semibold w-[44px] shrink-0" style={{ color: a.recommendation.verdict === "kill" ? "var(--critical)" : "var(--warning)" }}>
                        {a.recommendation.verdict.toUpperCase()}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-medium truncate">{a.name}</div>
                        <div className="dim text-[11.5px] truncate">{a.recommendation.reason}</div>
                      </div>
                      <span className="dim text-[11px] num shrink-0">{o.campaigns.find((c) => c.id === a.campaignId)?.name.split("|")[0]?.trim()}</span>
                    </li>
                  ))}
                {!o.ads.some((a) => a.status === "active" && a.recommendation.verdict !== "keep" && a.recommendation.verdict !== "none") && (
                  <li className="dim text-[12.5px] px-4 py-5">Rien à signaler : toutes les ads actives tiennent tes cibles.</li>
                )}
              </ul>
            </section>
          </div>
        </>
      )}
      <CreativeModal
        row={creative}
        open={creative !== null}
        onClose={() => setCreative(null)}
        currency={mb.currency}
        campaignName={o?.campaigns.find((c) => c.id === creative?.campaignId)?.name ?? ""}
        adsetName={o?.adsets.find((a) => a.id === creative?.parentId)?.name ?? ""}
        onCopied={() => creative && mb.logEvent("ad", creative.id, creative.name, "postId.copy", `Post ID de ${creative.name} copié`)}
      />
    </>
  );
}
