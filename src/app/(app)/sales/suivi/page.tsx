"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import { fmtDate, fmtDateTime, fmtMoney, label } from "@/lib/format";
import { useSalesData } from "@/lib/sales/client";
import { Card, Empty, ErrorNote, PageHeader, Spinner, StatTile, useToast } from "@/components/ui";
import { IgHandle } from "@/components/sales/bits";
import { AppointmentDetail } from "@/components/sales/AppointmentDetail";
import { useSales } from "@/components/sales/context";
import type { SuiviClosed, SuiviFollowUp, SuiviNoShow } from "@/app/api/sales/suivi/route";

interface Payload {
  noShows: SuiviNoShow[];
  followUps: SuiviFollowUp[];
  closed: SuiviClosed[];
  currency: string;
  totals: {
    noShows: number;
    toRelaunch: number;
    overdue: number;
    today: number;
    closed: number;
    contract: number;
    cash: number;
    remaining: number;
  };
}

const BUCKETS = [
  { key: "overdue", title: "En retard", tone: "var(--critical)" },
  { key: "today", title: "Aujourd'hui", tone: "var(--warning)" },
  { key: "upcoming", title: "À venir", tone: "var(--text-2)" },
] as const;

/** Jour AAAA-MM-JJ a J+n, pour la date de rappel d'une relance. */
function dayPlus(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Suivi : l'ecran qu'on ouvre le matin avec son cafe.
 *
 * Il repond a une seule question, « qu'est-ce que je fais aujourd'hui sur
 * mes calls passes ? » : quels no-shows relancer, quelles relances sont
 * arrivees a echeance, et ou en sont les closes (qui doit encore payer).
 * Chaque nom ouvre la fiche pour agir sans changer d'ecran.
 */
export default function SuiviPage() {
  const { session, members, version, bump } = useSales();
  const toast = useToast();
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [showClosedFollowUps, setShowClosedFollowUps] = useState(false);

  const { data, loading, error, reload } = useSalesData<Payload>(`/api/sales/suivi?v=${version}`);
  const currency = data?.currency ?? "EUR";

  const refresh = () => {
    void reload();
    bump();
  };

  /**
   * « Relance envoyée » sur un no-show : on note qu'on a ecrit au lead et on
   * se donne deux jours pour qu'il reponde. La relance apparait aussitot
   * dans la liste du dessous, et passera en retard si rien ne bouge.
   */
  const relaunch = async (n: SuiviNoShow) => {
    setBusy(n.id);
    try {
      await api("/api/sales/followups", {
        method: "POST",
        body: JSON.stringify({
          appointmentId: n.id,
          dueAt: new Date(`${dayPlus(2)}T10:00:00`).toISOString(),
          notes: `Relance no-show du ${fmtDate(n.scheduledAt)} envoyée${n.relaunches ? ` (${n.relaunches + 1}e)` : ""}. Reprogrammer le call s'il répond.`,
        }),
      });
      toast(`Relance notée pour ${n.leadName}. Rappel dans 2 jours.`);
      refresh();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy("");
    }
  };

  const closeFollowUp = async (id: string, status: "done" | "cancelled") => {
    setBusy(id);
    try {
      await api(`/api/sales/followups/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      toast(status === "done" ? "Relance clôturée." : "Relance abandonnée.");
      refresh();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy("");
    }
  };

  const t = data?.totals;
  const closedFollowUps = (data?.followUps ?? []).filter((f) => f.bucket === "closed");

  return (
    <>
      <PageHeader title="Suivi" />

      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <StatTile
          label="No-shows à relancer"
          value={t?.toRelaunch ?? 0}
          hint={t && t.noShows > t.toRelaunch ? `${t.noShows - t.toRelaunch} déjà relancé${t.noShows - t.toRelaunch > 1 ? "s" : ""}` : undefined}
          accent={t?.toRelaunch ? "var(--critical)" : undefined}
        />
        <StatTile
          label="Relances à faire"
          value={(t?.overdue ?? 0) + (t?.today ?? 0)}
          hint={t?.overdue ? `${t.overdue} en retard` : undefined}
          accent={t?.overdue ? "var(--critical)" : t?.today ? "var(--warning)" : undefined}
        />
        <StatTile label="Closés" value={t?.closed ?? 0} hint={t ? `${fmtMoney(t.contract, currency)} de contrat` : undefined} />
        <StatTile
          label="Reste à encaisser"
          value={fmtMoney(t?.remaining ?? 0, currency)}
          hint={t ? `${fmtMoney(t.cash, currency)} déjà encaissés` : undefined}
          accent={t?.remaining ? "var(--warning)" : "var(--emerald)"}
        />
      </div>

      {loading && !data ? (
        <Card>
          <Spinner label="Chargement du suivi…" />
        </Card>
      ) : data ? (
        <div className="flex flex-col gap-4">
          {/* ------------------------------ No-shows ------------------------------ */}
          <Card
            title="No-shows à relancer"
            subtitle="Calls manqués sans nouveau rendez-vous. « Relance envoyée » note le message et te rappelle dans 2 jours ; le nom ouvre la fiche pour décaler le call."
            padded={false}
          >
            {!data.noShows.length ? (
              <Empty>Aucun no-show en attente. Tous ont été reprogrammés.</Empty>
            ) : (
              <ul>
                {data.noShows.map((n, i) => (
                  <li
                    key={n.id}
                    className="px-3.5 py-2.5 flex items-center gap-3 flex-wrap"
                    style={{ borderBottom: i < data.noShows.length - 1 ? "1px solid var(--border)" : "none" }}
                  >
                    <span className="num text-[12px] shrink-0" style={{ width: 108, color: n.relaunchedAt ? "var(--text-2)" : "var(--critical)" }}>
                      {fmtDateTime(n.scheduledAt)}
                    </span>
                    <button className="text-[12.5px] font-medium text-left hover:underline" onClick={() => setOpenId(n.id)}>
                      {n.leadName}
                    </button>
                    <IgHandle username={n.igUsername} muted />
                    {n.phone && (
                      <a href={`tel:${n.phone}`} className="num text-[12px] link">
                        {n.phone}
                      </a>
                    )}
                    <span className="dim text-[12px]">
                      il y a {n.daysAgo} jour{n.daysAgo > 1 ? "s" : ""}
                      {session.isAdmin && n.setterName ? ` · setter ${n.setterName}` : ""}
                    </span>
                    {n.relaunchedAt && (
                      <span className="badge !text-[10.5px] !py-0">
                        relancé {n.relaunches > 1 ? `${n.relaunches}× · ` : ""}le {fmtDate(n.relaunchedAt)}
                      </span>
                    )}
                    <span className="flex gap-1.5 shrink-0 ml-auto">
                      <button className={`btn btn-sm ${n.relaunchedAt ? "" : "btn-primary"}`} onClick={() => void relaunch(n)} disabled={busy === n.id}>
                        {busy === n.id ? <span className="spinner" /> : n.relaunchedAt ? "Relancer encore" : "Relance envoyée"}
                      </button>
                      <button className="btn btn-sm btn-ghost" onClick={() => setOpenId(n.id)}>
                        Décaler
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* ------------------------------ Relances ------------------------------ */}
          <Card
            title="Relances émises"
            subtitle="Chaque relance a une date de rappel. « Fait » quand le lead a répondu ou que le call est reprogrammé."
            padded={false}
            actions={
              closedFollowUps.length > 0 ? (
                <button className="btn btn-sm" onClick={() => setShowClosedFollowUps((v) => !v)}>
                  {showClosedFollowUps ? "Masquer les clôturées" : `Clôturées récemment · ${closedFollowUps.length}`}
                </button>
              ) : undefined
            }
          >
            {!data.followUps.some((f) => f.bucket !== "closed") ? (
              <Empty>Aucune relance en attente.</Empty>
            ) : (
              BUCKETS.map((bucket) => {
                const items = data.followUps.filter((f) => f.bucket === bucket.key);
                if (!items.length) return null;
                return (
                  <div key={bucket.key}>
                    <div className="px-3.5 py-1.5 label-xs" style={{ background: "var(--surface-2)", color: bucket.tone }}>
                      {bucket.title} · {items.length}
                    </div>
                    <ul>
                      {items.map((f, i) => (
                        <li
                          key={f.id}
                          className="px-3.5 py-2.5 flex items-center gap-3 flex-wrap"
                          style={{ borderBottom: i < items.length - 1 ? "1px solid var(--border)" : "none" }}
                        >
                          <span className="num text-[12px] shrink-0" style={{ color: bucket.tone, width: 108 }}>
                            {fmtDateTime(f.dueAt)}
                          </span>
                          <button className="text-[12.5px] font-medium text-left hover:underline" onClick={() => setOpenId(f.appointmentId)}>
                            {f.leadName}
                          </button>
                          <IgHandle username={f.igUsername} muted />
                          {f.phone && (
                            <a href={`tel:${f.phone}`} className="num text-[12px] link">
                              {f.phone}
                            </a>
                          )}
                          <span className="dim text-[12px] flex-1 min-w-[120px] truncate">{f.notes}</span>
                          {session.isAdmin && f.closerName && <span className="badge !text-[10px] !py-0">{f.closerName}</span>}
                          <span className="flex gap-1.5 shrink-0">
                            <button className="btn btn-sm" onClick={() => void closeFollowUp(f.id, "done")} disabled={busy === f.id}>
                              Fait
                            </button>
                            <button className="btn btn-sm btn-ghost" onClick={() => void closeFollowUp(f.id, "cancelled")} disabled={busy === f.id}>
                              Abandonner
                            </button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })
            )}
            {showClosedFollowUps && closedFollowUps.length > 0 && (
              <div>
                <div className="px-3.5 py-1.5 label-xs" style={{ background: "var(--surface-2)" }}>
                  Clôturées ces 14 derniers jours
                </div>
                <ul>
                  {closedFollowUps.map((f, i) => (
                    <li
                      key={f.id}
                      className="px-3.5 py-2 flex items-center gap-3 flex-wrap text-[12px] dim"
                      style={{ borderBottom: i < closedFollowUps.length - 1 ? "1px solid var(--border)" : "none" }}
                    >
                      <span className="num shrink-0" style={{ width: 108 }}>
                        {fmtDateTime(f.completedAt || f.dueAt)}
                      </span>
                      <button className="font-medium text-left hover:underline" style={{ color: "var(--text)" }} onClick={() => setOpenId(f.appointmentId)}>
                        {f.leadName}
                      </button>
                      <span className="flex-1 min-w-[120px] truncate">{f.notes}</span>
                      <span className="badge !text-[10px] !py-0">{label(f.status)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>

          {/* -------------------------------- Closés ------------------------------ */}
          <Card title="Closés" subtitle="Toutes les ventes, de la plus récente à la plus ancienne. Le nom ouvre la fiche pour encaisser une échéance ou corriger la vente." padded={false}>
            {!data.closed.length ? (
              <Empty>Aucune vente enregistrée pour l&apos;instant.</Empty>
            ) : (
              <div className="scroll-x">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Élève</th>
                      <th>Offre</th>
                      <th className="text-right">Contrat</th>
                      <th className="text-right">Encaissé</th>
                      <th className="text-right">Reste</th>
                      <th>Prochaine échéance</th>
                      {session.isAdmin && <th>Setter</th>}
                      {session.isAdmin && <th>Closer</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {data.closed.map((c) => (
                      <tr key={c.saleId}>
                        <td className="num text-[12.5px]">{fmtDate(c.soldAt)}</td>
                        <td>
                          <button className="text-[12.5px] font-medium text-left hover:underline" onClick={() => setOpenId(c.id)}>
                            {c.leadName}
                          </button>{" "}
                          <IgHandle username={c.igUsername} muted />
                        </td>
                        <td className="text-[12.5px]">
                          {c.offer}
                          {c.saleStatus !== "active" && <span className="badge !text-[10px] !py-0 ml-1.5">{label(c.saleStatus)}</span>}
                        </td>
                        <td className="text-right num">{fmtMoney(c.contractValue, c.currency)}</td>
                        <td className="text-right num" style={{ color: "var(--emerald)" }}>
                          {fmtMoney(c.cashCollected, c.currency)}
                        </td>
                        <td className="text-right num" style={{ color: c.remaining > 0 ? "var(--warning)" : "var(--text-3)" }}>
                          {c.remaining > 0 ? fmtMoney(c.remaining, c.currency) : "soldé"}
                        </td>
                        <td className="text-[12px] num">
                          {c.nextDue ? (
                            <span style={{ color: c.nextDue.late ? "var(--critical)" : "var(--text-2)" }}>
                              {c.nextDue.dueAt.split("-").reverse().join("/")} · {fmtMoney(c.nextDue.amount, c.currency)}
                              {c.nextDue.late ? " · en retard" : ""}
                            </span>
                          ) : (
                            <span className="dim">—</span>
                          )}
                        </td>
                        {session.isAdmin && <td className="text-[12px]">{c.setterName}</td>}
                        {session.isAdmin && <td className="text-[12px]">{c.closerName}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      ) : null}

      <AppointmentDetail
        id={openId}
        open={openId !== null}
        onClose={() => setOpenId(null)}
        onChanged={refresh}
        session={session}
        members={members}
      />
    </>
  );
}
