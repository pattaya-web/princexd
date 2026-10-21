/**
 * « Ma marque » : personal brand, avatar client, offre, piliers, règles et
 * SOP, saisis une fois et injectés dans tous les prompts de contenu
 * (analyse de Reels, scripts, stories, stratégie, pubs, swipe file,
 * scénariste YouTube).
 *
 * Le texte compilé est aussi écrit dans `settings.brandContext`, le champ
 * historique que les prompts lisent déjà : rien à rebrancher.
 */
import type { BrandProfile, Settings } from "./types";

export const EMPTY_BRAND: BrandProfile = { identity: "", audience: "", offer: "", resources: "", pillars: "", rules: "", sops: "" };

/** Libellés des sections, dans l'ordre d'injection. */
export const BRAND_SECTIONS: { key: keyof BrandProfile; title: string; hint: string; placeholder: string }[] = [
  {
    key: "identity",
    title: "Qui je suis (personal brand)",
    hint: "Prénom, âge, métier, ce qui te rend différent, ton histoire en 3 lignes, ta façon de parler et tes expressions.",
    placeholder:
      "Mady, 24 ans, coach e-commerce et IA, marché francophone. Je fais vraiment de l'e-commerce : je montre mes boutiques et mes chiffres, je ne vends pas de rêve. Cash, drôle, familier, je tutoie toujours. Expressions : « frérot », « en vrai », « le rêve », « officiel ? », « let's go », « honnêtement ». Histoire : parti sans argent, business ratés, mon meilleur ami qui explose en e-com à côté de moi, puis plus de 1M généré grâce à l'e-com.",
  },
  {
    key: "audience",
    title: "À qui je parle (avatar client)",
    hint: "Qui, âge, situation, ce qu'il veut, ce qui lui fait peur, ce qu'il a déjà essayé, ce qu'il se dit le soir.",
    placeholder:
      "Débutant francophone, 20 à 60 ans, salarié ou étudiant, veut un revenu complémentaire, ne sait pas par où commencer, a peur de perdre de l'argent sur les mauvais produits ou les mauvaises pubs, attiré par l'IA, a besoin d'être accompagné.",
  },
  {
    key: "offer",
    title: "Mon offre",
    hint: "Nom, format, pour qui, promesse honnête, prix si tu veux qu'il soit cité, comment on y entre (call, masterclass…).",
    placeholder: "Scale X : accompagnement 1:1 pour débutants. Trouver un produit, monter la boutique avec l'IA, lancer une pub Meta, lire les données. Entrée par un appel découverte après la masterclass gratuite.",
  },
  {
    key: "resources",
    title: "Mes ressources (CTA indirects)",
    hint: "Lead magnets, liens en bio, masterclass, guides : ce vers quoi un contenu peut renvoyer sans vendre.",
    placeholder: "Masterclass gratuite (lien en bio) · Guide « 10 produits à éviter » · Boutique démo visible sur demande",
  },
  {
    key: "pillars",
    title: "Mes piliers de contenu",
    hint: "3 à 5 thèmes que tout contenu doit servir.",
    placeholder: "1. La preuve : mes boutiques, mes chiffres, mes élèves.\n2. La méthode : produit, boutique IA, pub Meta, lecture des données.\n3. La peur : ne pas perdre d'argent, promesses du marché démontées.",
  },
  {
    key: "rules",
    title: "Règles de contenu",
    hint: "Ce qu'on fait toujours, ce qu'on ne fait jamais. Les prompts les appliquent à la lettre.",
    placeholder:
      "- Chaque chiffre a sa preuve à l'écran, sinon [À VÉRIFIER].\n- Jamais de promesse de revenu.\n- Pas de jargon américain traduit : exemples français ou belges.\n- Les blagues et les expressions restent.\n- Un CTA indirect vers une ressource, un CTA direct à la fin.",
  },
  {
    key: "sops",
    title: "SOP et process",
    hint: "Tes procédures : structure d'un Reel, d'une story, d'une pub, checklist avant publication, format des hooks… Tout ce qu'un prompt doit respecter.",
    placeholder:
      "REEL : hook 3 s (promesse + émotion) → contexte 10 s → preuve à l'écran → méthode en 3 points → CTA indirect.\nSTORY : 3 par jour, 1 valeur / 1 vie / 1 CTA.\nPUB UGC : 1 personne, 1 problème, 1 preuve, 1 appel à l'action, 30 à 45 s.",
  },
];

export function hasBrand(b?: BrandProfile | null): boolean {
  return Boolean(b && BRAND_SECTIONS.some((s) => (b[s.key] ?? "").trim()));
}

/** Le bloc texte injecté dans les prompts : seulement les sections remplies. */
export function compileBrand(b: BrandProfile): string {
  const parts: string[] = [];
  for (const s of BRAND_SECTIONS) {
    const v = (b[s.key] ?? "").trim();
    if (v) parts.push(`${s.title.toUpperCase()}\n${v}`);
  }
  return parts.join("\n\n");
}

/** Le contexte en vigueur : la fiche structurée si elle est remplie, sinon l'ancien champ libre. */
export function brandContextOf(settings: Pick<Settings, "brand" | "brandContext">): string {
  return hasBrand(settings.brand) ? compileBrand(settings.brand as BrandProfile) : (settings.brandContext ?? "").trim();
}

/** Ajoute le contexte de marque à une consigne système, comme source de vérité. */
export function withBrandContext(system: string, settings: Pick<Settings, "brand" | "brandContext">): string {
  const ctx = brandContextOf(settings);
  if (!ctx) return system;
  return `${system}\n\nCONTEXTE DE MARQUE (source de vérité : identité, audience, offre, règles et process à respecter, ils priment sur toute autre description) :\n${ctx}`;
}
