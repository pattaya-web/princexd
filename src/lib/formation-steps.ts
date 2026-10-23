import { newId } from "@/lib/db";
import { onboardingSettings } from "@/lib/onboarding";
import type { CourseStep, DB, Settings, Student, StudentPortalSettings, StudentTask } from "@/lib/types";

/**
 * Parcours « Scale X » : la marche a suivre des eleves (cote serveur).
 *
 * Les etapes par defaut reprennent la methode de Mady, dans l\x27ordre ou un
 * eleve doit les faire pour lancer vite sur Meta Ads. Posees une seule fois ;
 * ensuite tout se gere dans Formation → Parcours & etapes.
 */

export const DEFAULT_PORTAL: StudentPortalSettings = {
  bookingUrl: "",
  whatsapp: "",
  helpText: "Tu bloques ? Demande d'abord à Claude (page Démarrage, section 07) : il règle la plupart des problèmes en direct. Mady, c'est pour les urgences et les validations : réserve ton créneau.",
  quote: "Plus vite tu lances, plus vite tu apprends. Le reste, c'est de l'optimisation.",
  quoteAuthor: "Mady",
  /** Vidéo d'accompagnement de Mady (YouTube non répertorié), remplaçable depuis Démarrage. */
  welcomeVideoUrl: "https://youtu.be/ZqxCDnJMZ2w",
};

/** Réglages en vigueur, avec le lien iClosed du compte en repli pour la réservation. */
export function portalSettings(settings: Pick<Settings, "studentPortal" | "salesBookingUrl">): StudentPortalSettings {
  const p = settings.studentPortal ?? {};
  return {
    bookingUrl: (p.bookingUrl ?? "").trim() || (settings.salesBookingUrl ?? "").trim(),
    whatsapp: (p.whatsapp ?? "").trim(),
    helpText: (p.helpText ?? "").trim() || DEFAULT_PORTAL.helpText,
    quote: (p.quote ?? "").trim() || DEFAULT_PORTAL.quote,
    quoteAuthor: (p.quoteAuthor ?? "").trim() || DEFAULT_PORTAL.quoteAuthor,
    welcomeVideoUrl: (p.welcomeVideoUrl ?? "").trim() || DEFAULT_PORTAL.welcomeVideoUrl,
  };
}

type Seed = Pick<CourseStep, "title" | "detail" | "link">;

type SeedV2 = Seed & { /** Ancien titre (version 1), pour retrouver l'étape déjà en base. */ was: RegExp };

