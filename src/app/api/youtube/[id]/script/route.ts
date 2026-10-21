import { NextRequest, NextResponse } from "next/server";
import { getSettings, readDB, writeDB } from "@/lib/db";
import { askText, KieError } from "@/lib/kie";
import { DEFAULT_SCRIPT_PROMPT, transcriptMessage } from "@/lib/youtube";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Analyse + script adapté, avec le prompt du scénariste comme consigne système. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { extra?: string };
  const db = readDB();
  const v = db.ytVideos.find((x) => x.id === id);
  if (!v) return NextResponse.json({ error: "Vidéo introuvable." }, { status: 404 });
  if (!v.transcript.trim()) return NextResponse.json({ error: "Récupère d'abord le transcript." }, { status: 400 });

  const system = (getSettings().ytScriptPrompt ?? "").trim() || DEFAULT_SCRIPT_PROMPT;
  const extra = (body.extra ?? "").trim();
  const prompt = `${transcriptMessage(v)}${extra ? `\n\nCONSIGNE DU JOUR : ${extra}` : ""}`;
  try {
    let out = "";
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < 3 && !out; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 3000 * attempt));
      try {
        out = (await askText(prompt, system, 8000)).trim();
      } catch (e) {
        lastErr = e as Error;
        if ((e as KieError).code === 401) throw e;
      }
    }
    if (!out) throw lastErr ?? new Error("Réponse vide du modèle.");
    v.script = out;
    v.scriptAt = new Date().toISOString();
    v.updatedAt = v.scriptAt;
    writeDB(db);
    return NextResponse.json({ video: v });
  } catch (e) {
    const err = e as KieError;
    return NextResponse.json({ error: `Modèle texte : ${err.message}` }, { status: err.code === 401 ? 401 : 502 });
  }
}
