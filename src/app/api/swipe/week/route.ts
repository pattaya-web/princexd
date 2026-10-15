import { NextRequest, NextResponse } from "next/server";
import { readDB } from "@/lib/db";
import { weekProgress } from "@/lib/swipe-week";
import { swipeProdStatus, swipeStage, type SwipeScript, type SwipeStage } from "@/lib/types";

export const dynamic = "force-dynamic";

export interface ToEditRow {
  id: string;
  title: string;
  stage: SwipeStage | "";
  url: string;
  thumbnail: string;
  script: SwipeScript | null;
  /** Dossier de montage rattache, avec les rushs. */
  editJobId: string;
  editJobTitle: string;
  editJobStatus: string;
  /** Resultats IA (images, B-roll) rattaches au swipe. */
  assets: { id: string; kind: "image" | "video"; url: string; prompt: string }[];
  tourneAt: string;
}

/**
 * Le bloc « Semaine en cours » : progression par etape du funnel, plan du
 * jour, et pour le monteur la liste des Reels tournes qui attendent un
 * montage (script court, texte ecran, duree, rushs, assets IA). Une seule
 * route pour toutes les pages, proprietaire et monteur.
 */
export async function GET(_req: NextRequest) {
  const db = readDB();
  const progress = weekProgress(db.swipes, db.settings.weeklyReelTargets);
  const jobs = new Map(db.edits.map((j) => [j.id, j]));
  const toEdit: ToEditRow[] = db.swipes
    .filter((s) => swipeProdStatus(s) === "tourne")
    .map((s) => {
      const job = s.editJobId ? jobs.get(s.editJobId) : undefined;
      return {
        id: s.id,
        title: s.title || s.script?.hook || s.analysis?.hook || s.caption || s.url,
        stage: swipeStage(s),
        url: s.url,
        thumbnail: s.thumbnail,
        script: s.script ?? null,
        editJobId: job?.id ?? "",
        editJobTitle: job?.title ?? "",
        editJobStatus: job?.status ?? "",
        assets: db.generations
          .filter((g) => g.swipeId === s.id && g.state === "success" && g.resultUrls.length)
          .map((g) => ({ id: g.id, kind: g.kind, url: g.resultUrls[0], prompt: g.prompt })),
        tourneAt: s.prodDates?.tourne ?? "",
      };
    })
    .sort((a, b) => a.tourneAt.localeCompare(b.tourneAt));
  return NextResponse.json({ progress, toEdit });
}
