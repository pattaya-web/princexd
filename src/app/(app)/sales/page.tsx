"use client";

import { sessionHas } from "@/lib/sales/roles";
import { useState } from "react";
import Link from "next/link";
import { fmtDateTime, fmtInt, fmtMoney, label } from "@/lib/format";
import { periodQuery, useSalesData } from "@/lib/sales/client";
import { Card, Empty, ErrorNote, PageHeader, Spinner, StatTile } from "@/components/ui";
import { Funnel, PeriodPicker, Ratio } from "@/components/sales/bits";
import { AppointmentModal } from "@/components/sales/AppointmentModal";
import { useSales } from "@/components/sales/context";
import { MemberHome } from "@/components/sales/MemberHome";
import type { CloserRow, FunnelStep, SalesKpis, SetterRow } from "@/lib/sales/analytics";
import type { ActivityLog } from "@/lib/types";

interface DashboardPayload {
  kpis: SalesKpis;
  funnel: FunnelStep[];
  setters: SetterRow[];
  closers: CloserRow[];
  objections: { key: string; count: number }[];
  commissions: { setters: number; closers: number; due: number };
  followUps: { overdue: number; pending: number };
  logs: ActivityLog[];
  currency: string;
}

/**
 * Dashboard commercial.
 *
 * Le meme ecran sert a tout le monde, mais pas avec le meme contenu : l'admin
 * voit les classements et les commissions de l'equipe, un setter ou un closer
 * ne voit que sa propre performance. Le tri est fait par le serveur — la page
 * ne recoit tout simplement pas ce qui ne la concerne pas.
 */
