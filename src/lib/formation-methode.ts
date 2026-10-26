import type { Settings, StudentMethodSettings } from "@/lib/types";

/**
 * Pages « Recherche produit » et « Ta boutique » de la plateforme élèves
 * (Scale X) : la vidéo BrandSearch, la consigne des 10 produits à envoyer à
 * Mady sur WhatsApp, et le message que l'élève colle à Claude Code pour
 * poser le thème de Mady sur sa boutique. Valeurs par défaut ici, tout est
 * modifiable par l'admin depuis les pages. Module pur : serveur et navigateur.
 */

export const DEFAULT_PRODUCT_COUNT = 10;

export const DEFAULT_THEME_PROMPT = `Dans mon dossier il y a le fichier [NOM-DU-ZIP].zip : c'est le thème Shopify « Aesthetic Lab » de mon coach Mady (Online Store 2.0, dossiers assets / config / layout / locales / sections / snippets / templates à la racine, avec un README.md à lire en premier). Sa page est parfaite. Tu ne changes ni la structure, ni le design, ni l'ordre des sections, ni les couleurs, ni les polices, ni le CSS.

Ma boutique : [mon-adresse].myshopify.com
Mon produit : [nom, ce que c'est, ce qu'il fait, prix de vente, prix barré]
Ma marque : [nom de marque] · e-mail support : [support@…]
Ma cible : [qui achète et pourquoi]
Mes images et vidéos : dans le sous-dossier « creatives »

Fais tout toi-même avec Shopify CLI, je ne tape aucune commande :
1. Décompresse le zip dans un dossier « theme » et lis le README.md.
2. Connecte-le à ma boutique et lance l'aperçu (shopify theme dev --store [mon-adresse].myshopify.com). Donne-moi le lien d'aperçu à ouvrir.
3. Remplace UNIQUEMENT le contenu, dans cet ordre, en me montrant chaque étape dans l'aperçu avant de passer à la suivante :
   - Réglages du thème : nom de marque (wordmark), favicon, e-mail support, liens clés (produit principal, collection principale).
   - Hero : ma vidéo 9:16 (ou mon image) du dossier creatives à la place des aplats gris, titre et sous-titre pour mon produit.
   - Sections bénéfices, comment ça marche, avant / après, avis, FAQ, pied de page : réécris tous les textes pour mon produit, en français, même longueur que les textes existants ; mets mes images à la place des placeholders ; propose-moi 6 avis clients crédibles à valider.
   - Page produit : garde un seul template produit, supprime les exemples (jawliner, patch, tape, peptide…), crée mon produit (titre, description, prix, prix barré, images) et les métachamps aesthetic_lab que le README décrit.
   - Dis-moi les images ou vidéos qui manquent, à quel endroit, et dans quel format (3:4, 1:1, 9:16, 16:9) : je les génère dans mon Studio IA.
4. Quand je dis « OK, mets en ligne » : envoie le thème sur ma boutique (shopify theme push --unpublished), publie-le, et vérifie que la page d'accueil et la page produit s'affichent bien sur mobile.

Si une erreur apparaît, corrige-la et continue. Explique-moi chaque étape en une phrase simple, sans jargon.`;


export const DEFAULT_METHOD: StudentMethodSettings = {
  productVideoUrl: "https://youtu.be/63LKEzcg5Bo",
  productCount: DEFAULT_PRODUCT_COUNT,
  productNote:
    "Regarde la vidéo en entier, puis fais la recherche sur BrandSearch. Remplis le tableau avec tes 10 produits et envoie-le à Mady sur WhatsApp. Il valide ton produit avec toi, puis tu passes aux créatives.",
  themeNote:
    "Aesthetic Lab, c'est ma page qui convertit, livrée vide : les textes et les sections sont là, les médias sont des aplats gris à remplacer. Elle est parfaite : tu ne touches ni à la structure, ni au design. Tu changes seulement les textes, les images, les vidéos et le produit pour que ce soit le tien. C'est Claude Code qui fait le travail avec Shopify CLI, dans VS Code : tu lui donnes le fichier et le message ci-dessous.",
  themePrompt: DEFAULT_THEME_PROMPT,
  shopVideoUrl: "https://youtu.be/gjm9FH_ewho",
  shopVideoSummary: "",
  shopVideoSteps: "",
};

