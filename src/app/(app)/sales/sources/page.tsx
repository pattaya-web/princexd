"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/client";
import { fmtDateTime, fmtInt, fmtMoney, relative } from "@/lib/format";
import { periodQuery, useSalesData } from "@/lib/sales/client";
import { Card, Empty, ErrorNote, PageHeader, Spinner, StatTile, useToast } from "@/components/ui";
import { IgHandle, PeriodPicker, Ratio, StatusBadge } from "@/components/sales/bits";
import { AppointmentDetail } from "@/components/sales/AppointmentDetail";
import { useSales } from "@/components/sales/context";
import type { SourceGroup, SourceRow } from "@/app/api/sales/sources/route";
import type { AppointmentStatus } from "@/lib/types";

interface Payload {
  currency: string;
  rows: SourceRow[];
  breakdown: SourceGroup[];
  totals: { appointments: number; withUtm: number; leads: number; sales: number; cash: number };
  lastSourcesSyncAt: string;
}

/** Pastille de couleur stable par famille de source. */
const FAMILY_COLOR: Record<string, string> = {
  Instagram: "var(--s1)",
  "Lien setter": "var(--s2)",
  "Landing page": "var(--s3)",
  ManyChat: "var(--s4)",
  Meta: "var(--s5)",
  "Beacons (bio)": "var(--s6)",
  Google: "var(--s7)",
  Inconnue: "var(--text-3)",
};
const familyColor = (f: string) => FAMILY_COLOR[f] ?? "var(--s8)";

/**
 * Sources : d'où viennent les leads.
 *
 * Le lien cliqué pour réserver dit tout : bio Instagram, landing page, lien
 * signé d'un setter, pub Meta. iClosed garde ces paramètres sur chaque
 * booking ; cette page les lit et les range. En haut la répartition par
 * source avec ce qu'elle rapporte, en bas la liste brute, comme chez iClosed.
 */
