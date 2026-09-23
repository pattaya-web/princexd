import { newId } from "./db";
import { mapThumbnail, toPost } from "./instagram";
import { cacheImage } from "./thumb-cache";
import {
  buildHistory,
  fetchAccountInsights,
  fetchFollowerHistory,
  fetchMedia,
  fetchProfile,
  fetchStoriesToday,
  fetchUnfollows,
  toFollowerPoint,
  toSnapshot,
} from "./instagram";
import type { DB } from "./types";

/** Au-delà, Meta ne conserve plus rien : inutile de garder le cache. */
const KEEP_DAYS = 120;

/**
 * Synchro légère : profil, insights du jour, historique 30 jours.
 *
 * Les désabonnements demandent un appel par journée — trop cher pour une
 * synchro qui tourne à chaque ouverture du dashboard. On les accumule donc
 * dans un cache et on ne rafraîchit que les tout derniers jours ; la synchro
 * complète, elle, rattrape toute la fenêtre.
 *
 * Mute `db` en place ; l'appelant reste responsable du writeDB.
 */
export async function runLightSync(db: DB, unfollowDays = 3) {
  const [profile, insights, raw, stories] = await Promise.all([
    fetchProfile(),
    fetchAccountInsights(),
    fetchFollowerHistory(30),
    fetchStoriesToday(),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const existing = db.followers.find((f) => f.date === today);
  const point = toFollowerPoint(profile, insights, existing?.id ?? newId(), today, stories);
  if (existing) Object.assign(existing, point);
  else db.followers.unshift(point);

  // Un seul appel de plus, mais il suffit a reperer un reel publie a l'instant :
  // la coche "reels du jour" se remplit donc sans action manuelle.
  try {
    for (const m of await fetchMedia(6)) {
      if (m.media_product_type === "STORY") continue;
      const known = db.posts.find((p) => p.url === m.permalink);
      const thumbnail = await cacheImage(mapThumbnail(m), `t${m.id}`);
      if (known) {
        known.thumbnail = thumbnail;
        known.caption = m.caption ?? "";
        known.igMediaId = m.id;
      } else {
        // Stats a zero : la synchro complete les remplira.
        db.posts.unshift({ ...toPost(m, {}, newId()), thumbnail });
      }
    }
  } catch {
    // Une publication non detectee ne doit jamais faire echouer la synchro.
  }

  const cache = { ...(db.settings.igUnfollows ?? {}) };
  const window = Object.keys(raw.gains).sort().slice(-unfollowDays);
  // Les jours déjà en cache ne bougent plus, sauf le plus récent qui peut
  // encore évoluer tant que la journée n'est pas close côté Meta.
  const toFetch = [...new Set([...window.filter((d) => cache[d] === undefined), ...window.slice(-1)])];

  if (toFetch.length) Object.assign(cache, await fetchUnfollows(toFetch));

  const floor = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
  db.settings.igUnfollows = Object.fromEntries(
    Object.entries(cache).filter(([date]) => date >= floor),
  );

  // L'historique est construit APRÈS le relevé du jour pour que la variation
  // d'aujourd'hui compte dans la déduction de secours.
  const history = buildHistory(raw.gains, raw.reach, db.followers, db.settings.igUnfollows);
  const snapshot = toSnapshot(profile, insights, history);
  db.settings.igProfile = snapshot;

  return { snapshot, point };
}
