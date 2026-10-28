import fs from "node:fs";
import path from "node:path";
import { withBrandContext } from "./brand";
import { getSettings, newId, readDB, saveSettings, writeDB } from "./db";
import { getFathomKey, getTranscript, type FathomTranscriptLine } from "./fathom";
import { askText } from "./kie";
import type { Appointment, CallReview, DB } from "./types";

/**
 * Relecture des calls de closing (2026-10-28).
 *
 * Fathom enregistre chaque call et garde le transcript mot pour mot. Ici on
 * s'en sert pour deux choses, depuis le Sales Dashboard :
 *  - l'analyse d'un call : ce qui a marche, ce qu'il faut ameliorer, les
 *    objections et comment elles ont ete traitees (`analyzeCall`) ;
 *  - le script de closing : LA trame de Mady, redigee a partir des calls
 *    closes (ses vraies phrases qui marchent) et des calls perdus (ce qui
 *    fait perdre), avec les points a ameliorer recurrents (`buildClosingScript`).
 *
 * Les transcripts sont gardes sur disque (data/fathom/<id>.json) pour ne pas
 * redemander Fathom a chaque fois (60 appels / min). Les analyses vont dans
 * `callReviews`, le script dans les reglages.
 */

const TRANSCRIPT_DIR = path.join(process.cwd(), "data", "fathom");
/** Taille maximale d'un transcript envoye au modele (gemini-3-pro : tres large contexte, on reste raisonnable). */
const MAX_CALL_CHARS = 120_000;
const MAX_WON_FOR_SCRIPT = 4;
const MAX_LOST_FOR_SCRIPT = 2;

export type CallOutcome = CallReview["outcome"];

/** Un call enregistre par Fathom, tel que le dashboard le liste. */
export interface ReviewCall {
  appointmentId: string;
  leadId: string;
  leadName: string;
  /** Date du call (ISO). */
  at: string;
  outcome: CallOutcome;
  /** Valeur du contrat si la vente est gagnee, 0 sinon. */
  amount: number;
  currency: string;
  closerName: string;
  fathomUrl: string;
  recordingId: string;
  review: CallReview | null;
}

export interface ClosingScript {
  text: string;
  at: string;
  calls: number;
}

/* ------------------------------ Issue d'un call ------------------------------- */

export function outcomeOf(db: DB, appt: Appointment): CallOutcome {
  const sale = db.sales.find((s) => s.appointmentId === appt.id && s.status !== "cancelled");
  if (sale || appt.status === "closed-won") return "won";
  const lead = db.leads.find((l) => l.id === appt.leadId);
  if (appt.status === "closed-lost" || lead?.stage === "closed-lost") return "lost";
  return "open";
}

function toCall(db: DB, appt: Appointment, names: Map<string, string>): ReviewCall {
  const lead = db.leads.find((l) => l.id === appt.leadId);
  const sale = db.sales.find((s) => s.appointmentId === appt.id && s.status !== "cancelled");
  return {
    appointmentId: appt.id,
    leadId: appt.leadId,
    leadName: lead?.name ?? "Lead supprimé",
    at: appt.scheduledAt,
    outcome: outcomeOf(db, appt),
    amount: sale ? Math.max(0, sale.contractValue - (sale.refundAmount || 0)) : 0,
    currency: sale?.currency || db.settings.salesCurrency || "EUR",
    closerName: names.get(appt.closerId) ?? "",
    fathomUrl: appt.fathomUrl ?? "",
    recordingId: appt.fathomRecordingId ?? "",
    review: db.callReviews.find((r) => r.appointmentId === appt.id) ?? null,
  };
}

/** Les calls enregistres par Fathom, du plus recent au plus ancien. */
export function listReviewCalls(db: DB, limit = 80): ReviewCall[] {
  const names = new Map(db.team.map((m) => [m.id, m.name] as const));
  return db.appointments
    .filter((a) => a.fathomRecordingId && a.status !== "cancelled")
    .sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt))
    .slice(0, limit)
    .map((a) => toCall(db, a, names));
}

export function currentScript(): ClosingScript | null {
  const s = getSettings();
  return s.closingScript ? { text: s.closingScript, at: s.closingScriptAt ?? "", calls: s.closingScriptCalls ?? 0 } : null;
}

/* ------------------------------ Transcript ------------------------------- */

function transcriptPath(recordingId: string) {
  return path.join(TRANSCRIPT_DIR, `${recordingId.replace(/[^A-Za-z0-9_-]/g, "_")}.json`);
}

