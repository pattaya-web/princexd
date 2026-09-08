import { NextRequest, NextResponse } from "next/server";
import { getTask, KieError } from "@/lib/kie";
import { readDB, writeDB } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Rafraîchit une ou plusieurs générations en cours.
 * Sans paramètre, reprend toutes les tâches encore ouvertes — c'est ce que
 * le Studio appelle en boucle tant qu'il reste quelque chose à attendre.
 */
export async function GET(req: NextRequest) {
  const one = req.nextUrl.searchParams.get("taskId");
  const db = readDB();
  const pending = db.generations.filter(
    (g) => (one ? g.taskId === one : g.state !== "success" && g.state !== "fail"),
  );
  if (!pending.length) return NextResponse.json({ updated: [], remaining: 0 });

  const updated: string[] = [];
  for (const gen of pending.slice(0, 12)) {
    try {
      const rec = await getTask(gen.taskId);
      gen.state = rec.state;
      gen.resultUrls = rec.resultUrls;
      gen.creditsConsumed = rec.creditsConsumed;
      gen.failMsg = rec.failMsg;
      gen.updatedAt = new Date().toISOString();
      updated.push(gen.taskId);
    } catch (e) {
      // Une tâche qui échoue à répondre ne doit pas bloquer les autres.
      gen.failMsg = (e as KieError).message;
    }
  }
  writeDB(db);

  const remaining = db.generations.filter((g) => g.state !== "success" && g.state !== "fail").length;
  return NextResponse.json({ updated, remaining, generations: db.generations.slice(0, 60) });
}
