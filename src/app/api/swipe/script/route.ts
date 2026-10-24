import { NextRequest, NextResponse } from "next/server";
import { getSettings, readDB, writeDB } from "@/lib/db";
import { askText, KieError, parseJsonLoose } from "@/lib/kie";
import { swipeStage, type SwipeScript, type SwipeStage } from "@/lib/types";
import { jobStatusResponse, respondAsJobBuffered } from "@/lib/bg-jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * « Générer mon script » (Swipe file).
 *
 * Deux modes :
 *  - adapt (par défaut) : un script personnel Scale X qui garde la mécanique
 *    et l'angle du Reel de référence (hook, structure, émotion, preuve, CTA)
 *    sans recopier les mots d'un autre créateur ;
 *  - verbatim : la vidéo est à moi, on remet son texte en forme sans rien
 *    réécrire (hook mot pour mot, corps ligne par ligne, CTA).
 * Dans les deux cas le swipe passe en « Script prêt » s'il était en Swipe file.
 */

const SYSTEM_VERBATIM = `Tu mets en forme le script d'une video pour qu'il soit facile a lire et a tourner tel quel, en francais.
Tu ne reecris RIEN : pas de reformulation, pas d'adaptation, pas de resume, pas de mot ajoute ni retire (seulement la ponctuation, les hesitations et les repetitions parasites). Un script dans une autre langue est traduit fidelement, c'est la seule transformation permise.
Tu reponds uniquement par un objet JSON valide, sans texte autour et sans bloc markdown.`;

const SYSTEM_ADAPT = `Tu es le scénariste de Mady, entrepreneur e-commerce et coach individuel (Shopify, Claude Code, IA, recherche produit, Meta Ads), qui tourne des Reels face caméra.
Ton : naturel, familier, direct, drôle, pédagogique, sans discours artificiel, en français parlé. Jamais de jargon marketing creux, jamais de phrases de « gourou ».
Tu écris un script PERSONNEL et ORIGINAL : tu gardes la mécanique et l'angle du Reel de référence (type de hook, structure, émotion, preuve, place du CTA) mais tu ne recopies jamais ses phrases. Les exemples, chiffres et anecdotes viennent de l'univers de Mady (ses élèves, ses boutiques, ses pubs), jamais inventés comme des faits précis : si un chiffre manque, laisse un crochet [chiffre] à compléter.
Tu réponds uniquement par un objet JSON valide, sans texte autour et sans bloc markdown.`;

const CTA_RULE: Record<SwipeStage, string> = {
  TOFU: "TOFU (attirer) : AUCUN CTA commercial. Au plus « abonne-toi » ou une question qui fait commenter. Pas d'offre, pas de coaching.",
  MOFU: "MOFU (convaincre) : CTA facultatif, plutôt une question ou une ressource (« commente X, je t'envoie … »). Jamais « réserve un appel ».",
  BOFU: "BOFU (convertir) : UN seul appel à l'action, direct et légitime (DM, lien en bio, réserver un appel), amené par une vraie raison d'agir.",
};

function verbatimPrompt(input: { transcript: string; hook: string; cta: string; screen: string[]; speakers: string }) {
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
- Si le script n'est pas en francais, traduis-le en francais parle et naturel, fidele phrase a phrase (rien d'ajoute, rien de retire).
- hook + bullets + cta = tout le script, rien de plus, rien de moins (le hook et le CTA ne sont pas repetes dans bullets).
- Si deux personnes se parlent : speakers = "dialogue", et chaque ligne de bullets commence par "A :" ou "B :".
- durationSec = duree de lecture a voix haute, environ 2,5 mots par seconde, entre 10 et 90.`;
}

function adaptPrompt(input: { transcript: string; stage: SwipeStage | ""; hook: string; hookType: string; structure: string; emotion: string; proof: string; cta: string; why: string[]; brandContext: string; notes: string }) {
  const stage = input.stage || "TOFU";
  return `# Qui je suis
${input.brandContext}

# Le Reel de référence (à ne PAS recopier : on garde la mécanique, pas les mots)
Transcription :
"""
${input.transcript}
"""
Ce que l'analyse en a tiré :
- Hook : ${input.hook || "?"} (type : ${input.hookType || "?"})
- Structure : ${input.structure || "?"}
- Émotion / objection : ${input.emotion || "?"}
- Preuve utilisée : ${input.proof || "?"}
- CTA : ${input.cta || "aucun"}
- Pourquoi ça marche : ${input.why.length ? input.why.join(" · ") : "?"}
${input.notes ? `- Mes notes : ${input.notes}` : ""}

