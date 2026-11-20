/**
 * « Photo 1 », « photo 2 » dans un prompt du Studio.
 *
 * Les modèles de KIE (GPT Image 2, Nano Banana, Seedream, Seedance…) lisent
 * les images de référence dans l'ordre où elles sont envoyées, et leur
 * documentation les désigne par « Image 1 », « Image 2 ». Mady écrit en
 * français et sans convention (« la photo 2 », « réf 3 », « la deuxième
 * image », « photos 1 et 2 », « @img1 ») : on ramène tout à « [Image N] » et
 * on ajoute en tête une légende qui dit au modèle que la numérotation suit
 * l'ordre des pièces jointes, celui que Mady règle à la souris dans le Studio.
 *
 * Seul le texte envoyé au modèle change : le prompt enregistré reste celui
 * que Mady a tapé (une relance repart de son texte). Module pur : serveur et
 * navigateur.
 */

/** Les mots qui désignent une image de référence, au singulier et au pluriel. */
const NOUN = String.raw`(?:photos?|images?|imgs?|pics?|pictures?|r[ée]f[ée]rences?|r[ée]fs?|references?|visuels?)`;

/** Après le numéro : pas une lettre ni un chiffre (« image 4K »), pas un format (« image 16:9 », « 9x16 »). */
const END = String.raw`(?![\p{L}\d]|\s*[:/x×]\s*\d)`;

const ORDINAL_WORDS: [string, number][] = [
  ["premi[èe]re|premier|first", 1],
  ["deuxi[èe]me|seconde?", 2],
  ["troisi[èe]me|third", 3],
  ["quatri[èe]me|fourth", 4],
  ["cinqui[èe]me|fifth", 5],
  ["sixi[èe]me|sixth", 6],
  ["septi[èe]me|seventh", 7],
  ["huiti[èe]me|eighth", 8],
  ["neuvi[èe]me|ninth", 9],
  ["dixi[èe]me|tenth", 10],
  ["onzi[èe]me|eleventh", 11],
  ["douzi[èe]me|twelfth", 12],
];

/** Le dernier : « la dernière photo », « the last image ». */
const LAST = "derni[èe]re?|last";

/** Ordinal écrit en chiffres : 1ère, 1re, 1er, 2e, 2ème, 3eme, 2nd, 4th… */
const NUM_ORDINAL = String.raw`(\d{1,2})(?:[èe]re|re|er|[èe]me|e|st|nd|rd|th)`;

export interface ReferenceNumbering {
  /** Le prompt avec chaque mention ramenée à « [Image N] » (inchangé sans référence). */
  prompt: string;
  /** Les numéros cités et qui existent (1 à `count`), triés. */
  cited: number[];
  /** Les numéros cités au-delà des photos fournies (« photo 3 » avec 2 photos). */
  missing: number[];
}

/**
 * Remplace les mentions de photos numérotées par « [Image N] ».
 *
 * Sans photo de référence (`count` 0), rien ne bouge : « une image 2 fois
 * plus lumineuse » reste du texte. Une mention au-delà de `count` est laissée
 * telle quelle et signalée dans `missing`.
 */
