"use client";

import { sessionHas } from "@/lib/sales/roles";
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { api } from "@/lib/client";
import { fmtDate, fmtDualDateTime, fmtDualTime, fmtInt, fmtMoney, label } from "@/lib/format";
import { periodQuery, useSalesData } from "@/lib/sales/client";
import { Card, Empty, ErrorNote, PageHeader, Spinner, StatTile, useToast } from "@/components/ui";
import { Delta, Funnel, PeriodPicker, Ratio, TrendChart } from "@/components/sales/bits";
import { OffersCard } from "@/components/sales/OffersCard";
import { InstallmentAlerts } from "@/components/sales/InstallmentAlerts";
import { AppointmentModal } from "@/components/sales/AppointmentModal";
import { useSales } from "@/components/sales/context";
import { MemberHome } from "@/components/sales/MemberHome";
import type { CloserRow, DayPoint, FunnelStep, SalesKpis, SetterRow } from "@/lib/sales/analytics";
import type { ActivityLog } from "@/lib/types";
import type { ActivityBlocks, AttentionBlock, AttentionItem, GoalBlock } from "@/app/api/sales/dashboard/route";

interface DashboardPayload {
  range: { from: string; to: string; key: string; label: string };
  kpis: SalesKpis;
  /** Memes indicateurs sur la periode precedente, null quand elle n'a pas de sens. */
  previous: SalesKpis | null;
  series: DayPoint[];
  goal: GoalBlock | null;
  attention: AttentionBlock | null;
  funnel: FunnelStep[];
  setters: SetterRow[];
  closers: CloserRow[];
  objections: { key: string; count: number }[];
  commissions: { setters: number; closers: number; due: number };
  followUps: { overdue: number; pending: number };
  logs: ActivityLog[];
  activity: ActivityBlocks | null;
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
  const currency = data?.currency ?? "EUR";

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

      {data?.attention && <AttentionCard block={data.attention} />}