export function methodSettings(settings: Pick<Settings, "studentMethod">): StudentMethodSettings {
  const s = settings.studentMethod ?? {};
  const count = Number(s.productCount);
  return {
    productVideoUrl: (s.productVideoUrl ?? "").trim() || DEFAULT_METHOD.productVideoUrl,
    productCount: Number.isFinite(count) && count >= 1 && count <= 30 ? Math.round(count) : DEFAULT_PRODUCT_COUNT,
    productNote: (s.productNote ?? "").trim() || DEFAULT_METHOD.productNote,
    themeNote: (s.themeNote ?? "").trim() || DEFAULT_METHOD.themeNote,
    themePrompt: (s.themePrompt ?? "").trim() || DEFAULT_THEME_PROMPT,
    // Vide enregistre = pas de video : l'admin peut la retirer sans que la valeur par defaut revienne.
    shopVideoUrl: s.shopVideoUrl === undefined ? DEFAULT_METHOD.shopVideoUrl : s.shopVideoUrl.trim(),
    shopVideoSummary: (s.shopVideoSummary ?? "").trim() || DEFAULT_METHOD.shopVideoSummary,
    shopVideoSteps: (s.shopVideoSteps ?? "").trim() || DEFAULT_METHOD.shopVideoSteps,
  };
}

/** Les etapes de la video, une par ligne ; « Titre : detail » ou « Titre — detail » se decoupe en titre + texte. */
export function parseVideoSteps(text: string): { title: string; text: string }[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:\d+[.)]|[-•*])\s*/, "").trim())
    .filter(Boolean)
    .map((l) => {
      const m = l.match(/^(.{3,80}?)\s*(?::|—|–| - )\s*(.+)$/);
      return m ? { title: m[1].trim(), text: m[2].trim() } : { title: l, text: "" };
    });
}

/** Lecture des réglages envoyés par l'admin : champs propres, bornés. */
export function readMethodSettings(raw: Partial<StudentMethodSettings>): StudentMethodSettings {
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const count = Number(raw.productCount);
  return {
    productVideoUrl: str(raw.productVideoUrl, 500),
    productCount: Number.isFinite(count) && count >= 1 && count <= 30 ? Math.round(count) : DEFAULT_PRODUCT_COUNT,
    productNote: str(raw.productNote, 2000),
    themeNote: str(raw.themeNote, 2000),
    themePrompt: str(raw.themePrompt, 8000),
    shopVideoUrl: str(raw.shopVideoUrl, 500),
    shopVideoSummary: str(raw.shopVideoSummary, 6000),
    shopVideoSteps: str(raw.shopVideoSteps, 6000),
  };
}

/** Colonnes du tableau de produits que l'élève remplit et envoie à Mady. */
export const PRODUCT_COLUMNS = [
  { key: "name", label: "Produit", placeholder: "ex. Masseur cervical" },
  { key: "link", label: "Lien (pub ou boutique qui le vend)", placeholder: "https://…" },
  { key: "price", label: "Prix de vente", placeholder: "ex. 39,90 €" },
  { key: "why", label: "Pourquoi il marche", placeholder: "ex. 40 pubs actives depuis 2 mois" },
] as const;

export type ProductRow = Record<(typeof PRODUCT_COLUMNS)[number]["key"], string>;

export const emptyProductRows = (n: number): ProductRow[] => Array.from({ length: n }, () => ({ name: "", link: "", price: "", why: "" }));

/** Le tableau en texte, prêt pour WhatsApp (une ligne par produit, colonnes séparées par « | »). */
export function productsAsText(rows: ProductRow[], firstName: string): string {
  const filled = rows.filter((r) => r.name.trim() || r.link.trim());
  const lines = filled.map((r, i) => `${i + 1}. ${r.name.trim() || "?"} | ${r.link.trim() || "pas de lien"} | ${r.price.trim() || "prix ?"} | ${r.why.trim() || ""}`.trim());
  return [`Salut Mady, c'est ${firstName}. Voici mes ${filled.length} produits (Produit | Lien | Prix de vente | Pourquoi) :`, "", ...lines, "", "Lequel on valide ?"].join("\n");
}

/** Taille lisible d'un fichier (Mo, Ko). */
export function fmtBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1).replace(".", ",")} Mo`;
  if (n >= 1024) return `${Math.round(n / 1024)} Ko`;
  return `${n} o`;
}
