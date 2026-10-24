import { NextRequest, NextResponse } from "next/server";
import { readDB, writeDB } from "@/lib/db";
import { jobStatusResponse, startJob } from "@/lib/bg-jobs";
import { GeminiError, hasGemini, transcribeYoutubeWithGemini } from "@/lib/gemini";
import { OpenAiError, transcribe } from "@/lib/openai";
import { downloadAudio, toArrayBuffer } from "@/lib/ytdlp";
import { fetchCaptions, YoutubeError } from "@/lib/youtube";
import type { YtVideo } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const VOCAB = "Shopify, AliExpress, e-commerce, dropshipping, Meta Ads, ROAS, AI, ChatGPT, Claude, TikTok Shop, Amazon FBA";

const PASTE_HINT = "Le plus sûr : sur YouTube, sous la vidéo, « …plus » → « Afficher la transcription », tout sélectionner, puis « Coller le transcript » ici.";
const GEMINI_HINT = "Pour que ça marche tout seul : ajoute une clé Gemini (gratuite, aistudio.google.com) dans Réglages → Transcription YouTube.";

export interface TranscriptResult {
  video: YtVideo;
  /** D'où vient le texte : sous-titres (automatiques ou non), Gemini, audio + OpenAI. */
  source: "captions" | "gemini" | "whisper";
  auto?: boolean;
}

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

/** Gemini lit la vidéo chez Google : la seule voie qui ne dépend pas de l'adresse du serveur. */
async function viaGemini(v: YtVideo, setStep: (s: string) => void): Promise<TranscriptResult> {
  setStep("Transcription de la vidéo par Gemini (1 à 3 min)…");
  const r = await transcribeYoutubeWithGemini(v.url);
  console.log(`[youtube/transcript] gemini ok (${r.model}, ${r.text.length} car.) ${v.videoId}`);
  return { video: saveTranscript(v.id, r.text, r.language, "gemini"), source: "gemini" };
}

/**
 * Sous-titres YouTube d'abord (quelques secondes quand YouTube laisse passer
 * le serveur), sinon Gemini. Depuis un datacenter, YouTube répond presque
 * toujours « Sign in to confirm you're not a bot » : Gemini est en pratique
 * la voie normale, les sous-titres un raccourci quand ils passent.
 */
async function runAuto(v: YtVideo, setStep: (s: string) => void): Promise<TranscriptResult> {
  setStep("Sous-titres YouTube…");
  let blocked = "";
  try {
    const cap = await fetchCaptions(v.videoId);
    if (cap) {
      console.log(`[youtube/transcript] sous-titres ok (${cap.language}${cap.auto ? ", auto" : ""}) ${v.videoId}`);
      return { video: saveTranscript(v.id, cap.text, cap.language, "captions", cap.durationSec), source: "captions", auto: cap.auto };
    }
    blocked = "Cette vidéo n'a aucun sous-titre lisible depuis le serveur.";
  } catch (e) {
    blocked = (e as YoutubeError).message;
  }
  console.warn(`[youtube/transcript] sous-titres impossibles ${v.videoId} : ${blocked}`);
  if (!hasGemini()) throw new Error(`${blocked} ${GEMINI_HINT} ${PASTE_HINT}`);
  try {
    return await viaGemini(v, setStep);
  } catch (e) {
    const err = e as GeminiError;
    console.warn(`[youtube/transcript] gemini échec ${v.videoId} : ${err.message}`);
    throw new Error(`${err.message} ${PASTE_HINT}`);
  }
}

/** Audio + OpenAI (yt-dlp), avec Gemini en secours si YouTube bloque le téléchargement. */
async function runWhisper(v: YtVideo, setStep: (s: string) => void): Promise<TranscriptResult> {
  setStep("Téléchargement de l'audio…");
  let audio: { data: Buffer; filename: string };
  try {
    audio = await downloadAudio(v.url);
  } catch (e) {
    const why = (e as Error).message;
    console.warn(`[youtube/transcript] audio impossible ${v.videoId} : ${why}`);
    if (hasGemini()) {
      try {
        return await viaGemini(v, setStep);
      } catch (ge) {
        throw new Error(`${(ge as Error).message} ${PASTE_HINT}`);
      }
    }
    throw new Error(`Audio impossible à récupérer : ${why} ${GEMINI_HINT} ${PASTE_HINT}`);
  }
  setStep("Transcription de l'audio (OpenAI)…");
  const { data, filename } = audio;
  const r = await transcribe(toArrayBuffer(data), filename, { model: "gpt-4o-transcribe", prompt: VOCAB }).catch(async (e) => {
    if (e instanceof OpenAiError && (e.code === 401 || e.code === 413)) throw e;
    return transcribe(toArrayBuffer(data), filename, { model: "whisper-1", prompt: VOCAB });
  });
  return { video: saveTranscript(v.id, r.text, r.language || "", "whisper"), source: "whisper" };
}

/**
 * Récupère le transcript.
 *  - sans option : tâche de fond → `{ jobId }` (sous-titres, sinon Gemini), à suivre avec `GET ?job=` ;
 *  - `{ text }` : transcript collé à la main, enregistré tel quel ;
 *  - `{ whisper: true }` : audio + OpenAI en tâche de fond (Gemini en secours) → `{ jobId }`.
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

  if (body.whisper) return NextResponse.json({ jobId: startJob((setStep) => runWhisper(v, setStep)) }, { status: 202 });

  if (v.transcript.trim() && !body.force) return NextResponse.json({ video: v, cached: true });
  return NextResponse.json({ jobId: startJob((setStep) => runAuto(v, setStep)) }, { status: 202 });
}

/** `?job=` : état de la tâche en cours (sous-titres / Gemini / audio). */
export async function GET(req: NextRequest) {
  return jobStatusResponse(req) ?? NextResponse.json({ error: "Précise ?job=." }, { status: 400 });
}
