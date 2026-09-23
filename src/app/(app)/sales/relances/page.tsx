"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import { fmtDateTime } from "@/lib/format";
import { useSalesData } from "@/lib/sales/client";
import { Card, Empty, ErrorNote, PageHeader, Spinner, StatTile, useToast } from "@/components/ui";
import { IgHandle } from "@/components/sales/bits";
import { AppointmentDetail } from "@/components/sales/AppointmentDetail";
import { useSales } from "@/components/sales/context";
import type { FollowUpRow } from "@/app/api/sales/followups/route";

const BUCKETS = [
  { key: "overdue", title: "En retard", tone: "var(--critical)" },
  { key: "today", title: "Aujourd'hui", tone: "var(--warning)" },
  { key: "upcoming", title: "À venir", tone: "var(--text-2)" },
] as const;

/**
 * Les relances a traiter.
 *
 * Un prospect qui dit « je dois en parler à mon associé » n'est pas perdu, il
 * est en attente. Cette page existe pour qu'aucun de ces leads ne disparaisse
 * entre deux calls.
 */
export default function FollowUpsPage() {
  const { session, members, version, bump } = useSales();
  const toast = useToast();
  const [openId, setOpenId] = useState<string | null>(null);

  const { data, loading, error, reload } = useSalesData<{
    rows: FollowUpRow[];
    counts: { overdue: number; today: number; upcoming: number };
  }>(`/api/sales/followups?v=${version}`);

  const close = async (id: string, status: "done" | "cancelled") => {
    try {
      await api(`/api/sales/followups/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      toast(status === "done" ? "Relance clôturée." : "Relance annulée.");
      void reload();
      bump();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  const rows = data?.rows ?? [];

  return (
    <>
      <PageHeader title="Relances" />

      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3 mb-4">
        <StatTile
          label="En retard"
          value={data?.counts.overdue ?? 0}
          accent={data?.counts.overdue ? "var(--critical)" : undefined}
        />
        <StatTile
          label="Aujourd'hui"
          value={data?.counts.today ?? 0}
          accent={data?.counts.today ? "var(--warning)" : undefined}
        />
        <StatTile label="À venir" value={data?.counts.upcoming ?? 0} />
      </div>

      {loading && !data ? (
        <Card>
          <Spinner label="Chargement…" />
        </Card>
      ) : !rows.length ? (
        <Card>
          <Empty>Aucune relance en attente. Tout est à jour.</Empty>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {BUCKETS.map((bucket) => {
            const items = rows.filter((r) => r.bucket === bucket.key && r.status === "pending");
            if (!items.length) return null;
            return (
              <Card key={bucket.key} title={bucket.title} padded={false}>
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
                      <button
                        className="text-[12.5px] font-medium text-left hover:underline"
                        onClick={() => setOpenId(f.appointmentId)}
                      >
                        {f.leadName}
                      </button>
                      <IgHandle username={f.igUsername} muted />
                      <span className="dim text-[12px] flex-1 min-w-[120px] truncate">{f.notes}</span>
                      {session.isAdmin && f.closerName && (
                        <span className="badge !text-[10px] !py-0">{f.closerName}</span>
                      )}
                      <span className="flex gap-1.5 shrink-0">
                        <button className="btn btn-sm" onClick={() => void close(f.id, "done")}>
                          Fait
                        </button>
                        <button className="btn btn-sm btn-ghost" onClick={() => void close(f.id, "cancelled")}>
                          Abandonner
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
      )}

      <AppointmentDetail
        id={openId}
        open={openId !== null}
        onClose={() => setOpenId(null)}
        onChanged={() => {
          void reload();
          bump();
        }}
        session={session}
        members={members}
      />
    </>
  );
}
