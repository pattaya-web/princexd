import { NextRequest, NextResponse } from "next/server";
import { readDB, writeDB } from "@/lib/db";
import { elapsed, getJob, startJob } from "@/lib/bg-jobs";
import { OpenAiError, transcribe } from "@/lib/openai";
import { downloadAudio, toArrayBuffer } from "@/lib/ytdlp";
import { fetchCaptions, YoutubeError } from "@/lib/youtube";
import type { YtVideo } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const VOCAB = "Shopify, AliExpress, e-commerce, dropshipping, Meta Ads, ROAS, AI, ChatGPT, Claude, TikTok Shop, Amazon FBA";

const BLOCKED_HINT = "Depuis le serveur, YouTube refuse souvent l'accès (adresse de datacenter). Le plus sûr : sur YouTube, sous la vidéo, « …plus » → « Afficher la transcription », tout sélectionner, puis « Coller le transcript » ici.";

function saveTranscript(id: string, text: string, lang: string, source: YtVideo["transcriptSource"], durationSec?: number): YtVideo {
  const db = readDB();
  const v = db.ytVideos.find((x) => x.id === id);
  if (!v) throw new Error("Vidéo introuvable.");
  v.transcript = text.trim();
  v.transcriptLang = lang;
  v.transcriptSource = source;
  if (durationSec) v.durationSec = durationSec;
  v.updatedAt = new Date().toISOString();
  writeDB(db);
  return v;
}

/** Transcription audio en tâche de fond (yt-dlp + OpenAI) : trop long pour une requête derrière Cloudflare. */
async function runWhisper(v: YtVideo, setStep: (s: string) => void): Promise<{ video: YtVideo }> {
  setStep("Téléchargement de l'audio…");
  let audio: { data: Buffer; filename: string };
  try {
    audio = await downloadAudio(v.url);
  } catch (e) {
    throw new Error(`Audio impossible à récupérer : ${(e as Error).message} ${BLOCKED_HINT}`);
  }
  setStep("Transcription de l'audio (OpenAI)…");
  const { data, filename } = audio;
  const r = await transcribe(toArrayBuffer(data), filename, { model: "gpt-4o-transcribe", prompt: VOCAB }).catch(async (e) => {
    if (e instanceof OpenAiError && (e.code === 401 || e.code === 413)) throw e;
    return transcribe(toArrayBuffer(data), filename, { model: "whisper-1", prompt: VOCAB });
  });
  return { video: saveTranscript(v.id, r.text, r.language || "", "whisper") };
}

/**
 * Récupère le transcript.
 *  - sans option : sous-titres YouTube, réponse immédiate (ou erreur claire) ;
 *  - `{ text }` : transcript collé à la main, enregistré tel quel ;
 *  - `{ whisper: true }` : audio + OpenAI en tâche de fond → `{ jobId }`, à suivre avec `GET ?job=`.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { force?: boolean; whisper?: boolean; text?: string };
  const db = readDB();
  const v = db.ytVideos.find((x) => x.id === id);
  if (!v) return NextResponse.json({ error: "Vidéo introuvable." }, { status: 404 });

  if (typeof body.text === "string") {
    const text = body.text.trim();
    if (text.length < 40) return NextResponse.json({ error: "Transcript trop court : colle le texte complet." }, { status: 400 });
    return NextResponse.json({ video: saveTranscript(id, text.slice(0, 200_000), "", "manual") });
  }

  if (body.whisper) {
    return NextResponse.json({ jobId: startJob((setStep) => runWhisper(v, setStep)) }, { status: 202 });
  }

  if (v.transcript.trim() && !body.force) return NextResponse.json({ video: v, cached: true });

  try {
    const cap = await fetchCaptions(v.videoId);
    if (!cap) return NextResponse.json({ error: `Cette vidéo n'a aucun sous-titre lisible d'ici. ${BLOCKED_HINT}` }, { status: 422 });
    return NextResponse.json({ video: saveTranscript(id, cap.text, cap.language, "captions", cap.durationSec), auto: cap.auto });
  } catch (e) {
    const err = e as YoutubeError;
    return NextResponse.json({ error: `${err.message} ${BLOCKED_HINT}` }, { status: 502 });
  }
}

/** `?job=` : état de la transcription audio en cours. */
export async function GET(req: NextRequest) {
  const job = getJob<{ video: YtVideo }>(req.nextUrl.searchParams.get("job") ?? "");
  if (!job) return NextResponse.json({ error: "Tâche introuvable : relance." }, { status: 404 });
  if (job.status === "error") return NextResponse.json({ status: "error", error: job.error }, { status: 502 });
  return NextResponse.json({ status: job.status, step: job.step, elapsed: elapsed(job), ...(job.result ? { result: job.result } : {}) });
}
