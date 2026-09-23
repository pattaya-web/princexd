import { NextRequest, NextResponse } from "next/server";
import { newId, readDB, writeDB } from "@/lib/db";
import { fetchCreatorPages, InstagramError, mapThumbnail } from "@/lib/instagram";
import { cacheImage, cacheImages, hashKey } from "@/lib/thumb-cache";
import { DownloadError, fetchMeta, isSupportedUrl } from "@/lib/ytdlp";
import { PROD_FOLDERS } from "@/lib/format";
import type { ProdFolder } from "@/lib/types";

const isFolder = (v: unknown): v is ProdFolder => PROD_FOLDERS.some((f) => f.value === v);

export const dynamic = "force-dynamic";
export const maxDuration = 800;

/** Un lien de publication : reel, post ou IGTV. */
const POST_PATH = /\/(reel|reels|p|tv)\/([A-Za-z0-9_-]+)/;

/**
 * Extrait un pseudo depuis une URL de profil ou une saisie libre.
 * Renvoie null si l'entree ne designe pas un compte.
 */
function readHandle(raw: string): string | null {
  const clean = raw.trim().replace(/^@/, "");

  if (/^[A-Za-z0-9._]{1,30}$/.test(clean)) return clean.toLowerCase();

  try {
    const url = new URL(clean.startsWith("http") ? clean : `https://${clean}`);
    if (!/instagram\.com$/i.test(url.hostname.replace(/^www\./, ""))) return null;
    const first = url.pathname.split("/").filter(Boolean)[0];
    if (!first || ["p", "reel", "reels", "tv", "explore", "stories"].includes(first)) return null;
    return /^[A-Za-z0-9._]{1,30}$/.test(first) ? first.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Aiguille une saisie collee.
 *
 * Un lien de publication part directement en production : Business Discovery ne
 * sait interroger qu'un compte entier, jamais un reel precis, donc les
 * metadonnees viennent de yt-dlp. Un lien de profil ou un pseudo lance le suivi
 * du createur.
 */
export async function POST(req: NextRequest) {
  const { input, deep, folder } = (await req.json().catch(() => ({}))) as {
    input?: string;
    deep?: number;
    /** Dossier de production cible (ajout rapide). Sinon « value ». */
    folder?: string;
  };
  if (!input?.trim()) return NextResponse.json({ error: "Rien à analyser." }, { status: 400 });

  const raw = input.trim();
  const target: ProdFolder = isFolder(folder) ? folder : "value";

  // ---- Cas 1 : une publication precise, envoyee en production.
  // Un lien Instagram de reel/post, ou n'importe quel lien video que yt-dlp
  // sait lire (TikTok, YouTube…) des lors que ce n'est pas un profil.
  const isPostLink = POST_PATH.test(raw) || (/^https?:\/\//i.test(raw) && !readHandle(raw) && Boolean(isSupportedUrl(raw)));
  if (isPostLink) {
    const url = raw.split("?")[0];
    const db = readDB();
    const known = db.saved.find((r) => r.permalink === url);
    if (known) {
      // Deja en production : on le range dans le dossier demande.
      if (isFolder(folder) && known.folder !== folder) {
        known.folder = folder;
        writeDB(db);
      }
      return NextResponse.json({ kind: "saved", item: known, already: true });
    }

    try {
      const itemId = newId();
      /*
       * Metadonnees : yt-dlp d'abord. Si Instagram bloque le serveur, on se
       * rabat sur ce qu'on sait deja du post (createur suivi), et sinon on
       * enregistre le lien tel quel : la video reste lisible via l'embed.
       */
      const known = db.creatorPosts.find((p) => p.permalink.split("?")[0] === url);
      let meta: { author: string; title: string; thumbnail: string; likes: number; comments: number };
      let partial = false;
      try {
        meta = await fetchMeta(url);
      } catch (e) {
        if (known) {
          meta = { author: known.creator, title: known.caption, thumbnail: known.thumbnail, likes: known.likes, comments: known.comments };
        } else if (POST_PATH.test(url)) {
          meta = { author: "", title: url, thumbnail: "", likes: 0, comments: 0 };
          partial = true;
        } else {
          throw e;
        }
      }
      const item = {
        id: itemId,
        source: "creator" as const,
        author: meta.author,
        permalink: url,
        thumbnail: await cacheImage(meta.thumbnail, `s${itemId}`),
        caption: meta.title,
        likes: meta.likes,
        comments: meta.comments,
        views: 0,
        isReel: true,
        // Dossier choisi a l'ajout, sinon « value » ; reclassable ensuite.
        folder: target,
        note: "",
        done: false,
        createdAt: new Date().toISOString(),
      };
      const fresh = readDB();
      fresh.saved.unshift(item);
      writeDB(fresh);
      return NextResponse.json({ kind: "saved", item, partial });
    } catch (e) {
      const err = e as DownloadError;
      return NextResponse.json({ error: err.message }, { status: err.code ?? 502 });
    }
  }

  // ---- Cas 2 : un compte a suivre
  const handle = readHandle(raw);
  if (!handle) {
    return NextResponse.json(
      { error: "Colle un lien de reel, un lien de profil, ou un pseudo." },
      { status: 400 },
    );
  }

  try {
    // `deep: 0` demande tout le compte, sans plafond. Sinon on borne au
    // nombre demande, avec 300 par defaut pour que l'ajout reste rapide.
    const depth = deep === 0 ? 0 : Math.max(deep ?? 300, 25);
    const found = await fetchCreatorPages(handle, depth);
    const username = found.username.toLowerCase();
    const db = readDB();

    const profile = {
      username,
      name: found.name ?? username,
      profilePicture: await cacheImage(found.profile_picture_url ?? "", `c${hashKey(username)}`),
      biography: found.biography ?? "",
      followers: found.followers_count ?? 0,
      mediaCount: found.media_count ?? 0,
      lastSync: new Date().toISOString(),
    };

    const existing = db.creators.find((c) => c.username === username);
    if (existing) Object.assign(existing, profile);
    else db.creators.unshift({ id: newId(), ...profile, createdAt: new Date().toISOString() });

    let created = 0;
    const medias = found.media?.data ?? [];
    const thumbs = await cacheImages(medias.map((m) => ({ url: mapThumbnail(m), key: `t${m.id}` })));
    for (const [i, m] of medias.entries()) {
      const row = {
        creator: username,
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
      const known = db.creatorPosts.find((p) => p.igMediaId === m.id);
      if (known) Object.assign(known, row);
      else {
        db.creatorPosts.unshift({ id: newId(), ...row, createdAt: new Date().toISOString() });
        created++;
      }
    }

    writeDB(db);
    return NextResponse.json({ kind: "creator", username, followers: profile.followers, created });
  } catch (e) {
    const err = e as InstagramError;
    return NextResponse.json({ error: err.message }, { status: err.code === 401 ? 401 : 502 });
  }
}