# Catégorie du Reel à écrire : ${stage}
Règle CTA — ${CTA_RULE[stage]}

# Ce que je veux
Mon script Scale X, prêt à lire face caméra, avec la même mécanique que la référence mais mes mots, mon univers et mon ton :
{
  "hook": "un hook fort, 1 à 2 phrases, même type de hook que la référence, dans mon univers",
  "bullets": ["le corps, naturel et parlé, UNE idée par ligne, 15 mots max par ligne, 4 à 8 lignes"],
  "message": "le message central en une phrase (ce que le spectateur doit retenir)",
  "broll": ["indication de B-roll ou de preuve à afficher à l'écran, une par ligne, 3 à 6 (ex. « écran : dashboard Shopify du jour », « capture : message d'un élève »)"],
  "cta": "le CTA adapté à la catégorie ('' si TOFU sans CTA)",
  "screenText": ["2 à 5 textes à incruster, courts"],
  "durationSec": 30
}
Règles :
- Une vidéo, un objectif. ${stage === "TOFU" ? "Une émotion dominante, zéro jargon, compréhensible par un inconnu." : stage === "MOFU" ? "Une objection précise levée, avec une démonstration ou une preuve concrète." : "Une preuve réelle, une raison légitime d'agir maintenant, un seul CTA clair."}
- Pas de copie : aucune phrase de la référence ne doit se retrouver telle quelle.
- durationSec = durée de lecture à voix haute, environ 2,5 mots par seconde, entre 15 et 90.`;
}

async function handlePost(req: NextRequest) {
  const { swipeId, mode } = (await req.json().catch(() => ({}))) as { swipeId?: string; mode?: "adapt" | "verbatim" };
  const db = readDB();
  const swipe = swipeId ? db.swipes.find((s) => s.id === swipeId) : undefined;
  if (!swipe) return NextResponse.json({ error: "Swipe introuvable." }, { status: 404 });
  const a = swipe.analysis;
  const transcript = (a?.transcriptFr || a?.transcriptOriginal || swipe.transcriptInput || "").trim();
  if (!transcript) return NextResponse.json({ error: "Transcription nécessaire : importe la vidéo ou colle le texte des paroles dans l'onglet Source." }, { status: 400 });
  const m: "adapt" | "verbatim" = mode === "verbatim" ? "verbatim" : "adapt";

  const prompt =
    m === "verbatim"
      ? verbatimPrompt({
          transcript,
          hook: a?.hook ?? "",
          cta: a?.cta ?? "",
          screen: a?.onScreenText ?? [],
          speakers: a?.speakers === "dialogue" ? "deux personnes qui se parlent" : a?.speakers === "solo" ? "une seule personne" : "",
        })
      : adaptPrompt({
          transcript,
          stage: swipeStage(swipe),
          hook: a?.hook ?? "",
          hookType: a?.hookType ?? "",
          structure: a?.structure ?? "",
          emotion: a?.emotion ?? "",
          proof: a?.proof ?? "",
          cta: a?.cta ?? "",
          why: a?.whyItWorks ?? [],
          brandContext: getSettings().brandContext,
          notes: swipe.notes ?? "",
        });

  try {
    const raw = await askText(prompt, m === "verbatim" ? SYSTEM_VERBATIM : SYSTEM_ADAPT, 4000);
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
      bullets: clean(out.bullets, 10),
      cta: String(out.cta ?? "").trim(),
      message: m === "adapt" ? String(out.message ?? "").trim() : "",
      broll: m === "adapt" ? clean(out.broll, 8) : [],
      mode: m,
      screenText: clean(out.screenText, 6),
      durationSec: Number.isFinite(dur) ? Math.min(90, Math.max(10, Math.round(dur))) : 30,
      speakers: m === "verbatim" ? (String(out.speakers ?? a?.speakers ?? "").toLowerCase().includes("dialog") ? "dialogue" : "solo") : "solo",
      generatedAt: now,
      updatedAt: now,
    };
    if (!script.hook && !script.bullets.length) throw new KieError("Le modèle n'a rien rendu d'exploitable, réessaie.", 502);

    const fresh = readDB();
    const target = fresh.swipes.find((s) => s.id === swipe.id);
    if (target) {
      target.script = script;
      // « Script prêt » automatique dès que le script existe, sans faire reculer un swipe plus avancé.
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
