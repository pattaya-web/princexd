"use client";

import { use } from "react";
import { fmtDate, fmtInt, fmtMoney, label } from "@/lib/format";
import { periodQuery, useSalesData } from "@/lib/sales/client";
import { BarChart } from "@/components/charts";
import { Card, Empty, ErrorNote, PageHeader, Spinner, StatTile } from "@/components/ui";
import { AppointmentsBoard } from "@/components/sales/AppointmentsBoard";
import { PeriodPicker, Ratio } from "@/components/sales/bits";
import { useSales } from "@/components/sales/context";
import type { CloserRow, DayPoint, SetterRow } from "@/lib/sales/analytics";
import type { LedgerRow } from "@/lib/sales/commissions";
import type { CommissionPayment, CommissionRule } from "@/lib/types";

interface ProfilePayload {
  member: { id: string; name: string; role: string; status: string; email: string; joinedAt: string };
  isSetter: boolean;
  currency: string;
  stats: (SetterRow & CloserRow) | null;
  ledger: LedgerRow | null;
  ruleLabel: string;
  series: DayPoint[];
  payments: CommissionPayment[];
  ruleHistory: CommissionRule[];
}

/**
 * Fiche individuelle d'un membre.
 *
 * Les chiffres proviennent des memes fonctions que le dashboard : la fiche
 * d'Alex ne peut donc pas contredire le classement des setters, meme apres
 * une correction de vente ou un changement de regle.
 */
