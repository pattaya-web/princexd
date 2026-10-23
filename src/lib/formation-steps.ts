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
  };
}

type Seed = Pick<CourseStep, "title" | "detail" | "link">;

const SEED: Seed[] = [
  {
    title: "Remplis le formulaire d'onboarding",
    detail: "5 minutes. C'est ce qui permet à Mady de préparer ton accompagnement : ta situation, ton objectif, pourquoi tu l'as choisi. On ne démarre pas sans.",
    link: "{{formulaire}}",
  },
  {
    title: "Installe les outils de travail",
    detail:
      "Suis la page Démarrage : message de bienvenue avec tous les liens, guide pas à pas pour installer Claude Code et connecter Shopify (Windows et Mac), installation du thème.\n- Visual Studio Code (gratuit) : https://code.visualstudio.com\n- Claude Pro Max (90 €/mois) : {{claude}}\n- Chrome Remote Desktop (gratuit) : https://remotedesktop.google.com/access , pour que Mady prenne la main sur ton écran quand tu bloques\n\nTout doit être installé avant ton premier call.",
    link: "/formation/demarrage",
  },
  {
    title: "Ouvre ta boutique Shopify (1 €)",
    detail: "Passe par le lien de Mady pour avoir les premiers mois à 1 €. Choisis le plan de base, note bien l'adresse de ta boutique (xxx.myshopify.com) : tu en auras besoin pour la génération.",
    link: "{{shopify}}",
  },
  {
    title: "Prends BrainSearch, plan Starter",
    detail: "63 $/mois. C'est l'outil de recherche produit : on s'en sert dès la première semaine pour trouver les produits qui se vendent déjà.",
    link: "{{brainsearch}}",
  },
  {
    title: "Crée ton compte Meta Business et ton Gestionnaire de publicités",
    detail:
      "- Crée un portefeuille Meta Business sur business.facebook.com\n- Crée un compte publicitaire, ajoute ta carte bancaire et vérifie-le\n- Crée une page Facebook et relie ton compte Instagram de marque\n- Donne l'accès à Mady (partenaire) quand il te le demandera",
    link: "https://business.facebook.com",
  },
  {
    title: "Regarde les modules Fondations de la formation",
    detail: "Les premiers modules, dans l'ordre. Coche chaque module quand il est terminé : c'est comme ça que Mady suit ton avancement.",
    link: "/formation/cours",
  },
  {
    title: "Trouve 3 produits avec BrainSearch et envoie-les à Mady",
    detail: "Applique la méthode du module recherche produit. Pour chaque produit : lien du concurrent, prix de vente, pourquoi il marche. Envoie les 3 à Mady sur WhatsApp, il valide avec toi.",
    link: "",
  },
  {
    title: "Valide ton produit avec Mady",
    detail: "Un call de validation : positionnement, prix, angle marketing. C'est à partir de là que la boutique se construit.",
    link: "",
  },
  {
    title: "Ta boutique est générée : vérifie et complète",
    detail:
      "Mady génère ta boutique avec Claude Code à partir de son template. Ensuite, à toi :\n- vérifier les textes de la page d'accueil et de la fiche produit\n- ajouter logo, nom de marque, mentions légales, politique de retour\n- activer Shopify Payments et faire une commande test",
    link: "",
  },
  {
    title: "Crée tes créatives avec l'IA",
    detail: "Page Créatives : la boutique exemple, des créatives qui marchent et les prompts à copier dans Claude ou GPT. 3 vidéos UGC et 3 images par produit, avec les prompts donnés dans le module créatives. Pas de perfection : on teste vite et on garde ce qui marche.",
    link: "/formation/creatives",
  },
  {
    title: "Installe le Pixel Meta et la Conversions API",
    detail: "Dans Shopify : canal Facebook & Instagram, connecte ton compte Meta, active le partage de données « maximal ». Vérifie que le Pixel remonte bien une vue de page et un ajout au panier.",
    link: "",
  },
  {
    title: "Lance ta première campagne Meta Ads",
    detail: "Campagne de test selon la structure du module Meta Ads (budget, audiences larges, 3 à 6 créatives). Lancement à minuit, on ne touche à rien pendant 3 jours.",
    link: "",
  },
  {
    title: "Analyse à J+3 et point avec Mady",
    detail: "Récupère les chiffres (dépense, CPM, CTR, coût par achat) et réserve un call : on coupe, on scale ou on change de créative.",
    link: "",
  },
];

/** Pose les étapes par défaut une seule fois (base sans étape). Renvoie vrai s'il y a eu écriture. */
export function ensureCourseSteps(db: DB): boolean {
  db.courseSteps ??= [];
  if (db.settings.courseStepsSeededAt) return false;
  if (!db.courseSteps.length) {
    const now = new Date().toISOString();
    db.courseSteps = SEED.map((s, i) => ({ id: newId(), ...s, order: i, published: true, createdAt: now, updatedAt: now }));
  }
  db.settings.courseStepsSeededAt = new Date().toISOString();
  return true;
}

/**
 * Relie les étapes déjà en base aux pages de la plateforme quand leur lien
 * est vide (Démarrage, Créatives). Idempotent : vrai seulement s'il y a eu
 * une écriture.
 */
export function ensureGuideStepLink(db: DB): boolean {
  const links: [RegExp, string][] = [
    [/installe les outils/i, "/formation/demarrage"],
    [/crée tes créatives/i, "/formation/creatives"],
  ];
  let changed = false;
  for (const [re, link] of links) {
    const step = (db.courseSteps ?? []).find((s) => re.test(s.title));
    if (step && !step.link.trim()) {
      step.link = link;
      step.updatedAt = new Date().toISOString();
      changed = true;
    }
  }
  return changed;
}

export const sortSteps = <T extends Pick<CourseStep, "order" | "createdAt">>(steps: T[]): T[] =>
  steps.slice().sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));

/** Remplace les balises d'onboarding d'un lien d'étape ({{formulaire}}, {{shopify}}, {{claude}}, {{brainsearch}}). */
export function resolveStepLink(link: string, settings: Pick<Settings, "studentOnboarding">): string {
  const cfg = onboardingSettings(settings);
  const map: Record<string, string> = { formulaire: cfg.formUrl, shopify: cfg.shopifyUrl, claude: cfg.claudeUrl, brainsearch: cfg.brainsearchUrl };
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
