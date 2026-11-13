"use client";

/**
 * Opérations — la vue strategique de Mady sur la machine commerciale.
 *
 * Pas les taches une par une (elles sont dans le cockpit de Jorah) : les
 * flux, les taux avec leur denominateur, l'execution de l'equipe, les
 * anomalies, et ce qui revient a Mady elle-meme (calls a statuer, paiements
 * a verifier). Chaque taux explique sa definition au survol.
 */
import { useState } from "react";
import Link from "next/link";
import { useSalesData } from "@/lib/sales/client";
import { useSales } from "@/components/sales/context";
import { Card, Empty, ErrorNote, PageHeader, Spinner, StatTile } from "@/components/ui";
import type { OpsKpis } from "@/lib/sales/ops/report";
import type { AnomalyRow } from "@/lib/sales/ops/views";
import type { DailyReport } from "@/lib/sales/ops/report";
import { LeadSheet } from "@/components/sales/LeadSheet";
import { ReportBlock } from "@/components/sales/ops/Performance";
import { money, Pill, when } from "@/components/sales/ops/shared";

interface Payload {
  kpis: OpsKpis;
  anomalies: AnomalyRow[];
  today: DailyReport;
  mine: { id: string; kind: string; title: string; context: string; dueAt: string; leadId: string }[];
  engine: { lastRunAt: string; lastError: string; lastErrorAt: string; runs: number; failures: number; open: number; last: { created: number; updated: number; closed: number; assigned: number } | null };
  headName: string;
  currency: string;
}

const SOURCES = [
  { v: "", l: "Toutes les sources" },
  { v: "META_ADS", l: "Meta Ads" },
  { v: "INSTAGRAM", l: "Instagram" },
  { v: "ORGANIC", l: "Organique" },
  { v: "REFERRAL", l: "Parrainage" },
  { v: "OTHER", l: "Autre" },
  { v: "UNKNOWN", l: "Inconnue" },
];

