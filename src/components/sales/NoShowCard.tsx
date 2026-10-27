"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import { fmtDateTime, relative } from "@/lib/format";
import { useSalesData } from "@/lib/sales/client";
import { Card, Empty, useToast } from "@/components/ui";
import { useSales } from "./context";
import type { NoShowRow } from "@/app/api/sales/no-shows/route";

/**
 * Suivi des no-show du setter : ceux qui ne sont pas venus au call et n'ont
 * pas encore repose de rendez-vous. Une ligne = nom, numero, call manque,
 * et a droite une case « Relancé » : cochee = relance faite, avec qui et
 * quand. La case se libere au bout de 24 h pour relancer encore, jusqu'au
 * R2 ; des qu'un nouveau rendez-vous est pose, la ligne disparait.
 */
export function NoShowCard({ onOpenLead }: { onOpenLead?: (leadId: string) => void }) {
  const { version, bump } = useSales();
  const toast = useToast();
  const { data, reload } = useSalesData<{ rows: NoShowRow[] }>(`/api/sales/no-shows?v=${version}`, { every: 120_000 });
  const rows = data?.rows ?? [];
  const [busy, setBusy] = useState("");
  const copy = async (v: string) => {
    try {
      await navigator.clipboard.writeText(v);
      toast("Copié.");
    } catch {
      toast("Copie impossible ici.", "err");
    }
  };
  const relaunch = async (r: NoShowRow) => {
    setBusy(r.appointmentId);
    try {
      await api(`/api/sales/leads/${r.leadId}`, { method: "PATCH", body: JSON.stringify({ action: "status", status: "message-sent" }) });
      toast(`${r.name} : relancé.`);
      void reload();
      bump();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy("");
    }
  };
  const recent = (iso: string) => Boolean(iso) && Date.now() - Date.parse(iso) < 24 * 3600_000;

  if (!data || !rows.length) return null;
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          Suivi des no-show
          <span className="badge !text-[10.5px] !py-0 num" style={{ color: "var(--critical)" }}>
            {rows.length}
          </span>
        </span>
      }
      subtitle="Pas venus au call, pas encore de R2. Relance, coche. La case se libère le lendemain pour relancer encore, jusqu'au rendez-vous reposé."
      padded={false}
    >
      {rows.length === 0 ? (
        <Empty>Aucun no-show en attente.</Empty>
      ) : (
        <ul>
          {rows.slice(0, 15).map((r, i) => {
            const done = recent(r.lastFollowUpAt);
            return (
              <li key={r.appointmentId} className="px-3.5 py-2.5 flex items-center gap-3 flex-wrap" style={{ borderBottom: i < Math.min(rows.length, 15) - 1 ? "1px solid var(--border)" : "none" }}>
                <span className="min-w-0 flex-1 basis-[220px]">
                  <span className="flex items-center gap-2 flex-wrap">
                    <button type="button" className="text-[13px] font-semibold hover:underline text-left" onClick={() => onOpenLead?.(r.leadId)} title="Ouvrir la fiche">
                      {r.name}
                    </button>
                    {r.igUsername && <span className="dim text-[12px]">@{r.igUsername}</span>}
                    {r.phone && (
                      <button type="button" className="link num text-[12.5px]" onClick={() => void copy(r.phone)} title="Copier le numéro">
                        {r.phone}
                      </button>
                    )}
                  </span>
                  <span className="block text-[11.5px] mt-0.5" style={{ color: "var(--critical)" }}>
                    No-show le {fmtDateTime(r.missedAt)}
                  </span>
                  {r.lastFollowUpAt && (
                    <span className="dim text-[11.5px] block">
                      Relancé {relative(r.lastFollowUpAt)}
                      {r.lastFollowUpBy ? ` par ${r.lastFollowUpBy}` : ""}
                    </span>
                  )}
                </span>
                <label className="flex items-center gap-2 text-[12.5px] font-medium cursor-pointer shrink-0" style={{ color: done ? "var(--emerald)" : "var(--text-2)" }}>
                  <input type="checkbox" className="w-[18px] h-[18px] cursor-pointer" checked={done} disabled={busy === r.appointmentId || done} onChange={() => void relaunch(r)} />
                  {done ? "Relancé" : "Relancer"}
                </label>
              </li>
            );
          })}
          {rows.length > 15 && <li className="dim text-[11.5px] px-3.5 py-2">… et {rows.length - 15} de plus.</li>}
        </ul>
      )}
    </Card>
  );
}