      {loading && !data ? (
        <Card>
          <Spinner label="Calcul des indicateurs…" />
        </Card>
      ) : !k ? null : (
        <div className="flex flex-col gap-4">
          {data.goal && <GoalCard goal={data.goal} currency={currency} onSaved={refresh} />}

          {/* Bloc 1 : le volume. Chaque tuile porte sa variation vs la periode precedente. */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile
              label="Rendez-vous posés"
              value={fmtInt(k.appointments)}
              hint={<Delta now={k.appointments} prev={data.previous?.appointments} />}
            />
            <StatTile
              label="Calls honorés"
              value={fmtInt(k.attended)}
              hint={
                <Hints>
                  <Ratio value={k.showRate} />
                  <Delta now={k.attended} prev={data.previous?.attended} />
                </Hints>
              }
              accent={k.showRate >= 60 ? "var(--good)" : undefined}
            />
            <StatTile
              label="No-shows"
              value={fmtInt(k.noShows)}
              hint={<Delta now={k.noShows} prev={data.previous?.noShows} invert />}
              accent={k.noShows > 0 ? "var(--critical)" : undefined}
            />
            <StatTile
              label="Ventes"
              value={fmtInt(k.sales)}
              hint={
                <Hints>
                  <Ratio value={k.closeRate} />
                  <Delta now={k.sales} prev={data.previous?.sales} />
                </Hints>
              }
            />
          </div>

          {/* Bloc 2 : l'argent. Contrat et cash cote a cote, jamais confondus. */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile
              label="Valeur de contrat"
              value={fmtMoney(k.contractValue, currency)}
              hint={<Delta now={k.contractValue} prev={data.previous?.contractValue} />}
            />
            <StatTile
              label="Cash encaissé"
              value={fmtMoney(k.cashCollected, currency)}
              accent="var(--emerald)"
              hint={<Delta now={k.cashCollected} prev={data.previous?.cashCollected} />}
            />
            <StatTile
              label="Panier moyen"
              value={fmtMoney(k.avgDealSize, currency)}
              hint={<Delta now={k.avgDealSize} prev={data.previous?.avgDealSize} />}
            />
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

          {session.isAdmin && <InstallmentAlerts />}
          {session.isAdmin && <OffersCard editable />}

          <div className="grid lg:grid-cols-2 gap-4 items-start">
            <Card title="Funnel">
              <Funnel steps={data.funnel} />
            </Card>

            <Card title="Tendance" subtitle={`Calls honorés et ventes · ${data.range.label.toLowerCase()}`}>
              {data.range.key === "all" || data.range.key === "upcoming" ? (
                <Empty>Choisis une période bornée (7 jours, 30 jours, ce mois…) pour voir la tendance.</Empty>
              ) : (
                <TrendChart points={data.series} from={data.range.from} to={data.range.to} />
              )}
            </Card>
          </div>

          <div className="grid lg:grid-cols-2 gap-4 items-start">
            {data.objections.length > 0 && (
              <Card title="Objections" subtitle="Raisons de perte sur la période" padded={false}>
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

          {/* Journal en trois blocs : shifts des setters, rendez-vous et prospection, versements. */}
          {session.isAdmin && data.activity && (
            <div className="grid lg:grid-cols-3 gap-4 items-start">
              <Card title="Shifts setters" subtitle="Pointage et tâches du jour · heures FR puis DXB" padded={false}>
                {data.activity.tasksToday.length > 0 && (
                  <div className="px-3.5 py-2.5 flex flex-wrap gap-2" style={{ borderBottom: "1px solid var(--border)" }}>
                    {data.activity.tasksToday.map((t) => (
                      <span key={t.memberName} className="badge !text-[11px]" title="Tâches du jour cochées">
                        {t.memberName} · {t.done}/{t.total} tâches
                      </span>
                    ))}
                  </div>
                )}
                {!data.activity.shifts.length ? (
                  <Empty>Aucune session pointée.</Empty>
                ) : (
                  <ul>
                    {data.activity.shifts.map((s, i) => (
                      <li
                        key={s.id}
                        className="px-3.5 py-2 text-[12.5px]"
                        style={{ borderBottom: i < data.activity!.shifts.length - 1 ? "1px solid var(--border)" : "none" }}
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="font-medium">{s.memberName}</span>
                          <span className="num">{s.endedAt ? `${s.hours} h` : <span style={{ color: "var(--emerald)" }}>● en cours</span>}</span>
                        </div>
                        <div className="dim num text-[11.5px]">
                          {fmtDate(s.startedAt)} · {fmtDualTime(s.startedAt)}
                          {s.endedAt ? ` → ${fmtDualTime(s.endedAt)}` : ""}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="px-3.5 py-2" style={{ borderTop: "1px solid var(--border)" }}>
                  <Link href="/sales/pointage" className="link text-[12px]">
                    Tout voir dans Shifts équipe
                  </Link>
                </div>
              </Card>

              <Card title="Rendez-vous & prospection" subtitle="Rendez-vous, ventes, statuts posés · FR puis DXB" padded={false}>
                {!data.activity.appointments.length ? (
                  <Empty>Rien pour l&apos;instant.</Empty>
                ) : (
                  <ul>
                    {data.activity.appointments.map((l, i) => (
                      <li
                        key={l.id}
                        className="px-3.5 py-2 text-[12.5px]"
                        style={{ borderBottom: i < data.activity!.appointments.length - 1 ? "1px solid var(--border)" : "none" }}
                      >
                        <div>{l.summary}</div>
                        <div className="dim num text-[11.5px]">
                          {fmtDate(l.at)} · {fmtDualTime(l.at)}
                          {l.actorName ? ` · ${l.actorName}` : ""}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="px-3.5 py-2" style={{ borderTop: "1px solid var(--border)" }}>
                  <Link href="/sales/agenda" className="link text-[12px]">
                    Ouvrir l&apos;agenda
                  </Link>
                </div>
              </Card>

              <Card title="Versements" subtitle="Commissions versées · FR puis DXB" padded={false}>
                {!data.activity.payments.length ? (
                  <Empty>Aucun versement enregistré.</Empty>
                ) : (
                  <ul>
                    {data.activity.payments.map((l, i) => (
                      <li
                        key={l.id}
                        className="px-3.5 py-2 text-[12.5px]"
                        style={{ borderBottom: i < data.activity!.payments.length - 1 ? "1px solid var(--border)" : "none" }}
                      >
                        <div>{l.summary}</div>
                        <div className="dim num text-[11.5px]">
                          {fmtDate(l.at)} · {fmtDualTime(l.at)}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="px-3.5 py-2" style={{ borderTop: "1px solid var(--border)" }}>
                  <Link href="/sales/commissions" className="link text-[12px]">
                    Grand livre
                  </Link>
                </div>
              </Card>
            </div>
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

/** Plusieurs indications sous une tuile, sur une ligne. */
function Hints({ children }: { children: ReactNode }) {
  return <span className="flex items-center gap-2 flex-wrap">{children}</span>;
}

/* ------------------------------- À traiter ------------------------------ */

/**
 * Les trois listes qui faussent les chiffres tant qu'on ne les regle pas :
 * calls passes sans resultat, calls imminents non confirmes, calls sans
 * closer. Chaque ligne ouvre la fiche. La carte disparait quand tout est
 * propre : pas de carte vide qui rassure a tort.
 */
function AttentionCard({ block }: { block: AttentionBlock }) {
  type Group = { key: keyof AttentionBlock; title: string; hint: string; tone: string; items: AttentionItem[] };
  const all: Group[] = [
    {
      key: "noOutcome",
      title: "Résultat à saisir",
      hint: "Calls passés toujours « posé » ou « confirmé » : le show rate ment tant qu'ils traînent.",
      tone: "var(--critical)",
      items: block.noOutcome,
    },
    {
      key: "unconfirmed",
      title: "À confirmer sous 48 h",
      hint: "Le lead n'a pas confirmé sa présence : ce sont les no-shows de demain.",
      tone: "var(--warning)",
      items: block.unconfirmed,
    },
    {
      key: "unassigned",
      title: "Sans closer",
      hint: "Calls à venir que personne ne prendra tant qu'ils ne sont pas attribués.",
      tone: "var(--serious)",
      items: block.unassigned,
    },
  ];
  const groups = all.filter((g) => g.items.length > 0);

  if (!groups.length) return null;

  return (
    <div className={`mb-4 grid gap-3 ${groups.length === 1 ? "" : groups.length === 2 ? "lg:grid-cols-2" : "lg:grid-cols-3"}`}>
      {groups.map((g) => (
        <Card
          key={g.key}
          padded={false}
          title={
            <span className="flex items-center gap-2 !text-[14px]">
              <span className="w-[8px] h-[8px] rounded-full shrink-0" style={{ background: g.tone }} />
              {g.title}
              <span className="badge !text-[10.5px] !py-0 num">{g.items.length}</span>
            </span>
          }
          subtitle={g.hint}
        >
          <ul>
            {g.items.map((it, i) => (
              <li key={it.id} style={{ borderBottom: i < g.items.length - 1 ? "1px solid var(--border)" : "none" }}>
                <Link
                  href={`/sales/rendez-vous?open=${it.id}`}
                  className="px-3.5 py-2 flex items-center justify-between gap-3 text-[12.5px] hover:bg-[var(--surface-2)]"
                >
                  <span className="font-medium truncate">{it.leadName}</span>
                  <span className="dim num text-[11.5px] shrink-0">
                    {fmtDualDateTime(it.at)} · {it.who}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}

/* ---------------------------- Objectif du mois -------------------------- */

/**
 * Cash du mois civil face a l'objectif, avec la projection au rythme actuel.
 *
 * L'objectif se modifie sur place : c'est l'admin qui le fixe, et il le lit
 * ici tous les jours. Sans objectif, la carte propose d'en fixer un et
 * montre quand meme le cash du mois et celui du mois dernier.
 */
function GoalCard({ goal, currency, onSaved }: { goal: GoalBlock; currency: string; onSaved: () => void }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(goal.target || ""));
  const [busy, setBusy] = useState(false);

  const pct = goal.target > 0 ? Math.min((goal.cash / goal.target) * 100, 100) : 0;
  const onTrack = goal.target > 0 && goal.projected >= goal.target;
  const remaining = Math.max(0, goal.target - goal.cash);
  const daysLeft = Math.max(1, goal.daysInMonth - goal.dayOfMonth + 1);

  const save = async () => {
    setBusy(true);
    try {
      await api("/api/sales/goal", { method: "PATCH", body: JSON.stringify({ target: Number(draft) || 0 }) });
      toast(Number(draft) > 0 ? "Objectif du mois enregistré." : "Objectif retiré.");
      setEditing(false);
      onSaved();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Objectif du mois"
      subtitle={`Cash encaissé depuis le 1er, échéances comprises · jour ${goal.dayOfMonth} sur ${goal.daysInMonth}`}
      actions={
        editing ? (
          <>
            <input
              className="input !w-[140px] !h-[30px] num"
              type="number"
              min={0}
              step={500}
              value={draft}
              placeholder="ex. 20000"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void save();
                if (e.key === "Escape") setEditing(false);
              }}
              autoFocus
            />
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void save()}>
              Enregistrer
            </button>
            <button className="btn btn-sm" disabled={busy} onClick={() => setEditing(false)}>
              Annuler
            </button>
          </>
        ) : (
          <button
            className="btn btn-sm"
            onClick={() => {
              setDraft(String(goal.target || ""));
              setEditing(true);
            }}
          >
            {goal.target > 0 ? "Modifier l'objectif" : "Fixer un objectif"}
          </button>
        )
      }
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-3">
        <span
          className="text-[28px] sm:text-[32px] font-semibold num leading-none"
          style={{ letterSpacing: "-0.035em", color: "var(--emerald)" }}
        >
          {fmtMoney(goal.cash, currency)}
        </span>
        {goal.target > 0 ? (
          <span className="dim text-[13px] num">
            sur {fmtMoney(goal.target, currency)} · {pct.toFixed(0)} %
          </span>
        ) : (
          <span className="dim text-[13px]">aucun objectif fixé</span>
        )}
        <span className="dim text-[12px] num ml-auto">mois dernier : {fmtMoney(goal.lastMonth, currency)}</span>
      </div>

      {goal.target > 0 && (
        <>
          <div className="rounded-[6px] overflow-hidden" style={{ height: 10, background: "var(--surface-3)" }}>
            <div
              className="h-full rounded-[6px] transition-[width]"
              style={{
                width: `${Math.max(pct, goal.cash > 0 ? 1.5 : 0)}%`,
                background: onTrack ? "var(--emerald)" : "var(--grad-accent)",
              }}
            />
          </div>
          <div className="flex flex-wrap justify-between gap-2 mt-2 text-[12px]">
            <span style={{ color: onTrack ? "var(--good)" : "var(--text-2)" }}>
              {onTrack ? "✓ " : ""}Projection fin de mois au rythme actuel :{" "}
              <strong className="num">{fmtMoney(goal.projected, currency)}</strong>
            </span>
            {remaining > 0 ? (
              <span className="dim num">
                Reste {fmtMoney(remaining, currency)} · {fmtMoney(remaining / daysLeft, currency)} par jour sur {daysLeft} jour
                {daysLeft > 1 ? "s" : ""}
              </span>
            ) : (
              <span className="num" style={{ color: "var(--good)" }}>
                Objectif atteint 🎉
              </span>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
