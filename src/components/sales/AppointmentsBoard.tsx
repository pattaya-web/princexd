"use client";

import { hasRole, sessionHas } from "@/lib/sales/roles";
import { useMemo, useState } from "react";
import { fmtDate, fmtMoney, label } from "@/lib/format";
import { periodQuery, useSalesData } from "@/lib/sales/client";
import { APPOINTMENT_SOURCES, APPOINTMENT_STATUSES } from "@/lib/sales/constants";
import { Card, Empty, ErrorNote, Spinner } from "@/components/ui";
import { IgHandle, PeriodPicker, StatusBadge, type PeriodState } from "./bits";
import { AppointmentDetail } from "./AppointmentDetail";
import type { AppointmentRow } from "@/app/api/sales/appointments/route";
import type { PublicMember } from "@/lib/sales/repo";
import type { Session } from "@/lib/types";

/**
 * Tableau des rendez-vous, filtres compris.
 *
 * Le meme composant sert au setter, au closer et a l'admin : le cloisonnement
 * est fait par le serveur, l'interface n'a donc qu'a masquer les filtres qui
 * n'auraient aucun sens (inutile de proposer « filtrer par setter » a un
 * setter qui ne voit que les siens).
 */
export function AppointmentsBoard({
  session,
  members,
  period,
  onPeriodChange,
  onChanged,
  refreshKey = 0,
  forceSetterId,
  forceCloserId,
}: {
  session: Session;
  members: PublicMember[];
  period: PeriodState;
  onPeriodChange: (p: PeriodState) => void;
  onChanged: () => void;
  refreshKey?: number;
  /**
   * Filtres imposes par la page appelante (ex. la fiche d'un setter).
   * Quand ils sont fournis, les listes deroulantes correspondantes
   * disparaissent : laisser un filtre qui ne repond pas est pire que pas de
   * filtre du tout.
   */
  forceSetterId?: string;
  forceCloserId?: string;
}) {
  const [setterId, setSetterId] = useState("");
  const [closerId, setCloserId] = useState("");
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [outcome, setOutcome] = useState("");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const setters = useMemo(() => members.filter((m) => hasRole(m, "setter")), [members]);
  const closers = useMemo(() => members.filter((m) => hasRole(m, "closer")), [members]);

  const effectiveSetterId = forceSetterId ?? setterId;
  const effectiveCloserId = forceCloserId ?? closerId;

  const query = periodQuery(period.period, period.from, period.to, {
    setterId: effectiveSetterId,
    closerId: effectiveCloserId,
    status,
    source,
    outcome,
    q,
    // Force le rechargement apres une ecriture sans dupliquer l'etat.
    v: String(refreshKey),
  });

  const { data, loading, error, reload } = useSalesData<{
    rows: AppointmentRow[];
    total: number;
    currency: string;
  }>(`/api/sales/appointments?${query}`);

  const rows = data?.rows ?? [];
  const currency = data?.currency ?? "USD";

  const afterChange = () => {
    void reload();
    onChanged();
  };

  return (
    <>
      <Card padded={false} className="mb-4">
        <div className="p-3 flex flex-wrap items-center gap-2">
          <PeriodPicker value={period} onChange={onPeriodChange} />

          <input
            className="input !w-[200px] !h-[30px]"
            placeholder="Instagram, nom, email, tél."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />

          {/* Un setter ne voit que ses lignes : le filtre serait un leurre. */}
          {session.isAdmin && !forceSetterId && (
            <select
              className="select !w-auto !h-[30px] !text-[12px]"
              value={setterId}
              onChange={(e) => setSetterId(e.target.value)}
            >
              <option value="">Tous les setters</option>
              {setters.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          )}

          {(session.isAdmin || sessionHas(session, "setter")) && !forceCloserId && (
            <select
              className="select !w-auto !h-[30px] !text-[12px]"
              value={closerId}
              onChange={(e) => setCloserId(e.target.value)}
            >
              <option value="">Tous les closers</option>
              {closers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          )}

          <select
            className="select !w-auto !h-[30px] !text-[12px]"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">Tous les statuts</option>
            {APPOINTMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </select>

          <select
            className="select !w-auto !h-[30px] !text-[12px]"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          >
            <option value="">Toutes les sources</option>
            {APPOINTMENT_SOURCES.map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </select>

          <select
            className="select !w-auto !h-[30px] !text-[12px]"
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
          >
            <option value="">Closés ou non</option>
            <option value="won">Closed Won</option>
            <option value="lost">Closed Lost</option>
          </select>

          <span className="dim text-[11.5px] num ml-auto">
            {loading ? "…" : `${data?.total ?? 0} rendez-vous`}
          </span>
        </div>
      </Card>

      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      <Card padded={false}>
        {loading && !rows.length ? (
          <div className="p-4">
            <Spinner label="Chargement…" />
          </div>
        ) : !rows.length ? (
          <Empty>
            Aucun rendez-vous sur cette période. Élargis la fenêtre ou enregistre ton premier rendez-vous.
          </Empty>
        ) : (
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Lead</th>
                  <th>Instagram</th>
                  <th>Setter</th>
                  <th>Closer</th>
                  <th>Source</th>
                  <th>Statut</th>
                  <th style={{ width: 40 }} />
                  <th className="text-right">Contrat</th>
                  <th className="text-right">Encaissé</th>
                  <th className="text-right">Commission</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="cursor-pointer" onClick={() => setOpenId(r.id)}>
                    <td>
                      <span className="num">{fmtDate(r.scheduledAt)}</span>
                      <span className="dim num ml-1.5 text-[11.5px]">
                        {new Date(r.scheduledAt).toLocaleTimeString("fr-FR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </td>
                    <td className="max-w-[170px] truncate">{r.leadName}</td>
                    <td>
                      <IgHandle username={r.igUsername} />
                    </td>
                    <td className="text-[12.5px]">{r.setterName}</td>
                    <td className="text-[12.5px]">
                      {r.closerName || <span className="dim">Non assigné</span>}
                    </td>
                    <td>
                      <span className="badge !text-[10.5px] !py-0">{label(r.source)}</span>
                    </td>
                    <td>
                      <StatusBadge status={r.status} />
                    </td>
                    {/* Lien de visio : le closer rejoint sans ouvrir la fiche. */}
                    <td onClick={(e) => e.stopPropagation()}>
                      {r.iclosedUrl ? (
                        <a
                          href={r.iclosedUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="btn btn-sm btn-primary !h-[24px] !px-2.5 !text-[11px]"
                          title="Rejoindre le call"
                        >
                          Rejoindre ↗
                        </a>
                      ) : (
                        <span className="dim">—</span>
                      )}
                    </td>
                    <td className="text-right num">
                      {r.contractValue ? fmtMoney(r.contractValue, r.currency) : <span className="dim">—</span>}
                    </td>
                    <td className="text-right num" style={r.cashCollected ? { color: "var(--emerald)" } : undefined}>
                      {r.cashCollected ? fmtMoney(r.cashCollected, r.currency) : <span className="dim">—</span>}
                    </td>
                    <td className="text-right num">
                      {r.commission ? fmtMoney(r.commission, currency) : <span className="dim">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <AppointmentDetail
        id={openId}
        open={openId !== null}
        onClose={() => setOpenId(null)}
        onChanged={afterChange}
        session={session}
        members={members}
      />
    </>
  );
}