export default function OperationsPage() {
  const { version, bump, members } = useSales();
  const [days, setDays] = useState(30);
  const [source, setSource] = useState("");
  const [owner, setOwner] = useState("");
  const [sheet, setSheet] = useState<string | null>(null);
  const { data, error, loading } = useSalesData<Payload>(`/api/sales/ops/kpis?days=${days}&source=${source}&owner=${owner}&v=${version}`, { every: 120_000 });
  const k = data?.kpis;
  const c = data?.currency ?? "EUR";
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader
        title="Opérations"
        subtitle={data?.headName ? `La machine commerciale, pilotée par ${data.headName}. Ici : les chiffres, les écarts et ce qui t'attend.` : "Nomme un Head of Setting dans Automatisations pour que les leads lui soient attribués."}
        actions={
          <>
            <select className="select !h-[34px] !w-auto" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Période">
              <option value={1}>Aujourd'hui</option>
              <option value={7}>7 jours</option>
              <option value={30}>30 jours</option>
              <option value={90}>90 jours</option>
            </select>
            <select className="select !h-[34px] !w-auto" value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source">
              {SOURCES.map((s) => (
                <option key={s.v} value={s.v}>
                  {s.l}
                </option>
              ))}
            </select>
            <select className="select !h-[34px] !w-auto" value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Responsable">
              <option value="">Tous les responsables</option>
              {members.filter((m) => m.status !== "inactif").map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <Link href="/sales/workspace" className="btn">
              Cockpit équipe →
            </Link>
          </>
        }
      />

      {error && <ErrorNote>{error}</ErrorNote>}
      {loading && !data ? (
        <Card>
          <Spinner label="Calcul des indicateurs…" />
        </Card>
      ) : !k || !data ? null : (
        <div className="space-y-4">
          {data.engine.lastError && (
            <ErrorNote>
              Le moteur de tâches a échoué ({when(data.engine.lastErrorAt, today)}) : {data.engine.lastError}. Les tâches existantes restent affichées ; il retente toutes les 2 minutes.
            </ErrorNote>
          )}

          {/* Ce qui revient a Mady */}
          {data.mine.length > 0 && (
            <Card title={`À toi (${data.mine.length})`} subtitle="Calls à statuer, paiements à préciser ou à vérifier : la suite part automatiquement à l'équipe dès que c'est fait.">
              <ul className="space-y-1.5">
                {data.mine.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center gap-2 text-[13px]">
                    <Pill tone={t.kind === "outcome-missing" ? "info" : "warn"}>{t.kind === "payment-verify" ? "Paiement à vérifier" : t.kind === "payment" ? "Paiement à préciser" : "Résultat à renseigner"}</Pill>
                    <button type="button" className="font-medium hover:underline text-left" onClick={() => setSheet(t.leadId)}>
                      {t.title}
                    </button>
                    <span className="dim text-[12px]">{when(t.dueAt, today)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* Acquisition */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
            <StatTile label="Leads aujourd'hui" value={k.leads.today} />
            <StatTile label="Leads 7 jours" value={k.leads.d7} />
            <StatTile label="Leads 30 jours" value={k.leads.d30} />
            <StatTile label="Délai médian de 1re réponse" value={k.medianFirstResponseMin === null ? "—" : k.medianFirstResponseMin < 60 ? `${k.medianFirstResponseMin} min` : `${Math.round(k.medianFirstResponseMin / 60)} h`} hint="Leads arrivés sur la période, du formulaire au premier contact confirmé" />
          </div>

          <div className="grid lg:grid-cols-3 gap-3">
            <Card title="Rendez-vous" subtitle={`Sur ${k.range.days} jour${k.range.days > 1 ? "s" : ""}`}>
              <ul className="space-y-1 text-[13px]">
                <li className="flex justify-between"><span>Posés (créés sur la période)</span><strong className="num">{k.appointments.booked}</strong></li>
                <li className="flex justify-between"><span>Confirmés par le prospect</span><strong className="num">{k.appointments.confirmed}</strong></li>
                <li className="flex justify-between"><span>Réalisés</span><strong className="num">{k.appointments.held}</strong></li>
                <li className="flex justify-between"><span>No-shows</span><strong className="num">{k.appointments.noShows}</strong></li>
                <li className="flex justify-between"><span>No-shows récupérés</span><strong className="num">{k.appointments.recovered}</strong></li>
              </ul>
            </Card>
            <Card title="Ventes & encaissements" subtitle="Ventes conclues et cash encaissé sur la période">
              <ul className="space-y-1 text-[13px]">
                <li className="flex justify-between"><span>Ventes</span><strong className="num">{k.sales.count}</strong></li>
                <li className="flex justify-between"><span>CA encaissé</span><strong className="num">{money(k.sales.cash, c)}</strong></li>
                <li className="flex justify-between"><span>Paiements en attente</span><strong className="num">{k.sales.pendingCount} · {money(k.sales.pendingAmount, c)}</strong></li>
                <li className="flex justify-between" title="(calls à venir + relances post-call en cours) × prix de l'offre principale + restes dus"><span>Valeur du pipeline ⓘ</span><strong className="num">{money(k.sales.pipelineValue, c)}</strong></li>
                <li className="flex justify-between"><span>Leads chauds non closés</span><strong className="num">{k.sales.hotNotClosed}</strong></li>
              </ul>
            </Card>
            <Card title="Sources" subtitle="Leads arrivés sur la période">
              {k.leads.bySource.length === 0 ? (
                <p className="dim text-[12.5px]">Aucun lead sur la période.</p>
              ) : (
                <ul className="space-y-1.5 text-[13px]">
                  {k.leads.bySource.map((s) => (
                    <li key={s.label}>
                      <div className="flex justify-between"><span>{s.label}</span><strong className="num">{s.count}</strong></div>
                      <div className="h-[5px] rounded-full mt-0.5" style={{ background: "var(--surface-3)" }}>
                        <div className="h-full rounded-full" style={{ width: `${Math.round((s.count / Math.max(1, k.leads.inRange)) * 100)}%`, background: "var(--accent)" }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card title="Taux de conversion" subtitle="Survole un taux pour lire son dénominateur exact.">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5">
              {k.rates.map((r) => (
                <div key={r.key} className="rounded-lg px-3 py-2.5" style={{ background: "var(--surface-3)" }} title={r.hint}>
                  <div className="label-xs">{r.label}</div>
                  <div className="text-[22px] font-semibold num mt-1">{r.pct === null ? "—" : `${r.pct.toLocaleString("fr-FR")} %`}</div>
                  <div className="dim text-[11.5px] num">
                    {r.num} / {r.den}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Exécution de l'équipe" subtitle="Tâches faites sur la période, et dans les délais (avant la fin du jour d'échéance).">
            {k.team.length === 0 ? (
              <p className="dim text-[12.5px]">Pas encore de tâche traitée.</p>
            ) : (
              <table className="table w-full text-[13px]">
                <thead>
                  <tr>
                    <th className="text-left">Membre</th>
                    <th className="text-right">Leads suivis</th>
                    <th className="text-right">Tâches faites</th>
                    <th className="text-right">Dans les délais</th>
                    <th className="text-right">En retard</th>
                  </tr>
                </thead>
                <tbody>
                  {k.team.map((t) => (
                    <tr key={t.id}>
                      <td>{t.name}</td>
                      <td className="text-right num">{t.owned}</td>
                      <td className="text-right num">{t.done}</td>
                      <td className="text-right num">{t.onTimePct === null ? "—" : `${t.onTimePct} %`}</td>
                      <td className="text-right num" style={{ color: t.overdue ? "var(--critical)" : undefined }}>
                        {t.overdue}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card title={`Anomalies (${data.anomalies.length})`} subtitle="Leads actifs sans responsable, sans prochaine action, sans activité ou avec un call passé sans résultat.">
            {data.anomalies.length === 0 ? (
              <Empty>Aucune anomalie : chaque lead actif a un responsable et une prochaine action. ✓</Empty>
            ) : (
              <ul className="space-y-1.5">
                {data.anomalies.map((a) => (
                  <li key={a.leadId} className="flex flex-wrap items-center gap-2 text-[13px]">
                    <Pill tone="bad">{a.reason}</Pill>
                    <button type="button" className="font-medium hover:underline text-left" onClick={() => setSheet(a.leadId)}>
                      {a.name}
                    </button>
                    <span className="dim text-[12px]">
                      depuis {when(a.since, today)} · {a.ownerName}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <ReportBlock version={version} onChanged={bump} />

          <p className="dim text-[12px]">
            Moteur de tâches : {data.engine.lastRunAt ? `dernier passage ${when(data.engine.lastRunAt, today)}` : "pas encore passé"} · {data.engine.open} tâches ouvertes
            {data.engine.last ? ` · dernier passage : ${data.engine.last.created} créées, ${data.engine.last.closed} closes, ${data.engine.last.assigned} leads attribués` : ""}
            {data.engine.failures ? ` · ${data.engine.failures} échec(s) depuis le démarrage` : ""} ·{" "}
            <Link href="/sales/automatisations" className="link">
              Réglages
            </Link>
          </p>
        </div>
      )}
      <LeadSheet id={sheet} onClose={() => setSheet(null)} onChanged={bump} />
    </>
  );
}