const SEED: SeedV2[] = [
  {
    was: /formulaire d'onboarding/i,
    title: "Remplis le formulaire d'onboarding (5 min)",
    detail:
      "Clique sur « Ouvrir le lien » et réponds aux questions : ta situation, ton objectif, pourquoi tu as choisi Mady. C'est avec ça qu'il prépare ton accompagnement.\n\n✅ Fait quand : tu as vu la page de confirmation du formulaire.",
    link: "{{formulaire}}",
  },
  {
    was: /installe les outils/i,
    title: "Installe VS Code et Claude Code (15 min)",
    detail:
      "Page Démarrage, sections 01 à 04 : tu installes VS Code, tu ajoutes l'extension Claude Code, tu ouvres ton dossier et tu colles le premier message à Claude. C'est lui qui installe et connecte le reste, tu dis oui. Prends Claude Max ({{claude}}) avant.\n\n✅ Fait quand : Claude te répond « C'est prêt » et ton aperçu de boutique s'ouvre dans le navigateur.",
    link: "/formation/demarrage",
  },
  {
    was: /boutique shopify/i,
    title: "Ouvre ta boutique Shopify (1 €) et note son adresse",
    detail:
      "Passe par le lien de Mady pour avoir les premiers mois à 1 €. Choisis le plan Basic. Puis Paramètres > Domaines : note ton adresse xxx.myshopify.com, tu en auras besoin pour la génération de ta boutique.\n\n✅ Fait quand : tu peux ouvrir l'admin Shopify et tu as noté ton adresse myshopify.",
    link: "{{shopify}}",
  },
  {
    was: /br(ai|a)ndsearch, plan starter|brainsearch, plan/i,
    title: "Prends BrandSearch, plan Starter",
    detail:
      "63 $/mois. C'est l'outil de recherche produit : il montre les produits qui se vendent déjà, les pubs qui tournent et les boutiques qui scalent. On s'en sert dès la première semaine.\n\n✅ Fait quand : tu es connecté à BrandSearch et tu vois le tableau de bord.",
    link: "{{brainsearch}}",
  },
  {
    was: /meta business/i,
    title: "Crée ton compte Meta Business et ton compte publicitaire",
    detail:
      "- Crée un portefeuille Meta Business sur business.facebook.com\n- Crée un compte publicitaire, ajoute ta carte bancaire et vérifie-le\n- Crée une page Facebook et relie ton compte Instagram de marque\n- Donne l'accès à Mady (partenaire) quand il te le demandera\n\n✅ Fait quand : le compte publicitaire est vérifié, la carte est ajoutée et Mady a l'accès partenaire.",
    link: "https://business.facebook.com",
  },
  {
    was: /modules fondations|guides fondations/i,
    title: "Lis les guides Fondations (Education)",
    detail:
      "Les guides PDF, dans l'ordre : la méthode, la recherche produit, la boutique, les créatives, Meta Ads. Lis-les en entier, coche chaque guide quand c'est fait : c'est comme ça que Mady suit ton avancement.\n\n✅ Fait quand : tous les guides Fondations sont cochés.",
    link: "/formation/education",
  },
  {
    was: /trouve 3 produits/i,
    title: "Trouve 3 produits avec BrandSearch et envoie-les à Mady",
    detail:
      "Applique le guide Recherche produit. Pour chaque produit : lien du concurrent, prix de vente, pourquoi il marche (pubs actives, avis, tendance). Envoie les 3 à Mady sur WhatsApp, en un seul message.\n\n✅ Fait quand : Mady t'a répondu sur tes 3 produits.",
    link: "",
  },
  {
    was: /valide ton produit/i,
    title: "Valide ton produit avec Mady (call)",
    detail:
      "Réserve un call de validation : positionnement, prix, angle marketing, nom de marque. C'est à partir de là que la boutique se construit.\n\n✅ Fait quand : le produit est validé et tu as ton nom de marque.",
    link: "/formation/appel",
  },
  {
    was: /boutique est générée|boutique est generee/i,
    title: "Demande ta boutique à Mady, puis vérifie et complète",
    detail:
      "Page Démarrage, section 09 : donne ton adresse myshopify et ton produit. Mady génère la boutique (produits, collection, pages, thème Aesthetic Lab). Ensuite, à toi :\n- relire l'accueil et la fiche produit\n- ajouter logo, nom de marque, politiques\n- activer Shopify Payments et faire une commande test (Démarrage, section 04)\n\n✅ Fait quand : tu peux acheter sur ta boutique depuis ton téléphone.",
    link: "/formation/demarrage#boutique",
  },
  {
    was: /cr[ée]e tes cr[ée]atives/i,
    title: "Crée tes créatives avec l'IA",
    detail:
      "Page Créatives : angles → prompts (Claude ou GPT) → images et vidéos (Higgsfield ou Studio IA). Objectif : 3 vidéos + 3 images par produit, formats 9:16 et 4:5. Pas de perfection, on teste vite.\n\n✅ Fait quand : 6 créatives exportées dans un dossier, prêtes à envoyer.",
    link: "/formation/creatives",
  },
  {
    was: /pixel meta/i,
    title: "Installe le Pixel Meta et la Conversions API",
    detail:
      "Page Démarrage, section 06 : application Facebook & Instagram dans Shopify, partage de données « Maximal », test des événements.\n\n✅ Fait quand : PageView, ViewContent, AddToCart, InitiateCheckout et Purchase apparaissent dans « Tester les événements », avec Navigateur ET Serveur.",
    link: "/formation/demarrage#pixel",
  },
  {
    was: /premi[èe]re campagne/i,
    title: "Lance ta première campagne Meta Ads",
    detail:
      "Suis le guide Meta Ads : campagne de test, audiences larges, 3 à 6 créatives, budget quotidien fixé avec Mady. Lancement à minuit, on ne touche à rien pendant 3 jours.\n\n✅ Fait quand : la campagne est active et dépense.",
    link: "",
  },
  {
    was: /j\+3/i,
    title: "Analyse à J+3 et fais le point avec Mady",
    detail:
      "Récupère dépense, CPM, CTR, coût par achat (guide Analyse). Réserve un call : on coupe, on garde ou on scale, et on prépare la suite.\n\n✅ Fait quand : le call J+3 est fait.",
    link: "/formation/appel",
  },
];

/** Pose les étapes par défaut une seule fois (base sans étape). Renvoie vrai s'il y a eu écriture. */
export function ensureCourseSteps(db: DB): boolean {
  db.courseSteps ??= [];
  if (db.settings.courseStepsSeededAt) return false;
  if (!db.courseSteps.length) {
    const now = new Date().toISOString();
    db.courseSteps = SEED.map(({ was: _was, ...s }, i) => ({ id: newId(), ...s, order: i, published: true, createdAt: now, updatedAt: now }));
  }
  db.settings.courseStepsSeededAt = new Date().toISOString();
  db.settings.courseStepsSeedVersion = SEED_VERSION;
  return true;
}

