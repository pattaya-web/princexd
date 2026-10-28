import { NextRequest } from "next/server";
import { readDB } from "@/lib/db";
import { annotateReel, keptReels, reelQueue, reelStats, type KeptReel, type ReelStats } from "@/lib/reels";
import { readSession, requireAdmin } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import type { Reel, SwipeStage } from "@/lib/types";

export const dynamic = "force-dynamic";

export interface ReelsPayload {
  queue: Reel[];
  kept: KeptReel[];
  stats: ReelStats;
}

/** La file a juger, les Reels gardes (avec leur swipe) et les compteurs. */
export async function GET(req: NextRequest) {
  return handle((): ReelsPayload => {
    requireAdmin(readSession(req));
    const db = readDB();
    const view = req.nextUrl.searchParams.get("view");
    return {
      queue: view === "kept" ? [] : reelQueue(db),
      kept: view === "queue" ? [] : keptReels(db),
      stats: reelStats(db),
    };
  });
}

/** `{ id, stage?, note? }` : classement TOFU / MOFU / BOFU et note d'un Reel garde. */
export async function PATCH(req: NextRequest) {
  return handle(async () => {
    requireAdmin(readSession(req));
    const b = (await req.json().catch(() => ({}))) as { id?: string; stage?: SwipeStage | ""; note?: string };
    return annotateReel(String(b.id ?? ""), { stage: b.stage, note: b.note });
  });
}
