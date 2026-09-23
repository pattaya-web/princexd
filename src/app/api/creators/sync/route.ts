import { NextRequest, NextResponse } from "next/server";
import { newId, readDB, writeDB } from "@/lib/db";
import { fetchCreatorPages, InstagramError, mapThumbnail } from "@/lib/instagram";
import { cacheImage, cacheImages, hashKey } from "@/lib/thumb-cache";

export const dynamic = "force-dynamic";
export const maxDuration = 800;

/**
 * Ajoute ou rafraîchit un créateur suivi.
 *
 * Un seul appel Meta : Business Discovery renvoie le profil et ses dernières
 * publications d'un coup. Les posts sont identifiés par leur id Instagram,
 * donc une resynchro met à jour les compteurs au lieu de dupliquer.
 */
export async function POST(req: NextRequest) {
  const { username, limit = 24 } = (await req.json().catch(() => ({}))) as {
    username?: string;
    limit?: number;
  };
  if (!username?.trim()) {
    return NextResponse.json({ error: "Nom d'utilisateur manquant." }, { status: 400 });
  }

  try {
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

    // Les miniatures partent en cache local avant d'etre enregistrees :
    // l'URL CDN de Meta serait morte dans quelques jours.
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

    return NextResponse.json({
      creator: profile.username,
      followers: profile.followers,
      postsCreated: created,
      postsUpdated: updated,
    });
  } catch (e) {
    const err = e as InstagramError;
    return NextResponse.json({ error: err.message }, { status: err.code === 401 ? 401 : 502 });
  }
}
