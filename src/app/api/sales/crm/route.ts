import { NextRequest } from "next/server";
import { readDB } from "@/lib/db";
import { readSession, requireSales } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { buildCrm } from "@/lib/sales/crm";

export const dynamic = "force-dynamic";

/** Les lignes du CRM avec leurs vues rapides et compteurs, pour la session. */
export async function GET(req: NextRequest) {
  return handle(() => {
    const session = requireSales(readSession(req));
    return buildCrm(readDB(), session);
  });
}
