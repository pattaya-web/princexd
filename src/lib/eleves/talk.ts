import { newId, readDB, writeDB } from "@/lib/db";
import { NextRequest } from "next/server";
import { businessSnapshot } from "@/lib/assistant-snapshot";
import { POST as extractSwipe } from "@/app/api/swipe/extract/route";
import { assistantReply, assistantSource, type AssistantSource, type ChatTurn } from "@/lib/assistant";
import type { Session, Swipe, SwipeStage } from "@/lib/types";
import { completeDraft, parseStudentText, SOURCE_OPTIONS, type NewStudentDraft } from "./draft";
import { chatContext, confirmNewStudent, findLeadMatches, type ConfirmResult } from "./new-student";

/**
 * Conversation du chat « Nouvel élève ».
 *
 * L'assistant (Claude, ou KIE en repli) discute avec Mady, demande ce qui
 * manque, récapitule, et n'émet un bloc <create>{json}</create> qu'après un
 * « ok » explicite. Le serveur garde la main : sans confirmation dans le
 * dernier message de Mady, rien n'est écrit, même si le modèle a émis le bloc.
 */

export interface TalkResult {
  reply: string;
  /** Présent quand l'élève vient d'être enregistré pendant ce tour. */
  result?: ConfirmResult;
  /** Reels ajoutés au swipe file pendant ce tour. */
  swipes?: { id: string; title: string; funnel: string; url: string }[];
  source: AssistantSource;
}

const ADD_SWIPE_RE = /<add_swipe>([\s\S]*?)<\/add_swipe>/gi;

const CREATE_RE = /<create>([\s\S]*?)<\/create>/i;
const CONFIRM_RE = /\b(oui|ok|okay|okey|yes|yep|ouais|go|vas[- ]y|valide|valid[eé]|confirm[eé]|c'?est bon|exact|parfait|nickel|enregistre|cr[eé]e|envoie|lance|[cç]a marche|top|d'?accord|dac|bien s[uû]r|carr[eé]ment|fonce)\b/i;

const STABLE_SYSTEM = `Tu es l'assistant de Mady dans son tool (princexd), un coach e-commerce + IA. Tu lui parles comme Claude : naturel, direct, chaleureux, en français et en le tutoyant. C'est un chat sur téléphone : réponses courtes (une à quatre phrases), pas de titres, pas de listes à puces sauf pour un récapitulatif, pas de markdown lourd.

Tu as quatre missions.

MISSION 1 · Répondre sur son business. À chaque tour tu reçois une photo à jour de son tool (ventes du mois, encaissé, reste à encaisser, leads, rendez-vous, élèves, semaine de contenu par funnel). Quand Mady demande « combien j'ai encaissé », « combien de vidéos sont prêtes », « combien de reels à tourner », réponds avec ces chiffres, précis et sans détour, en rappelant la période. Si la photo ne contient pas l'info, dis-le et indique la page du tool où la trouver (/sales/dashboard, /sales/leads, /swipe, /formation/eleves) plutôt que d'inventer.

MISSION 2 · Ajouter un reel au swipe file. Quand Mady te colle un lien (Instagram, TikTok, YouTube) et te dit de l'ajouter, termine ton message par un bloc <add_swipe>{"url":"…","funnel":"TOFU"|"MOFU"|"BOFU"|"","note":"…"}</add_swipe> par lien (funnel vide si Mady ne le précise pas ; note = ce qu'il dit du reel, sinon ""). Pas besoin de confirmation : c'est réversible. Le tool récupère le titre et la vignette et l'affiche ensuite dans Swipe file, statut « à analyser ».

MISSION 3 · Enregistrer un nouvel élève. Quand Mady t'annonce qu'un prospect a signé (« closé »), tu enregistres le nouvel élève dans son CRM. Pour ça il te faut :
- name : prénom et nom ;
- contractValue : la valeur du contrat (nombre, dans la devise indiquée) ;
- cashCollected : ce qui est encaissé aujourd'hui, et paymentType : "paid-in-full" (payé en une fois : « instant », « cash », « comptant »), "installments" (en plusieurs fois, avec installments = nombre de fois ; sans précision, cashCollected = contrat / nombre de fois), "deposit" (acompte), "other" (contrat envoyé, rien encaissé : cashCollected = 0) ;
- soldAt : date de la vente AAAA-MM-JJ (aujourd'hui si rien n'est dit) ;
- source : d'où vient le prospect, une clé parmi la liste fournie ;
- leadId : l'identifiant d'un lead du CRM si l'un des candidats fournis est bien lui, sinon "" (nouveau lead) ;
- phone : son numéro, utile pour lui envoyer le message de bienvenue sur WhatsApp (facultatif, demande-le une seule fois) ;
- facultatif : email, igUsername (sans @), offer (nom de l'offre), notes (contexte utile), setterId (parmi les setters fournis, si Mady dit qui a amené le lead), createAccess (true par défaut : crée son accès à la plateforme de formation), contractSigned (true seulement si Mady dit que le contrat est signé).

Règles :
1. Ne demande que ce qui manque, deux questions maximum à la fois. Le nom et le montant sont indispensables ; la source et le mode de paiement sont importants ; le reste est optionnel.
2. Quand tu as l'essentiel, fais un récapitulatif en une ligne ou en quelques puces et demande « Je l'enregistre ? ». N'invente jamais une information.
3. Quand Mady confirme (« oui », « ok », « valide », « go »…), réponds par une phrase très courte puis termine ton message par un bloc exactement de la forme <create>{...}</create> contenant le JSON de l'élève (clés ci-dessus, nombres sans unité, chaînes vides plutôt que null). Un seul bloc, jamais avant confirmation explicite.
4. Si Mady corrige quelque chose après le récapitulatif, refais le récapitulatif corrigé et redemande.
5. Après l'enregistrement, le tool affiche lui-même le message de bienvenue, les identifiants et le bouton WhatsApp : ne les réinvente pas, dis juste que c'est fait.
6. MISSION 4 · Tout le reste (un message à écrire, un conseil, une relance, une idée de contenu) : réponds normalement, toujours bref, en t'appuyant sur le contexte métier.

Contexte métier : Mady vend un accompagnement e-commerce. Méthode : produit trouvé avec BrainSearch, boutique Shopify construite avec Claude Code, créatives faites par IA, publicités Meta Ads. Chaque nouvel élève reçoit un message d'onboarding (formulaire, outils à installer, accès plateforme).`;