export function numberReferences(text: string, count: number): ReferenceNumbering {
  if (!text || count < 1) return { prompt: text, cited: [], missing: [] };
  const cited = new Set<number>();
  const missing = new Set<number>();
  const tag = (n: number, original: string) => {
    if (n < 1) return original;
    if (n > count) {
      missing.add(n);
      return original;
    }
    cited.add(n);
    return `[Image ${n}]`;
  };

  let out = text;

  // « @img1 », « @photo 2 », « @1 » (avant les autres : « img1 » ne doit pas être pris seul)
  out = out.replace(/@(?:photo|image|img|pic|ref|réf)?\s?(\d{1,2})(?![\p{L}\d])/giu, (m, n: string) => tag(Number(n), m));

  /*
   * Avant le mot : ni lettre, ni « [ » (une mention déjà convertie,
   * « [Image 1] », ne se convertit pas deux fois), ni « @ ».
   */
  const START = String.raw`(?<![\p{L}\[@])`;

  // « photos 1 et 2 », « images 1, 2 et 3 », « refs 2 & 4 »
  out = out.replace(
    new RegExp(String.raw`${START}${NOUN}\s*((?:\d{1,2}\s*(?:,|et|and|&)\s*)+\d{1,2})${END}`, "giu"),
    (m, list: string) => {
      const nums = list.split(/\s*(?:,|et|and|&)\s*/i).map((s) => Number(s.trim()));
      if (nums.some((n) => !Number.isFinite(n) || n < 1 || n > count)) {
        nums.filter((n) => n > count).forEach((n) => missing.add(n));
        return m;
      }
      const tags = nums.map((n) => tag(n, String(n)));
      return tags.length > 1 ? `${tags.slice(0, -1).join(", ")} and ${tags[tags.length - 1]}` : tags[0];
    },
  );

  // « photo 1 », « image n°2 », « réf #3 », « photo numéro 4 »
  out = out.replace(
    new RegExp(String.raw`${START}${NOUN}\s*(?:n°|n\.|no\.?|num[ée]ro|#)?\s*(\d{1,2})${END}`, "giu"),
    (m, n: string) => tag(Number(n), m),
  );

  // « la 2e photo », « la 1ère image », « the 3rd picture »
  out = out.replace(
    new RegExp(String.raw`(?:\b(?:la|le|les|the)\s+|\bl['’])?${NUM_ORDINAL}\s+${NOUN}(?!\p{L})`, "giu"),
    (m, n: string) => tag(Number(n), m),
  );

  // « la deuxième photo », « the first image », « la dernière réf »
  for (const [words, n] of ORDINAL_WORDS) {
    out = out.replace(new RegExp(String.raw`(?:\b(?:la|le|les|the)\s+|\bl['’])?(?<!\p{L})(?:${words})\s+${NOUN}(?!\p{L})`, "giu"), (m) => tag(n, m));
  }
  out = out.replace(new RegExp(String.raw`(?:\b(?:la|le|the)\s+)?(?<!\p{L})(?:${LAST})\s+${NOUN}(?!\p{L})`, "giu"), (m) => tag(count, m));

  return { prompt: out, cited: [...cited].sort((a, b) => a - b), missing: [...missing].sort((a, b) => a - b) };
}

/** La légende en tête du prompt : la numérotation suit l'ordre des pièces jointes. */
export function referenceLegend(count: number): string {
  const list = Array.from({ length: Math.min(count, 12) }, (_, i) => `[Image ${i + 1}] = attached image #${i + 1}`).join(", ");
  return (
    `REFERENCE IMAGES: the ${count} attached images are numbered in the exact order they are attached (${list}). ` +
    `Whenever the prompt names [Image N], take that element (person, face, product, outfit, colors, text, background or style, as asked) exactly from that attached image and from no other one.`
  );
}

/**
 * Une photo citée mais absente (« image 3 » avec 2 photos) est facultative :
 * Mady garde le même prompt d'une génération à l'autre, avec ou sans cette
 * photo. On ne refuse rien, on dit au modèle d'ignorer ces mentions.
 */
export function missingReferenceNote(missing: number[], count: number): string {
  const which = missing.map((n) => `image ${n}`).join(", ");
  return (
    `Only ${count} reference image${count > 1 ? "s are" : " is"} attached: the prompt's mention${missing.length > 1 ? "s" : ""} of ${which} refer${missing.length > 1 ? "" : "s"} to ${missing.length > 1 ? "optional images that were" : "an optional image that was"} NOT provided this time. ` +
    `Ignore ${missing.length > 1 ? "those mentions" : "that mention"} and any instruction that depends only on ${missing.length > 1 ? "them" : "it"}; do not invent ${missing.length > 1 ? "those images" : "that image"}.`
  );
}

/**
 * Le prompt prêt à partir : mentions numérotées et légende en tête quand le
 * prompt cite une photo présente, consigne d'ignorer celles qui manquent.
 * Sans aucune mention, le texte part tel quel.
 */
export function promptWithReferences(text: string, count: number): ReferenceNumbering {
  const r = numberReferences(text, count);
  if (!r.cited.length && !r.missing.length) return r;
  const head = [r.cited.length ? referenceLegend(count) : "", r.missing.length ? missingReferenceNote(r.missing, count) : ""].filter(Boolean).join(" ");
  return { ...r, prompt: `${head}\n\n${r.prompt}` };
}