export default function SalesDashboardPage() {
  const { session, members, period, setPeriod, version, bump } = useSales();
  const [adding, setAdding] = useState(false);

  /*
   * Deux ecrans, deux publics.
   *
   * Un setter n'a que faire d'un tableau de bord de pilotage : il veut savoir
   * quand il bosse, qui il doit rappeler et ou il en est de son objectif.
   * L'admin, lui, veut les agregats et les classements.
   */
  const isMember = sessionHas(session, "setter") || sessionHas(session, "closer");

  const { data, loading, error, reload } = useSalesData<DashboardPayload>(
    `/api/sales/dashboard?${periodQuery(period.period, period.from, period.to, { v: String(version) })}`,
  );

  const k = data?.kpis;
  const currency = data?.currency ?? "USD";

  const refresh = () => {
    bump();
    void reload();
  };

  if (isMember) return <MemberHome />;

  return (
    <>
      <PageHeader
        title={session.isAdmin ? "Sales Dashboard" : `Mon activité — ${session.memberName}`}
        actions={
          <>
            <PeriodPicker value={period} onChange={setPeriod} />
            {(session.isAdmin || sessionHas(session, "setter")) && (
              <button className="btn btn-primary" onClick={() => setAdding(true)}>
                + Rendez-vous
              </button>
            )}
          </>
        }
      />

      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {/* Relances en retard : la seule alerte qui merite d'etre en haut. */}
      {data && data.followUps.overdue > 0 && (
        <Link href="/sales/relances" className="block mb-4">
          <div
            className="rounded-lg px-3.5 py-2.5 text-[12.5px] flex items-center gap-2"
            style={{
              background: "color-mix(in srgb, var(--warning) 12%, transparent)",
              border: "1px solid color-mix(in srgb, var(--warning) 35%, transparent)",
            }}
          >
            <strong className="num">{data.followUps.overdue}</strong>
            relance{data.followUps.overdue > 1 ? "s" : ""} en retard — à traiter avant que le lead refroidisse.
          </div>
        </Link>
      )}

      {loading && !data ? (
        <Card>
          <Spinner label="Calcul des indicateurs…" />
        </Card>
      ) : !k ? null : (
        <div className="flex flex-col gap-4">
          {/* Bloc 1 : le volume */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile label="Rendez-vous posés" value={fmtInt(k.appointments)} />
            <StatTile
              label="Calls honorés"
              value={fmtInt(k.attended)}
              hint={<Ratio value={k.showRate} />}
              accent={k.showRate >= 60 ? "var(--good)" : undefined}
            />
            <StatTile
              label="No-shows"
              value={fmtInt(k.noShows)}
              accent={k.noShows > 0 ? "var(--critical)" : undefined}
            />
            <StatTile label="Ventes" value={fmtInt(k.sales)} hint={<Ratio value={k.closeRate} />} />
          </div>

          {/* Bloc 2 : l'argent. Contrat et cash cote a cote, jamais confondus. */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile label="Valeur de contrat" value={fmtMoney(k.contractValue, currency)} />
            <StatTile
              label="Cash encaissé"
              value={fmtMoney(k.cashCollected, currency)}
              accent="var(--emerald)"
            />
            <StatTile label="Panier moyen" value={fmtMoney(k.avgDealSize, currency)} />
            <StatTile
              label="CA par rendez-vous"
              value={fmtMoney(k.revenuePerAppointment, currency)}
              hint={`${fmtMoney(k.revenuePerCall, currency)} par call honoré`}
            />
          </div>

          {/* Bloc 3 : les commissions */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile label="Commissions setters" value={fmtMoney(data.commissions.setters, currency)} />
            <StatTile label="Commissions closers" value={fmtMoney(data.commissions.closers, currency)} />
            <StatTile
              label="Total dû"
              value={fmtMoney(data.commissions.due, currency)}
              accent={data.commissions.due > 0 ? "var(--warning)" : undefined}
              hint={
                <Link href="/sales/commissions" className="link">
                  Ouvrir le grand livre
                </Link>
              }
            />
            <StatTile
              label="Conversion rdv → vente"
              value={<Ratio value={k.apptToSaleRate} />}
              hint={`${fmtInt(k.sales)} sur ${fmtInt(k.appointments)}`}
            />
          </div>

          <div className="grid lg:grid-cols-2 gap-4 items-start">
            <Card title="Funnel">
              <Funnel steps={data.funnel} />
            </Card>

            {data.objections.length > 0 && (
              <Card title="Objections" padded={false}>
                <ul>
                  {data.objections.map((o, i) => (
                    <li
                      key={o.key}
                      className="px-3.5 py-2.5 flex items-center justify-between gap-3"
                      style={{
                        borderBottom: i < data.objections.length - 1 ? "1px solid var(--border)" : "none",
                      }}
                    >
                      <span className="text-[12.5px]">{label(o.key)}</span>
                      <span className="num text-[12.5px] font-semibold">{o.count}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>

          {/* Classements : admin uniquement */}
          {session.isAdmin && data.setters.length > 0 && (
            <Card
              title="Classement setters"
              padded={false}
              actions={
                <Link href="/sales/setters" className="btn btn-sm">
                  Détail
                </Link>
              }
            >
              <div className="scroll-x">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Setter</th>
                      <th className="text-right">Rdv</th>
                      <th className="text-right">Shows</th>
                      <th className="text-right">Show rate</th>
                      <th className="text-right">Ventes</th>
                      <th className="text-right">Rdv → vente</th>
                      <th className="text-right">CA généré</th>
                      <th className="text-right">Cash</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.setters.map((s) => (
                      <tr key={s.memberId}>
                        <td>
                          <Link href={`/sales/membre/${s.memberId}`} className="link text-[12.5px]">
                            {s.name}
                          </Link>
                        </td>
                        <td className="text-right num">{fmtInt(s.appointments)}</td>
                        <td className="text-right num">{fmtInt(s.shows)}</td>
                        <td className="text-right">
                          <Ratio value={s.showRate} />
                        </td>
                        <td className="text-right num">{fmtInt(s.sales)}</td>
                        <td className="text-right">
                          <Ratio value={s.setterToSale} />
                        </td>
                        <td className="text-right num">{fmtMoney(s.revenue, currency)}</td>
                        <td className="text-right num" style={{ color: "var(--emerald)" }}>
                          {fmtMoney(s.cash, currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {session.isAdmin && data.closers.length > 0 && (
            <Card
              title="Classement closers"
              padded={false}
              actions={
                <Link href="/sales/closers" className="btn btn-sm">
                  Détail
                </Link>
              }
            >
              <div className="scroll-x">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Closer</th>
                      <th className="text-right">Calls</th>
                      <th className="text-right">Honorés</th>
                      <th className="text-right">Ventes</th>
                      <th className="text-right">Close rate</th>
                      <th className="text-right">Contrat</th>
                      <th className="text-right">Cash</th>
                      <th className="text-right">Panier moyen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.closers.map((c) => (
                      <tr key={c.memberId}>
                        <td>
                          <Link href={`/sales/membre/${c.memberId}`} className="link text-[12.5px]">
                            {c.name}
                          </Link>
                        </td>
                        <td className="text-right num">{fmtInt(c.assigned)}</td>
                        <td className="text-right num">{fmtInt(c.completed)}</td>
                        <td className="text-right num">{fmtInt(c.sales)}</td>
                        <td className="text-right">
                          <Ratio value={c.closeRate} />
                        </td>
                        <td className="text-right num">{fmtMoney(c.revenue, currency)}</td>
                        <td className="text-right num" style={{ color: "var(--emerald)" }}>
                          {fmtMoney(c.cash, currency)}
                        </td>
                        <td className="text-right num">{fmtMoney(c.avgDealSize, currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Journal : qui a fait quoi. */}
          {session.isAdmin && (
            <Card title="Activité récente" padded={false}>
              {!data.logs.length ? (
                <Empty>Rien pour l&apos;instant.</Empty>
              ) : (
                <ul>
                  {data.logs.map((l, i) => (
                    <li
                      key={l.id}
                      className="px-3.5 py-2 flex items-baseline gap-3"
                      style={{ borderBottom: i < data.logs.length - 1 ? "1px solid var(--border)" : "none" }}
                    >
                      <span className="dim num text-[11.5px] shrink-0">{fmtDateTime(l.at)}</span>
                      <span className="text-[12.5px]">{l.summary}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>
      )}

      <AppointmentModal
        open={adding}
        onClose={() => setAdding(false)}
        onSaved={refresh}
        session={session}
        members={members}
      />
    </>
  );
}