/** Un tour de conversation. Enregistre l'élève quand l'assistant émet un bloc <create> après confirmation. */
export async function talkNewStudent(session: Session, turns: ChatTurn[]): Promise<TalkResult> {
  const db = readDB();
  const ctx = chatContext(db);
  const users = turns.filter((t) => t.role === "user").map((t) => t.content).join("\n");
  const last = turns[turns.length - 1];
  if (!last || last.role !== "user" || !last.content.trim()) throw new Error("Écris-moi d'abord un message.");

  // Candidats du CRM d'après ce que Mady a dit jusqu'ici (nom, numéro, pseudo, email).
  const { draft: guess } = parseStudentText(users, ctx.today);
  const probe = completeDraft(guess, { offer: "", today: ctx.today });
  const matches = probe.name || probe.phone || probe.email || probe.igUsername ? findLeadMatches(db, probe) : [];

  const dynamic = [
    `Aujourd'hui : ${ctx.today} (Europe/Paris). Devise : ${ctx.currency}.`,
    `PHOTO DU TOOL (à jour) :\n${businessSnapshot(db)}`,
    `Sources possibles (clé = libellé) : ${SOURCE_OPTIONS.filter((o) => o.key)
      .map((o) => `${o.key} = ${o.label}`)
      .join(", ")}.`,
    ctx.offers.length
      ? `Offres de Mady : ${ctx.offers.map((o) => `${o.name}${o.price ? ` (${o.price} ${ctx.currency})` : ""}`).join(", ")}. Offre par défaut : ${ctx.offers[0].name}.`
      : 'Aucune offre déclarée : offer = "Accompagnement e-commerce + IA" par défaut.',
    ctx.setters.length ? `Setters (id = nom) : ${ctx.setters.map((s) => `${s.id} = ${s.name}`).join(", ")}. Sans précision, setterId = "" (Mady lui-même).` : "Aucun setter dans l'équipe.",
    matches.length
      ? `Leads du CRM qui ressemblent (id = détails) : ${matches
          .map(
            (m) =>
              `${m.id} = ${m.name}${m.handle ? ` ${m.handle}` : ""}${m.phone ? `, ${m.phone}` : ""}${m.setterName ? `, setter ${m.setterName}` : ""}${m.sourceLabel ? `, source ${m.sourceLabel}` : ""}${m.lastAppointmentAt ? `, call ${m.lastAppointmentStatus} le ${m.lastAppointmentAt.slice(0, 10)}` : ""}${m.isStudent ? ", DÉJÀ ÉLÈVE" : ""}`,
          )
          .join(" ; ")}. Si l'un est manifestement la même personne, propose-le à Mady (prénom + setter) et mets son id dans leadId ; sinon leadId = "".`
      : 'Aucun lead du CRM ne ressemble pour l\'instant : leadId = "" (nouveau lead).',
    ctx.formConfigured ? "" : "Le lien du formulaire d'onboarding n'est pas encore renseigné dans Élèves → Onboarding : signale-le à Mady une fois, brièvement.",
  ]
    .filter(Boolean)
    .join("\n");

  const { text: rawText, source } = await assistantReply(STABLE_SYSTEM, dynamic, turns);

  /* --- Reels à ajouter au swipe file --- */
  const swipes: NonNullable<TalkResult["swipes"]> = [];
  const swipeNotes: string[] = [];
  for (const sm of rawText.matchAll(ADD_SWIPE_RE)) {
    try {
      const spec = JSON.parse(sm[1]) as { url?: string; funnel?: string; note?: string };
      const added = await addSwipe(spec);
      swipes.push(added);
      swipeNotes.push(`Reel ajouté au swipe file${added.funnel ? ` (${added.funnel})` : ""} : ${added.title || added.url}.`);
    } catch (e) {
      swipeNotes.push(`Je n'ai pas pu ajouter ce reel : ${(e as Error).message}`);
    }
  }
  const text = rawText.replace(ADD_SWIPE_RE, "").trim();
  const withSwipes = (reply: string) => (swipeNotes.length ? `${reply}\n${swipeNotes.join("\n")}`.trim() : reply);

  const m = text.match(CREATE_RE);
  if (!m) return { reply: withSwipes(text), swipes: swipes.length ? swipes : undefined, source };

  const clean = text.replace(CREATE_RE, "").trim();
  if (!CONFIRM_RE.test(last.content)) {
    // Le modèle a brûlé l'étape : on garde son texte, mais rien n'est écrit sans un « ok ».
    return { reply: `${clean}\n\nDis-moi « ok » et je l'enregistre.`.trim(), source };
  }
  let parsed: Partial<NewStudentDraft>;
  try {
    parsed = JSON.parse(m[1]) as Partial<NewStudentDraft>;
  } catch {
    return { reply: `${clean}\n\nJe n'ai pas réussi à mettre la fiche en forme, redis-moi « ok » pour que je réessaie.`.trim(), source };
  }
  const draft = completeDraft(parsed, { offer: ctx.offers[0]?.name ?? "Accompagnement e-commerce + IA", today: ctx.today });
  try {
    const result = confirmNewStudent(session, draft, users.slice(-300));
    const bits = [
      clean || "C'est fait.",
      `${result.studentCreated ? "Fiche élève créée" : "Fiche déjà existante, vente mise à jour"} pour ${result.student.name} : ${result.sale.contractValue} ${result.sale.currency} (${result.sale.cashCollected} encaissés)${result.lead.setterName ? `, setter ${result.lead.setterName}` : ""}, source ${result.lead.sourceLabel}.${result.credentials ? " Son accès à la plateforme est créé." : ""}`,
      ...result.notes,
    ];
    return { reply: bits.join("\n"), result, source };
  } catch (e) {
    return { reply: `${clean}\n\nJe n'ai rien pu enregistrer : ${(e as Error).message}`.trim(), source };
  }
}

