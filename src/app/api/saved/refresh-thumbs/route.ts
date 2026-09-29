import { NextResponse } from "next/server";
import { readDB, writeDB } from "@/lib/db";
import { cacheImage } from "@/lib/thumb-cache";
import { isLocalOk, repairSavedThumbs } from "@/lib/thumb-repair";
import { fetchMeta } from "@/lib/ytdlp";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

/**
 * Repare les vignettes de la page Production.
 *
 * D'abord par l'API Instagram officielle (copies locales connues, flux du
 * createur, mes medias), puis yt-dlp en dernier recours : il est bloque sur
 * le serveur, mais fonctionne en local.
 */
export async function POST() {
  const db = readDB();
  const { fixed: viaApi, failed } = await repairSavedThumbs(db);
  let fixed = viaApi;
  let stillBroken = 0;

  for (const id of failed) {
    const item = db.saved.find((s) => s.id === id);
    if (!item) continue;
    try {
      const meta = await fetchMeta(item.permalink.split("?")[0]);
      const next = await cacheImage(meta.thumbnail, `s${item.id}`);
      if (isLocalOk(next)) {
        item.thumbnail = next;
        fixed++;
        continue;
      }
    } catch {
      // yt-dlp indisponible ici : on garde ce qu'on a.
    }
    stillBroken++;
  }

  if (fixed) writeDB(db);
  return NextResponse.json({ fixed, failed: stillBroken, total: db.saved.length });
}
