import { NextRequest, NextResponse } from "next/server";
import { readDB, writeDB } from "@/lib/db";
import { OpenAiError, transcribe } from "@/lib/openai";
import { downloadAudio, toArrayBuffer } from "@/lib/ytdlp";
import { fetchCaptions, YoutubeError } from "@/lib/youtube";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const VOCAB = "Shopify, AliExpress, e-commerce, dropshipping, Meta Ads, ROAS, AI, ChatGPT, Claude, TikTok Shop, Amazon FBA";

/**
 * Récupère le transcript : sous-titres YouTube d'abord (gratuit, quelques
 * secondes), sinon audio + whisper (`{ whisper: true }` force ce chemin).
 * `{ force: true }` recommence même si un transcript existe déjà.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { force?: boolean; whisper?: boolean };
  const db = readDB();
  const v = db.ytVideos.find((x) => x.id === id);
  if (!v) return NextResponse.json({ error: "Vidéo introuvable." }, { status: 404 });
  if (v.transcript.trim() && !body.force && !body.whisper) return NextResponse.json({ video: v, cached: true });

  let note = "";
  if (!body.whisper) {
    try {
      const cap = await fetchCaptions(v.videoId);
      if (cap) {
        v.transcript = cap.text;
        v.transcriptLang = cap.language;
        v.transcriptSource = "captions";
        if (cap.durationSec) v.durationSec = cap.durationSec;
        v.updatedAt = new Date().toISOString();
        writeDB(db);
        return NextResponse.json({ video: v, auto: cap.auto });
      }
      note = "Cette vidéo n'a aucun sous-titre YouTube : transcription de l'audio…";
    } catch (e) {
      note = `${(e as YoutubeError).message} Transcription de l'audio…`;
    }
  }

  // Repli : audio via yt-dlp, texte via OpenAI.
  try {
    const { data, filename } = await downloadAudio(v.url);
    const r = await transcribe(toArrayBuffer(data), filename, { model: "gpt-4o-transcribe", prompt: VOCAB }).catch(async (e) => {
      if (e instanceof OpenAiError && (e.code === 401 || e.code === 413)) throw e;
      return transcribe(toArrayBuffer(data), filename, { model: "whisper-1", prompt: VOCAB });
    });
    v.transcript = r.text;
    v.transcriptLang = r.language || "";
    v.transcriptSource = "whisper";
    v.updatedAt = new Date().toISOString();
    writeDB(db);
    return NextResponse.json({ video: v, note });
  } catch (e) {
    const err = e as Error & { status?: number };
    return NextResponse.json({ error: `${note ? `${note} ` : ""}${err.message}` }, { status: err.status && err.status >= 400 ? err.status : 502 });
  }
}
