import { NextRequest } from "next/server";
import { readDB } from "@/lib/db";
import { readSession, requireAdmin } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { opsKpis, dailyReport } from "@/lib/sales/ops/report";
import { computeAnomalies } from "@/lib/sales/ops/views";
import { opsState, runOps } from "@/lib/sales/ops/run";
import { opsSettings } from "@/lib/sales/ops/config";
import { indexDb } from "@/lib/sales/ops/engine";
import { dayOf } from "@/lib/sales/ops/time";

export const dynamic = "force-dynamic";

/**
 * Vue strategique de l'admin : indicateurs du pipeline, execution de
 * l'equipe, anomalies, compte rendu du jour et sante du moteur. Pas les
 * taches une par une : elles sont dans le cockpit.
 */
export async function GET(req: NextRequest) {
  return handle(() => {
    requireAdmin(readSession(req));
    runOps();
    const db = readDB();
    const now = Date.now();
    const days = Math.max(1, Math.min(365, Number(req.nextUrl.searchParams.get("days")) || 30));
    const source = req.nextUrl.searchParams.get("source") ?? "";
    const owner = req.nextUrl.searchParams.get("owner") ?? "";
    const cfg = opsSettings(db);
    const tasks = db.salesTasks ?? [];
    const myIds = new Set(["", db.settings.salesOwnerMemberId ?? ""]);
    return {
      kpis: opsKpis(db, now, days, { source, owner }),
      anomalies: computeAnomalies(db, now, indexDb(db), cfg.staleDays, cfg.anomalyWindowDays).slice(0, 50),
      today: dailyReport(db, dayOf(now), now),
      /** Ce qui revient a Mady elle-meme : calls a statuer, paiements a verifier. */
      mine: tasks
        .filter((t) => t.status === "open" && myIds.has(t.ownerId) && (t.kind === "outcome-missing" || t.kind === "payment-verify" || t.kind === "payment"))
        .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
        .slice(0, 20)
        .map((t) => ({ id: t.id, kind: t.kind, title: t.title, context: t.context, dueAt: t.dueAt, leadId: t.leadId, appointmentId: t.appointmentId ?? "", saleId: t.saleId ?? "" })),
      engine: { ...opsState(), open: tasks.filter((t) => t.status === "open").length },
      headName: db.team.find((m) => m.salesHead && m.status !== "inactif")?.name ?? "",
      currency: db.settings.salesCurrency || "EUR",
    };
  });
}
