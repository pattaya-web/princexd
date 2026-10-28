import { newId, readDB, writeDB } from "./db";
import { fetchCreatorPages, mapThumbnail } from "./instagram";
import { cacheImage, cacheImages, hashKey } from "./thumb-cache";

/**
 * Synchronisation d'un concurrent suivi (page Content → Concurrence).
 *
 * Un seul appel Meta (Business Discovery) renvoie le profil et ses
 * dernieres publications. Les posts sont identifies par leur id Instagram :
 * une resynchro met a jour les compteurs au lieu de dupliquer. Appele par
 * la route /api/creators/sync (a la main) et par le planificateur (toutes
 * les 12 h par concurrent, quelques-uns par passage pour respecter le quota
 * Meta de 200 appels / heure).
 */
export async function syncCreator(username: string, limit = 24): Promise<{ creator: string; followers: number; postsCreated: number; postsUpdated: number }> {
  const found = await fetchCreatorPages(username, limit === 0 ? 0 : Math.max(limit, 1));
  const handle = found.username.toLowerCase();

  const db = readDB();
  const existing = db.creators.find((c) => c.username === handle);
  const profile = {
    username: handle,
    name: found.name ?? handle,
    profilePicture: await cacheImage(found.profile_picture_url ?? "", `c${hashKey(handle)}`),
    biography: found.biography ?? "",
    followers: found.followers_count ?? 0,
    mediaCount: found.media_count ?? 0,
    lastSync: new Date().toISOString(),
  };

  if (existing) Object.assign(existing, profile);
  else db.creators.unshift({ id: newId(), ...profile, createdAt: new Date().toISOString() });

  let created = 0;
  let updated = 0;
  const medias = found.media?.data ?? [];
  const thumbs = await cacheImages(medias.map((m) => ({ url: mapThumbnail(m), key: `t${m.id}` })));

  for (const [i, m] of medias.entries()) {
    const known = db.creatorPosts.find((p) => p.igMediaId === m.id);
    const row = {
      creator: handle,
      igMediaId: m.id,
      caption: m.caption ?? "",
      permalink: m.permalink,
      thumbnail: thumbs[i],
      mediaType: m.media_type,
      isReel: m.media_product_type === "REELS" || m.media_type === "VIDEO",
      likes: m.like_count ?? 0,
      comments: m.comments_count ?? 0,
      timestamp: m.timestamp,
    };
    if (known) {
      Object.assign(known, row);
      updated++;
    } else {
      db.creatorPosts.unshift({ id: newId(), ...row, createdAt: new Date().toISOString() });
      created++;
    }
  }
  writeDB(db);
  return { creator: profile.username, followers: profile.followers, postsCreated: created, postsUpdated: updated };
}

const STALE_MS = 12 * 60 * 60 * 1000;

/**
 * Planificateur : rafraichit les concurrents dont la derniere synchro a plus
 * de 12 h, les plus anciens d'abord, `max` par passage. Une erreur sur un
 * compte (prive, supprime, quota) n'arrete pas les autres.
 */
export async function syncStaleCreators(max = 3): Promise<number> {
  const db = readDB();
  const now = Date.now();
  const stale = db.creators
    .filter((c) => !c.lastSync || now - Date.parse(c.lastSync) > STALE_MS)
    .sort((a, b) => (a.lastSync || "").localeCompare(b.lastSync || ""))
    .slice(0, max);
  let done = 0;
  for (const c of stale) {
    try {
      await syncCreator(c.username, 24);
      done++;
    } catch (e) {
      console.warn(`[creators] synchro @${c.username} :`, e instanceof Error ? e.message : String(e));
      // On date quand meme la tentative : pas de boucle sur un compte qui refuse.
      const d = readDB();
      const row = d.creators.find((x) => x.username === c.username);
      if (row) {
        row.lastSync = new Date().toISOString();
        writeDB(d);
      }
    }
  }
  return done;
}
