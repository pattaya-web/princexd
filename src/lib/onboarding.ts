import type { Settings, StudentOnboardingSettings } from "./types";

/**
 * Message de bienvenue envoyé à un élève dès qu'il rejoint l'accompagnement.
 *
 * Tout est modifiable dans Élèves → Onboarding : les liens (formulaire,
 * affiliations) et le texte lui-même. Le texte porte des balises que l'on
 * remplace au moment de copier :
 *   {{prenom}}       prénom de l'élève
 *   {{formulaire}}   lien du formulaire d'onboarding
 *   {{shopify}}      lien affilié Shopify (1 €)
 *   {{claude}}       lien Claude Max (affilié quand il y en aura un)
 *   {{brainsearch}}  lien BrandSearch (affilié quand il y en aura un) ; {{brandsearch}} accepté aussi
 *   {{plateforme}}   adresse de connexion à la plateforme de formation
 *   {{identifiant}}  identifiant de l'élève sur la plateforme
 *   {{motdepasse}}   mot de passe (connu seulement à sa création)
 * Module pur : utilisable serveur et navigateur.
 */

/** Même lien que le composant Shopify du générateur de boutiques. */
const SHOPIFY_AFFILIATE = "https://shopify.pxf.io/MAVeZN";

/** Lien affilié BrandSearch de Mady (code royalscale), posé le 2026-10-25. Partout où un élève ouvre BrandSearch. */
export const BRANDSEARCH_AFFILIATE = "https://brandsearch.co?ref=royalscale";

/** Une adresse BrandSearch sans code affilié (ancienne valeur enregistrée, ou brainsearch.co) : on y met le lien affilié. */
function brandsearchLink(stored: string): string {
  const v = stored.trim().replace(/brainsearch\.co/i, "brandsearch.co");
  if (!v) return BRANDSEARCH_AFFILIATE;
  if (/^https?:\/\/(www\.)?brandsearch\.co\/?$/i.test(v)) return BRANDSEARCH_AFFILIATE;
  return v;
}

export const DEFAULT_ONBOARDING_MESSAGE = `Bienvenue dans l'accompagnement {{prenom}} 🔥

T'as pris la bonne décision, maintenant on avance. Voici les 3 choses à faire AVANT notre premier call, dans l'ordre : 1. le formulaire (sur la plateforme) 2. la page Démarrage 3. tu m'écris « C'est fait ».

1️⃣ LE FORMULAIRE D'ONBOARDING (5 min, sur la plateforme)
👉 {{formulaire}}
C'est ce qui me permet de préparer ton accompagnement sur mesure : où tu en es, ton objectif, pourquoi tu m'as choisi. On ne démarre pas sans.

2️⃣ LA PAGE DÉMARRAGE : LES OUTILS (on bosse avec dès le premier jour)
La méthode : on trouve le produit avec BrandSearch, on construit la boutique avec Claude Code, on crée les créatives avec l'IA et on lance les pubs avec le Gestionnaire de publicités Meta.

• Shopify, 1 € les premiers mois avec mon lien 👉 {{shopify}}
• Claude Max (90 €/mois), c'est lui qui construit ta boutique 👉 {{claude}}
• Visual Studio Code (gratuit), c'est là que tourne Claude Code 👉 https://code.visualstudio.com
• BrandSearch, plan Starter (63 $/mois), pour trouver les produits 👉 {{brainsearch}}
• Un compte Meta Business + Gestionnaire de publicités (gratuit) 👉 https://business.facebook.com
• Chrome Remote Desktop (gratuit), pour que je prenne la main sur ton écran quand tu bloques 👉 https://remotedesktop.google.com/access

Installe tout maintenant : chaque jour sans ces outils, c'est un jour de retard sur ton lancement.

TA PLATEFORME DE FORMATION (c'est là que sont le formulaire et la page Démarrage)
👉 {{plateforme}}
Identifiant : {{identifiant}} (pas de mot de passe, ton identifiant suffit)
Mot de passe : {{motdepasse}}
Va sur la page Démarrage avant notre call et coche chaque étape quand elle est faite : c'est comme ça que je suis ton avancement.

3️⃣ ÉCRIS-MOI « C'EST FAIT »
Dès que le formulaire et la page Démarrage sont faits, écris-moi « C'est fait » ici et on cale ton premier call.

À très vite,
Mady`;

export const DEFAULT_ONBOARDING: StudentOnboardingSettings = {
  formUrl: "",
  shopifyUrl: SHOPIFY_AFFILIATE,
  claudeUrl: "https://claude.ai/upgrade",
  brainsearchUrl: BRANDSEARCH_AFFILIATE,
  message: DEFAULT_ONBOARDING_MESSAGE,
};

