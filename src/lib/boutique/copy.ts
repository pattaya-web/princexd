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

/**
 * KIE échoue parfois côté modèle (« 2 times retry fail ») sur les grosses
 * requêtes : on réessaie avec une pause, et l'appelant peut alléger la
 * demande entre deux essais.
 */
async function askWithRetry(build: (attempt: number) => { prompt: string; system: string; maxTokens: number }, tries = 3): Promise<string> {
  let last: Error | null = null;
  for (let attempt = 0; attempt < tries; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 3000 * attempt));
    const { prompt, system, maxTokens } = build(attempt);
    try {
      return await askText(prompt, system, maxTokens);
    } catch (e) {
      last = e as Error;
      if (/cle API|API KIE|401/.test(last.message)) throw last;
    }
  }
  throw last ?? new Error("Modèle texte indisponible.");
}
import type { ScrapedProduct, ShopBuildBrief } from "../types";
import { isHex, normalizeHex } from "./colors";

export interface BrandCopy {
  brandName: string;
  tagline: string;
  palette: { primary: string; secondary: string };
  announcement: string;
  about: string;
  faq: { q: string; a: string }[];
  /** Brief de niche deduit des concurrents : categorie, client, benefices, objections, ton. */
  niche: string;
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
export async function generateBrandCopy(brief: ShopBuildBrief, products: ScrapedProduct[]): Promise<BrandCopy> {
  const lang = langLabel(brief.language || "fr");
  const catalogue = products
    .slice(0, 12)
    .map((p) => `- ${p.title} (${p.variants[0]?.price || "?"}) : ${stripHtml(p.descriptionHtml, 220)}`)
    .join("\n");
  const system = `Tu es un copywriter e-commerce senior (marques DTC qui font +50 000 € par mois). Tu écris en ${lang}, ton direct, concret, orienté bénéfices, sans superlatifs creux ni emojis. Tu réponds UNIQUEMENT avec un objet JSON valide, sans commentaire ni bloc de code.`;
  const prompt = `Crée l'identité d'une nouvelle boutique en ligne qui vend ce catalogue (lu sur les fiches produit des concurrents).

CATALOGUE :
${catalogue || "(vide)"}

CONSIGNES DU FONDATEUR :
${brief.brandName ? `- Nom de marque imposé : ${brief.brandName}` : "- Propose un nom de marque court, mémorable, disponible en .com plausible, sans copier un concurrent."}
${brief.notes ? `- Positionnement / cible / ton : ${brief.notes}` : "- Positionnement : premium accessible, confiance, preuve, livraison rapide."}
${brief.primaryColor ? `- Couleur principale imposée : ${brief.primaryColor}` : "- Choisis une palette cohérente avec le produit (2 couleurs hex contrastées, principale sombre ou saturée, secondaire d'accent)."}

Réponds avec ce JSON :
{
  "brandName": "…",
  "niche": "brief de niche en 5 lignes : catégorie de produit, client type (qui, âge, situation), 4 bénéfices concrets que les concurrents mettent en avant, 3 objections / peurs de l'acheteur, ton à adopter",
  "tagline": "slogan de 4 à 8 mots",
  "palette": { "primary": "#rrggbb", "secondary": "#rrggbb" },
  "announcement": "barre d'annonce courte (livraison offerte, garantie, etc.)",
  "about": "page À propos en HTML simple (<p>, <h2>), 120 à 200 mots, à la première personne du pluriel",
  "faq": [ { "q": "question", "a": "réponse en 1 à 3 phrases" } ] (6 questions : livraison, délais, retours, paiement, suivi, garantie),
}`;

  const raw = await askWithRetry(() => ({ prompt, system, maxTokens: 6000 }));
  const out = parseJsonLoose<Partial<BrandCopy>>(raw);
  return {
    brandName: (brief.brandName || out.brandName || "Ma Boutique").trim(),
    tagline: (out.tagline ?? "").trim(),
    palette: pickPalette(brief, out.palette),
    announcement: (out.announcement ?? "").trim(),
    about: (out.about ?? "").trim(),
    faq: Array.isArray(out.faq) ? out.faq.filter((f) => f && f.q && f.a).slice(0, 8) : [],
    niche: (out.niche ?? "").trim(),
  };
}

/**
 * Réécrit les textes d'un template (accueil, fiche produit, en-tête, pied de
 * page) pour la niche de la boutique. Le template a été écrit pour une autre
 * boutique : chaque texte garde son rôle, sa longueur et sa forme, seul le
 * fond change. Par lots de 30 clés, chaque lot réessayé ; un lot perdu
 * garde les textes d'origine.
 */
export async function rewriteTemplateTexts(
  brief: ShopBuildBrief,
  brand: Pick<BrandCopy, "brandName" | "tagline" | "niche">,
  texts: Record<string, string>,
  onBatch?: (done: number, total: number) => void,
): Promise<Record<string, string>> {
  const lang = langLabel(brief.language || "fr");
  const entries = Object.entries(texts);
  const out: Record<string, string> = {};
  const BATCH = 30;
  const system = `Tu es un copywriter e-commerce senior. Tu écris en ${lang} pour la marque « ${brand.brandName} »${brand.tagline ? ` (« ${brand.tagline} »)` : ""}.
NICHE ET CLIENT :
${brand.niche || brief.notes || "(voir les textes)"}
${brief.notes ? `CONSIGNES DU FONDATEUR : ${brief.notes}\n` : ""}
Tu réponds UNIQUEMENT avec un objet JSON valide { "clé": "texte" }, sans commentaire ni bloc de code.`;
  for (let i = 0; i < entries.length; i += BATCH) {
    const batch = entries.slice(i, i + BATCH);
    const prompt = `Ces textes viennent d'un template de boutique écrit pour une AUTRE niche. Réécris chaque valeur pour notre niche et notre marque.

RÈGLES :
- Garde exactement les mêmes clés, toutes, et renvoie un texte pour chacune.
- Chaque texte garde son rôle (titre, sous-titre, bouton, question ou réponse de FAQ, avis client, étape, bénéfice, étiquette, badge) et à peu près la même longueur.
- Garde la forme : balises HTML, retours à la ligne, séparateurs (|, ;, •), variables {{ … }} et {% … %}, emojis éventuels. Ne touche pas aux URL.
- Plus aucune référence à l'ancienne niche, à ses produits, à ses résultats ou à ses marques. Si un texte ne peut pas s'adapter, remplace-le par un texte neutre et vrai pour notre niche.
- Avis clients et témoignages : prénoms crédibles pour notre marché, ressenti concret, aucun chiffre de résultat invérifiable.
- Jamais de promesse chiffrée ni de superlatif creux. Ton direct, orienté bénéfices, naturel en ${lang}.

TEXTES :
${JSON.stringify(Object.fromEntries(batch), null, 1)}`;
    try {
      const raw = await askWithRetry(() => ({ prompt, system, maxTokens: 6000 }));
      const obj = parseJsonLoose<Record<string, unknown>>(raw);
      for (const [k, v] of Object.entries(obj ?? {})) {
        if (k in texts && typeof v === "string" && v.trim()) out[k] = v;
      }
    } catch (e) {
      console.warn(`[boutique] textes du thème lot ${i / BATCH + 1} : ${(e as Error).message}`);
    }
    onBatch?.(Math.min(i + BATCH, entries.length), entries.length);
  }
  return out;
}

/** Identité minimale quand le modèle texte est indisponible : la boutique sort quand même. */
export function fallbackBrandCopy(brief: ShopBuildBrief): BrandCopy {
  return {
    brandName: (brief.brandName || "Ma Boutique").trim(),
    tagline: "",
    palette: pickPalette(brief),
    announcement: "",
    about: "",
    faq: [],
    niche: brief.notes || "",
  };
}

/** Reecrit titres et descriptions, par lots de 4 produits. */
export async function generateProductCopy(
  brief: ShopBuildBrief,
  brand: Pick<BrandCopy, "brandName" | "niche">,
  products: ScrapedProduct[],
  onBatch?: (done: number, total: number) => void,
): Promise<ProductCopy[]> {
  const lang = langLabel(brief.language || "fr");
  const out: ProductCopy[] = products.map((p) => ({ title: p.title, descriptionHtml: p.descriptionHtml }));
  const BATCH = 4;
  for (let i = 0; i < products.length; i += BATCH) {
    const batch = products.slice(i, i + BATCH);
    const system = `Tu es un copywriter e-commerce senior. Tu écris en ${lang} pour la marque « ${brand.brandName} »${brief.notes ? ` (${brief.notes})` : ""}.${brand.niche ? `\nNICHE ET CLIENT :\n${brand.niche}` : ""}\nTu réponds UNIQUEMENT avec un tableau JSON valide, sans commentaire ni bloc de code.`;
    const prompt = `Réécris ces fiches produit pour qu'elles ne ressemblent pas au concurrent tout en décrivant exactement le même produit (mêmes caractéristiques, mêmes usages). Ne mentionne jamais le concurrent ni sa marque.

Pour chaque produit, renvoie :
- "title" : titre vendeur de 3 à 8 mots, sans le nom du concurrent ;
- "descriptionHtml" : HTML simple (<p>, <h3>, <ul><li>), 120 à 220 mots : accroche bénéfice, 3 à 5 points forts, caractéristiques utiles (dimensions, matière, compatibilité si connues), garantie / livraison.

PRODUITS (dans l'ordre, renvoie un tableau de même longueur) :
${batch.map((p, j) => `${j + 1}. ${p.title}\nOptions : ${p.options.map((o) => `${o.name} (${o.values.slice(0, 6).join(", ")})`).join(" ; ") || "aucune"}\nDescription concurrente : ${stripHtml(p.descriptionHtml, 900) || "(vide)"}`).join("\n\n")}`;

    try {
      const raw = await askWithRetry(() => ({ prompt, system, maxTokens: 6000 }));
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