/** Le transcript, lu sur disque s'il y est, sinon demande a Fathom et garde. */
export async function loadTranscript(recordingId: string): Promise<FathomTranscriptLine[]> {
  const p = transcriptPath(recordingId);
  try {
    if (fs.existsSync(p)) {
      const cached = JSON.parse(fs.readFileSync(p, "utf8")) as FathomTranscriptLine[];
      if (Array.isArray(cached) && cached.length) return cached;
    }
  } catch {
    /* fichier abime : on redemande */
  }
  const lines = await getTranscript(recordingId);
  if (lines.length) {
    try {
      fs.mkdirSync(TRANSCRIPT_DIR, { recursive: true });
      fs.writeFileSync(p, JSON.stringify(lines), "utf8");
    } catch {
      /* disque en lecture seule : on vit sans cache */
    }
  }
  return lines;
}

const shortTs = (ts?: string | null) => {
  const m = /^(\d+):(\d{2}):(\d{2})$/.exec((ts ?? "").trim());
  if (!m) return "";
  const h = Number(m[1]);
  return h ? `${h}:${m[2]}:${m[3]}` : `${m[2]}:${m[3]}`;
};

/**
 * Le transcript en texte lisible : « [mm:ss] Nom : texte », les prises de
 * parole consecutives d'une meme personne regroupees. Et la part de parole de
 * chacun, pour savoir qui parle trop.
 */
export function formatTranscript(lines: FathomTranscriptLine[]): { text: string; speakers: { name: string; share: number }[] } {
  const words = new Map<string, number>();
  const out: string[] = [];
  let last = "";
  for (const l of lines) {
    const name = (l.speaker?.display_name ?? "").trim() || "Inconnu";
    const text = (l.text ?? "").trim();
    if (!text) continue;
    words.set(name, (words.get(name) ?? 0) + text.split(/\s+/).length);
    if (name === last && out.length) out[out.length - 1] += ` ${text}`;
    else {
      const ts = shortTs(l.timestamp);
      out.push(`${ts ? `[${ts}] ` : ""}${name} : ${text}`);
      last = name;
    }
  }
  const total = [...words.values()].reduce((a, b) => a + b, 0) || 1;
  const speakers = [...words.entries()].map(([name, n]) => ({ name, share: Math.round((n / total) * 100) })).sort((a, b) => b.share - a.share);
  return { text: out.join("\n"), speakers };
}

/* ------------------------------ Analyse d'un call ------------------------------- */

