"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import { fmtDateTime, relative } from "@/lib/format";
import { useSalesData } from "@/lib/sales/client";
import { Card, Empty, useToast } from "@/components/ui";
import { useSales } from "./context";
import { SendToSetterModal } from "./SetterTasksCard";
import type { NoShowRow } from "@/app/api/sales/no-shows/route";

const STATUS: Record<string, string> = {
  "no-answer": "pas de réponse",
  "message-sent": "message envoyé",
  callback: "à rappeler",
  reached: "joint",
  "not-interested": "pas intéressé",
};

/**
 * Suivi des no-show du setter : ceux qui ne sont pas venus au call et n'ont
 * pas encore repose de rendez-vous. A relancer sans relache jusqu'au R2 ;
 * des qu'un nouveau rendez-vous est pose, la ligne disparait.
 */
export function NoShowCard({ onOpenLead }: { onOpenLead?: (leadId: string) => void }) {
  const { version, bump } = useSales();
  const toast = useToast();
  const { data, reload } = useSalesData<{ rows: NoShowRow[] }>(`/api/sales/no-shows?v=${version}`, { every: 120_000 });
  const rows = data?.rows ?? [];
  const [busy, setBusy] = useState("");
  const [remind, setRemind] = useState<NoShowRow | null>(null);
  const copy = async (v: string) => {
    try {
      await navigator.clipboard.writeText(v);
      toast("Copié.");
    } catch {
      toast("Copie impossible ici.", "err");
    }
  };
  const followed = async (r: NoShowRow) => {
    setBusy(r.appointmentId);
    try {
      await api(`/api/sales/leads/${r.leadId}`, { method: "PATCH", body: JSON.stringify({ action: "status", status: "message-sent" }) });
      toast(`${r.name} : relance notée.`);
      void reload();
      bump();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy("");
    }
  };

  if (!data || !rows.length) return null;
  return (
    <>
      <Card
        title={
          <span className="flex items-center gap-2">
            Suivi des no-show
            <span className="badge !text-[10.5px] !py-0 num" style={{ color: "var(--critical)" }}>
              {rows.length}
            </span>
          </span>
        }
        subtitle="Pas venus au call, pas encore de R2 : relance-les sans relâche jusqu'à ce qu'ils reposent un rendez-vous. Dès qu'il est posé, la ligne disparaît."
        padded={false}
      >
        {rows.length === 0 ? (
          <Empty>Aucun no-show en attente.</Empty>
        ) : (
          <ul>
            {rows.slice(0, 12).map((r, i) => (
              <li key={r.appointmentId} className="px-3.5 py-2.5 flex items-start gap-3 flex-wrap" style={{ borderBottom: i < Math.min(rows.length, 12) - 1 ? "1px solid var(--border)" : "none" }}>
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
                    Call manqué le {fmtDateTime(r.missedAt)} · {relative(r.missedAt)}
                  </span>
                  <span className="dim text-[11.5px] block">
                    {r.lastFollowUpAt ? `Dernière relance ${relative(r.lastFollowUpAt)} (${STATUS[r.lastFollowUpStatus] ?? r.lastFollowUpStatus})` : "Jamais relancé depuis le no-show"}
                  </span>
                </span>
                <span className="flex items-center gap-1 shrink-0">
                  <button className="btn btn-sm !h-[28px]" disabled={busy === r.appointmentId} onClick={() => void followed(r)} title="Je viens de lui écrire ou de l'appeler">
                    ✓ J&apos;ai relancé
                  </button>
                  <button className="btn btn-sm btn-ghost !h-[28px]" onClick={() => setRemind(r)} title="Me noter une relance à une date">
                    Relance le…
                  </button>
                </span>
              </li>
            ))}
            {rows.length > 12 && <li className="dim text-[11.5px] px-3.5 py-2">… et {rows.length - 12} de plus.</li>}
          </ul>
        )}
      </Card>
      <SendToSetterModal
        open={remind !== null}
        self
        prefill={remind ? { leadId: remind.leadId, name: remind.name, phone: remind.phone, igUsername: remind.igUsername } : undefined}
        onClose={() => setRemind(null)}
        onSent={() => {
          void reload();
          bump();
        }}
      />
    </>
  );
}
