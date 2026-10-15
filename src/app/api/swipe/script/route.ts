import { NextRequest, NextResponse } from "next/server";
import { getSettings, readDB, writeDB } from "@/lib/db";
import { askText, KieError, parseJsonLoose } from "@/lib/kie";
import { swipeStage, type SwipeScript } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SYSTEM = `Tu es un directeur de creation qui transforme une analyse de reel en script court pret a tourner face camera.
Tu ecris en francais parle, au tutoiement, sans jargon marketing et sans flatterie.
Tu reponds uniquement par un objet JSON valide, sans texte autour et sans bloc markdown.`;

/**
 * Le script court (onglet « Mon script ») : hook mot pour mot, corps en
 * bullets d'une ligne chacune avec le chiffre ou la raison, CTA mot pour
 * mot, textes ecran, duree cible. Pre-rempli depuis l'adaptation deja
 * produite par l'analyse ; le proprietaire corrige ensuite a la main.
 */
function buildPrompt(input: { stage: string; hook: string; script: string; cta: string; screen: string[]; format: string; brandContext: string }) {
  return `Contexte business : ${input.brandContext}

Etape du funnel visee : ${input.stage || "non precisee"} (TOFU = attirer des inconnus, MOFU = prouver la methode, BOFU = pousser vers l'appel).
Format conseille : ${input.format || "reel face camera"}.

ADAPTATION DEJA ECRITE (ma marque) :
Hook : ${input.hook || "(vide)"}
Script :
"""
${input.script || "(vide)"}
"""
CTA : ${input.cta || "(vide)"}
Textes ecran reperes sur l'original : ${input.screen.length ? input.screen.join(" | ") : "(aucun)"}

Transforme ca en script court a tourner, sans rien inventer qui contredise l'adaptation :
{
  "hook": "1 a 2 phrases, mot pour mot, telles que je les dis face camera",
  "bullets": ["une ligne par idee du corps, 12 mots max, avec LE chiffre ou LA raison, jamais une phrase redigee"],
  "cta": "1 phrase mot pour mot",
  "screenText": ["2 a 5 textes a incruster, 6 mots max chacun"],
  "durationSec": 30
}
Entre 3 et 7 bullets. durationSec entre 15 et 60, coherent avec la longueur du texte (environ 2,5 mots par seconde).`;
}

export async function POST(req: NextRequest) {
  const { swipeId } = (await req.json().catch(() => ({}))) as { swipeId?: string };
  const db = readDB();
  const swipe = swipeId ? db.swipes.find((s) => s.id === swipeId) : undefined;
  if (!swipe) return NextResponse.json({ error: "Swipe introuvable." }, { status: 404 });
  const a = swipe.analysis;
  if (!a) return NextResponse.json({ error: "Décortique d'abord ce contenu : le script court part de l'adaptation." }, { status: 400 });

  const prompt = buildPrompt({
    stage: swipeStage(swipe),
    hook: a.adaptation?.hook ?? a.hook ?? "",
    script: a.adaptation?.script ?? a.transcriptFr ?? "",
    cta: a.adaptation?.cta ?? a.cta ?? "",
    screen: a.onScreenText ?? [],
    format: a.formatRecommande ?? "",
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
