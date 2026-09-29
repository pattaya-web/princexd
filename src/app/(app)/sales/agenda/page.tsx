"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/client";
import { useSalesData } from "@/lib/sales/client";
import { hasRole } from "@/lib/sales/roles";
import { PageHeader, useToast } from "@/components/ui";
import { AppointmentDetail } from "@/components/sales/AppointmentDetail";
import { AppointmentModal } from "@/components/sales/AppointmentModal";
import { CallsCalendar } from "@/components/sales/CallsCalendar";
import { useSales } from "@/components/sales/context";
import type { AppointmentRow } from "@/app/api/sales/appointments/route";

/**
 * Agenda des calls, vue admin.
 *
 * Tous les calls a venir, semaine par semaine, avec sur chaque carte le
 * closer qui le prend : on repartit les calls du jour d'un coup d'oeil, et
 * chaque closer retrouve les siens sur son propre dashboard. Un filtre par
 * closer isole l'agenda d'une personne, « Sans closer » ce qui reste a
 * repartir.
 */
export default function AgendaPage() {
  const { session, members, version, bump } = useSales();
  const toast = useToast();
  const [who, setWho] = useState<string>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const closers = useMemo(() => members.filter((m) => hasRole(m, "closer") && m.status !== "inactif"), [members]);

  const { data, reload } = useSalesData<{ rows: AppointmentRow[] }>(
    `/api/sales/appointments?period=upcoming&limit=500&v=${version}`,
  );

  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    if (who === "all") return all;
    if (who === "none") return all.filter((r) => !r.closerId);
    return all.filter((r) => r.closerId === who);
  }, [data, who]);

  const assign = async (id: string, closerId: string) => {
    try {
      await api(`/api/sales/appointments/${id}`, { method: "PATCH", body: JSON.stringify({ closerId }) });
      const name = closers.find((c) => c.id === closerId)?.name;
      toast(name ? `Call attribué à ${name}. Il le voit sur son dashboard.` : "Closer retiré.");
      void reload();
      bump();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  const chips: { key: string; label: string; n: number }[] = [
    { key: "all", label: "Tous", n: (data?.rows ?? []).length },
    { key: "none", label: "Sans closer", n: (data?.rows ?? []).filter((r) => !r.closerId).length },
    ...closers.map((c) => ({ key: c.id, label: c.name, n: (data?.rows ?? []).filter((r) => r.closerId === c.id).length })),
  ];

  return (
    <>
      <PageHeader
        title="Agenda des calls"
        subtitle="Tous les calls à venir, iClosed et rendez-vous posés par les setters. Choisis sur chaque carte qui le prend."
        actions={
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            + Rendez-vous
          </button>
        }
      />

      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        {chips.map((c) => {
          const active = who === c.key;
          const warn = c.key === "none" && c.n > 0;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => setWho(c.key)}
              className="flex items-center gap-1.5 h-[30px] px-3 rounded-full text-[12.5px] font-medium transition-colors"
              style={{
                background: active ? "var(--surface)" : "var(--surface-2)",
                border: `1px solid ${active ? (warn ? "#f59e0b" : "var(--text-2)") : "var(--border)"}`,
                color: active ? "var(--text)" : warn ? "#f59e0b" : "var(--text-2)",
              }}
            >
              {c.label}
              <span className="num opacity-70">{c.n}</span>
            </button>
          );
        })}
      </div>

      <CallsCalendar rows={rows} role="admin" onOpen={setOpenId} closers={closers} onAssign={assign} />

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
      <AppointmentModal
        open={adding}
        onClose={() => setAdding(false)}
        onSaved={() => {
          void reload();
          bump();
        }}
        session={session}
        members={members}
      />
    </>
  );
}
