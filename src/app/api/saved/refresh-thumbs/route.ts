import { NextResponse } from "next/server";
import { readDB, writeDB } from "@/lib/db";
import { cacheImage } from "@/lib/thumb-cache";
import { fetchMeta } from "@/lib/ytdlp";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

/**
 * Repare les vignettes expirees de la page Production.
 *
 * Les elements enregistres avant la mise en cache pointent encore vers des
 * URL CDN mortes. On retrouve une image locale par le meme lien chez les
 * createurs suivis ou dans mes propres posts ; sinon on redemande les
 * metadonnees a yt-dlp et on met la nouvelle image en cache.
 */
export async function POST() {
  const db = readDB();
  let fixed = 0;
  let failed = 0;

  for (const item of db.saved) {
    if (item.thumbnail.startsWith("/api/media/")) continue;
    const url = item.permalink.split("?")[0];

    const fromCreator = db.creatorPosts.find(
      (p) => p.permalink.split("?")[0] === url && p.thumbnail.startsWith("/api/media/"),
    );
    const fromMine = db.posts.find((p) => p.url.split("?")[0] === url && p.thumbnail?.startsWith("/api/media/"));
    let next = fromCreator?.thumbnail ?? fromMine?.thumbnail ?? "";

    if (!next) {
      try {
        const meta = await fetchMeta(url);
        next = await cacheImage(meta.thumbnail, `s${item.id}`);
      } catch {
        next = "";
      }
    }

    if (next && next.startsWith("/api/media/")) {
      item.thumbnail = next;
      fixed++;
    } else {
      failed++;
    }
  }

  if (fixed) writeDB(db);
  return NextResponse.json({ fixed, failed, total: db.saved.length });
}
