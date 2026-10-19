/**
 * Copywriting de la boutique generee, par le modele texte KIE deja branche
 * dans l'app (Reglages → cle KIE). Deux appels :
 *  - la marque : nom, slogan, palette, textes de la page d'accueil, pages ;
 *  - les produits, par lots : titre et description reecrits.
 *
 * Les prix, variantes et images ne passent jamais par l'IA : ils sont
 * recopies tels quels des concurrents.
 */
import { askText, parseJsonLoose } from "../kie";
import type { ScrapedProduct, ShopBuildBrief } from "../types";
import { isHex, normalizeHex } from "./colors";

export interface BrandCopy {
  brandName: string;
  tagline: string;
  palette: { primary: string; secondary: string };
  announcement: string;
  about: string;
  faq: { q: string; a: string }[];
  /** Textes de la page d'accueil, par cle « section.cle ». */
  homepage: Record<string, string>;
}

export interface ProductCopy {
  title: string;
  descriptionHtml: string;
}

const LANG: Record<string, string> = { fr: "français", en: "anglais", es: "espagnol", de: "allemand", it: "italien", nl: "néerlandais", pt: "portugais" };

export const langLabel = (code: string) => LANG[code] ?? code;

/** Texte brut d'une description HTML, borne pour le prompt. */
export function stripHtml(html: string, max = 1200): string {
  return html
    .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>|<\/p>|<\/li>|<\/h\d>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim()
    .slice(0, max);
}

const FALLBACK_PALETTES: { primary: string; secondary: string }[] = [
  { primary: "#1f3a5f", secondary: "#e8b86d" },
  { primary: "#2f6b4f", secondary: "#f2c14e" },
  { primary: "#7a2e4a", secondary: "#f4d6c1" },
  { primary: "#1b1b1f", secondary: "#c9a227" },
  { primary: "#3b4bd8", secondary: "#f6a623" },
];

function pickPalette(brief: ShopBuildBrief, ai?: { primary?: string; secondary?: string }): { primary: string; secondary: string } {
  const fromBrief = brief.primaryColor && isHex(brief.primaryColor) ? normalizeHex(brief.primaryColor) : "";
  const secBrief = brief.secondaryColor && isHex(brief.secondaryColor) ? normalizeHex(brief.secondaryColor) : "";
  const aiP = ai?.primary && isHex(ai.primary) ? normalizeHex(ai.primary) : "";
  const aiS = ai?.secondary && isHex(ai.secondary) ? normalizeHex(ai.secondary) : "";
  const fb = FALLBACK_PALETTES[Math.floor(Math.random() * FALLBACK_PALETTES.length)];
  const primary = fromBrief || aiP || fb.primary;
  const secondary = secBrief || aiS || fb.secondary;
  return { primary, secondary };
}

/**
 * Marque + accueil. `homepageTexts` : les textes actuels du template, par
 * cle, que le modele doit reecrire un par un en gardant la meme cle.
 */
export async function generateBrandCopy(
  brief: ShopBuildBrief,
  products: ScrapedProduct[],
  homepageTexts: Record<string, string>,
): Promise<BrandCopy> {
  const lang = langLabel(brief.language || "fr");
  const catalogue = products
    .slice(0, 12)
    .map((p) => `- ${p.title} (${p.variants[0]?.price || "?"}) : ${stripHtml(p.descriptionHtml, 220)}`)
    .join("\n");
  const keys = Object.entries(homepageTexts).slice(0, 70);
  const homepageBlock = keys.length
    ? `\n\nTEXTES DE LA PAGE D'ACCUEIL À RÉÉCRIRE (garde exactement les mêmes clés ; même longueur approximative ; si la valeur contient des balises HTML, garde la même structure de balises ; ne touche pas aux URL) :\n${JSON.stringify(Object.fromEntries(keys), null, 1)}`
    : "";

  const system = `Tu es un copywriter e-commerce senior (marques DTC qui font +50 000 € par mois). Tu écris en ${lang}, ton direct, concret, orienté bénéfices, sans superlatifs creux ni emojis. Tu réponds UNIQUEMENT avec un objet JSON valide, sans commentaire ni bloc de code.`;
  const prompt = `Crée l'identité d'une nouvelle boutique en ligne qui vend ce catalogue.

CATALOGUE :
${catalogue || "(vide)"}

CONSIGNES DU FONDATEUR :
${brief.brandName ? `- Nom de marque imposé : ${brief.brandName}` : "- Propose un nom de marque court, mémorable, disponible en .com plausible, sans copier un concurrent."}
${brief.notes ? `- Positionnement / cible / ton : ${brief.notes}` : "- Positionnement : premium accessible, confiance, preuve, livraison rapide."}
${brief.primaryColor ? `- Couleur principale imposée : ${brief.primaryColor}` : "- Choisis une palette cohérente avec le produit (2 couleurs hex contrastées, principale sombre ou saturée, secondaire d'accent)."}

Réponds avec ce JSON :
{
  "brandName": "…",
  "tagline": "slogan de 4 à 8 mots",
  "palette": { "primary": "#rrggbb", "secondary": "#rrggbb" },
  "announcement": "barre d'annonce courte (livraison offerte, garantie, etc.)",
  "about": "page À propos en HTML simple (<p>, <h2>), 120 à 200 mots, à la première personne du pluriel",
  "faq": [ { "q": "question", "a": "réponse en 1 à 3 phrases" } ] (6 questions : livraison, délais, retours, paiement, suivi, garantie),
  "homepage": { "clé": "texte réécrit", … }
}${homepageBlock}`;

  const raw = await askText(prompt, system, 8000);
  const out = parseJsonLoose<Partial<BrandCopy>>(raw);
  const homepage: Record<string, string> = {};
  for (const [k, v] of Object.entries(out.homepage ?? {})) {
    if (typeof v === "string" && v.trim() && k in homepageTexts) homepage[k] = v;
  }
  return {
    brandName: (brief.brandName || out.brandName || "Ma Boutique").trim(),
    tagline: (out.tagline ?? "").trim(),
    palette: pickPalette(brief, out.palette),
    announcement: (out.announcement ?? "").trim(),
    about: (out.about ?? "").trim(),
    faq: Array.isArray(out.faq) ? out.faq.filter((f) => f && f.q && f.a).slice(0, 8) : [],
    homepage,
  };
}

