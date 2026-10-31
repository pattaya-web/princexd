import { NextRequest } from "next/server";
import { newId, readDB, writeDB } from "@/lib/db";
import { askText, parseJsonLoose } from "@/lib/kie";
import { Forbidden, readSession } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import seed from "@/lib/i18n/studio-en.json";
import type { Session } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Traduction de l'interface pour un membre Studio en anglais.
 *
 * Le navigateur (lib/dom-translate) traduit les textes affichés à partir d'un
 * dictionnaire français → anglais : le dictionnaire livré avec le code
 * (lib/i18n/studio-en.json), complété ici des textes encore inconnus, traduits
 * une fois par l'IA (clé KIE du compte, quelques centimes) puis gardés dans
 * `uiTranslations`. Les nombres y sont remplacés par {0}, {1}…
 */

const MAX_BATCH = 60;
const MAX_LEN = 600;
/** Borne du cache : le contenu tapé par le membre (ses prompts affichés) ne doit pas gonfler la base sans fin. */
const MAX_CACHE = 8000;

function allowed(session: Session) {
  if (session.isAdmin || (session.role === "studio" && session.lang === "en")) return;
  throw new Forbidden("Accès refusé.");
}

function dictionary(): Record<string, string> {
  const out: Record<string, string> = { ...(seed as Record<string, string>) };
  for (const t of readDB().uiTranslations) if (t.lang === "en") out[t.source] = t.text;
  return out;
}

export async function GET(req: NextRequest) {
  return handle((): { translations: Record<string, string> } => {
    allowed(readSession(req));
    return { translations: dictionary() };
  });
}

const SYSTEM = `You translate the French user interface of a web app (an AI studio that generates images and videos) into natural, concise English, the way a polished SaaS app would word it.
Rules:
- Keep placeholders like {0}, {1} exactly as they are, in the right place.
- Keep emojis, arrows, symbols, punctuation style, and line breaks.
- Never translate brand or model names: KIE, kie.ai, GPT Image, Nano Banana, Seedance, Seedream, Kling, Wan, Veo, Sora, Runway, Hailuo, ElevenLabs, OpenAI, Google, MPGate.
- Keep "Swap" as "Swap" (video swap = "Video swap"). "Création" as a tab name = "Create". "crédits" = "credits". Use "you" (informal "tu" → "you").
- If a string is already English, a name, or not translatable, return it unchanged.
The input is a JSON object { "0": "...", "1": "...", … }.
Answer with JSON only: {"t": { "0": "translation", "1": "translation", … }} with the same keys.`;

export async function POST(req: NextRequest) {
  return handle(async (): Promise<{ translations: Record<string, string> }> => {
    allowed(readSession(req));
    const body = (await req.json().catch(() => ({}))) as { texts?: unknown };
    const known = dictionary();
    const requested = [...new Set((Array.isArray(body.texts) ? body.texts : []).map((t) => String(t ?? "").trim()))]
      .filter((t) => t && t.length <= MAX_LEN)
      .slice(0, MAX_BATCH);
    // Déjà connus (un autre onglet vient de les demander) : rendus tels quels.
    const translations: Record<string, string> = {};
    for (const t of requested) if (known[t] !== undefined) translations[t] = known[t];
    const texts = requested.filter((t) => known[t] === undefined);
    if (!texts.length || readDB().uiTranslations.length >= MAX_CACHE) return { translations };

    const raw = await askText(JSON.stringify(Object.fromEntries(texts.map((t, i) => [String(i), t]))), SYSTEM, 8000);
    // Réponse indexée : un oubli du modèle ne fait perdre que ces textes-là (redemandés à l'affichage suivant).
    const out = (parseJsonLoose<{ t?: Record<string, unknown> }>(raw).t ?? {}) as Record<string, unknown>;

    texts.forEach((source, i) => {
      const value = out[String(i)];
      if (typeof value !== "string") return;
      const text = value.trim();
      // Un espace réservé perdu fausserait les nombres affichés : on garde alors le français.
      const holes = (s: string) => (s.match(/\{\d+\}/g) ?? []).sort().join();
      if (text && holes(text) === holes(source)) translations[source] = text;
    });

    // Relue après l'appel à l'IA : d'autres écritures ont pu passer entre-temps.
    const db = readDB();
    const have = new Set(db.uiTranslations.filter((t) => t.lang === "en").map((t) => t.source));
    for (const source of texts) {
      const text = translations[source];
      if (text !== undefined && !have.has(source)) db.uiTranslations.push({ id: newId(), lang: "en", source, text });
    }
    writeDB(db);
    return { translations };
  });
}