/** Les réglages en vigueur : ceux enregistrés, complétés par les valeurs par défaut. */
export function onboardingSettings(settings: Pick<Settings, "studentOnboarding">): StudentOnboardingSettings {
  const s = settings.studentOnboarding ?? {};
  return {
    formUrl: (s.formUrl ?? "").trim(),
    shopifyUrl: (s.shopifyUrl ?? "").trim() || DEFAULT_ONBOARDING.shopifyUrl,
    claudeUrl: (s.claudeUrl ?? "").trim() || DEFAULT_ONBOARDING.claudeUrl,
    // L'outil s'appelle BrandSearch (brandsearch.co) : l'ancienne adresse enregistrée est corrigée à la lecture,
    // et une adresse sans code affilié reçoit le lien affilié de Mady.
    brainsearchUrl: brandsearchLink(s.brainsearchUrl ?? ""),
    message: ((s.message ?? "").trim() ? s.message! : DEFAULT_ONBOARDING_MESSAGE).replace(/BrainSearch/g, "BrandSearch"),
  };
}

export interface OnboardingContext {
  name: string;
  username?: string;
  /** Connu seulement juste après la création de l'accès. */
  password?: string;
  /** Origine du site (https://mvdyprince.fr) ; la page de connexion est /login. */
  baseUrl: string;
}

/** Remplace les balises du message. Une balise sans valeur reste lisible plutôt que vide. */
export function renderOnboarding(cfg: StudentOnboardingSettings, ctx: OnboardingContext): string {
  const first = ctx.name.trim().split(/\s+/)[0] ?? "";
  const rep = (key: string, value: string) => (text: string) => text.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "gi"), value);
  const steps = [
    rep("prenom", first),
    rep("formulaire", cfg.formUrl || "(lien du formulaire à venir)"),
    rep("shopify", cfg.shopifyUrl),
    rep("claude", cfg.claudeUrl),
    rep("brainsearch", cfg.brainsearchUrl),
    rep("brandsearch", cfg.brainsearchUrl),
    rep("plateforme", `${ctx.baseUrl.replace(/\/$/, "")}/login`),
    rep("identifiant", ctx.username || "(je te l'envoie juste après)"),
    rep("motdepasse", ctx.password || (ctx.username ? "(celui que je t'ai envoyé)" : "(je te l'envoie juste après)")),
  ];
  // Sans mot de passe (identifiant seul depuis le 2026-10-22), la ligne « Mot de passe » saute.
  const base = ctx.password ? cfg.message : cfg.message.replace(/^.*\{\{\s*motdepasse\s*\}\}.*(\r?\n)?/gim, "");
  return steps.reduce((text, step) => step(text), base);
}

/**
 * Le message d'onboarding tel qu'il s'affiche sur la plateforme : les
 * balises sont remplacées, le prénom n'est pas affiché (« on s'en fout »), et
 * tout ce qui suit la partie « plateforme de formation » saute puisque
 * l'élève y est déjà.
 */
export function welcomeMessage(settings: Pick<Settings, "studentOnboarding">): string {
  const cfg = onboardingSettings(settings);
  const paragraphs = cfg.message.replace(/\r\n/g, "\n").split(/\n{2,}/);
  const cut = paragraphs.findIndex((p) => /3️⃣|\{\{\s*(plateforme|identifiant|motdepasse)\s*\}\}/i.test(p));
  const kept = cut > 0 ? paragraphs.slice(0, cut) : paragraphs;
  const text = renderOnboarding({ ...cfg, message: kept.join("\n\n") }, { name: "", baseUrl: "" });
  return text
    .split("\n")
    .map((l) => l.replace(/[ \t]{2,}/g, " ").trimEnd())
    .join("\n")
    .trim();
}

/** Balises reconnues, pour l'aide de l'éditeur. */
export const ONBOARDING_TAGS: { tag: string; label: string }[] = [
  { tag: "{{prenom}}", label: "prénom de l'élève" },
  { tag: "{{formulaire}}", label: "formulaire d'onboarding" },
  { tag: "{{shopify}}", label: "lien Shopify affilié" },
  { tag: "{{claude}}", label: "lien Claude Max" },
  { tag: "{{brainsearch}}", label: "lien BrandSearch" },
  { tag: "{{plateforme}}", label: "page de connexion" },
  { tag: "{{identifiant}}", label: "identifiant plateforme" },
  { tag: "{{motdepasse}}", label: "mot de passe plateforme" },
];
