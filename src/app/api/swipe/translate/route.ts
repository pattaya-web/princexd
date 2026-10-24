import { NextRequest, NextResponse } from "next/server";
import { newId, readDB, writeDB } from "@/lib/db";
import { askText, KieError, parseJsonLoose } from "@/lib/kie";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SYSTEM = `Tu traduis des scripts de videos (reels, TikTok) vers le francais parle, naturel, tel qu'on le dirait face camera.
Fidele au sens et a la structure : rien d'ajoute, rien de retire, rien de resume. Les chiffres, les noms de marques et d'outils restent tels quels.
Tu reponds uniquement par un objet JSON valide, sans texte autour et sans bloc markdown.`;

export interface TranslateResult {
  fr: string;
  language: string;
  speakers: "solo" | "dialogue";
}

type Job = { state: "running" | "done" | "error"; result?: TranslateResult; error?: string; code?: number; at: number };

/*
 * Traductions en cours, en memoire du processus. Le navigateur lance la
 * traduction (POST, reponse immediate) puis l'interroge toutes les deux
 * secondes (GET ?job=) : le proxy devant le site ne voit jamais une requete
 * de plus d'une minute, donc plus d'« Erreur 502 » pendant que KIE travaille.
 * Un redemarrage du conteneur perd les jobs en cours : le navigateur le voit
 * (job inconnu) et propose de relancer.
 */
const JOBS = new Map<string, Job>();
const JOB_TTL_MS = 15 * 60 * 1000;

function sweep() {
  const now = Date.now();
  for (const [id, j] of JOBS) if (now - j.at > JOB_TTL_MS) JOBS.delete(id);
}

/**
 * Traduction du script colle (contenu US, etc.) en francais parle. Le user
 * reprend le contenu des autres : la traduction doit rester collee au texte,
 * juste rendue naturelle en francais, et mise en forme pour etre lue (une
 * idee par ligne, A : / B : si deux personnes se parlent). L'original est
 * conserve sur le swipe pour pouvoir y revenir.
 */
async function translate(source: string, swipeId: string | undefined): Promise<TranslateResult> {
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

  const raw = await askText(prompt, SYSTEM, 8000);
  const out = parseJsonLoose<{ language?: string; fr?: string; speakers?: string }>(raw);
  const fr = String(out.fr ?? "").trim();
  if (!fr) throw new KieError("Le modèle n'a rien rendu, réessaie.", 502);
  const language = String(out.language ?? "").trim().toLowerCase().slice(0, 5);
  const speakers = String(out.speakers ?? "").toLowerCase().includes("dialog") ? ("dialogue" as const) : ("solo" as const);

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
  return { fr, language, speakers };
}

/** Lance la traduction en fond et rend tout de suite l'identifiant du job. */
export async function POST(req: NextRequest) {
  const { swipeId, text } = (await req.json().catch(() => ({}))) as { swipeId?: string; text?: string };
  const source = (text ?? "").trim();
  if (!source) return NextResponse.json({ error: "Rien à traduire : colle d'abord le script." }, { status: 400 });

  sweep();
  const jobId = newId();
  const job: Job = { state: "running", at: Date.now() };
  JOBS.set(jobId, job);
  const started = Date.now();
  void translate(source, swipeId)
    .then((result) => {
      job.state = "done";
      job.result = result;
      console.log(`[swipe/translate] ok en ${Math.round((Date.now() - started) / 1000)} s (${source.length} car.)`);
    })
    .catch((e: KieError) => {
      job.state = "error";
      job.error = e.message || "Traduction échouée.";
      job.code = e.code === 401 ? 401 : 502;
      console.warn(`[swipe/translate] échec après ${Math.round((Date.now() - started) / 1000)} s : ${job.error}`);
    })
    .finally(() => {
      job.at = Date.now();
    });
  return NextResponse.json({ jobId });
}

/** État d'une traduction : `running`, puis le résultat (rendu une fois) ou l'erreur. */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("job") ?? "";
  const job = JOBS.get(id);
  if (!job) return NextResponse.json({ error: "Traduction introuvable (le serveur a peut-être redémarré) : relance-la." }, { status: 404 });
  if (job.state === "running") return NextResponse.json({ state: "running" });
  JOBS.delete(id);
  if (job.state === "error") return NextResponse.json({ error: job.error }, { status: job.code ?? 502 });
  return NextResponse.json({ state: "done", ...job.result });
}
