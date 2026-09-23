import { NextRequest, NextResponse } from "next/server";
import { readDB, writeDB } from "@/lib/db";
import { MAX_UPLOAD_BYTES, transcribe } from "@/lib/openai";
import { DownloadError, downloadAudio, isSupportedUrl, toArrayBuffer } from "@/lib/ytdlp";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Lexique metier passe au modele. Une LISTE, jamais une phrase :
    une phrase est recrachee telle quelle sur un audio sans parole. */
const TRANSCRIBE_VOCAB =
  "Shopify, AliExpress, e-commerce, dropshipping, Meta Ads, tunnel, ROAS, IA, ChatGPT, Claude, coaching";

/**
 * Transcription d'une video a partir de son URL publique.
 *
 * Meta ne livre pas le fichier des reels qui ne t'appartiennent pas : on passe
 * donc par yt-dlp pour recuperer la piste audio, puis par OpenAI.
 */
export async function POST(req: NextRequest) {
  const { url, savedId, force } = (await req.json().catch(() => ({}))) as {
    url?: string;
    savedId?: string;
    force?: boolean;
  };

  if (!url?.trim()) return NextResponse.json({ error: "URL manquante." }, { status: 400 });
  if (!isSupportedUrl(url)) {
    return NextResponse.json(
      { error: "Seules les URL Instagram, TikTok et YouTube sont acceptees." },
      { status: 400 },
    );
  }

  // Une transcription deja obtenue n'est pas refacturee.
  if (savedId && !force) {
    const known = readDB().saved.find((r) => r.id === savedId);
    if (known?.transcript?.trim()) {
      return NextResponse.json({ transcript: known.transcript, cached: true });
    }
  }

  try {
    const { data, filename } = await downloadAudio(url);
    if (data.byteLength > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        {
          error: `Fichier de ${(data.byteLength / 1024 / 1024).toFixed(1)} Mo : au-dessus de la limite OpenAI de 25 Mo.`,
        },
        { status: 413 },
      );
    }

    const { text, language } = await transcribe(toArrayBuffer(data), filename, {
      prompt: TRANSCRIBE_VOCAB,
    });

    if (savedId) {
      const db = readDB();
      const row = db.saved.find((r) => r.id === savedId);
      if (row) {
        row.transcript = text;
        writeDB(db);
      }
    }

    return NextResponse.json({
      transcript: text,
      language,
      cached: false,
      sizeMb: Number((data.byteLength / 1024 / 1024).toFixed(2)),
    });
  } catch (e) {
    const err = e as DownloadError;
    return NextResponse.json({ error: err.message }, { status: err.code ?? 502 });
  }
}
