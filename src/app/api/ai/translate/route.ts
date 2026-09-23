import { NextRequest, NextResponse } from "next/server";
import { askText, KieError } from "@/lib/kie";
import { formatTranscript } from "@/lib/format";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

const SYSTEM = `Tu traduis des scripts de vidéos courtes vers le français.
Tu restitues exactement ce qui est dit, dans le même ordre, sans résumer, sans commenter et sans ajouter de titre.
Tu gardes le ton parlé, les tics de langage et la ponctuation orale.
Si le texte est déjà en français, tu le renvoies tel quel.
Tu ne réponds QUE par la traduction.`;

/** Traduction d'un script en français, pour les références étrangères. */
export async function POST(req: NextRequest) {
  const { text } = (await req.json().catch(() => ({}))) as { text?: string };
  if (!text?.trim()) {
    return NextResponse.json({ error: "Aucun texte à traduire." }, { status: 400 });
  }

  try {
    const out = await askText(`Traduis ce script en français :\n\n${text.trim()}`, SYSTEM, 4000);
    return NextResponse.json({ text: formatTranscript(out) });
  } catch (e) {
    const err = e as KieError;
    return NextResponse.json({ error: err.message }, { status: err.code === 401 ? 401 : 502 });
  }
}
