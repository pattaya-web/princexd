import fs from "node:fs";
import path from "node:path";
import { fetchMedia, findCreatorMedia, mapThumbnail } from "@/lib/instagram";
import { cacheImage } from "@/lib/thumb-cache";
import type { DB } from "@/lib/types";

/**
 * Reparation des vignettes.
 *
 * Une vignette est bonne quand elle est chez nous (/api/media/…) ET que le
 * fichier existe sur le disque. Tout le reste est perime : une URL CDN de
 * Meta (elle meurt en quelques jours) ou un fichier local disparu (base
 * copiee sans ses medias). La reparation passe par l'API Instagram
 * officielle, jamais par yt-dlp que le serveur ne peut pas utiliser.
 */
const MEDIA_DIR = path.join(process.cwd(), "data", "media");

export function isLocalOk(url: string | undefined | null): boolean {
  if (!url || !url.startsWith("/api/media/")) return false;
  const file = url.slice("/api/media/".length).split("?")[0];
  if (!/^[A-Za-z0-9]+\.[A-Za-z0-9]+$/.test(file)) return false;
  return fs.existsSync(path.join(MEDIA_DIR, file));
}

const cleanLink = (u: string) => (u || "").split("?")[0].replace(/\/+$/, "");

/** Vignettes perimees des createurs suivis, par pseudo, et avatars perimes. */
export function creatorThumbHealth(db: DB): { stale: Record<string, number>; total: Record<string, number>; avatars: string[] } {
  const stale: Record<string, number> = {};
  const total: Record<string, number> = {};
  for (const p of db.creatorPosts) {
    total[p.creator] = (total[p.creator] ?? 0) + 1;
    if (p.thumbnail && !isLocalOk(p.thumbnail)) stale[p.creator] = (stale[p.creator] ?? 0) + 1;
  }
  const avatars = db.creators.filter((c) => c.profilePicture && !isLocalOk(c.profilePicture)).map((c) => c.username);
  return { stale, total, avatars };
}

/**
 * Repare les vignettes des elements enregistres (page Production).
 *
 * Dans l'ordre du moins cher au plus cher : une copie locale deja connue
 * (createurs suivis, mes posts), puis l'API Instagram (flux du createur, ou
 * mes propres medias). Renvoie les identifiants encore casses pour qu'un
 * appelant tente autre chose.
 */
export async function repairSavedThumbs(db: DB): Promise<{ fixed: number; failed: string[] }> {
  let fixed = 0;
  const failed: string[] = [];
  let mine: Awaited<ReturnType<typeof fetchMedia>> | null = null;
  const myMedia = async () => {
    if (!mine) {
      try {
        mine = await fetchMedia(300);
      } catch {
        mine = [];
      }
    }
    return mine;
  };

  for (const item of db.saved) {
    if (isLocalOk(item.thumbnail)) continue;
    const link = cleanLink(item.permalink);
    let next = "";

    const fromCreator = db.creatorPosts.find((p) => cleanLink(p.permalink) === link);
    const fromMine = db.posts.find((p) => cleanLink(p.url) === link);
    if (fromCreator && isLocalOk(fromCreator.thumbnail)) next = fromCreator.thumbnail;
    else if (fromMine && isLocalOk(fromMine.thumbnail)) next = fromMine.thumbnail!;

    if (!next && fromCreator) {
      // Le createur est suivi : on retrouve le media dans son flux officiel.
      try {
        const hit = await findCreatorMedia(fromCreator.creator, link);
        if (hit) {
          next = await cacheImage(mapThumbnail(hit.media), `t${hit.media.id}`);
          if (isLocalOk(next)) fromCreator.thumbnail = next;
        }
      } catch {
        // Quota ou reseau : on passe.
      }
    }

    if (!next && (item.source === "mine" || fromMine)) {
      const m = (await myMedia()).find((x) => cleanLink(x.permalink) === link);
      if (m) {
        next = await cacheImage(mapThumbnail(m), `t${m.id}`);
        if (fromMine && isLocalOk(next)) fromMine.thumbnail = next;
      }
    }

    if (isLocalOk(next)) {
      item.thumbnail = next;
      fixed++;
    } else {
      failed.push(item.id);
    }
  }
  return { fixed, failed };
}
