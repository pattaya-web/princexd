import { NextResponse } from "next/server";
import { readDB } from "@/lib/db";
import { mondayISO } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Etat des objectifs du jour, pour la barre affichée sur toutes les pages.
 *
 * Route dédiée et volontairement minuscule : le Shell est monté partout, il ne
 * doit pas tirer les 226 publications juste pour compter celles d'aujourd'hui.
 */
export async function GET() {
  const db = readDB();
  const today = new Date().toISOString().slice(0, 10);
  const point = db.followers.find((f) => f.date === today);

  const reelsDone = db.posts.filter(
    (p) => p.status === "publie" && p.publishedAt.slice(0, 10) === today,
  ).length;

  // Photos et carrousels de la semaine en cours.
  const monday = mondayISO();
  const photosDone = db.posts.filter(
    (p) =>
      p.status === "publie" &&
      (p.format === "post-image" || p.format === "carrousel") &&
      p.publishedAt.slice(0, 10) >= monday,
  ).length;

  return NextResponse.json({
    date: today,
    photosDone,
    photosGoal: db.settings.weeklyPhotoGoal ?? 4,
    reelsDone,
    reelsGoal: db.settings.dailyReelsGoal ?? 3,
    channelDone: point?.channelPosts ?? 0,
    channelGoal: db.settings.dailyChannelGoal ?? 6,
    storyCount: point?.storyCount ?? 0,
    theme: db.settings.weekPlan?.[String(new Date().getDay())]?.theme ?? "",
  });
}
