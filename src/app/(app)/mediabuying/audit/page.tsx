"use client";

import { useEffect, useState } from "react";
import { useMb } from "@/components/mediabuying/context";
import { Card, Empty, PageHeader, Spinner } from "@/components/ui";
import { api } from "@/lib/client";
import { fmtDateTime } from "@/lib/format";
import type { MediaBuyingAuditLog } from "@/lib/mediabuying/types";

const ACTION_LABEL: Record<string, string> = {
  "budget.update": "Budget",
  "status.pause": "Pause",
  "status.activate": "Activation",
  "entity.duplicate": "Duplication",
  "campaign.create": "Création",
  "phase.set": "Phase",
  "leadGoal.set": "Objectif",
  "winner.set": "Tag",
  "postId.copy": "Post ID",
  "postId.copyMany": "Post IDs",
  "export.csv": "Export",
  "settings.update": "Réglages",
  "draft.create": "Brouillon",
  "draft.delete": "Brouillon",
  "connection.create": "Connexion",
  "connection.test": "Connexion",
  "connection.token": "Connexion",
  "connection.disconnect": "Connexion",
  "connection.delete": "Connexion",
};

/** Journal : tout ce qui a ete fait depuis l'outil, qui, quand, avant / apres. */
export default function AuditPage() {
  const mb = useMb();
  const [rows, setRows] = useState<MediaBuyingAuditLog[] | null>(null);
  const [all, setAll] = useState(false);

  useEffect(() => {
    const q = new URLSearchParams({ limit: "300" });
    if (!all && mb.connection) q.set("connectionId", mb.connection.id);
    void api<{ rows: MediaBuyingAuditLog[] }>(`/api/mediabuying/audit?${q}`).then((r) => setRows(r.rows)).catch(() => setRows([]));
  }, [mb.connection, all, mb.overview?.syncedAt]);

  return (
    <>
      <PageHeader
        title="Journal"
        subtitle="Chaque action faite depuis l'outil : budgets, pauses, duplications, tags, copies de Post ID, réglages."
        actions={
          <label className="flex items-center gap-2 text-[12.5px]">
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Tous les comptes
          </label>
        }
      />
      <Card padded={false}>
        {rows === null ? (
          <div className="p-5">
            <Spinner label="Chargement…" />
          </div>
        ) : rows.length === 0 ? (
          <Empty>Rien dans le journal pour l&apos;instant.</Empty>
        ) : (
          <ul>
            {rows.map((r) => (
              <li key={r.id} className="flex items-start gap-3 px-4 py-2.5" style={{ borderBottom: "1px solid var(--border)" }}>
                <div className="w-[118px] shrink-0">
                  <div className="num text-[12px]">{fmtDateTime(r.at)}</div>
                  <div className="dim text-[11px] truncate">{r.userName}</div>
                </div>
                <span className="badge !text-[10px] !py-0 shrink-0 mt-0.5">{ACTION_LABEL[r.action] ?? r.action}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px]">{r.summary}</div>
                  {(r.before || r.after) && r.action === "budget.update" && (
                    <div className="dim text-[11.5px] num">
                      {r.before || "—"} → {r.after}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
