import { getSettings } from "./db";

/**
 * Gemini (Google AI Studio) : transcription d'une vidéo YouTube par son URL.
 *
 * Depuis le VPS, YouTube refuse tout (« Sign in to confirm you're not a
 * bot ») : ni sous-titres, ni audio pour yt-dlp. Gemini, lui, lit la vidéo
 * directement chez Google à partir de l'URL publique : aucune adresse de
 * serveur en jeu. Clé gratuite sur aistudio.google.com, priorité à
 * GEMINI_API_KEY, sinon Réglages.
 */

export class GeminiError extends Error {
  code: number;
  constructor(message: string, code = 502) {
    super(message);
    this.code = code;
  }
}

export function geminiKey(): string {
  return process.env.GEMINI_API_KEY?.trim() || (getSettings().geminiApiKey ?? "").trim();
}

export const hasGemini = () => Boolean(geminiKey());

/** Modèles essayés dans l'ordre : le premier qui répond gagne (les noms bougent d'une saison à l'autre ; vérifié le 2026-10-25 : gemini-2.5-flash n'est plus ouvert aux nouveaux comptes, 3.8-flash recommandé). */
const MODELS = ["gemini-3.8-flash", "gemini-3.5-flash", "gemini-3-flash-preview", "gemini-2.5-flash", "gemini-2.0-flash"];

const PROMPT = `Transcribe this video's speech verbatim, in its original language. Keep every sentence, including hesitations that carry meaning; do not summarize, do not translate, do not add commentary or timestamps. If two people speak, prefix each line with "A:" or "B:". Group the text into short paragraphs (one idea per paragraph). Start your answer with one line "LANGUAGE: <two-letter code>" then an empty line, then the transcript only. If there is no speech at all, answer "LANGUAGE: none" and nothing else.`;

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

/**
 * La consigne, avec la fenêtre de temps quand on ne transcrit qu'un morceau.
 * Ceinture et bretelles : l'intervalle est aussi donné à l'API, mais sur une
 * URL YouTube Google a déjà laissé passer le son entier malgré l'intervalle ;
 * la consigne borne alors le modèle elle-même.
 */
function promptFor(span?: VideoSpan): string {
  if (!span) return PROMPT;
  return `${PROMPT}

IMPORTANT: transcribe ONLY the speech between ${mmss(span.startSec)} and ${mmss(span.endSec)} (minutes:seconds from the start of the video). Ignore everything said before or after this window, even if you can hear it. If there is no speech inside this window (for example the video ends before it), answer "LANGUAGE: none" and nothing else.`;
}

export interface GeminiTranscript {
  text: string;
  language: string;
  model: string;
  /** Vrai quand Gemini s'est arrêté faute de place (réponse coupée) : le texte n'est pas complet. */
  truncated: boolean;
}

/** Un morceau de vidéo, en secondes depuis le début. */
export interface VideoSpan {
  startSec: number;
  endSec: number;
}

/**
 * Transcription d'une vidéo YouTube publique, en entier ou sur un morceau
 * (`span`, pour les vidéos longues). Lève GeminiError avec un message lisible.
 */
export async function transcribeYoutubeWithGemini(videoUrl: string, span?: VideoSpan): Promise<GeminiTranscript> {
  const key = geminiKey();
  if (!key) throw new GeminiError("Aucune clé Gemini : ajoute-la dans Réglages → Transcription YouTube (gratuite sur aistudio.google.com).", 401);

  const videoPart: Record<string, unknown> = { file_data: { file_uri: videoUrl } };
  if (span) videoPart.video_metadata = { start_offset: `${Math.max(0, Math.floor(span.startSec))}s`, end_offset: `${Math.max(1, Math.floor(span.endSec))}s` };

  let lastError = "";
  for (const model of MODELS) {
    let res: Response;
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ parts: [videoPart, { text: promptFor(span) }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 65536 },
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(8 * 60_000),
      });
    } catch (e) {
      const name = (e as Error).name;
      lastError = name === "TimeoutError" || name === "AbortError" ? "Gemini n'a pas répondu en 8 minutes." : `Gemini injoignable : ${(e as Error).message}`;
      continue;
    }
    const raw = await res.text();
    if (!res.ok) {
      const msg = (() => {
        try {
          return (JSON.parse(raw) as { error?: { message?: string } }).error?.message ?? raw;
        } catch {
          return raw;
        }
      })().slice(0, 300);
      // Clé refusée : inutile d'essayer un autre modèle.
      if (res.status === 400 && /API key/i.test(msg)) throw new GeminiError(`Clé Gemini refusée : ${msg}`, 401);
      if (res.status === 403) throw new GeminiError(`Gemini refuse la clé (${msg}).`, 401);
      lastError = `${model} → HTTP ${res.status} : ${msg}`;
      // Modèle inconnu ou indisponible : on passe au suivant ; quota ou vidéo : on arrête.
      if (res.status === 404 || res.status === 503) continue;
      throw new GeminiError(`Gemini : ${msg}`, 502);
    }
    let json: { candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]; promptFeedback?: { blockReason?: string } };
    try {
      json = JSON.parse(raw) as typeof json;
    } catch {
      lastError = `${model} → réponse illisible`;
      continue;
    }
    if (json.promptFeedback?.blockReason) throw new GeminiError(`Gemini a refusé la vidéo (${json.promptFeedback.blockReason}).`, 422);
    const text = (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
    if (!text) {
      lastError = `${model} → réponse vide (${json.candidates?.[0]?.finishReason ?? "?"})`;
      continue;
    }
    const m = text.match(/^LANGUAGE:\s*([a-z]{2,5}|none)\s*\n?/i);
    const language = m ? m[1].toLowerCase() : "";
    const body = (m ? text.slice(m[0].length) : text).trim();
    if (language === "none" || !body) throw new GeminiError("Gemini n'a trouvé aucune parole dans cette vidéo.", 422);
    return { text: body, language: language === "none" ? "" : language, model, truncated: json.candidates?.[0]?.finishReason === "MAX_TOKENS" };
  }
  throw new GeminiError(`Transcription Gemini impossible : ${lastError || "aucun modèle n'a répondu"}.`, 502);
}

