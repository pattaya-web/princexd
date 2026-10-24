import type { Settings, StudentMethodSettings } from "@/lib/types";

/**
 * Pages « Recherche produit » et « Ta boutique » de la plateforme élèves
 * (Scale X) : la vidéo BrandSearch, la consigne des 10 produits à envoyer à
 * Mady sur WhatsApp, et le message que l'élève colle à Claude Code pour
 * poser le thème de Mady sur sa boutique. Valeurs par défaut ici, tout est
 * modifiable par l'admin depuis les pages. Module pur : serveur et navigateur.
 */

export const DEFAULT_PRODUCT_COUNT = 10;

export const DEFAULT_THEME_PROMPT = `Dans mon dossier il y a le fichier [NOM-DU-ZIP].zip : c'est le thème Shopify de mon coach Mady. Sa page est parfaite. Tu ne changes ni la structure, ni le design, ni l'ordre des sections, ni les couleurs, ni les polices.

Installe ce thème sur ma boutique Shopify ([mon-adresse].myshopify.com) et remplace UNIQUEMENT le contenu par celui de mon produit :

- Mon produit : [nom, ce que c'est, ce qu'il fait, prix de vente]
- Ma marque : [nom de marque]
- Ma cible : [qui achète et pourquoi]
- Textes : réécris tous les textes du thème (titres, bénéfices, descriptions, avis clients, FAQ, bandeaux) pour mon produit, en français, en gardant à peu près la même longueur que les textes existants.
- Images et vidéos : utilise mes fichiers du dossier « creatives » (dans mon dossier). Dis-moi lesquels il manque, à quel endroit, et dans quel format (3:4, 1:1, 9:16, 16:9).
- Prix, variantes, livraison : [prix, options, délai]

Fais-le section par section. À chaque section, dis-moi ce que tu as changé pour que je vérifie dans l'aperçu (F5). Quand je dis « OK, mets en ligne », tu publies.`;

export const DEFAULT_METHOD: StudentMethodSettings = {
  productVideoUrl: "https://youtu.be/63LKEzcg5Bo",
  productCount: DEFAULT_PRODUCT_COUNT,
  productNote:
    "Regarde la vidéo en entier, puis fais la recherche sur BrandSearch. Remplis le tableau avec tes 10 produits et envoie-le à Mady sur WhatsApp. Il valide ton produit avec toi, puis tu passes aux créatives.",
  themeNote:
    "Ce thème, c'est ma page qui convertit. Elle est parfaite : tu ne touches ni à la structure, ni au design. Tu changes seulement les textes, les images, les vidéos et le produit pour que ce soit le tien. C'est Claude Code qui fait le travail, dans VS Code : tu lui donnes le fichier et le message ci-dessous.",
  themePrompt: DEFAULT_THEME_PROMPT,
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
  };
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
