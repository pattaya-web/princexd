import { NextRequest, NextResponse } from "next/server";
import { getSettings, readDB, writeDB } from "@/lib/db";
import { fetchMediaUrl, InstagramError } from "@/lib/instagram";
import { MAX_UPLOAD_BYTES, OpenAiError, transcribe } from "@/lib/openai";
import { downloadAudio, toArrayBuffer } from "@/lib/ytdlp";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Lexique metier passe au modele. Une LISTE, jamais une phrase :
    une phrase est recrachee telle quelle sur un audio sans parole. */
const TRANSCRIBE_VOCAB =
  "Shopify, AliExpress, e-commerce, dropshipping, Meta Ads, tunnel, ROAS, IA, ChatGPT, Claude, coaching";

/**
 * Transcription réelle d'un reel.
 *
 * Les URL média Instagram expirent, donc on en redemande une fraîche à partir
 * de l'identifiant du média avant de télécharger. Le mp4 part tel quel chez
 * OpenAI, qui l'accepte : aucune extraction audio locale n'est nécessaire.
 */
export async function POST(req: NextRequest) {
  const { postId, force } = (await req.json().catch(() => ({}))) as {
    postId?: string;
    force?: boolean;
  };
  if (!postId) return NextResponse.json({ error: "postId manquant" }, { status: 400 });

  const post = readDB().posts.find((p) => p.id === postId);
  if (!post) return NextResponse.json({ error: "Publication introuvable" }, { status: 404 });

  // Une transcription est définitive : on ne repaie pas sans raison.
  if (post.transcript?.trim() && !force) {
    return NextResponse.json({ transcript: post.transcript, cached: true });
  }

  if (!post.igMediaId) {
    return NextResponse.json(
      { error: "Publication sans identifiant Instagram : relance une synchronisation complète." },
      { status: 400 },
    );
  }

  try {
    const media = await fetchMediaUrl(post.igMediaId);
    // Une photo expose aussi un media_url (le jpg) : sans ce test on l'enverrait
    // a OpenAI, qui repondrait « Audio file might be corrupted » sans rien dire d'utile.
    if (media.media_type === "IMAGE" || media.media_type === "CAROUSEL_ALBUM") {
      return NextResponse.json(
        { error: "Rien à transcrire : cette publication est une photo ou un carrousel, pas une vidéo." },
        { status: 400 },
      );
    }

    let data: ArrayBuffer;
    let filename = `${post.igMediaId}.mp4`;

    if (media.media_url) {
      const res = await fetch(media.media_url, { cache: "no-store" });
      if (!res.ok) {
        return NextResponse.json(
          { error: `Téléchargement de la vidéo impossible (HTTP ${res.status}).` },
          { status: 502 },
        );
      }
      data = await res.arrayBuffer();
    } else {
      // Meta ne sert plus le fichier des vieilles publications : on repasse
      // par le permalien public, qui reste accessible.
      const audio = await downloadAudio(post.url);
      data = toArrayBuffer(audio.data);
      filename = audio.filename;
    }

    // Instagram sert la video complete. Au-dela de 25 Mo, on repasse par yt-dlp
    // qui recupere la piste audio seule — une vingtaine de fois plus legere.
    if (data.byteLength > MAX_UPLOAD_BYTES) {
      const audio = await downloadAudio(post.url);
      data = toArrayBuffer(audio.data);
      filename = audio.filename;
    }

    if (data.byteLength > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        {
          error: `Vidéo de ${(data.byteLength / 1024 / 1024).toFixed(1)} Mo : au-dessus de la limite OpenAI de 25 Mo, même en audio seul.`,
        },
        { status: 413 },
      );
    }

    const settings = getSettings();
    const { text, language } = await transcribe(data, filename, { prompt: TRANSCRIBE_VOCAB });

    const fresh = readDB();
    const target = fresh.posts.find((p) => p.id === postId);
    if (target) {
      target.transcript = text;
      writeDB(fresh);
    }

    return NextResponse.json({
      transcript: text,
      language,
      cached: false,
      sizeMb: Number((data.byteLength / 1024 / 1024).toFixed(2)),
    });
  } catch (e) {
    const err = e as OpenAiError | InstagramError;
    return NextResponse.json({ error: err.message }, { status: err.code === 401 ? 401 : 502 });
  }
}
