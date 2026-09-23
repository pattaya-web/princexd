import { NextRequest, NextResponse } from "next/server";
import { readDB, writeDB } from "@/lib/db";
import { MAX_UPLOAD_BYTES, OpenAiError, transcribe } from "@/lib/openai";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Lexique metier passe au modele. Une LISTE, jamais une phrase :
    une phrase est recrachee telle quelle sur un audio sans parole. */
const TRANSCRIBE_VOCAB =
  "Shopify, AliExpress, e-commerce, dropshipping, Meta Ads, tunnel, ROAS, IA, ChatGPT, Claude, coaching";

/** Formats acceptés par l'API OpenAI de transcription. */
const ACCEPTED = /\.(mp3|mp4|mpeg|mpga|m4a|wav|webm|mov)$/i;

/**
 * Transcription d'un fichier déposé à la main.
 *
 * Indispensable pour le swipe : Meta ne renvoie pas le fichier vidéo des reels
 * qui ne t'appartiennent pas (vérifié sur plusieurs comptes publics), donc la
 * seule voie pour transcrire le contenu d'un concurrent est de fournir la
 * vidéo soi-même.
 *
 * `swipeId` est optionnel : s'il est fourni, la transcription est enregistrée
 * sur ce swipe et devient exploitable par l'analyse.
 */
export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Requête illisible : envoie un fichier." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Aucun fichier reçu." }, { status: 400 });
  }

  if (!ACCEPTED.test(file.name)) {
    return NextResponse.json(
      { error: "Format non supporté. Accepté : mp4, mov, m4a, mp3, wav, webm." },
      { status: 415 },
    );
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      {
        error: `Fichier de ${(file.size / 1024 / 1024).toFixed(1)} Mo : la limite OpenAI est de 25 Mo. Découpe la vidéo ou extrais l'audio.`,
      },
      { status: 413 },
    );
  }

  try {
    const data = await file.arrayBuffer();
    const { text, language } = await transcribe(data, file.name, {
      prompt: TRANSCRIBE_VOCAB,
    });

    const swipeId = form.get("swipeId");
    if (typeof swipeId === "string" && swipeId) {
      const db = readDB();
      const swipe = db.swipes.find((s) => s.id === swipeId);
      if (swipe) {
        swipe.transcriptInput = text;
        writeDB(db);
      }
    }

    return NextResponse.json({
      transcript: text,
      language,
      sizeMb: Number((file.size / 1024 / 1024).toFixed(2)),
    });
  } catch (e) {
    const err = e as OpenAiError;
    return NextResponse.json({ error: err.message }, { status: err.code === 401 ? 401 : 502 });
  }
}