/** Reecrit titres et descriptions, par lots de 4 produits. */
export async function generateProductCopy(
  brief: ShopBuildBrief,
  brandName: string,
  products: ScrapedProduct[],
  onBatch?: (done: number, total: number) => void,
): Promise<ProductCopy[]> {
  const lang = langLabel(brief.language || "fr");
  const out: ProductCopy[] = products.map((p) => ({ title: p.title, descriptionHtml: p.descriptionHtml }));
  const BATCH = 4;
  for (let i = 0; i < products.length; i += BATCH) {
    const batch = products.slice(i, i + BATCH);
    const system = `Tu es un copywriter e-commerce senior. Tu écris en ${lang} pour la marque « ${brandName} »${brief.notes ? ` (${brief.notes})` : ""}. Tu réponds UNIQUEMENT avec un tableau JSON valide, sans commentaire ni bloc de code.`;
    const prompt = `Réécris ces fiches produit pour qu'elles ne ressemblent pas au concurrent tout en décrivant exactement le même produit (mêmes caractéristiques, mêmes usages). Ne mentionne jamais le concurrent ni sa marque.

Pour chaque produit, renvoie :
- "title" : titre vendeur de 3 à 8 mots, sans le nom du concurrent ;
- "descriptionHtml" : HTML simple (<p>, <h3>, <ul><li>), 120 à 220 mots : accroche bénéfice, 3 à 5 points forts, caractéristiques utiles (dimensions, matière, compatibilité si connues), garantie / livraison.

PRODUITS (dans l'ordre, renvoie un tableau de même longueur) :
${batch.map((p, j) => `${j + 1}. ${p.title}\nOptions : ${p.options.map((o) => `${o.name} (${o.values.slice(0, 6).join(", ")})`).join(" ; ") || "aucune"}\nDescription concurrente : ${stripHtml(p.descriptionHtml, 900) || "(vide)"}`).join("\n\n")}`;

    try {
      const raw = await askText(prompt, system, 6000);
      const arr = parseJsonLoose<Partial<ProductCopy>[]>(raw);
      if (Array.isArray(arr)) {
        arr.forEach((c, j) => {
          const idx = i + j;
          if (idx >= out.length || !c) return;
          if (typeof c.title === "string" && c.title.trim()) out[idx].title = c.title.trim();
          if (typeof c.descriptionHtml === "string" && c.descriptionHtml.trim()) out[idx].descriptionHtml = c.descriptionHtml.trim();
        });
      }
    } catch (e) {
      // Un lot rate garde les textes d'origine : la boutique sort quand meme.
      console.warn(`[boutique] copywriting lot ${i / BATCH + 1} : ${(e as Error).message}`);
    }
    onBatch?.(Math.min(i + BATCH, products.length), products.length);
  }
  return out;
}

/** Page FAQ en HTML a partir des questions generees. */
export function faqHtml(faq: { q: string; a: string }[]): string {
  return faq.map((f) => `<h3>${f.q}</h3><p>${f.a}</p>`).join("\n");
}
