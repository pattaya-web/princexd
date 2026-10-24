import { NextRequest, NextResponse } from "next/server";
import { askText, KieError } from "@/lib/kie";
import { formatTranscript } from "@/lib/format";
import { jobStatusResponse, respondAsJobBuffered } from "@/lib/bg-jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

const SYSTEM = `Tu traduis des scripts de vidéos courtes vers le français.
Tu restitues exactement ce qui est dit, dans le même ordre, sans résumer, sans commenter et sans ajouter de titre.
Tu gardes le ton parlé, les tics de langage et la ponctuation orale.
Si le texte est déjà en français, tu le renvoies tel quel.
Tu ne réponds QUE par la traduction.`;

/** Traduction d'un script en français, pour les références étrangères. */
async function handlePost(req: NextRequest) {
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
