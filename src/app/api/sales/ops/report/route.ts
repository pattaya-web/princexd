import { NextRequest } from "next/server";
import { newId, readDB, writeDB } from "@/lib/db";
import { readSession, requireSales, requireSalesManager } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { dailyReport, weeklyReport } from "@/lib/sales/ops/report";
import { dayOf } from "@/lib/sales/ops/time";
import { isSetterSession } from "@/lib/sales/setter-view";

export const dynamic = "force-dynamic";

/**
 * Compte rendu commercial : le jour demande (aujourd'hui par defaut) et les
 * 7 derniers jours compares aux 7 precedents. Chiffres calcules sur les
 * vraies donnees. Head of Setting et admin (le cash encaisse y figure).
 */
export async function GET(req: NextRequest) {
  return handle(() => {
    const session = requireSalesManager(requireSales(readSession(req)));
    const db = readDB();
    const now = Date.now();
    const day = req.nextUrl.searchParams.get("day") || dayOf(now);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("Jour invalide.");
    // Head of Setting aux montants annonces : pas de cash reel dans son compte rendu.
    const masked = isSetterSession(session);
    const daily = dailyReport(db, day, now);
    const weekly = weeklyReport(db, now);
    if (masked) {
      daily.lines = daily.lines.filter((l) => !l.money);
      weekly.lines = weekly.lines.filter((l) => !l.money);
    }
    return {
      daily,
      weekly,
      history: (db.salesReports ?? []).slice(0, 30).map((r) => ({ day: r.day, by: r.validatedByName, at: r.validatedAt, comment: r.comment })),
      currency: db.settings.salesCurrency || "EUR",
    };
  });
}

/** Valide (et complete) le compte rendu du jour : les chiffres sont figes avec le commentaire. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const session = requireSalesManager(requireSales(readSession(req)));
    const body = (await req.json().catch(() => ({}))) as { day?: string; comment?: string };
    const db = readDB();
    const now = Date.now();
    const day = body.day && /^\d{4}-\d{2}-\d{2}$/.test(body.day) ? body.day : dayOf(now);
    const r = dailyReport(db, day, now);
    db.salesReports ??= [];
    const existing = db.salesReports.find((x) => x.day === day);
    const record = {
      id: existing?.id ?? newId(),
      day,
      numbers: Object.fromEntries(r.lines.map((l) => [l.key, l.value])),
      comment: String(body.comment ?? "").trim().slice(0, 3000),
      validatedBy: session.memberId,
      validatedByName: session.memberName || "Moi",
      validatedAt: new Date(now).toISOString(),
    };
    if (existing) Object.assign(existing, record);
    else db.salesReports.unshift(record);
    db.salesReports = db.salesReports.sort((a, b) => b.day.localeCompare(a.day)).slice(0, 400);
    db.activityLogs.unshift({ id: newId(), at: record.validatedAt, actorId: session.memberId, actorName: record.validatedByName, action: "report.validated", entity: "report", entityId: record.id, summary: `Compte rendu du ${day} validé par ${record.validatedByName}` });
    writeDB(db);
    return { ok: true };
  });
}
