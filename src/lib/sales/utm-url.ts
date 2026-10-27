/**
 * Fabrication et comparaison des liens UTM. Module PUR (aucun acces a la
 * base) : le generateur cote navigateur l'importe. Le rattachement aux
 * leads vit dans utm-links.ts (serveur).
 */

export interface UtmParams {
  source: string;
  medium: string;
  campaign: string;
  content: string;
  term: string;
}

export const UTM_SOURCES = ["youtube", "instagram", "tiktok", "facebook", "newsletter", "telegram", "whatsapp", "linkedin", "podcast", "site"] as const;
export const UTM_MEDIUMS = ["video", "short", "reel", "story", "post", "bio", "description", "comment", "pinned", "email", "dm", "ad"] as const;

const slug = (v: string) =>
  v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);

/** Valeur utm propre : minuscules, sans accents, soulignes. */
export const utmValue = slug;

/** L'URL complete : la destination, puis ses parametres utm (vides omis). */
export function buildUtmUrl(baseUrl: string, p: UtmParams): string {
  const base = baseUrl.trim();
  if (!base) return "";
  let u: URL;
  try {
    u = new URL(base);
  } catch {
    return "";
  }
  const pairs: [string, string][] = [
    ["utm_source", utmValue(p.source)],
    ["utm_medium", utmValue(p.medium)],
    ["utm_campaign", utmValue(p.campaign)],
    ["utm_content", utmValue(p.content)],
    ["utm_term", utmValue(p.term)],
  ];
  for (const [k, v] of pairs) {
    u.searchParams.delete(k);
    if (v) u.searchParams.set(k, v);
  }
  return u.toString();
}

/** Cle de comparaison : les cinq parametres, normalises. */
export function utmKey(p: Partial<UtmParams>): string {
  return [utmValue(p.source ?? ""), utmValue(p.medium ?? ""), utmValue(p.campaign ?? ""), utmValue(p.content ?? ""), utmValue(p.term ?? "")].join("|");
}

