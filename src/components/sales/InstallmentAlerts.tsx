"use client";

import Link from "next/link";
import { fmtMoney } from "@/lib/format";
import { useSalesData } from "@/lib/sales/client";
import { Card } from "@/components/ui";
import type { InstallmentAlert } from "@/lib/sales/installments";

/**
 * Alerte « échéance à encaisser ».
 *
 * Affichée sur le CRM, le Sales Dashboard et l'accueil du closer dès qu'une
 * échéance de paiement en plusieurs fois arrive à date (ou est en retard).
 * Rien ne s'affiche quand il n'y a rien à encaisser : pas de carte vide.
 */
export function InstallmentAlerts({ onOpen, horizon = 3 }: { onOpen?: (appointmentId: string) => void; horizon?: number }) {
  const { data } = useSalesData<{ today: string; items: InstallmentAlert[] }>(`/api/sales/installments?horizon=${horizon}`);
  const items = data?.items ?? [];
  if (!items.length) return null;
  const due = items.filter((i) => i.state !== "soon").length;
  const overdue = items.filter((i) => i.state === "overdue").length;

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <span>💶 Échéances à encaisser</span>
          {due > 0 && (
            <span className="badge !text-[10.5px] !py-0" style={{ background: overdue ? "var(--critical)" : "var(--warning)", color: "#fff", borderColor: "transparent" }}>
              {due} {overdue ? "dont en retard" : "aujourd'hui"}
            </span>
          )}
        </span>
      }
      subtitle="Paiements en plusieurs fois arrivés à date. Ouvre la fiche pour marquer l'échéance encaissée."
      padded={false}
    >
      <ul>
        {items.map((i, idx) => {
          const color = i.state === "overdue" ? "var(--critical)" : i.state === "today" ? "var(--warning)" : "var(--text-2)";
          const when =
            i.state === "overdue"
              ? `en retard de ${i.daysLate} jour${i.daysLate > 1 ? "s" : ""}`
              : i.state === "today"
                ? "aujourd'hui"
                : `dans ${-i.daysLate} jour${-i.daysLate > 1 ? "s" : ""}`;
          const body = (
            <>
              <span className="w-[8px] h-[8px] rounded-full shrink-0" style={{ background: color }} />
              <span className="text-[13px] font-medium truncate">{i.leadName}</span>
              <span className="dim text-[12px] shrink-0">échéance {i.n}/{i.total}</span>
              <span className="num text-[13px] font-semibold shrink-0">{fmtMoney(i.amount, i.currency)}</span>
              <span className="text-[12px] font-semibold shrink-0" style={{ color }}>{when}</span>
              <span className="dim text-[11.5px] num shrink-0">· {i.dueAt}</span>
              <span className="dim text-[11.5px] shrink-0 ml-auto">closer {i.closerName}</span>
            </>
          );
          const style = { borderBottom: idx < items.length - 1 ? "1px solid var(--border)" : "none" };
          return (
            <li key={`${i.saleId}-${i.n}`} style={style}>
              {onOpen ? (
                <button type="button" className="w-full text-left px-3.5 py-2.5 flex items-center gap-2.5 flex-wrap hover:bg-[var(--surface-2)]" onClick={() => onOpen(i.appointmentId)}>
                  {body}
                </button>
              ) : (
                <Link href={`/sales/rendez-vous?open=${i.appointmentId}`} className="px-3.5 py-2.5 flex items-center gap-2.5 flex-wrap hover:bg-[var(--surface-2)]">
                  {body}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
