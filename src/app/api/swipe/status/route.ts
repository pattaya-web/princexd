import { NextRequest, NextResponse } from "next/server";
import { readDB, writeDB } from "@/lib/db";
import { readSession } from "@/lib/sales/access";
import { SWIPE_PROD_STATUSES, type SwipeProdStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Fait avancer (ou reculer) un swipe dans la chaine de production, en datant
 * le passage. Le monteur ne peut poser que « monte » ; tout le reste est au
 * proprietaire. « scripte » est pose automatiquement par la generation du
 * script court (voir /api/swipe/script), mais reste posable a la main.
 */
export async function POST(req: NextRequest) {
  const { swipeId, status } = (await req.json().catch(() => ({}))) as { swipeId?: string; status?: SwipeProdStatus };
  if (!swipeId || !status || !SWIPE_PROD_STATUSES.includes(status)) {
    return NextResponse.json({ error: "Statut inconnu." }, { status: 400 });
  }
  const session = readSession(req);
  if (session.role === "editor" && status !== "monte") {
    return NextResponse.json({ error: "Le monteur ne peut que marquer un Reel « monté »." }, { status: 403 });
  }
  const db = readDB();
  const swipe = db.swipes.find((s) => s.id === swipeId);
  if (!swipe) return NextResponse.json({ error: "Swipe introuvable." }, { status: 404 });
  const now = new Date().toISOString();
  swipe.prodStatus = status;
  swipe.prodDates = { ...(swipe.prodDates ?? {}), [status]: now };
  if (!swipe.prodDates.source) swipe.prodDates.source = swipe.createdAt;
  writeDB(db);
  return NextResponse.json({ swipe });
}
