import { newId } from "@/lib/db";
import { DEFAULT_TEMPLATE_CATEGORIES } from "./templates";
import type { DB, MessageTemplate } from "@/lib/types";

/**
 * Exemples de templates, poses une seule fois (cote serveur : newId lit la
 * base). Le reste (rendu, lien WhatsApp, tri) vit dans templates.ts, partage
 * avec le navigateur.
 */

type Seed = Pick<MessageTemplate, "name" | "category" | "content" | "channel" | "isFavorite"> & { defaultFor?: string[] };

/** Pas de prenom dans les exemples : on copie-colle sans verifier le nom. */
const SEED: Seed[] = [
  {
    name: "Appel sans réponse — Lead Ads",
    category: "LEAD ADS",
    channel: "whatsapp",
    isFavorite: true,
    defaultFor: ["no-answer"],
    content:
      "Salut, c’est Mady. Je viens d’essayer de t’appeler après ton passage sur ma masterclass E-commerce + IA.\n\nJe voulais simplement voir où tu en es actuellement sur ton projet et échanger 5 min avec toi pour voir ce que tu cherches à mettre en place.\n\nSi tu veux remettre un visage sur le nom :\nhttps://www.instagram.com/mvdyprince/\n\nT’es plus dispo aujourd’hui ou demain ?",
  },
  {
    name: "Relance après premier message",
    category: "RELANCE",
    channel: "whatsapp",
    isFavorite: true,
    content: "Salut, je me permets de te relancer rapidement suite à mon message.\n\nDis-moi simplement si ton projet e-commerce est toujours d’actualité et on voit ensemble si ça vaut le coup qu’on échange.",
  },
  {
    name: "R2 à programmer",
    category: "R2",
    channel: "whatsapp",
    isFavorite: true,
    content: "Comme vu ensemble, le mieux maintenant c’est qu’on se bloque un deuxième appel pour rentrer concrètement dans ton projet et voir comment on peut avancer.\n\nDis-moi tes dispos et on cale ça.",
  },
  {
    name: "Envoi contrat",
    category: "CONTRAT",
    channel: "whatsapp",
    isFavorite: true,
    content: "Je viens de t’envoyer le contrat.\n\nPrends le temps de le lire tranquillement et dis-moi dès que c’est bon de ton côté.\n\nSi t’as la moindre question avant de valider, tu m’écris directement ici.",
  },
  {
    name: "Paiement en attente",
    category: "PAIEMENT",
    channel: "whatsapp",
    isFavorite: true,
    content: "Salut, je reviens rapidement vers toi concernant ce qu’on avait validé ensemble.\n\nDis-moi simplement si c’est toujours bon de ton côté pour qu’on avance comme prévu.",
  },
  {
    name: "Après call — Follow-up",
    category: "APRÈS CALL",
    channel: "whatsapp",
    isFavorite: false,
    content: "Merci pour l’échange.\n\nRéfléchis tranquillement à ce qu’on s’est dit et si t’as une question qui te vient entre-temps, écris-moi directement ici.",
  },
  {
    name: "No-show",
    category: "NO-SHOW",
    channel: "whatsapp",
    isFavorite: false,
    content: "Salut, je t’attendais pour notre appel mais j’imagine que t’as eu un imprévu.\n\nDis-moi simplement si tu veux qu’on le recale et je te trouve un autre créneau.",
  },
];

/** Pose les exemples une seule fois (base vide de templates). Renvoie vrai s'il y a eu ecriture. */
export function ensureMessageTemplates(db: DB): boolean {
  if (db.settings.messageTemplatesSeededAt) return false;
  db.messageTemplates ??= [];
  if (!db.messageTemplates.length) {
    const now = new Date().toISOString();
    db.messageTemplates = SEED.map((s, i) => ({ id: newId(), ...s, isActive: true, sortOrder: i, createdAt: now, updatedAt: now }));
  }
  db.settings.messageTemplateCategories ??= [...DEFAULT_TEMPLATE_CATEGORIES];
  db.settings.messageTemplatesSeededAt = new Date().toISOString();
  ensureConfirmationTemplate(db);
  return true;
}

/** Message de confirmation du call (Agenda) : pose une fois, meme sur une base deja seedee. */
const CONFIRMATION: Seed = {
  name: "Confirmation du call",
  category: "CONFIRMATION",
  channel: "whatsapp",
  isFavorite: false,
  content:
    "Salut, c’est Mady. Je te confirme notre call {{date}} à {{heure}}.\n\nVoici le lien pour nous rejoindre :\n{{lien}}\n\nSi t’as un empêchement, dis-le moi ici et on recale. À tout à l’heure !",
};

export function ensureConfirmationTemplate(db: DB): boolean {
  if (db.settings.messageTemplatesConfirmAt) return false;
  db.messageTemplates ??= [];
  if (!db.messageTemplates.some((t) => t.category === "CONFIRMATION")) {
    const now = new Date().toISOString();
    db.messageTemplates.push({ id: newId(), ...CONFIRMATION, isActive: true, sortOrder: db.messageTemplates.reduce((m, x) => Math.max(m, x.sortOrder), -1) + 1, createdAt: now, updatedAt: now });
  }
  const cats = db.settings.messageTemplateCategories ?? [...DEFAULT_TEMPLATE_CATEGORIES];
  if (!cats.includes("CONFIRMATION")) db.settings.messageTemplateCategories = [...cats, "CONFIRMATION"];
  db.settings.messageTemplatesConfirmAt = new Date().toISOString();
  return true;
}

