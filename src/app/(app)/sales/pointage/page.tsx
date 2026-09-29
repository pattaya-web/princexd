"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/client";
import { fmtDay, fmtTime } from "@/lib/format";
import { periodQuery, useSalesData } from "@/lib/sales/client";
import { Card, Empty, ErrorNote, PageHeader, Spinner, StatTile, useToast } from "@/components/ui";
import { PeriodPicker } from "@/components/sales/bits";
import { useSales } from "@/components/sales/context";
import type { WorkRow, WorkTotal } from "@/app/api/sales/work/route";

/**
 * Shifts de l'equipe : qui a pointe, de quelle heure a quelle heure, combien
 * d'heures sur la periode. Les sessions viennent des boutons « Démarrer ma
 * session » / « Terminer » de l'accueil de chaque membre. Une session en
 * cours est cloturable ici si quelqu'un a oublie de la terminer.
 */
export default function PointagePage() {
  const { members, period, setPeriod, version, bump } = useSales();
  const toast = useToast();
  const [who, setWho] = useState("all");

  const { data, loading, error, reload } = useSalesData<{ rows: WorkRow[]; totals: WorkTotal[] }>(
    `/api/sales/work?${periodQuery(period.period, period.from, period.to, { v: String(version) })}`,
  );

  const rows = useMemo(() => (data?.rows ?? []).filter((r) => who === "all" || r.memberId === who), [data, who]);
  const totals = data?.totals ?? [];
  const totalHours = Math.round(totals.reduce((a, t) => a + t.hours, 0) * 100) / 100;
  const online = totals.filter((t) => t.openSince);

  const close = async (r: WorkRow) => {
    if (!window.confirm(`Terminer la session en cours de ${r.memberName} ?`)) return;
    try {
      await api("/api/sales/work", { method: "POST", body: JSON.stringify({ action: "stop", memberId: r.memberId }) });
      toast("Session clôturée.");
      void reload();
      bump();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  const hm = (h: number) => {
    const m = Math.round(h * 60);
    return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
  };

  return (
    <>
      <PageHeader
        title="Shifts équipe"
        subtitle="Heures réellement pointées par chaque membre : début, fin, durée. La période s'applique au début de session."
        actions={<PeriodPicker value={period} onChange={setPeriod} />}
      />

      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <StatTile label="Heures sur la période" value={hm(totalHours)} />
        <StatTile label="Sessions" value={totals.reduce((a, t) => a + t.sessions, 0)} />
        <StatTile
          label="En session maintenant"
          value={online.length}
          accent={online.length ? "var(--emerald)" : undefined}
          hint={online.length ? online.map((t) => `${t.memberName} depuis ${fmtTime(t.openSince)}`).join(" · ") : undefined}
        />
        <StatTile label="Membres ayant pointé" value={totals.filter((t) => t.sessions > 0).length} />
      </div>

      {/* Total par personne, puis le detail session par session. */}
      {totals.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          {[{ memberId: "all", memberName: "Tous", hours: totalHours, sessions: 0, openSince: "" }, ...totals].map((t) => {
            const active = who === t.memberId;
            return (
              <button
                key={t.memberId}
                type="button"
                onClick={() => setWho(t.memberId)}
                className="flex items-center gap-1.5 h-[30px] px-3 rounded-full text-[12.5px] font-medium"
                style={{
                  background: active ? "var(--surface)" : "var(--surface-2)",
                  border: `1px solid ${active ? "var(--text-2)" : "var(--border)"}`,
                  color: active ? "var(--text)" : "var(--text-2)",
                }}
              >
                {t.openSince && <span className="inline-block w-[8px] h-[8px] rounded-full" style={{ background: "var(--emerald)" }} />}
                {t.memberName}
                <span className="num opacity-70">{hm(t.hours)}</span>
              </button>
            );
          })}
        </div>
      )}

      {loading && !data ? (
        <Card>
          <Spinner label="Chargement…" />
        </Card>
      ) : !rows.length ? (
        <Card>
          <Empty>
            Aucune session sur cette période. Chaque membre pointe depuis son accueil : « Démarrer ma session » en
            arrivant, « Terminer » en partant.
          </Empty>
        </Card>
      ) : (
        <Card padded={false}>
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th>Membre</th>
                  <th>Jour</th>
                  <th>Début</th>
                  <th>Fin</th>
                  <th className="text-right">Durée</th>
                  <th>Note</th>
                  <th style={{ width: 120 }} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const open = !r.endedAt;
                  return (
                    <tr key={r.id} style={open ? { background: "color-mix(in srgb, var(--emerald) 10%, var(--surface))" } : undefined}>
                      <td className="text-[13px] font-medium">{r.memberName}</td>
                      <td className="num">{fmtDay(r.startedAt)}</td>
                      <td className="num">{fmtTime(r.startedAt)}</td>
                      <td className="num">
                        {open ? (
                          <span className="badge badge-good !text-[10.5px] !py-0">en cours</span>
                        ) : (
                          fmtTime(r.endedAt)
                        )}
                      </td>
                      <td className="text-right num font-medium">{hm(r.hours)}{r.hours >= 14 ? <span className="dim text-[10.5px]" title="Session oubliée, plafonnée à 14 h"> plaf.</span> : null}</td>
                      <td className="text-[12px] dim max-w-[240px] truncate" title={r.note}>{r.note || "—"}</td>
                      <td className="text-right">
                        {open && (
                          <button className="btn btn-sm" onClick={() => void close(r)} title="Il a oublié de terminer : clôturer maintenant">
                            ■ Clôturer
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {members.length === 0 && null}
    </>
  );
}