/* ------------------------------ Vidéos longues ------------------------------ */

/** Longueur d'un morceau : 20 minutes, loin de la limite de sortie de Gemini et de son délai de réponse. */
const CHUNK_SEC = 20 * 60;
/** Une vidéo d'au plus 25 minutes se tente d'un bloc. */
const SINGLE_MAX_SEC = 25 * 60;
/** Morceaux transcrits en même temps. */
const PARALLEL = 3;
/** 15 × 20 min = 5 h : au-delà, on s'arrête. */
const MAX_CHUNKS = 15;

/** Un morceau, et s'il revient coupé, ses deux moitiés (une fois). */
async function transcribeSpan(videoUrl: string, span: VideoSpan): Promise<GeminiTranscript> {
  const r = await transcribeYoutubeWithGemini(videoUrl, span);
  if (!r.truncated || span.endSec - span.startSec < 300) return r;
  const mid = Math.floor((span.startSec + span.endSec) / 2);
  const a = await transcribeYoutubeWithGemini(videoUrl, { startSec: span.startSec, endSec: mid });
  const b = await transcribeYoutubeWithGemini(videoUrl, { startSec: mid, endSec: span.endSec });
  return { text: `${a.text}\n\n${b.text}`.trim(), language: a.language || b.language, model: a.model, truncated: a.truncated || b.truncated };
}

/**
 * Le transcript COMPLET d'une vidéo, quelle que soit sa longueur.
 *
 * Courte (≤ 25 min) ou durée inconnue : un seul appel ; s'il revient coupé,
 * on repart en morceaux. Longue : morceaux de 20 minutes, trois à la fois,
 * recollés dans l'ordre. Durée inconnue (YouTube bloque le serveur) : on
 * avance par morceaux de 20 minutes jusqu'à tomber sur du silence, c'est la
 * fin de la vidéo.
 */
export async function transcribeYoutubeFull(videoUrl: string, durationSec: number, setStep: (s: string) => void = () => {}): Promise<GeminiTranscript> {
  let known = Math.max(0, Math.floor(durationSec || 0));
  if (!known || known <= SINGLE_MAX_SEC) {
    setStep(known ? `Transcription de la vidéo par Gemini (${Math.round(known / 60)} min de vidéo, 1 à 3 min)…` : "Transcription de la vidéo par Gemini (1 à 3 min)…");
    const whole = await transcribeYoutubeWithGemini(videoUrl);
    if (!whole.truncated) return whole;
    // Coupé : la vidéo est plus longue que prévu, on repart en morceaux.
    if (known) known = 0;
  }

  const chunks: VideoSpan[] = [];
  if (known) {
    const n = Math.min(MAX_CHUNKS, Math.ceil(known / CHUNK_SEC));
    const len = Math.ceil(known / n);
    for (let i = 0; i < n; i++) chunks.push({ startSec: i * len, endSec: Math.min(known, (i + 1) * len) });
  } else {
    for (let i = 0; i < MAX_CHUNKS; i++) chunks.push({ startSec: i * CHUNK_SEC, endSec: (i + 1) * CHUNK_SEC });
  }

  const parts: (GeminiTranscript | null)[] = chunks.map(() => null);
  let ended = false;
  for (let i = 0; i < chunks.length && !ended; i += PARALLEL) {
    const batch = chunks.slice(i, i + PARALLEL).map((span, k) => ({ span, idx: i + k }));
    const last = Math.min(i + PARALLEL, chunks.length);
    setStep(`Transcription par Gemini : partie${last > i + 1 ? "s" : ""} ${i + 1}${last > i + 1 ? ` à ${last}` : ""}${known ? ` sur ${chunks.length}` : ""} (20 min chacune)…`);
    const results = await Promise.all(
      batch.map(async ({ span }) => {
        try {
          return await transcribeSpan(videoUrl, span);
        } catch (e) {
          // Durée inconnue : un morceau au-delà de la fin n'a pas de parole (ou Gemini le refuse) → c'est la fin.
          const err = e as GeminiError;
          if (!known && err.code !== 401 && parts.some(Boolean)) return null;
          throw e;
        }
      }),
    );
    results.forEach((r, k) => {
      parts[batch[k].idx] = r;
    });
    if (!known && results.some((r) => r === null)) ended = true;
  }

  const done = parts.filter((p): p is GeminiTranscript => Boolean(p));
  if (!done.length) throw new GeminiError("Gemini n'a trouvé aucune parole dans cette vidéo.", 422);
  // Deux parties qui commencent par le même texte : l'intervalle n'a pas été respecté, on ne garde que la première.
  const head = (t: string) => t.toLowerCase().replace(/[^a-z0-9àâçéèêëîïôûùüÿœ]+/g, " ").trim().slice(0, 240);
  for (let i = done.length - 1; i > 0; i--) {
    if (head(done[i].text) && head(done[i].text) === head(done[i - 1].text)) {
      console.warn(`[gemini] partie ${i + 1} identique à la partie ${i} : doublon retiré`);
      done.splice(i, 1);
    }
  }
  return {
    text: done.map((p) => p.text.trim()).filter(Boolean).join("\n\n"),
    language: done.find((p) => p.language)?.language ?? "",
    model: done[0].model,
    truncated: done.some((p) => p.truncated),
  };
}