export default function MemberProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { session, members, period, setPeriod, version, bump } = useSales();

  const { data, loading, error } = useSalesData<ProfilePayload>(
    `/api/sales/members/${id}?${periodQuery(period.period, period.from, period.to, { v: String(version) })}`,
  );

  const currency = data?.currency ?? "USD";
  const s = data?.stats;
  const ledger = data?.ledger;
  const isSetter = data?.isSetter ?? true;

  return (
    <>
      <PageHeader
        title={data?.member.name ?? "Membre"}
        actions={<PeriodPicker value={period} onChange={setPeriod} />}
      />

      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {loading && !data ? (
        <Card>
          <Spinner label="Chargement…" />
        </Card>
      ) : !data ? null : (
        <div className="flex flex-col gap-4">
          {/* En-tete */}
          <Card>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <span className="badge">{label(data.member.role)}</span>
              <span
                className={`badge ${
                  data.member.status === "actif"
                    ? "badge-good"
                    : data.member.status === "inactif"
                      ? "badge-danger"
                      : "badge-warn"
                }`}
              >
                {label(data.member.status)}
              </span>
              {data.member.email && <span className="text-[12.5px]">{data.member.email}</span>}
              <span className="text-[12.5px]">
                <span className="dim">Depuis </span>
                <span className="num">{data.member.joinedAt ? fmtDate(data.member.joinedAt) : "—"}</span>
              </span>
              <span className="text-[12.5px] ml-auto">
                <span className="dim">Commission : </span>
                {data.ruleLabel}
              </span>
            </div>
          </Card>

          {/* Performance */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {isSetter ? (
              <>
                <StatTile
                  label="Rendez-vous"
                  value={fmtInt(s?.appointments ?? 0)}
                  hint={`${fmtInt(s?.qualified ?? 0)} qualifiés`}
                />
                <StatTile label="Shows" value={fmtInt(s?.shows ?? 0)} hint={<Ratio value={s?.showRate ?? 0} />} />
                <StatTile label="No-shows" value={fmtInt(s?.noShows ?? 0)} accent="var(--critical)" />
                <StatTile
                  label="Ventes générées"
                  value={fmtInt(s?.sales ?? 0)}
                  hint={<Ratio value={s?.setterToSale ?? 0} />}
                />
              </>
            ) : (
              <>
                <StatTile label="Calls assignés" value={fmtInt(s?.assigned ?? 0)} />
                <StatTile label="Calls honorés" value={fmtInt(s?.completed ?? 0)} />
                <StatTile label="Ventes" value={fmtInt(s?.sales ?? 0)} hint={<Ratio value={s?.closeRate ?? 0} />} />
                <StatTile label="Panier moyen" value={fmtMoney(s?.avgDealSize ?? 0, currency)} />
              </>
            )}
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile label="CA généré" value={fmtMoney(s?.revenue ?? 0, currency)} />
            <StatTile label="Cash généré" value={fmtMoney(s?.cash ?? 0, currency)} accent="var(--emerald)" />
            <StatTile
              label="Commission gagnée"
              value={fmtMoney(ledger?.earnedInPeriod ?? 0, currency)}
              hint={`${fmtMoney(ledger?.earnedTotal ?? 0, currency)} depuis le début`}
            />
            <StatTile
              label="Reste dû"
              value={fmtMoney(ledger?.due ?? 0, currency)}
              accent={(ledger?.due ?? 0) > 0 ? "var(--warning)" : "var(--good)"}
              hint={`${fmtMoney(ledger?.paidTotal ?? 0, currency)} déjà versés`}
            />
          </div>

          {/* Performance dans le temps */}
          {data.series.length > 0 && (
            <Card title="Jour par jour">
              <BarChart
                rows={data.series.map((p) => ({
                  label: fmtDate(p.date),
                  value: isSetter ? p.appointments : p.shows,
                  color: "var(--s1)",
                  meta: `${p.appointments} rdv · ${p.shows} shows · ${p.sales} vente${p.sales > 1 ? "s" : ""}`,
                }))}
                format={(n) => String(Math.round(n))}
              />
            </Card>
          )}

          {/* Versements */}
          <div className="grid lg:grid-cols-2 gap-4 items-start">
            <Card title="Versements" padded={false}>
              {!data.payments.length ? (
                <Empty>Aucune commission versée pour l&apos;instant.</Empty>
              ) : (
                <ul>
                  {data.payments.map((p, i) => (
                    <li
                      key={p.id}
                      className="px-3.5 py-2.5 flex items-center justify-between gap-3"
                      style={{
                        borderBottom: i < data.payments.length - 1 ? "1px solid var(--border)" : "none",
                      }}
                    >
                      <span className="num text-[12px]">{fmtDate(p.paidAt)}</span>
                      <span className="text-[12px] flex-1 min-w-0 truncate dim">{p.method || p.notes}</span>
                      <span className="num text-[12.5px] font-semibold">{fmtMoney(p.amount, p.currency)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {/* L'historique des regles explique les commissions anciennes. */}
            <Card title="Historique des règles" padded={false}>
              {!data.ruleHistory.length ? (
                <Empty>Aucune règle de commission configurée.</Empty>
              ) : (
                <ul>
                  {data.ruleHistory.map((r, i) => (
                    <li
                      key={r.id}
                      className="px-3.5 py-2.5 flex items-center justify-between gap-3"
                      style={{
                        borderBottom: i < data.ruleHistory.length - 1 ? "1px solid var(--border)" : "none",
                      }}
                    >
                      <span className="num text-[12px]">{fmtDate(r.effectiveFrom)}</span>
                      <span className="text-[12px] flex-1 min-w-0 truncate">{label(r.type)}</span>
                      <span className="num text-[12px]">
                        {r.pct ? `${r.pct} %` : ""} {r.fixed ? `${r.fixed} ${r.currency}` : ""}
                      </span>
                      {r.active && <span className="badge badge-good !text-[10px] !py-0">En cours</span>}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <AppointmentsBoard
            session={session}
            members={members}
            period={period}
            onPeriodChange={setPeriod}
            onChanged={bump}
            refreshKey={version}
            forceSetterId={isSetter ? id : undefined}
            forceCloserId={!isSetter ? id : undefined}
          />
        </div>
      )}
    </>
  );
}
