import { NextRequest, NextResponse } from "next/server";
import { getSettings, saveSettings } from "@/lib/db";
import { DEFAULT_SCRIPT_PROMPT } from "@/lib/youtube";

export const dynamic = "force-dynamic";

/** Le prompt du scénariste en vigueur, et le prompt par défaut pour y revenir. */
export async function GET() {
  const custom = (getSettings().ytScriptPrompt ?? "").trim();
  return NextResponse.json({ prompt: custom || DEFAULT_SCRIPT_PROMPT, isDefault: !custom, defaultPrompt: DEFAULT_SCRIPT_PROMPT });
}

/** `{ prompt }` ; vide = retour au prompt par défaut. */
export async function PUT(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { prompt?: string };
  const prompt = (body.prompt ?? "").trim().slice(0, 20000);
  saveSettings({ ytScriptPrompt: prompt === DEFAULT_SCRIPT_PROMPT.trim() ? "" : prompt });
  const custom = (getSettings().ytScriptPrompt ?? "").trim();
  return NextResponse.json({ prompt: custom || DEFAULT_SCRIPT_PROMPT, isDefault: !custom, defaultPrompt: DEFAULT_SCRIPT_PROMPT });
}
