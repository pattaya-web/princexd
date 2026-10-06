import { NextRequest } from "next/server";
import { readDB, writeDB } from "@/lib/db";
import { fetchCalls, IclosedError } from "@/lib/iclosed";
import { canSee, readSession, requireAdmin, requireSales } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { findByIclosedId, utmRecord } from "@/lib/sales/iclosed-link";
import { inRange, rangeFromParams } from "@/lib/sales/period";
import { isAttended, isDead } from "@/lib/sales/constants";
import { netCash, netContract } from "@/lib/sales/commissions";
import { hasUtm, sourceFamily, sourceKey, sourceLabel, utmFromUrl, type UtmInfo } from "@/lib/sales/sources";
import type { Appointment } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Par quelle porte sont arrives les leads.
 *
 * Deux lectures : la liste brute, comme chez iClosed (un rendez-vous par
 * ligne avec ses UTM), et la repartition par source avec ce que chacune a
 * rapporte. Les opt-ins de la landing page (Systeme.io) sont comptes a part :
 * ce sont des leads, pas encore des rendez-vous.
 */

export interface SourceRow {
  id: string;
  scheduledAt: string;
  status: string;
  leadName: string;
  igUsername: string;
  email: string;
  phone: string;
  setterName: string;
  closerName: string;
  utm: UtmInfo;
  label: string;
  family: string;
  key: string;
  fromIclosed: boolean;
  contractValue: number;
  cashCollected: number;
}

export interface SourceGroup {
  key: string;
  label: string;
  family: string;
  appointments: number;
  attended: number;
  sales: number;
  contract: number;
  cash: number;
  /** Opt-ins landing page sur la periode, pour les sources qui en ont. */
  leads: number;
}

export async function GET(req: NextRequest) {
  return handle(() => {
    const session = requireSales(readSession(req));
    const db = readDB();
    const range = rangeFromParams(req.nextUrl.searchParams);
    const leads = new Map(db.leads.map((l) => [l.id, l]));
    const names = new Map(db.team.map((m) => [m.id, m.name]));
    const name = (id: string) => (id ? (names.get(id) ?? "—") : "");
    const saleOf = new Map(db.sales.filter((s) => s.status !== "cancelled").map((s) => [s.appointmentId, s]));

    const rows: SourceRow[] = db.appointments
      .filter((a) => canSee(session, a) && inRange(a.scheduledAt, range) && !isDead(a.status))
      .map((a) => {
        const lead = leads.get(a.leadId);
        // Le lien de reservation d'abord ; a defaut, la page d'opt-in du lead.
        const utm: UtmInfo = hasUtm(a.utm as UtmInfo) ? (a.utm as UtmInfo) : utmFromUrl(lead?.sourceUrl);
        const sale = saleOf.get(a.id);
        return {
          id: a.id,
          scheduledAt: a.scheduledAt,
          status: a.status,
          leadName: lead?.name ?? "Lead supprimé",
          igUsername: lead?.igUsername ?? "",
          email: lead?.email ?? "",
          phone: lead?.phone ?? "",
          setterName: name(a.setterId),
          closerName: name(a.closerId),
          utm,
          label: sourceLabel(utm),
          family: sourceFamily(utm),
          key: sourceKey(utm),
          fromIclosed: Boolean(a.iclosedEventId),
          contractValue: sale ? netContract(sale) : 0,
          cashCollected: sale ? netCash(sale) : 0,
        };
      })
      .sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt));

    /* Opt-ins de la landing page sur la periode, par source du lien. */
    const lpLeads = session.isAdmin
      ? db.leads.filter((l) => l.optInAt && inRange(l.optInAt, range)).map((l) => utmFromUrl(l.sourceUrl))
      : [];

    const groups = new Map<string, SourceGroup>();
    const touch = (info: UtmInfo) => {
      const key = sourceKey(info);
      let g = groups.get(key);
      if (!g) {
        g = { key, label: sourceLabel(info), family: sourceFamily(info), appointments: 0, attended: 0, sales: 0, contract: 0, cash: 0, leads: 0 };
        groups.set(key, g);
      }
      return g;
    };
    for (const r of rows) {
      const g = touch(r.utm);
      g.appointments += 1;
      if (isAttended(r.status as Appointment["status"])) g.attended += 1;
      if (r.contractValue > 0) {
        g.sales += 1;
        g.contract += r.contractValue;
        g.cash += r.cashCollected;
      }
    }
    for (const info of lpLeads) touch(info).leads += 1;

    const breakdown = [...groups.values()]
      .map((g) => ({ ...g, contract: Math.round(g.contract * 100) / 100, cash: Math.round(g.cash * 100) / 100 }))
      .sort((a, b) => b.appointments - a.appointments || b.leads - a.leads);

    return {
      range,
      currency: db.settings.salesCurrency || "EUR",
      rows,
      breakdown,
      totals: {
        appointments: rows.length,
        withUtm: rows.filter((r) => r.key !== "unknown").length,
        leads: lpLeads.length,
        sales: rows.filter((r) => r.contractValue > 0).length,
        cash: Math.round(rows.reduce((a, r) => a + r.cashCollected, 0) * 100) / 100,
      },
      lastSourcesSyncAt: db.settings.salesSourcesSyncAt ?? "",
    };
  });
}

/**
 * Rattrapage (admin) : relit les appels iClosed passes et a venir et pose
 * leurs UTM sur les rendez-vous deja importes qui n'en ont pas. Une douzaine
 * de requetes au plus : le quota iClosed est de 200 par heure.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    requireAdmin(readSession(req));
    const body = (await req.json().catch(() => ({}))) as { pages?: unknown };
    const pages = Math.min(12, Math.max(1, Number(body.pages) || 6));

    let calls;
    try {
      const [past, upcoming] = await Promise.all([fetchCalls("PAST", pages, 50), fetchCalls("UPCOMING", 2, 50)]);
      calls = [...upcoming, ...past];
    } catch (e) {
      throw new Error(e instanceof IclosedError ? e.message : (e as Error).message);
    }

    const db = readDB();
    let updated = 0;
    let matched = 0;
    for (const call of calls) {
      const existing = findByIclosedId(db, String(call.id));
      if (!existing) continue;
      matched += 1;
      const utm = utmRecord(call);
      if (!utm) continue;
      const before = JSON.stringify(existing.utm ?? {});
      if (before === JSON.stringify(utm)) continue;
      existing.utm = utm;
      existing.updatedAt = new Date().toISOString();
      updated += 1;
    }
    db.settings.salesSourcesSyncAt = new Date().toISOString();
    writeDB(db);
    return { examined: calls.length, matched, updated, at: db.settings.salesSourcesSyncAt };
  });
}
