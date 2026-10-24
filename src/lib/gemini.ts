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

/** Modèles essayés dans l'ordre : le premier qui répond gagne (les noms bougent d'une saison à l'autre). */
const MODELS = ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"];

const PROMPT = `Transcribe this video's speech verbatim, in its original language. Keep every sentence, including hesitations that carry meaning; do not summarize, do not translate, do not add commentary or timestamps. If two people speak, prefix each line with "A:" or "B:". Group the text into short paragraphs (one idea per paragraph). Start your answer with one line "LANGUAGE: <two-letter code>" then an empty line, then the transcript only. If there is no speech at all, answer "LANGUAGE: none" and nothing else.`;

export interface GeminiTranscript {
  text: string;
  language: string;
  model: string;
}

/** Transcription d'une vidéo YouTube publique. Lève GeminiError avec un message lisible. */
export async function transcribeYoutubeWithGemini(videoUrl: string): Promise<GeminiTranscript> {
  const key = geminiKey();
  if (!key) throw new GeminiError("Aucune clé Gemini : ajoute-la dans Réglages → Transcription YouTube (gratuite sur aistudio.google.com).", 401);

  let lastError = "";
  for (const model of MODELS) {
    let res: Response;
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ parts: [{ file_data: { file_uri: videoUrl } }, { text: PROMPT }] }],
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
    return { text: body, language: language === "none" ? "" : language, model };
  }
  throw new GeminiError(`Transcription Gemini impossible : ${lastError || "aucun modèle n'a répondu"}.`, 502);
}
