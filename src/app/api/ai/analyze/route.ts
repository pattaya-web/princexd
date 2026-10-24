import { NextRequest, NextResponse } from "next/server";
import { askText, KieError, parseJsonLoose } from "@/lib/kie";
import { getSettings, readDB, writeDB } from "@/lib/db";
import { buildAnalyzePrompt, SYSTEM_ANALYST } from "@/lib/prompts";
import { SWIPE_FORMATS, SWIPE_STAGES, type SwipeAnalysis, type SwipeFormat, type SwipeStage } from "@/lib/types";
import { jobStatusResponse, respondAsJobBuffered } from "@/lib/bg-jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handlePost(req: NextRequest) {
  const { swipeId } = (await req.json()) as { swipeId: string };
  const db = readDB();
  const swipe = db.swipes.find((s) => s.id === swipeId);
  if (!swipe) return NextResponse.json({ error: "Swipe introuvable" }, { status: 404 });

  // Une legende Instagram n'est pas une transcription : sans les paroles, pas de classement.
  if (!swipe.transcriptInput?.trim()) {
    return NextResponse.json({ error: "Transcription nécessaire : importe la vidéo ou colle le texte des paroles, puis relance l'analyse." }, { status: 400 });
  }

  const prompt = buildAnalyzePrompt({
    url: swipe.url,
    platform: swipe.platform,
    author: swipe.author,
    caption: swipe.caption,
    transcript: swipe.transcriptInput,
    screenText: swipe.screenTextInput ?? "",
    brandContext: getSettings().brandContext,
  });

  try {
    const raw = await askText(prompt, SYSTEM_ANALYST, 12000);
    const analysis = parseJsonLoose<SwipeAnalysis>(raw);
    // Classement funnel : on ne garde que des valeurs connues, le reste est vide.
    const etape = String(analysis.etape ?? "").trim().toUpperCase();
    analysis.etape = (SWIPE_STAGES as string[]).includes(etape) ? (etape as SwipeStage) : undefined;
    const format = String(analysis.format ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    analysis.format = (SWIPE_FORMATS as readonly string[]).includes(format) ? (format as SwipeFormat) : "";
    analysis.speakers = String(analysis.speakers ?? "").toLowerCase().includes("dialog") ? "dialogue" : "solo";
    const confiance = Number(analysis.confiance);
    analysis.confiance = Number.isFinite(confiance) ? Math.min(100, Math.max(0, Math.round(confiance))) : 0;
    for (const k of ["justification", "emotion", "structure"] as const) analysis[k] = String(analysis[k] ?? "").trim().slice(0, 600);

    const fresh = readDB();
    const target = fresh.swipes.find((s) => s.id === swipeId);
    if (target) {
      target.analysis = analysis;
      target.status = "analyse";
      target.transcriptNeeded = false;
      if (!target.title && analysis.hook) target.title = analysis.hook.slice(0, 80);
      writeDB(fresh);
    }
    return NextResponse.json({ analysis });
  } catch (e) {
    const err = e as KieError;
    return NextResponse.json({ error: err.message }, { status: err.code === 401 ? 401 : 502 });
  }
}

/*
 * Avec l'en-tete `x-bg-job: 1` (option `job: true` de api()), la reponse est
 * produite en fond et rejouee au `GET ?job=` : le proxy ne coupe plus les
 * traitements longs. Sans l'en-tete, la route repond comme avant.
 */
export async function POST(req: NextRequest) {
  return respondAsJobBuffered(req, undefined, (r, c) => handlePost(r));
}

export async function GET(req: NextRequest) {
  return jobStatusResponse(req) ?? Response.json({ error: "Méthode non prise en charge." }, { status: 405 });
}
