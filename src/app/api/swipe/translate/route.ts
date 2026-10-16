import { NextRequest, NextResponse } from "next/server";
import { readDB, writeDB } from "@/lib/db";
import { askText, KieError, parseJsonLoose } from "@/lib/kie";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SYSTEM = `Tu traduis des scripts de videos (reels, TikTok) vers le francais parle, naturel, tel qu'on le dirait face camera.
Fidele au sens et a la structure : rien d'ajoute, rien de retire, rien de resume. Les chiffres, les noms de marques et d'outils restent tels quels.
Tu reponds uniquement par un objet JSON valide, sans texte autour et sans bloc markdown.`;

/**
 * Traduction du script colle (contenu US, etc.) en francais parle. Le user
 * reprend le contenu des autres : la traduction doit rester collee au texte,
 * juste rendue naturelle en francais, et mise en forme pour etre lue (une
 * idee par ligne, A : / B : si deux personnes se parlent). L'original est
 * conserve sur le swipe pour pouvoir y revenir.
 */
export async function POST(req: NextRequest) {
  const { swipeId, text } = (await req.json().catch(() => ({}))) as { swipeId?: string; text?: string };
  const source = (text ?? "").trim();
  if (!source) return NextResponse.json({ error: "Rien à traduire : colle d'abord le script." }, { status: 400 });

  const prompt = `SCRIPT A TRADUIRE :
"""
${source}
"""

Rends :
{
  "language": "code de la langue detectee, ex. en",
  "fr": "la traduction francaise complete, parlee et naturelle, fidele phrase a phrase. Une idee par ligne, une ligne vide entre les blocs (accroche, corps, fin). Si deux personnes se parlent, chaque replique commence par 'A :' ou 'B :'.",
  "speakers": "solo | dialogue"
}
Si le texte est deja en francais, "fr" = le texte nettoye (ponctuation, hesitations) avec la meme mise en forme, sans changer les mots.`;

  try {
    const raw = await askText(prompt, SYSTEM, 8000);
    const out = parseJsonLoose<{ language?: string; fr?: string; speakers?: string }>(raw);
    const fr = String(out.fr ?? "").trim();
    if (!fr) throw new KieError("Le modèle n'a rien rendu, réessaie.", 502);
    const language = String(out.language ?? "").trim().toLowerCase().slice(0, 5);
    const speakers = String(out.speakers ?? "").toLowerCase().includes("dialog") ? "dialogue" : "solo";

    if (swipeId) {
      const db = readDB();
      const swipe = db.swipes.find((s) => s.id === swipeId);
      if (swipe) {
        // L'original n'est garde qu'une fois : retraduire un texte deja traduit ne doit pas l'ecraser.
        if (!swipe.transcriptSourceInput && swipe.transcriptInput.trim() && swipe.transcriptInput.trim() !== fr) swipe.transcriptSourceInput = swipe.transcriptInput;
        if (!swipe.transcriptSourceInput && source !== fr) swipe.transcriptSourceInput = source;
        swipe.transcriptInput = fr;
        swipe.transcriptLang = language;
        writeDB(db);
      }
    }
    return NextResponse.json({ fr, language, speakers });
  } catch (e) {
    const err = e as KieError;
    return NextResponse.json({ error: err.message }, { status: err.code === 401 ? 401 : 502 });
  }
}
