import { NextRequest, NextResponse } from "next/server";
import { elapsed, getJob, startJob } from "@/lib/bg-jobs";
import { formatTranscript } from "@/lib/format";
import { askText } from "@/lib/kie";
import { readForTranscription } from "@/lib/media-audio";
import { OpenAiError, transcribe } from "@/lib/openai";

export const dynamic = "force-dynamic";

/** Lexique passe au modele : une LISTE, jamais une phrase (voir lib/openai). */
const VOCAB =
  "Shopify, AliExpress, e-commerce, dropshipping, Meta Ads, TikTok, Instagram, tunnel, ROAS, IA, ChatGPT, Claude, coaching, closer, setter";

/** Le plus precis chez OpenAI ; whisper-1 en secours (audios tres longs). */
const PRECISE_MODEL = "gpt-4o-transcribe";
const FALLBACK_MODEL = "whisper-1";

const TRANSLATE_SYSTEM = `Tu traduis la transcription d'une vidéo vers le français.
Tu restitues exactement ce qui est dit, phrase par phrase, dans le même ordre, sans résumer, sans commenter et sans ajouter de titre.
Tu gardes le ton parlé et la ponctuation orale. Les noms de marques, d'outils et les chiffres restent tels quels.
Si un passage est déjà en français, tu le renvoies tel quel.
Tu ne réponds QUE par la traduction.`;

/** Au-dela, on decoupe : un modele traduit mal (et lentement) un pave de 20 minutes d'un coup. */
const TRANSLATE_CHUNK = 6000;

interface TranscriptResult {
  text: string;
  language: "fr" | "en" | "autre";
  model: string;
  sizeMb: number;
}

/**
 * Langue probable, sur les mots-outils : OpenAI ne renvoie pas la langue avec
 * gpt-4o-transcribe. Il ne s'agit que de proposer le bon bouton.
 */
function guessLanguage(text: string): TranscriptResult["language"] {
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  const FR = new Set(["le", "la", "les", "et", "est", "pas", "je", "une", "des", "que", "vous", "pour", "dans", "c'est", "ça", "on"]);
  const EN = new Set(["the", "and", "you", "is", "that", "it", "to", "of", "this", "with", "are", "for", "your", "what", "have"]);
  let fr = 0;
  let en = 0;
  for (const w of words) {
    if (FR.has(w)) fr++;
    if (EN.has(w)) en++;
  }
  if (fr === 0 && en === 0) return "autre";
  if (fr >= en * 1.5) return "fr";
  if (en >= fr * 1.5) return "en";
  return "autre";
}

/** Decoupe sur les paragraphes, puis les phrases, sans jamais couper un mot. */
function chunks(text: string): string[] {
  const out: string[] = [];
  let current = "";
  for (const para of text.split(/\n{2,}/)) {
    if ((current + "\n\n" + para).length <= TRANSLATE_CHUNK) {
      current = current ? `${current}\n\n${para}` : para;
      continue;
    }
    if (current) out.push(current);
    current = "";
    if (para.length <= TRANSLATE_CHUNK) {
      current = para;
      continue;
    }
    for (const sentence of para.match(/[^.!?]+[.!?]*\s*/g) ?? [para]) {
      if ((current + sentence).length > TRANSLATE_CHUNK && current) {
        out.push(current);
        current = "";
      }
      current += sentence;
    }
  }
  if (current.trim()) out.push(current);
  return out;
}

async function runTranscribe(url: string, setStep: (s: string) => void): Promise<TranscriptResult> {
  setStep("Lecture de la vidéo et extraction de la piste audio…");
  const { data, filename, sizeMb } = await readForTranscription(url);

  setStep(`Transcription (${PRECISE_MODEL}), ${sizeMb} Mo d'audio…`);
  let model = PRECISE_MODEL;
  let text: string;
  try {
    text = (await transcribe(data, filename, { model, prompt: VOCAB })).text;
  } catch (e) {
    const err = e as OpenAiError;
    // Cle refusee, fichier trop lourd ou aucune parole : whisper ne fera pas mieux.
    if ([401, 413, 422].includes(err.code)) throw err;
    setStep(`Le modèle précis a refusé (${err.message.slice(0, 80)}). Nouvel essai avec ${FALLBACK_MODEL}…`);
    model = FALLBACK_MODEL;
    text = (await transcribe(data, filename, { model, prompt: VOCAB })).text;
  }
  return { text: formatTranscript(text), language: guessLanguage(text), model, sizeMb };
}

async function runTranslate(text: string, setStep: (s: string) => void): Promise<{ text: string }> {
  const parts = chunks(text);
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    setStep(parts.length > 1 ? `Traduction, partie ${i + 1} sur ${parts.length}…` : "Traduction en français…");
    const translated = await askText(`Traduis ce passage en français :\n\n${parts[i]}`, TRANSLATE_SYSTEM, 8000);
    out.push(formatTranscript(translated));
  }
  return { text: out.join("\n\n") };
}

/**
 * Transcript complet d'une video deposee, et sa traduction.
 *
 * Tout tourne en tache de fond (POST -> jobId, GET -> etat) : une video de
 * dix minutes prend plus d'une minute a transcrire, et Cloudflare coupe a 100 s.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { action?: string; url?: string; text?: string };

  if (body.action === "translate") {
    const text = typeof body.text === "string" ? body.text.trim() : Array.isArray(body.text) ? body.text.join("\n").trim() : "";
    if (!text) return NextResponse.json({ error: "Aucun texte à traduire." }, { status: 400 });
    return NextResponse.json({ jobId: startJob((setStep) => runTranslate(text, setStep)) }, { status: 202 });
  }

  const url = (body.url ?? "").trim();
  if (!/^\/api\/media\/[A-Za-z0-9]+\.[A-Za-z0-9]+$/.test(url)) {
    return NextResponse.json({ error: "Dépose d'abord une vidéo." }, { status: 400 });
  }
  return NextResponse.json({ jobId: startJob((setStep) => runTranscribe(url, setStep)) }, { status: 202 });
}

export async function GET(req: NextRequest) {
  const job = getJob<TranscriptResult | { text: string }>(req.nextUrl.searchParams.get("job") ?? "");
  if (!job) return NextResponse.json({ error: "Tâche introuvable : relance." }, { status: 404 });
  if (job.status === "error") return NextResponse.json({ status: "error", error: job.error }, { status: 502 });
  return NextResponse.json({ status: job.status, step: job.step, elapsed: elapsed(job), ...(job.result ? { result: job.result } : {}) });
}
