import { NextRequest, NextResponse } from "next/server";
import { readDB, writeDB } from "@/lib/db";
import { MediaAudioError, readForTranscription } from "@/lib/media-audio";
import { OpenAiError, transcribe } from "@/lib/openai";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Lexique metier passe au modele : une LISTE, jamais une phrase. */
const TRANSCRIBE_VOCAB =
  "Shopify, AliExpress, e-commerce, dropshipping, Meta Ads, tunnel, ROAS, IA, ChatGPT, Claude, coaching, UGC";

/**
 * Transcription d'une pub d'inspiration deposee dans un dossier Ads.
 *
 * Le texte est enregistre sur l'inspiration : c'est lui qui sert ensuite a
 * sortir un script. Une transcription existante n'est pas repayee sans `force`.
 */
export async function POST(req: NextRequest) {
  const { folderId, url, force } = (await req.json().catch(() => ({}))) as {
    folderId?: string;
    url?: string;
    force?: boolean;
  };
  if (!folderId || !url) return NextResponse.json({ error: "folderId et url requis" }, { status: 400 });

  const folder = readDB().adFolders.find((f) => f.id === folderId);
  const insp = folder?.inspirations.find((i) => i.url === url);
  if (!folder || !insp) return NextResponse.json({ error: "Inspiration introuvable" }, { status: 404 });

  if (insp.transcript?.trim() && !force) {
    return NextResponse.json({ transcript: insp.transcript, cached: true });
  }

  try {
    const media = await readForTranscription(url);
    const { text, language } = await transcribe(media.data, media.filename, { prompt: TRANSCRIBE_VOCAB });

    // Relecture : la base a pu bouger pendant la minute de transcription.
    const fresh = readDB();
    const target = fresh.adFolders.find((f) => f.id === folderId)?.inspirations.find((i) => i.url === url);
    if (target) {
      target.transcript = text;
      target.transcribedAt = new Date().toISOString();
      target.language = language;
      writeDB(fresh);
    }

    return NextResponse.json({ transcript: text, language, cached: false, sizeMb: media.sizeMb });
  } catch (e) {
    const err = e as OpenAiError | MediaAudioError;
    const code = [401, 404, 413, 422].includes(err.code) ? err.code : 502;
    return NextResponse.json({ error: err.message }, { status: code });
  }
}
