import { NextRequest, NextResponse } from "next/server";
import { getSettings } from "@/lib/db";
import { getIclosedKey } from "@/lib/iclosed";
import { readSession, requireSales } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { syncIclosedUpcoming } from "@/lib/sales/iclosed-sync";

export const dynamic = "force-dynamic";

/**
 * Synchronisation des rendez-vous iClosed a venir (voir lib/sales/iclosed-sync).
 * Ouverte a toute l'equipe : un closer qui ouvre son espace le matin doit y
 * trouver ses calls du jour meme si l'admin n'a pas encore ouvert le sien.
 * `?force=1` ignore le delai de dix minutes (bouton manuel).
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    requireSales(readSession(req));
    const force = req.nextUrl.searchParams.get("force") === "1";
    return syncIclosedUpcoming({ force });
  });
}

/** Etat de la synchro, pour l'afficher sans la declencher. */
export async function GET(req: NextRequest) {
  const session = readSession(req);
  if (!session.isAdmin) return NextResponse.json({ enabled: false });
  const s = getSettings();
  return NextResponse.json({
    enabled: !s.salesAutoImportOff && Boolean(getIclosedKey()),
    hasKey: Boolean(getIclosedKey()),
    setterId: s.salesDefaultSetterId,
    closerId: s.salesDefaultCloserId ?? "",
    lastSyncAt: s.salesLastSyncAt,
  });
}
