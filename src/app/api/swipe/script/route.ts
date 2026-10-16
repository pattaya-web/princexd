import { NextRequest, NextResponse } from "next/server";
import { getSettings, readDB, writeDB } from "@/lib/db";
import { askText, KieError, parseJsonLoose } from "@/lib/kie";
import type { SwipeScript } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SYSTEM = `Tu mets en forme le script d'une video pour qu'il soit facile a lire et a tourner tel quel, en francais.
Tu ne reecris RIEN : pas de reformulation, pas d'adaptation, pas de resume, pas de mot ajoute ni retire (seulement la ponctuation, les hesitations et les repetitions parasites). Un script dans une autre langue est traduit fidelement, c'est la seule transformation permise.
Tu reponds uniquement par un objet JSON valide, sans texte autour et sans bloc markdown.`;

/**
 * Le script a tourner, c'est celui de la video d'origine : le user reprend le
 * contenu des autres parce que c'est leur hook qui a marche. On ne genere
 * donc rien, on met en forme : hook mot pour mot, corps ligne par ligne
 * (une idee par ligne, dans les mots de la video), CTA mot pour mot, et on
 * dit si une ou deux personnes parlent.
 */
function buildPrompt(input: { transcript: string; hook: string; cta: string; screen: string[]; speakers: string; brandContext: string }) {
  return `SCRIPT DE LA VIDEO (en francais, deja nettoye) :
"""
${input.transcript || "(vide)"}
"""
Hook repere par l'analyse : ${input.hook || "(non repere)"}
CTA repere par l'analyse : ${input.cta || "(non repere)"}
Textes a l'ecran reperes : ${input.screen.length ? input.screen.join(" | ") : "(aucun)"}
Nombre de personnes qui parlent d'apres l'analyse : ${input.speakers || "inconnu"}

Mets ce script en forme, sans changer les mots :
{
  "hook": "les 1 a 2 premieres phrases de la video, mot pour mot",
  "bullets": ["le reste du corps, dans l'ordre, UNE idee ou UNE phrase par ligne, 15 mots max par ligne, les mots de la video"],
  "cta": "la derniere phrase d'appel a l'action, mot pour mot ('' si la video n'en a pas)",
  "screenText": ["les textes a l'ecran, tels quels, 6 max"],
  "durationSec": 30,
  "speakers": "solo | dialogue"
}
Regles :
- Si le script n'est pas en francais, traduis-le en francais parle et naturel, fidele phrase a phrase (rien d'ajoute, rien de retire) : le script a tourner est toujours en francais.
- hook + bullets + cta = tout le script, rien de plus, rien de moins (le hook et le CTA ne sont pas repetes dans bullets).
- Si deux personnes se parlent : speakers = "dialogue", et chaque ligne de bullets commence par "A :" ou "B :" (le hook et le CTA aussi si ce sont des repliques).
- durationSec = duree de lecture a voix haute, environ 2,5 mots par seconde, entre 10 et 90.`;
}

export async function POST(req: NextRequest) {
  const { swipeId } = (await req.json().catch(() => ({}))) as { swipeId?: string };
  const db = readDB();
  const swipe = swipeId ? db.swipes.find((s) => s.id === swipeId) : undefined;
  if (!swipe) return NextResponse.json({ error: "Swipe introuvable." }, { status: 404 });
  const a = swipe.analysis;
  const transcript = (a?.transcriptFr || a?.transcriptOriginal || swipe.transcriptInput || "").trim();
  if (!transcript) return NextResponse.json({ error: "Il faut la transcription de la vidéo : colle-la (ou transcris-la) dans l'onglet Source, puis décortique." }, { status: 400 });

  const prompt = buildPrompt({
    transcript,
    hook: a?.hook ?? "",
    cta: a?.cta ?? "",
    screen: a?.onScreenText ?? [],
    speakers: a?.speakers === "dialogue" ? "deux personnes qui se parlent" : a?.speakers === "solo" ? "une seule personne" : "",
    brandContext: getSettings().brandContext,
  });

  try {
    const raw = await askText(prompt, SYSTEM, 4000);
    const out = parseJsonLoose<Partial<SwipeScript>>(raw);
    const clean = (v: unknown, max: number) =>
      (Array.isArray(v) ? v : [])
        .map((x) => String(x ?? "").trim())
        .filter(Boolean)
        .slice(0, max);
    const now = new Date().toISOString();
    const dur = Number(out.durationSec);
    const script: SwipeScript = {
      hook: String(out.hook ?? "").trim(),
      bullets: clean(out.bullets, 8),
      cta: String(out.cta ?? "").trim(),
      screenText: clean(out.screenText, 6),
      durationSec: Number.isFinite(dur) ? Math.min(90, Math.max(10, Math.round(dur))) : 30,
      speakers: String(out.speakers ?? a?.speakers ?? "").toLowerCase().includes("dialog") ? "dialogue" : "solo",
      generatedAt: now,
      updatedAt: now,
    };
    if (!script.hook && !script.bullets.length) throw new KieError("Le modèle n'a rien rendu d'exploitable, réessaie.", 502);

    const fresh = readDB();
    const target = fresh.swipes.find((s) => s.id === swipe.id);
    if (target) {
      target.script = script;
      // « Scripte » automatique des que le script existe, sans faire reculer un swipe plus avance.
      if (!target.prodStatus || target.prodStatus === "source") {
        target.prodStatus = "scripte";
        target.prodDates = { ...(target.prodDates ?? {}), source: target.prodDates?.source ?? target.createdAt, scripte: now };
      }
      writeDB(fresh);
    }
    return NextResponse.json({ script, prodStatus: target?.prodStatus ?? "scripte", prodDates: target?.prodDates ?? {} });
  } catch (e) {
    const err = e as KieError;
    return NextResponse.json({ error: err.message }, { status: err.code === 401 ? 401 : 502 });
  }
}