export { assistantSource };

/** Crée un swipe « à analyser » depuis un lien, comme le bouton Ajouter de la page Swipe file. */
async function addSwipe(spec: { url?: string; funnel?: string; note?: string }) {
  const url = (spec.url ?? "").trim();
  if (!/^https?:\/\//i.test(url)) throw new Error("lien invalide.");
  const funnel = (["TOFU", "MOFU", "BOFU"] as SwipeStage[]).find((f) => f === (spec.funnel ?? "").toUpperCase()) ?? "";
  const db0 = readDB();
  const dup = db0.swipes.find((s) => s.url.trim() === url);
  if (dup) return { id: dup.id, title: dup.title || dup.author, funnel: dup.etapeManuelle || "", url };

  let meta = { platform: "web", author: "", title: "", caption: "", thumbnail: "" };
  try {
    const res = await extractSwipe(new NextRequest("http://localhost/api/swipe/extract", { method: "POST", body: JSON.stringify({ url }), headers: { "content-type": "application/json" } }));
    const j = (await res.json()) as Partial<typeof meta> & { error?: string };
    if (!j.error) meta = { ...meta, ...j };
  } catch {
    // Sans métadonnées, le reel est quand même ajouté : Mady le complétera.
  }
  const db = readDB();
  const row: Swipe = {
    id: newId(),
    url,
    platform: meta.platform,
    author: meta.author,
    title: meta.title,
    caption: meta.caption,
    thumbnail: meta.thumbnail,
    transcriptInput: "",
    screenTextInput: "",
    tags: (spec.note ?? "").trim().slice(0, 300),
    analysis: null,
    status: "a-analyser",
    etapeManuelle: funnel,
    createdAt: new Date().toISOString(),
  };
  db.swipes.unshift(row);
  writeDB(db);
  return { id: row.id, title: row.title || row.author, funnel, url };
}
