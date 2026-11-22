import type { Student } from "./types";

/**
 * Checklist avant de lancer (Scale X, 2026-11-22) : tout ce qui doit être au
 * vert avant la première campagne / la première boutique. L'élève coche à la
 * main, rien n'est vérifié automatiquement. Les points `optional` sont
 * conseillés mais ne bloquent pas le feu vert. Les ids sont stockés sur la
 * fiche élève (`launchChecklist`) : ne jamais renommer un id existant.
 * Module pur : serveur et navigateur.
 */

export interface ChecklistItem {
  id: string;
  label: string;
  /** Précision sous le point (une phrase). */
  detail?: string;
  /** Page de la formation qui aide sur ce point. */
  link?: { href: string; label: string };
  /** Conseillé, pas obligatoire pour lancer. */
  optional?: boolean;
}

export interface ChecklistGroup {
  key: string;
  title: string;
  items: ChecklistItem[];
}

export const LAUNCH_CHECKLIST: ChecklistGroup[] = [
  {
    key: "boutique",
    title: "Ta boutique",
    items: [
      { id: "domain", label: "Ton nom de domaine est bien acheté et connecté à Shopify", detail: "Ta boutique s'ouvre sur ton domaine, pas sur une adresse en .myshopify.com." },
      { id: "product-pages", label: "Tes pages produits sont finalisées", detail: "Titre, description, prix, variantes : rien de vide, rien de « lorem ipsum », pas de faute." },
      { id: "reviews", label: "Tes avis clients sont en place", detail: "Des avis crédibles et lisibles sur la page produit." },
      { id: "faq", label: "Tu as une FAQ sur ta page produit", detail: "Livraison, retours, taille, utilisation : les questions que ton client se pose avant d'acheter." },
      { id: "photos", label: "Toutes les photos du site sont belles et réalistes", detail: "De belles images produit, cohérentes entre elles, rien qui fasse faux ou bâclé." },
      { id: "mobile", label: "Ton site est responsive : il s'affiche bien sur téléphone", detail: "Ouvre-le sur ton téléphone et fais tout le parcours jusqu'au paiement : la majorité de tes clients viendront de là." },
      { id: "shipping", label: "La livraison est configurée (gratuite ou payante)", detail: "Tarifs et délais réglés dans Shopify, et les mêmes que ceux annoncés sur le site." },
      { id: "market", label: "Le marché est configuré sur Shopify", detail: "Le pays sur lequel tu vas travailler est bien activé (Paramètres → Marchés)." },
      { id: "policies", label: "Tes politiques sont ajoutées en bas de page", detail: "Remboursement, confidentialité, conditions générales, livraison, contact." },
    ],
  },
  {
    key: "tracking",
    title: "Pixel et tracking",
    items: [
      { id: "pixel", label: "Ton pixel Meta est bien connecté à ta boutique" },
      { id: "test-order", label: "Tu as fait un achat test avec un code de réduction à 100 %", detail: "Tu paies toi-même ton propre produit à 0 €, juste pour déclencher l'événement Purchase sur Meta." },
      { id: "purchase-event", label: "L'événement Purchase (achat) est bien remonté dans Meta", detail: "Vérifie dans le Gestionnaire d'événements que ton achat test apparaît." },
      { id: "omega", label: "Omega Pixel est installé, en version payante (environ 9 $ / mois)", detail: "Il envoie toutes tes données à Meta par l'API de conversions, automatiquement : ton tracking est parfait.", link: { href: "/formation/shopify", label: "Astuces Shopify" } },
    ],
  },
  {
    key: "creatives",
    title: "Tes créatives",
    items: [
      { id: "creatives-ready", label: "Tes créatives sont prêtes", link: { href: "/formation/creatives", label: "Créatives" } },
      { id: "creatives-folder", label: "Tout est rangé proprement dans un dossier", detail: "Une créa = un fichier bien nommé, au bon format, prête à être uploadée." },
    ],
  },
  {
    key: "argent",
    title: "Prix et budget",
    items: [
      { id: "supplier-price", label: "Tu as vérifié le prix fournisseur sur AliExpress", detail: "Juste pour avoir une fourchette : regarde à combien le produit se vend en moyenne. Ne te base pas sur ces prix." },
      { id: "ads-budget", label: "Ton enveloppe budgétaire pour tes pubs Meta est prête", link: { href: "/formation/meta", label: "Campagnes Meta" } },
    ],
  },
  {
    key: "regard",
    title: "Le dernier regard",
    items: [
      { id: "convinced", label: "Tu es convaincu de tes créatives, de ta page produit et de ton site", detail: "Si toi tu n'achèterais pas, ton client non plus." },
      { id: "relative-review", label: "Tu as fait vérifier ton site par un proche", detail: "Un regard neuf : son premier avis spontané te dit déjà beaucoup sur ton travail. Pas obligatoire, mais pour ta première boutique c'est toujours plus sympa.", optional: true },
    ],
  },
];

export const CHECKLIST_IDS = new Set(LAUNCH_CHECKLIST.flatMap((g) => g.items.map((i) => i.id)));

export interface ChecklistProgress {
  done: number;
  /** Points obligatoires (les optionnels ne comptent pas). */
  total: number;
  /** Tous les points obligatoires sont cochés : feu vert. */
  ready: boolean;
}

export function checklistProgress(checked: Iterable<string>): ChecklistProgress {
  const set = new Set(checked);
  const required = LAUNCH_CHECKLIST.flatMap((g) => g.items).filter((i) => !i.optional);
  const done = required.filter((i) => set.has(i.id)).length;
  return { done, total: required.length, ready: done === required.length };
}

export const studentChecklist = (s: Pick<Student, "launchChecklist"> | undefined) => (s?.launchChecklist ?? []).filter((id) => CHECKLIST_IDS.has(id));
