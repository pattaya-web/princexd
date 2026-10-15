import { NextRequest, NextResponse } from "next/server";
import { readDB, writeDB } from "@/lib/db";
import { getTask } from "@/lib/kie";
import { warmThumb } from "@/lib/thumbs";

export const dynamic = "force-dynamic";

/**
 * Les generations rattachees a un swipe (prompts IA lances inline). Les
 * taches encore en cours sont relues chez KIE au passage : la page du swipe
 * sonde cette route toutes les quelques secondes tant qu'il reste quelque
 * chose en attente. Sur le VPS, le rappel KIE (/api/kie/callback) fait
 * souvent le travail avant.
 */
export async function GET(req: NextRequest) {
  const swipeId = req.nextUrl.searchParams.get("swipeId") ?? "";
  if (!swipeId) return NextResponse.json({ error: "swipeId manquant." }, { status: 400 });
  const db = readDB();
  const mine = db.generations.filter((g) => g.swipeId === swipeId);
  const pending = mine.filter((g) => g.state !== "success" && g.state !== "fail").slice(0, 8);
  let changed = false;
  const results = await Promise.allSettled(pending.map((g) => getTask(g.taskId)));
  for (const [i, gen] of pending.entries()) {
    const r = results[i];
    if (r.status === "rejected") continue;
    const rec = r.value;
    if (gen.state === rec.state && gen.progress === rec.progress) continue;
    changed = true;
    gen.state = rec.state;
    gen.resultUrls = rec.resultUrls;
    for (const u of rec.resultUrls ?? []) warmThumb(u);
    gen.creditsConsumed = rec.creditsConsumed;
    gen.failMsg = rec.failMsg;
    gen.progress = rec.progress;
    if (!gen.costTimeSec && (rec.state === "success" || rec.state === "fail")) {
      gen.costTimeSec = Math.max(1, Math.round((Date.now() - new Date(gen.createdAt).getTime()) / 1000));
    }
    gen.updatedAt = new Date().toISOString();
  }
  if (changed) writeDB(db);
  const rows = mine.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((g) => ({
    id: g.id,
    taskId: g.taskId,
    model: g.model,
    kind: g.kind,
    prompt: g.prompt,
    state: g.state,
    progress: g.progress,
    resultUrls: g.resultUrls,
    creditsConsumed: g.creditsConsumed,
    failMsg: g.failMsg,
    swipeSlot: g.swipeSlot ?? "",
    createdAt: g.createdAt,
  }));
  return NextResponse.json({ rows, pending: rows.filter((g) => g.state !== "success" && g.state !== "fail").length });
}
