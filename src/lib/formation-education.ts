/**
 * Education (plateforme élèves Scale X) : les guides PDF, dans l'ordre.
 *
 * Pas de vidéo pour l'instant : tout le cours est livré en PDF très
 * détaillés. Les sources HTML vivent dans content/education/, les PDF sont
 * construits par `node scripts/build-education.mjs` dans
 * public/formation/education/ et servis aux élèves connectés (le middleware
 * laisse passer /formation/*). L'élève coche chaque guide lu
 * (`Student.completedLessons`), Mady suit l'avancement.
 * Module pur : serveur et navigateur.
 */

export type LessonGroup = "Fondations" | "Lancement" | "Bonus";

export interface Lesson {
  id: string;
  order: number;
  group: LessonGroup;
  title: string;
  summary: string;
  /** Temps de lecture indicatif, en minutes. */
  minutes: number;
  /** Chemin public du PDF. */
  file: string;
}

const pdf = (slug: string) => `/formation/education/${slug}.pdf`;

export const LESSONS: Lesson[] = [
  {
    id: "01-methode",
    order: 1,
    group: "Fondations",
    title: "La méthode Scale X",
    summary: "Les 6 étapes du système, le rythme, les outils et leur coût, les 13 étapes de ta marche à suivre expliquées une par une.",
    minutes: 25,
    file: pdf("01-la-methode-scale-x"),
  },
  {
    id: "02-produit",
    order: 2,
    group: "Fondations",
    title: "Trouver un produit qui se vend déjà avec BrandSearch",
    summary: "Les 4 critères, la prise en main de brandsearch.co, la marge, les niches à éviter, les 10 produits à envoyer à Mady.",
    minutes: 30,
    file: pdf("02-recherche-produit-brandsearch"),
  },
  {
    id: "03-shopify",
    order: 3,
    group: "Fondations",
    title: "Créer et paramétrer ta boutique Shopify",
    summary: "Tous les réglages pas à pas : paiements, livraison, taxes, politiques, domaine, commande test. Ta boutique peut encaisser.",
    minutes: 35,
    file: pdf("03-shopify-creer-et-parametrer"),
  },
  {
    id: "04-claude-code",
    order: 4,
    group: "Fondations",
    title: "Ta boutique sans une ligne de code : Claude Code + Shopify CLI",
    summary: "Le thème Aesthetic Lab, le cycle de travail en deux fenêtres, les prompts de Mady à copier, les erreurs fréquentes.",
    minutes: 30,
    file: pdf("04-claude-code-et-shopify-cli"),
  },
  {
    id: "05-page-produit",
    order: 5,
    group: "Fondations",
    title: "La page produit qui convertit",
    summary: "Une section = une objection. Les 11 sections dans l'ordre, l'offre, le copywriting, la relecture avant mise en ligne.",
    minutes: 30,
    file: pdf("05-la-page-produit-qui-convertit"),
  },
  {
    id: "06-medias",
    order: 6,
    group: "Fondations",
    title: "Les médias de ta boutique avec GPT Image 2",
    summary: "Image de référence, formats, 7 types de médias, standard anti-IA, 12 prompts prêts à copier, placement dans le thème.",
    minutes: 30,
    file: pdf("06-medias-de-la-boutique"),
  },
  {
    id: "07-creatives",
    order: 7,
    group: "Lancement",
    title: "Tes créatives publicitaires avec l'IA",
    summary: "Statiques post-it, 6 formats vidéo Seedance, scripts UGC, montage simple, 5 à 8 créatives pour la première campagne.",
    minutes: 35,
    file: pdf("07-creatives-publicitaires-ia"),
  },
  {
    id: "08-meta-pixel",
    order: 8,
    group: "Lancement",
    title: "Meta Business, compte publicitaire et Pixel",
    summary: "Portefeuille, page, compte pub vérifié, accès partenaire à Mady, Pixel + Conversions API vérifiés événement par événement.",
    minutes: 25,
    file: pdf("08-meta-business-et-pixel"),
  },
  {
    id: "09-campagne",
    order: 9,
    group: "Lancement",
    title: "Lancer ta première campagne Meta Ads",
    summary: "Objectif Ventes, 1 CBO à 30 à 50 €/jour, 1 ad set large, 5 à 8 créatives, lancement le soir, 3 jours sans toucher. Configuration pas à pas et textes de pub.",
    minutes: 30,
    file: pdf("09-premiere-campagne-meta-ads"),
  },
  {
    id: "10-chiffres",
    order: 10,
    group: "Lancement",
    title: "Lire les chiffres et scaler",
    summary: "CTR, CPC, ROAS dans l'ordre, le ROAS de rentabilité, décision à J+3, +20 % tous les 2 jours si ça tient, la boucle hebdo.",
    minutes: 30,
    file: pdf("10-lire-les-chiffres-et-scaler"),
  },
  {
    id: "11-organique",
    order: 11,
    group: "Bonus",
    title: "Le trafic organique avec des comptes 100 % IA",
    summary: "Un personnage, une niche, Genjutsu pour la cohérence, 2 à 3 vidéos par jour. Zéro euro de pub.",
    minutes: 25,
    file: pdf("11-organique-ia"),
  },
  {
    id: "12-logistique",
    order: 12,
    group: "Bonus",
    title: "Fournisseur, livraison et service client",
    summary: "AliExpress puis agent, échantillon, délais honnêtes, suivi de colis, messages clients types, retours et obligations en France.",
    minutes: 30,
    file: pdf("12-logistique-fournisseur-et-service-client"),
  },
];

export const LESSON_GROUPS: LessonGroup[] = ["Fondations", "Lancement", "Bonus"];

/** Avancement d'un élève dans les guides. */
export function lessonProgress(completed: string[] | undefined) {
  const done = new Set(completed ?? []);
  const total = LESSONS.length;
  const doneCount = LESSONS.filter((l) => done.has(l.id)).length;
  const resumeIdx = LESSONS.findIndex((l) => !done.has(l.id));
  return {
    total,
    done: doneCount,
    percent: total ? Math.round((doneCount / total) * 100) : 0,
    resume: resumeIdx >= 0 ? { ...LESSONS[resumeIdx], index: resumeIdx } : null,
  };
}
