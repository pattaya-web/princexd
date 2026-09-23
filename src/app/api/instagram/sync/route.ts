import { NextRequest, NextResponse } from "next/server";
import { newId, readDB, writeDB } from "@/lib/db";
import { cacheImages } from "@/lib/thumb-cache";
import {
  fetchMedia,
  fetchMediaInsights,
  fetchProfile,
  fetchAccountInsights,
  InstagramError,
  mapStats,
  mapThumbnail,
  toPost,
} from "@/lib/instagram";
import { runLightSync } from "@/lib/instagram-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Synchronisation Instagram.
 *
 * `light` ne coûte que 4 appels : profil, insights du jour, historique. C'est
 * ce qui tourne à l'ouverture du dashboard.
 * `full` ajoute les publications et un appel d'insights par média — beaucoup
 * plus lourd, donc réservé au bouton manuel. Le quota Meta est de 200 appels
 * par heure, d'où cette séparation.
 */
export async function POST(req: NextRequest) {
  const { limit = 50, mode = "full" } = (await req.json().catch(() => ({}))) as {
    limit?: number;
    mode?: "light" | "full";
  };

  try {
    const db = readDB();
    // En mode full on rattrape toute la fenetre de desabonnements.
    const { snapshot, point } = await runLightSync(db, mode === "full" ? 30 : 3);

    let postsCreated = 0;
    let postsUpdated = 0;
    let postsSkipped = 0;

    if (mode === "full") {
      const media = (await fetchMedia(limit)).filter((m) => m.media_product_type !== "STORY");

      // Un appel d'insights par media, mais par paquets : en sequentiel les
      // 226 publications prenaient plusieurs minutes. Quatre a la fois reste
      // sous les limites de Meta tout en divisant le temps par autant.
      const insightsById = new Map<string, Awaited<ReturnType<typeof fetchMediaInsights>>>();
      const BATCH = 4;
      for (let i = 0; i < media.length; i += BATCH) {
        const slice = media.slice(i, i + BATCH);
        const got = await Promise.all(slice.map((m) => fetchMediaInsights(m.id)));
        slice.forEach((m, j) => insightsById.set(m.id, got[j]));
      }

      // Miniatures en cache local : l'URL CDN expire, pas le fichier chez nous.
      const thumbs = await cacheImages(media.map((m) => ({ url: mapThumbnail(m), key: `t${m.id}` })));

      for (const [i, m] of media.entries()) {
        const insights = insightsById.get(m.id) ?? null;
        const existing = db.posts.find((p) => p.url === m.permalink);

        if (existing) {
          // insights null = Meta muet sur ce média : on garde les stats connues.
          if (insights) Object.assign(existing, mapStats(m, insights));
          else postsSkipped++;
          existing.thumbnail = thumbs[i];
          existing.caption = m.caption ?? "";
          existing.igMediaId = m.id;
          if (!existing.publishedAt) existing.publishedAt = m.timestamp;
          if (existing.status !== "publie") existing.status = "publie";
          postsUpdated++;
        } else {
          if (!insights) postsSkipped++;
          db.posts.unshift({ ...toPost(m, insights ?? {}, newId()), thumbnail: thumbs[i] });
          postsCreated++;
        }
      }
    }

    writeDB(db);

    return NextResponse.json({
      mode,
      compte: snapshot.username,
      followers: snapshot.followers,
      reach: point.reach,
      profileVisits: point.profileVisits,
      linkClicks: point.linkClicks,
      accountsEngaged: point.accountsEngaged,
      joursHistorique: snapshot.history.length,
      postsCreated,
      postsUpdated,
      postsSkipped,
    });
  } catch (e) {
    const err = e as InstagramError;
    return NextResponse.json({ error: err.message }, { status: err.code === 401 ? 401 : 502 });
  }
}

/** Test de branchement : vérifie le token sans rien écrire dans la base. */
export async function GET() {
  try {
    const profile = await fetchProfile();
    const insights = await fetchAccountInsights();
    return NextResponse.json({ ok: true, profile, insights });
  } catch (e) {
    const err = e as InstagramError;
    return NextResponse.json({ ok: false, error: err.message }, { status: err.code ?? 502 });
  }
}