function parseJson<T>(raw: string): T {
  const s = raw.replace(/```(?:json)?/gi, "").trim();
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("Le modèle n'a pas renvoyé d'analyse lisible.");
  return JSON.parse(s.slice(a, b + 1)) as T;
}

const strList = (v: unknown, max = 8): string[] => (Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, max) : []);

const OUTCOME_FR: Record<CallOutcome, string> = { won: "VENTE CLOSÉE (le prospect a acheté)", lost: "PERDU (le prospect n'a pas acheté)", open: "pas encore statué" };

const ANALYSIS_SYSTEM = `Tu es le meilleur coach de closing high-ticket francophone. Tu relis le transcript d'un call de vente de Mady (le closer : coaching e-commerce / IA, offre à plusieurs milliers d'euros) et tu lui rends un debrief brut, précis et utile, comme un coach qui veut qu'il gagne plus de calls.

Règles :
- Tu analyses le closer (Mady), pas le prospect. Les autres intervenants sont le prospect (parfois son conjoint ou associé).
- Concret, pas de généralités : chaque point s'appuie sur ce qui a VRAIMENT été dit, cite les mots quand c'est utile, avec le minutage [mm:ss] si tu l'as.
- Même sur un call closé, cherche ce qui aurait pu faire perdre : découverte trop courte, douleur pas assez creusée, prix annoncé trop tôt ou trop tard, pas de deadline, pas d'engagement clair, trop de temps de parole du closer, objection évitée au lieu d'être traitée, pas de récap, prochaine étape floue.
- Tutoie Mady. Français direct, phrases courtes, montants en euros. Pas de markdown dans les textes.

Tu réponds UNIQUEMENT avec un objet JSON, sans texte autour :
{
  "score": nombre de 0 à 10 (qualité du closing sur ce call, indépendamment du résultat),
  "summary": "le call en 2-3 phrases : qui est le prospect, où il en est, ce qu'il veut, comment ça s'est fini",
  "strengths": ["3 à 5 choses que Mady a bien faites, précises, avec le moment"],
  "improvements": ["3 à 6 points à améliorer : ce qui s'est passé → pourquoi c'est un problème → quoi dire ou faire à la place"],
  "objections": [{"objection": "l'objection telle que dite par le prospect", "handled": "comment Mady l'a traitée", "better": "la réponse plus forte"}],
  "keyLines": ["3 à 6 phrases de Mady, mot pour mot, qui ont fait avancer le call (celles à garder dans son script)"],
  "nextTime": "LA consigne principale pour le prochain call, une phrase"
}`;

/**
 * Analyse un call enregistre : transcript Fathom → debrief par l'IA du
 * tool, garde dans `callReviews` (une analyse par call, la relance remplace).
 */
export async function analyzeCall(appointmentId: string): Promise<{ call: ReviewCall; review: CallReview }> {
  if (!getFathomKey()) throw new Error("Aucune clé API Fathom (Réglages → Fathom).");
  let db = readDB();
  const appt = db.appointments.find((a) => a.id === appointmentId);
  if (!appt) throw new Error("Call introuvable.");
  const recordingId = appt.fathomRecordingId ?? "";
  if (!recordingId) throw new Error("Ce call n'a pas d'enregistrement Fathom.");
  const lead = db.leads.find((l) => l.id === appt.leadId);
  const outcome = outcomeOf(db, appt);
  const lines = await loadTranscript(recordingId);
  const { text, speakers } = formatTranscript(lines);
  if (!text.trim()) throw new Error("Fathom n'a pas (encore) de transcript pour ce call. Réessaie dans quelques minutes.");
  const transcript = text.length > MAX_CALL_CHARS ? `${text.slice(0, MAX_CALL_CHARS)}\n[… transcript coupé …]` : text;
  const sale = db.sales.find((s) => s.appointmentId === appt.id && s.status !== "cancelled");
  const prompt = [
    `Call du ${new Date(appt.scheduledAt).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })} avec ${lead?.name ?? "un prospect"}.`,
    `Issue : ${OUTCOME_FR[outcome]}${sale ? ` · contrat ${Math.round(sale.contractValue)} ${sale.currency || "EUR"}, encaissé ${Math.round(sale.cashCollected || 0)}` : ""}${appt.lostReason ? ` · raison notée : ${appt.lostReason}` : ""}.`,
    appt.setterNotes ? `Contexte laissé par le setter : ${appt.setterNotes.slice(0, 600)}` : "",
    `Temps de parole : ${speakers.map((s) => `${s.name} ${s.share} %`).join(", ")}.`,
    "",
    "TRANSCRIPT :",
    transcript,
  ]
    .filter((l) => l !== "")
    .join("\n");
  const raw = await askText(prompt, withBrandContext(ANALYSIS_SYSTEM, db.settings), 4000);
  const j = parseJson<{ score?: unknown; summary?: unknown; strengths?: unknown; improvements?: unknown; objections?: unknown; keyLines?: unknown; nextTime?: unknown }>(raw);
  const score = Math.max(0, Math.min(10, Math.round(Number(j.score) || 0)));
  const objections = (Array.isArray(j.objections) ? j.objections : [])
    .map((o) => {
      const x = (o && typeof o === "object" ? o : {}) as Record<string, unknown>;
      return { objection: String(x.objection ?? "").trim(), handled: String(x.handled ?? "").trim(), better: String(x.better ?? "").trim() };
    })
    .filter((o) => o.objection)
    .slice(0, 8);
  const now = new Date().toISOString();
  db = readDB();
  const prev = db.callReviews.find((r) => r.appointmentId === appointmentId);
  const review: CallReview = {
    id: prev?.id ?? newId(),
    appointmentId,
    leadId: appt.leadId,
    recordingId,
    outcome,
    score,
    summary: String(j.summary ?? "").trim().slice(0, 1200),
    strengths: strList(j.strengths),
    improvements: strList(j.improvements),
    objections,
    keyLines: strList(j.keyLines),
    nextTime: String(j.nextTime ?? "").trim().slice(0, 400),
    transcriptChars: text.length,
    createdAt: now,
  };
  db.callReviews = [review, ...db.callReviews.filter((r) => r.appointmentId !== appointmentId)];
  db.activityLogs.unshift({ id: newId(), at: now, actorId: "", actorName: "IA", action: "appointment.updated", entity: "appointment", entityId: appt.id, summary: `Call de ${lead?.name ?? "un lead"} analysé (Fathom) : ${score}/10` });
  writeDB(db);
  const names = new Map(db.team.map((m) => [m.id, m.name] as const));
  const live = db.appointments.find((a) => a.id === appointmentId) ?? appt;
  return { call: toCall(db, live, names), review };
}

/* ------------------------------ Script de closing ------------------------------- */

const SCRIPT_SYSTEM = `Tu es le meilleur coach de closing high-ticket francophone. Mady (closer, coach e-commerce / IA) te donne les transcripts de ses vrais calls de vente, closés et perdus, avec leurs analyses. Tu lui écris SON script de closing : pas un script générique, SA trame, construite sur ce qui marche vraiment dans ses calls, dans ses mots, corrigée là où ça perd.

