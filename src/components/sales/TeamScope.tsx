"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { fmtInt, fmtMoney } from "@/lib/format";
import { periodQuery, useSalesData } from "@/lib/sales/client";
import { Card, Empty, ErrorNote, PageHeader, Spinner, StatTile } from "@/components/ui";
import { PeriodPicker, Ratio } from "./bits";
import { AppointmentsBoard } from "./AppointmentsBoard";
import { useSales } from "./context";
import { hasRole } from "@/lib/sales/roles";
import type { CloserRow, SalesKpis, SetterRow } from "@/lib/sales/analytics";

interface DashboardPayload {
  kpis: SalesKpis;
  setters: SetterRow[];
  closers: CloserRow[];
  commissions: { setters: number; closers: number; due: number };
  currency: string;
}

/**
 * Page de pilotage d'un metier — setters ou closers.
 *
 * Les deux ecrans partagent la meme mecanique : des indicateurs en haut, un
 * classement, puis le tableau des rendez-vous filtre sur la personne choisie.
 * Seules les colonnes du classement changent, d'ou ce composant commun plutot
 * que deux pages jumelles qui divergeraient a la premiere modification.
 */
export function TeamScope({ role }: { role: "setter" | "closer" }) {
  const { members, session, period, setPeriod, version, bump } = useSales();
  const [selected, setSelected] = useState("");

  const people = useMemo(() => members.filter((m) => hasRole(m, role)), [members, role]);

  const { data, loading, error } = useSalesData<DashboardPayload>(
    `/api/sales/dashboard?${periodQuery(period.period, period.from, period.to, { v: String(version) })}`,
  );

  const currency = data?.currency ?? "USD";
  const isSetter = role === "setter";
  const k = data?.kpis;

  // Ligne de classement de la personne selectionnee, s'il y en a une : evite
  // un second appel reseau pour des chiffres deja calcules.
  const row = selected
    ? isSetter
      ? data?.setters.find((s) => s.memberId === selected)
      : data?.closers.find((c) => c.memberId === selected)
    : undefined;

  const setterRow = row as SetterRow | undefined;
  const closerRow = row as CloserRow | undefined;

  return (
    <>
      <PageHeader
        title={isSetter ? "Setters" : "Closers"}
        actions={
          <>
            <select
              className="select !w-auto !h-[30px] !text-[12.5px]"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">Toute l&apos;équipe</option>
              {people.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <PeriodPicker value={period} onChange={setPeriod} />
          </>
        }
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
      ) : (
        <>
          {/* Indicateurs : ceux de la personne choisie, sinon ceux de l'equipe. */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            {isSetter ? (
              <>
                <StatTile
                  label="Rendez-vous posés"
                  value={fmtInt(setterRow ? setterRow.appointments : (k?.appointments ?? 0))}
                  hint={setterRow ? `${fmtInt(setterRow.qualified)} qualifiés` : undefined}
                />
                <StatTile
                  label="Calls honorés"
                  value={fmtInt(setterRow ? setterRow.shows : (k?.attended ?? 0))}
                  hint={<Ratio value={setterRow ? setterRow.showRate : (k?.showRate ?? 0)} />}
                />
                <StatTile
                  label="No-shows"
                  value={fmtInt(setterRow ? setterRow.noShows : (k?.noShows ?? 0))}
                  accent="var(--critical)"
                />
                <StatTile
                  label="Ventes générées"
                  value={fmtInt(setterRow ? setterRow.sales : (k?.sales ?? 0))}
                  hint={<Ratio value={setterRow ? setterRow.setterToSale : (k?.apptToSaleRate ?? 0)} />}
                />
                <StatTile
                  label="CA généré"
                  value={fmtMoney(setterRow ? setterRow.revenue : (k?.contractValue ?? 0), currency)}
                />
                <StatTile
                  label="Cash généré"
                  value={fmtMoney(setterRow ? setterRow.cash : (k?.cashCollected ?? 0), currency)}
                  accent="var(--emerald)"
                />
                <StatTile
                  label="Commissions setters"
                  value={fmtMoney(data?.commissions.setters ?? 0, currency)}
                  hint={selected ? "Équipe entière" : undefined}
                />
                <StatTile
                  label="Total dû à l'équipe"
                  value={fmtMoney(data?.commissions.due ?? 0, currency)}
                  hint={
                    <Link href="/sales/commissions" className="link">
                      Grand livre
                    </Link>
                  }
                />
              </>
            ) : (
              <>
                <StatTile
                  label="Calls assignés"
                  value={fmtInt(closerRow ? closerRow.assigned : (k?.appointments ?? 0))}
                />
                <StatTile
                  label="Calls honorés"
                  value={fmtInt(closerRow ? closerRow.completed : (k?.attended ?? 0))}
                  hint={<Ratio value={k?.showRate ?? 0} />}
                />
                <StatTile
                  label="Ventes"
                  value={fmtInt(closerRow ? closerRow.sales : (k?.sales ?? 0))}
                  hint={<Ratio value={closerRow ? closerRow.closeRate : (k?.closeRate ?? 0)} />}
                />
                <StatTile
                  label="No-shows"
                  value={fmtInt(closerRow ? closerRow.noShows : (k?.noShows ?? 0))}
                  accent="var(--critical)"
                />
                <StatTile
                  label="Valeur de contrat"
                  value={fmtMoney(closerRow ? closerRow.revenue : (k?.contractValue ?? 0), currency)}
                />
                <StatTile
                  label="Cash encaissé"
                  value={fmtMoney(closerRow ? closerRow.cash : (k?.cashCollected ?? 0), currency)}
                  accent="var(--emerald)"
                />
                <StatTile
                  label="Panier moyen"
                  value={fmtMoney(closerRow ? closerRow.avgDealSize : (k?.avgDealSize ?? 0), currency)}
                />
                <StatTile
                  label="CA par call"
                  value={fmtMoney(closerRow ? closerRow.revenuePerCall : (k?.revenuePerCall ?? 0), currency)}
                />
              </>
            )}
          </div>

          {/* Classement, seulement en vue equipe. */}
          {!selected && (
            <Card title={isSetter ? "Classement setters" : "Classement closers"} padded={false} className="mb-4">
              {(isSetter ? data?.setters.length : data?.closers.length) ? (
                <div className="scroll-x">
                  <table className="table">
                    <thead>
                      {isSetter ? (
                        <tr>
                          <th>Setter</th>
                          <th className="text-right">Rdv</th>
                          <th className="text-right">Qualifiés</th>
                          <th className="text-right">Shows</th>
                          <th className="text-right">Show rate</th>
                          <th className="text-right">Ventes</th>
                          <th className="text-right">Rdv → vente</th>
                          <th className="text-right">CA</th>
                          <th className="text-right">Cash</th>
                        </tr>
                      ) : (
                        <tr>
                          <th>Closer</th>
                          <th className="text-right">Assignés</th>
                          <th className="text-right">Honorés</th>
                          <th className="text-right">Ventes</th>
                          <th className="text-right">Close rate</th>
                          <th className="text-right">Contrat</th>
                          <th className="text-right">Cash</th>
                          <th className="text-right">Panier</th>
                          <th className="text-right">CA / call</th>
                        </tr>
                      )}
                    </thead>
                    <tbody>
                      {isSetter
                        ? data?.setters.map((s) => (
                            <tr key={s.memberId}>
                              <td>
                                <Link href={`/sales/membre/${s.memberId}`} className="link text-[12.5px]">
                                  {s.name}
                                </Link>
                              </td>
                              <td className="text-right num">{fmtInt(s.appointments)}</td>
                              <td className="text-right num">{fmtInt(s.qualified)}</td>
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
                          ))
                        : data?.closers.map((c) => (
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
                              <td className="text-right num">{fmtMoney(c.revenuePerCall, currency)}</td>
                            </tr>
                          ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty>
                  Aucun {isSetter ? "setter" : "closer"} n&apos;a encore d&apos;activité sur cette période.
                </Empty>
              )}
            </Card>
          )}

          <AppointmentsBoard
            session={session}
            members={members}
            period={period}
            onPeriodChange={setPeriod}
            onChanged={bump}
            refreshKey={version}
            forceSetterId={isSetter ? selected || undefined : undefined}
            forceCloserId={!isSetter ? selected || undefined : undefined}
          />
        </>
      )}
    </>
  );
}
