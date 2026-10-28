import { NextRequest } from "next/server";
import { readDB } from "@/lib/db";
import { callsByMonth } from "@/lib/sales/calls-months";
import { defaultCloserId } from "@/lib/sales/closers";
import { readSession, requireAdmin } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";

export const dynamic = "force-dynamic";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Calls par mois entre `from` et `to` (jours inclus). Sans bornes : les 6 derniers mois. `closer` : "me" (defaut), "all", ou un id. */
export async function GET(req: NextRequest) {
  return handle(() => {
    requireAdmin(readSession(req));
    const p = req.nextUrl.searchParams;
    const now = new Date();
    const dflt = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const pad = (n: number) => String(n).padStart(2, "0");
    const from = DAY.test(p.get("from") ?? "") ? String(p.get("from")) : `${dflt.getFullYear()}-${pad(dflt.getMonth() + 1)}-01`;
    const to = DAY.test(p.get("to") ?? "") ? String(p.get("to")) : `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const db = readDB();
    const c = p.get("closer") ?? "me";
    const closerId = c === "all" ? "" : c === "me" ? defaultCloserId(db) : c;
    return callsByMonth(db, { from, to, closerId }, now);
  });
}