Exigences :
- Les phrases à dire sont tirées des transcripts (mot pour mot ou à peine lissées), entre guillemets « ». Quand tu proposes une phrase que Mady n'a jamais dite, écris-la quand même dans son style (tutoiement, direct, chaleureux, zéro jargon).
- Chaque phase donne : l'objectif, le temps indicatif, les phrases / questions exactes, et les erreurs vues dans ses calls à ne plus faire.
- Les objections sont celles réellement entendues dans ses calls, avec la meilleure réponse (celle qui a marché, ou la version plus forte).
- Concret, actionnable, lisible en 5 minutes avant un call. Montants en euros. Tutoie Mady.
- Format : markdown simple (titres #, ##, listes -, gras **), pas de tableau, pas de code.

Structure obligatoire :
# Script de closing de Mady
## Points à améliorer récurrents
(les 4 à 6 choses qui reviennent dans ses calls, chacune : le problème → ce qu'il faut faire à la place)
## 1. Ouverture et cadre (2 min)
## 2. Découverte (10-15 min)
## 3. Douleur et enjeu (5-10 min)
## 4. Vision et pitch de l'offre (10 min)
## 5. Prix et plan de paiement (3 min)
## 6. Objections (les vraies, avec la réponse)
## 7. Le close (phrases exactes, engagement, prochaine étape)
## 8. Après le call
## Les phrases de Mady qui closent
(8 à 12 phrases mot pour mot tirées des calls closés)`;

/**
 * Redige le script de closing a partir des calls analyses : les transcripts
 * des meilleurs calls closes (jusqu'a 4) et de calls perdus (jusqu'a 2), plus
 * toutes les analyses en condense. Garde en reglages.
 */
export async function buildClosingScript(): Promise<ClosingScript> {
  if (!getFathomKey()) throw new Error("Aucune clé API Fathom (Réglages → Fathom).");
  const db = readDB();
  const calls = listReviewCalls(db, 200);
  const reviewed = calls.filter((c) => c.review);
  const won = reviewed.filter((c) => c.outcome === "won").sort((a, b) => b.review!.score - a.review!.score || b.at.localeCompare(a.at));
  const lost = reviewed.filter((c) => c.outcome === "lost").sort((a, b) => b.at.localeCompare(a.at));
  if (!won.length) throw new Error("Analyse d'abord au moins un call closé : le script se construit sur tes vrais calls.");

  const blocks: string[] = [];
  const pick = async (list: ReviewCall[], max: number, perCall: number, tag: string) => {
    for (const c of list.slice(0, max)) {
      const lines = await loadTranscript(c.recordingId);
      const { text, speakers } = formatTranscript(lines);
      if (!text.trim()) continue;
      const body = text.length > perCall ? `${text.slice(0, perCall)}\n[… coupé …]` : text;
      blocks.push(`=== CALL ${tag} · ${c.leadName} · ${new Date(c.at).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })}${c.amount ? ` · ${Math.round(c.amount)} €` : ""} · note du coach ${c.review!.score}/10 · parole : ${speakers.map((s) => `${s.name} ${s.share} %`).join(", ")} ===\n${body}`);
    }
  };
  await pick(won, MAX_WON_FOR_SCRIPT, 35_000, "CLOSÉ");
  await pick(lost, MAX_LOST_FOR_SCRIPT, 15_000, "PERDU");

  const digest = reviewed
    .slice(0, 25)
    .map((c) => {
      const r = c.review!;
      return `- ${c.leadName} (${c.outcome === "won" ? "closé" : c.outcome === "lost" ? "perdu" : "en attente"}, ${r.score}/10) : à améliorer → ${r.improvements.join(" | ")}. Consigne → ${r.nextTime}. Objections → ${r.objections.map((o) => o.objection).join(" | ") || "aucune"}.`;
    })
    .join("\n");

  const prompt = [
    `Mady a ${won.length} call${won.length > 1 ? "s" : ""} closé${won.length > 1 ? "s" : ""} et ${lost.length} perdu${lost.length > 1 ? "s" : ""} analysés. Voici le condensé des analyses :`,
    digest,
    "",
    "Et les transcripts complets des calls les plus parlants :",
    "",
    ...blocks,
    "",
    "Écris maintenant SON script de closing, en suivant la structure demandée.",
  ].join("\n");
  const text = (await askText(prompt, withBrandContext(SCRIPT_SYSTEM, db.settings), 9000)).trim();
  if (!text) throw new Error("Le modèle a renvoyé un script vide.");
  const at = new Date().toISOString();
  saveSettings({ closingScript: text, closingScriptAt: at, closingScriptCalls: reviewed.length });
  return { text, at, calls: reviewed.length };
}
