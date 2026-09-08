import { NextRequest, NextResponse } from "next/server";
import { askText, KieError, parseJsonLoose } from "@/lib/kie";
import { getSettings, readDB, writeDB } from "@/lib/db";
import { buildAnalyzePrompt, SYSTEM_ANALYST } from "@/lib/prompts";
import type { SwipeAnalysis } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const { swipeId } = (await req.json()) as { swipeId: string };
  const db = readDB();
  const swipe = db.swipes.find((s) => s.id === swipeId);
  if (!swipe) return NextResponse.json({ error: "Swipe introuvable" }, { status: 404 });

  if (!swipe.transcriptInput?.trim() && !swipe.caption?.trim()) {
    return NextResponse.json(
      { error: "Il faut au minimum une transcription ou une légende pour analyser ce contenu." },
      { status: 400 },
    );
  }

  const prompt = buildAnalyzePrompt({
    url: swipe.url,
    platform: swipe.platform,
    author: swipe.author,
    caption: swipe.caption,
    transcript: swipe.transcriptInput,
    brandContext: getSettings().brandContext,
  });

  try {
    const raw = await askText(prompt, SYSTEM_ANALYST, 12000);
    const analysis = parseJsonLoose<SwipeAnalysis>(raw);

    const fresh = readDB();
    const target = fresh.swipes.find((s) => s.id === swipeId);
    if (target) {
      target.analysis = analysis;
      target.status = "analyse";
      if (!target.title && analysis.hook) target.title = analysis.hook.slice(0, 80);
      writeDB(fresh);
    }
    return NextResponse.json({ analysis });
  } catch (e) {
    const err = e as KieError;
    return NextResponse.json({ error: err.message }, { status: err.code === 401 ? 401 : 502 });
  }
}
