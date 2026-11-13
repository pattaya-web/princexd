import { NextRequest } from "next/server";
import { readDB } from "@/lib/db";
import { readSession, requireSales } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { opsSettings } from "@/lib/sales/ops/config";

export const dynamic = "force-dynamic";

/** Bibliotheque d'objections, pour statuer un call « en attente » (closers et admin). */
export async function GET(req: NextRequest) {
  return handle(() => {
    requireSales(readSession(req));
    return { objections: opsSettings(readDB()).objections };
  });
}
