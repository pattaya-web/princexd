/**
 * Recoloration d'un theme Shopify.
 *
 * On ne connait pas les reglages de chaque theme (Dawn range ses couleurs
 * dans `color_schemes`, d'autres dans `colors_accent_1`…). Plutot que de
 * cibler des cles, on lit toutes les couleurs hexadecimales du
 * `settings_data.json`, on repere les couleurs « de marque » (saturees) et on
 * les remplace : la plus utilisee devient la couleur principale, la deuxieme
 * la secondaire, les autres prennent la teinte principale en gardant leur
 * clarte. Les gris, blancs et noirs ne bougent pas : la mise en page reste
 * celle du template, seule l'identite change.
 */

export interface Palette {
  primary: string;
  secondary: string;
}

const HEX = /#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/gi;

export function isHex(v: string): boolean {
  return /^#(?:[0-9a-f]{6}|[0-9a-f]{3})$/i.test(v.trim());
}

export function normalizeHex(v: string): string {
  let h = v.trim().toLowerCase().replace(/^#?/, "#");
  if (h.length === 4) h = `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`;
  return h;
}

function toHsl(hex: string): [number, number, number] {
  const h = normalizeHex(hex);
  const r = parseInt(h.slice(1, 3), 16) / 255;
  const g = parseInt(h.slice(3, 5), 16) / 255;
  const b = parseInt(h.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let hue = 0;
  if (max === r) hue = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) hue = (b - r) / d + 2;
  else hue = (r - g) / d + 4;
  return [hue * 60, s, l];
}

function fromHsl(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let [r, g, b] = [0, 0, 0];
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** Couleur « de marque » : assez saturee, ni quasi blanche ni quasi noire. */
function isBrandColor(hex: string): boolean {
  const [, s, l] = toHsl(hex);
  return s >= 0.22 && l >= 0.12 && l <= 0.88;
}

/** Compte les couleurs saturees d'un JSON de reglages, les plus frequentes d'abord. */
export function brandColors(json: string): { color: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const m of json.matchAll(HEX)) {
    const c = normalizeHex(m[0]);
    if (!isBrandColor(c)) continue;
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return [...counts.entries()].map(([color, count]) => ({ color, count })).sort((a, b) => b.count - a.count);
}

/**
 * Table de remplacement : ancienne couleur → nouvelle.
 * Les deux premieres prennent la palette telle quelle ; les suivantes gardent
 * leur clarte et leur saturation mais passent a la teinte principale.
 */
export function colorMap(json: string, palette: Palette): Map<string, string> {
  const map = new Map<string, string>();
  const found = brandColors(json);
  const primary = normalizeHex(palette.primary);
  const secondary = normalizeHex(palette.secondary || palette.primary);
  const [ph, ps] = toHsl(primary);
  found.forEach(({ color }, i) => {
    if (i === 0) map.set(color, primary);
    else if (i === 1) map.set(color, secondary);
    else {
      const [, , l] = toHsl(color);
      map.set(color, fromHsl(ph, Math.max(ps, 0.25), l));
    }
  });
  return map;
}

/** Applique la table a tout le fichier (cles `color_*`, degrades, schemas…). */
export function recolor(json: string, palette: Palette): { json: string; replaced: number } {
  const map = colorMap(json, palette);
  let replaced = 0;
  const out = json.replace(HEX, (m) => {
    const to = map.get(normalizeHex(m));
    if (!to) return m;
    replaced++;
    return to;
  });
  return { json: out, replaced };
}

/** Clarte percue, pour choisir un texte lisible sur la couleur principale. */
export function readableOn(hex: string): "#ffffff" | "#111111" {
  const [, , l] = toHsl(hex);
  return l > 0.6 ? "#111111" : "#ffffff";
}