export default function SourcesPage() {
  const { session, members, period, setPeriod, version, bump } = useSales();
  const toast = useToast();
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("");
  const [syncing, setSyncing] = useState(false);

  const { data, loading, error, reload } = useSalesData<Payload>(
    `/api/sales/sources?${periodQuery(period.period, period.from, period.to, { v: String(version) })}`,
  );
  const currency = data?.currency ?? "EUR";

  const rows = useMemo(() => (data?.rows ?? []).filter((r) => !filter || r.key === filter), [data, filter]);
  const t = data?.totals;

  const refresh = () => {
    void reload();
    bump();
  };

  /** Relit les appels iClosed et pose les UTM manquantes sur les anciens rendez-vous. */
  const syncSources = async () => {
    setSyncing(true);
    try {
      const r = await api<{ examined: number; matched: number; updated: number }>("/api/sales/sources", {
        method: "POST",
        body: JSON.stringify({ pages: 8 }),
      });
      toast(
        r.updated
          ? `${r.updated} rendez-vous complété${r.updated > 1 ? "s" : ""} avec leur source (sur ${r.matched} retrouvés chez iClosed).`
          : `Rien à compléter : les ${r.matched} rendez-vous retrouvés ont déjà leur source.`,
      );
      refresh();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Sources"
        actions={
          <>
            <PeriodPicker value={period} onChange={setPeriod} />
            {session.isAdmin && (
              <button className="btn" onClick={() => void syncSources()} disabled={syncing} title="Relit les appels iClosed passés et à venir pour retrouver la source des anciens rendez-vous">
                {syncing ? <span className="spinner" /> : "↻"} Récupérer les sources iClosed
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

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <StatTile label="Rendez-vous" value={fmtInt(t?.appointments ?? 0)} hint={t ? `${fmtInt(t.withUtm)} avec une source connue` : undefined} />
        <StatTile
          label="Source inconnue"
          value={fmtInt(t ? t.appointments - t.withUtm : 0)}
          hint={session.isAdmin && t && t.appointments - t.withUtm > 0 ? "Clique « Récupérer les sources iClosed »" : undefined}
          accent={t && t.appointments - t.withUtm > 0 ? "var(--warning)" : undefined}
        />
        <StatTile label="Opt-ins landing page" value={fmtInt(t?.leads ?? 0)} hint="Inscrits Systeme.io sur la période" />
        <StatTile label="Cash par source" value={fmtMoney(t?.cash ?? 0, currency)} hint={t ? `${fmtInt(t.sales)} vente${t.sales > 1 ? "s" : ""}` : undefined} accent="var(--emerald)" />
      </div>

      {loading && !data ? (
        <Card>
          <Spinner label="Lecture des sources…" />
        </Card>
      ) : data ? (
        <div className="flex flex-col gap-4">
          {/* ----------------------------- Répartition ----------------------------- */}
          <Card
            title="Par source"
            subtitle="Ce que chaque lien a amené sur la période. Clique une ligne pour filtrer la liste du dessous."
            padded={false}
            actions={
              filter ? (
                <button className="btn btn-sm" onClick={() => setFilter("")}>
                  ✕ Retirer le filtre
                </button>
              ) : undefined
            }
          >
            {!data.breakdown.length ? (
              <Empty>Aucun rendez-vous sur la période.</Empty>
            ) : (
              <div className="scroll-x">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>Détail du lien</th>
                      <th className="text-right">Opt-ins LP</th>
                      <th className="text-right">Rdv</th>
                      <th className="text-right">Honorés</th>
                      <th className="text-right">Show rate</th>
                      <th className="text-right">Ventes</th>
                      <th className="text-right">Contrat</th>
                      <th className="text-right">Cash</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.breakdown.map((g) => {
                      const active = filter === g.key;
                      return (
                        <tr
                          key={g.key}
                          className="cursor-pointer"
                          style={{ background: active ? "var(--accent-soft)" : undefined }}
                          onClick={() => setFilter(active ? "" : g.key)}
                        >
                          <td>
                            <span className="flex items-center gap-2 text-[12.5px] font-medium">
                              <span className="w-[8px] h-[8px] rounded-full shrink-0" style={{ background: familyColor(g.family) }} />
                              {g.family}
                            </span>
                          </td>
                          <td className="text-[12px] dim">{g.label !== g.family ? g.label : "—"}</td>
                          <td className="text-right num">{g.leads ? fmtInt(g.leads) : <span className="dim">—</span>}</td>
                          <td className="text-right num font-semibold">{fmtInt(g.appointments)}</td>
                          <td className="text-right num">{fmtInt(g.attended)}</td>
                          <td className="text-right">
                            <Ratio value={g.appointments ? (g.attended / g.appointments) * 100 : 0} />
                          </td>
                          <td className="text-right num">{fmtInt(g.sales)}</td>
                          <td className="text-right num">{g.contract ? fmtMoney(g.contract, currency) : <span className="dim">—</span>}</td>
                          <td className="text-right num" style={{ color: g.cash ? "var(--emerald)" : undefined }}>
                            {g.cash ? fmtMoney(g.cash, currency) : <span className="dim">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* -------------------------------- Liste -------------------------------- */}
          <Card
            title={filter ? `Rendez-vous · ${data.breakdown.find((g) => g.key === filter)?.label ?? ""}` : "Tous les rendez-vous"}
            subtitle={`Un rendez-vous par ligne avec les paramètres de son lien, comme chez iClosed.${data.lastSourcesSyncAt ? ` Dernier rattrapage iClosed ${relative(data.lastSourcesSyncAt)}.` : ""}`}
            padded={false}
          >
            {!rows.length ? (
              <Empty>Aucun rendez-vous{filter ? " pour cette source" : ""} sur la période.</Empty>
            ) : (
              <div className="scroll-x">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Lead</th>
                      <th>Source</th>
                      <th>utm_source</th>
                      <th>utm_medium</th>
                      <th>utm_campaign</th>
                      <th>utm_content</th>
                      <th>Référent</th>
                      {session.isAdmin && <th>Setter</th>}
                      <th>Statut</th>
                      <th className="text-right">Vente</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td className="num text-[12px] whitespace-nowrap">{fmtDateTime(r.scheduledAt)}</td>
                        <td>
                          <button className="text-[12.5px] font-medium text-left hover:underline" onClick={() => setOpenId(r.id)}>
                            {r.leadName}
                          </button>{" "}
                          <IgHandle username={r.igUsername} muted />
                        </td>
                        <td>
                          <span className="flex items-center gap-1.5 text-[12px] whitespace-nowrap">
                            <span className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: familyColor(r.family) }} />
                            {r.label}
                            {r.utm.meta && r.utm.source !== "setter" && (
                              <span className="badge !text-[10px] !py-0" title="Un identifiant de clic Meta était présent : arrivée par une pub ou un lien Instagram / Facebook">
                                Meta
                              </span>
                            )}
                          </span>
                        </td>
                        <Utm v={r.utm.source} />
                        <Utm v={r.utm.medium} />
                        <Utm v={r.utm.campaign} />
                        <Utm v={r.utm.content} />
                        <Utm v={r.utm.referrer} />
                        {session.isAdmin && <td className="text-[12px]">{r.setterName || <span className="dim">—</span>}</td>}
                        <td>
                          <StatusBadge status={r.status as AppointmentStatus} />
                        </td>
                        <td className="text-right num text-[12px]">
                          {r.contractValue > 0 ? (
                            <span>
                              {fmtMoney(r.contractValue, currency)}
                              <span className="dim"> · </span>
                              <span style={{ color: "var(--emerald)" }}>{fmtMoney(r.cashCollected, currency)}</span>
                            </span>
                          ) : (
                            <span className="dim">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Comment marquer tes liens" subtitle="Pour que chaque porte d'entrée ait son nom dans ce tableau.">
            <ul className="text-[12.5px] leading-relaxed flex flex-col gap-1.5">
              <li>
                <strong>Bio Instagram</strong> : ajoute <code className="mono text-[11.5px]">?utm_source=ig&amp;utm_medium=social&amp;utm_content=link_in_bio</code> à ton lien iClosed.
              </li>
              <li>
                <strong>Story / Reel</strong> : même chose avec <code className="mono text-[11.5px]">utm_medium=story</code> ou <code className="mono text-[11.5px]">utm_medium=reel</code>, et{" "}
                <code className="mono text-[11.5px]">utm_campaign=</code> le nom du contenu.
              </li>
              <li>
                <strong>Landing page</strong> : le bouton de réservation avec <code className="mono text-[11.5px]">utm_source=lp</code>. Les pubs Meta ajoutent déjà un identifiant de clic, repéré ici comme « Meta ».
              </li>
              <li>
                <strong>Setters</strong> : leur lien signé (Comptes → lien du setter) porte déjà <code className="mono text-[11.5px]">utm_source=setter&amp;utm_content=prénom</code>.
              </li>
              <li>
                Sans paramètre, on garde au moins le site d'où le lead a cliqué (Instagram, landing page, Beacons…) : c'est la colonne « Référent ».
              </li>
            </ul>
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

/** Cellule UTM : la valeur brute, ou un tiret discret. */
function Utm({ v }: { v?: string }) {
  return <td className="mono text-[11.5px]">{v ? v : <span className="dim">—</span>}</td>;
}