/** Version du texte des étapes par défaut. Monter ce numéro réécrit les étapes déjà en base (ids conservés). */
const SEED_VERSION = 3;

/**
 * Met à jour les étapes déjà en base vers la dernière version du texte par
 * défaut (étapes plus claires, BrandSearch, Education) : chaque étape est
 * retrouvée par son ancien titre, son id (donc les coches des élèves) est
 * conservé. Une seule fois par version. Vrai s'il y a eu écriture.
 */
export function ensureGuideStepLink(db: DB): boolean {
  if ((db.settings.courseStepsSeedVersion ?? 1) >= SEED_VERSION) return false;
  const now = new Date().toISOString();
  for (const seed of SEED) {
    const step = (db.courseSteps ?? []).find((s) => seed.was.test(s.title) || s.title === seed.title);
    if (!step) continue;
    step.title = seed.title;
    step.detail = seed.detail;
    step.link = seed.link;
    step.updatedAt = now;
  }
  db.settings.courseStepsSeedVersion = SEED_VERSION;
  return true;
}

export const sortSteps = <T extends Pick<CourseStep, "order" | "createdAt">>(steps: T[]): T[] =>
  steps.slice().sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));

/** Remplace les balises d'onboarding d'un lien d'étape ({{formulaire}}, {{shopify}}, {{claude}}, {{brainsearch}}). */
export function resolveStepLink(link: string, settings: Pick<Settings, "studentOnboarding">): string {
  const cfg = onboardingSettings(settings);
  const map: Record<string, string> = { formulaire: cfg.formUrl, shopify: cfg.shopifyUrl, claude: cfg.claudeUrl, brainsearch: cfg.brainsearchUrl, brandsearch: cfg.brainsearchUrl };
  return (link ?? "").replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => map[k.toLowerCase()] ?? "").trim();
}

/** Une ligne d'étape telle que l'élève la voit : étape commune ou étape assignée. */
export interface StepItem {
  id: string;
  kind: "step" | "task";
  title: string;
  detail: string;
  link: string;
  moduleId: string;
  done: boolean;
  published: boolean;
}

export function stepItems(db: DB, student: Student | undefined, opts: { includeDrafts?: boolean } = {}): { steps: StepItem[]; tasks: StepItem[] } {
  const done = new Set(student?.completedSteps ?? []);
  const steps = sortSteps(db.courseSteps ?? [])
    .filter((s) => s.published || opts.includeDrafts)
    .map((s) => ({
      id: s.id,
      kind: "step" as const,
      title: s.title,
      detail: resolveStepLink(s.detail, db.settings),
      link: resolveStepLink(s.link, db.settings),
      moduleId: s.moduleId ?? "",
      done: done.has(s.id),
      published: s.published,
    }));
  const tasks = (student?.tasks ?? []).map((t) => ({
    id: t.id,
    kind: "task" as const,
    title: t.title,
    detail: resolveStepLink(t.detail, db.settings),
    link: resolveStepLink(t.link, db.settings),
    moduleId: "",
    done: t.done,
    published: true,
  }));
  return { steps, tasks };
}

/** Lecture des champs d'une étape commune envoyés par l'admin. */
export function readStepFields(raw: Record<string, unknown>, current?: CourseStep): Pick<CourseStep, "title" | "detail" | "link" | "moduleId" | "published"> {
  const str = (v: unknown, fallback: string, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : fallback);
  const title = str(raw.title, current?.title ?? "", 160);
  if (!title) throw new Error("Le titre de l'étape est obligatoire.");
  return {
    title,
    detail: str(raw.detail, current?.detail ?? "", 6000),
    link: str(raw.link, current?.link ?? "", 500),
    moduleId: str(raw.moduleId, current?.moduleId ?? "", 40) || undefined,
    published: typeof raw.published === "boolean" ? raw.published : (current?.published ?? true),
  };
}

export function newTask(input: { title: string; detail?: string; link?: string }): StudentTask {
  const title = (input.title ?? "").trim().slice(0, 160);
  if (!title) throw new Error("Le titre de l'étape est obligatoire.");
  return { id: newId(), title, detail: (input.detail ?? "").trim().slice(0, 4000), link: (input.link ?? "").trim().slice(0, 500), done: false, doneAt: "", createdAt: new Date().toISOString() };
}
