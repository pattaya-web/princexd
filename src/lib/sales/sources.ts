/**
 * Source d'acquisition d'un lead ou d'un rendez-vous, lue dans les UTM.
 *
 * Tout ce que l'on sait d'un booking vient du lien cliqué : les parametres
 * `utm_*` poses par l'admin (bio Instagram, landing page, lien signe d'un
 * setter), le referent que iClosed enregistre comme une cle sans valeur
 * (« https://l.instagram.com/ »), et les identifiants de clic Meta
 * (`fbclid`, `_fbc`) qui trahissent une arrivee par une pub ou un lien
 * Instagram / Facebook. Ce module normalise tout ca en une poignee de champs
 * et en une etiquette lisible. Il est pur : utilisable serveur et navigateur.
 */

/** Parametres retenus sur un rendez-vous ou un lead. Tout le reste est jete. */
export interface UtmInfo {
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
  term?: string;
  /** Domaine du referent, sans « www. » (l.instagram.com, royalscalebymady.fr…). */
  referrer?: string;
  /** Un identifiant de clic Meta etait present (fbclid / _fbc). */
  meta?: "1";
}

const UTM_KEYS: Record<string, "source" | "medium" | "campaign" | "content" | "term"> = {
  utm_source: "source",
  utm_medium: "medium",
  utm_campaign: "campaign",
  utm_content: "content",
  utm_term: "term",
};

const clean = (v: string) => v.trim().toLowerCase().slice(0, 80);

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/** Ajoute une paire cle / valeur a l'info, si elle nous apprend quelque chose. */
function absorb(info: UtmInfo, key: string, value: string) {
  const k = key.trim();
  const mapped = UTM_KEYS[k.toLowerCase()];
  if (mapped) {
    const v = clean(value);
    if (v) info[mapped] = v;
    return;
  }
  if (/^https?:\/\//i.test(k)) {
    // iClosed range le referent comme une cle sans valeur.
    const host = hostOf(k);
    if (host && !info.referrer) info.referrer = host;
    return;
  }
  if (k === "fbclid" || k === "_fbc") info.meta = "1";
}

/** UTM d'un appel iClosed (`utm[] = { utmKey, utmValue }`). */
export function utmFromIclosed(utm: { utmKey?: string; utmValue?: string }[] | undefined): UtmInfo {
  const info: UtmInfo = {};
  for (const u of utm ?? []) absorb(info, u.utmKey ?? "", u.utmValue ?? "");
  return info;
}

/** UTM lus dans l'adresse d'une page (opt-in Systeme.io, par exemple). */
export function utmFromUrl(url: string | undefined): UtmInfo {
  const info: UtmInfo = {};
  if (!url) return info;
  try {
    const u = new URL(url);
    for (const [k, v] of u.searchParams) absorb(info, k, v);
  } catch {
    // Adresse illisible : aucune info.
  }
  return info;
}

/** Vrai si l'info porte au moins un renseignement. */
export function hasUtm(info: UtmInfo | undefined): boolean {
  return Boolean(info && Object.keys(info).length);
}

/**
 * Etiquette lisible, du plus precis au plus vague.
 *
 *   setter + content       « Lien de Noa »
 *   utm_source             « ig · social · link_in_bio »
 *   referent               « Instagram (lien) », « Landing page », « Beacons »
 *   identifiant Meta       « Meta (pub ou lien) »
 *   rien                   « Inconnue »
 */
export function sourceLabel(info: UtmInfo | undefined): string {
  if (!info) return "Inconnue";
  if (info.source === "setter") return info.content ? `Lien de ${capitalize(info.content)}` : "Lien setter";
  if (info.source) {
    const parts = [prettySource(info.source), info.medium, info.campaign, info.content].filter(Boolean) as string[];
    return parts.join(" · ");
  }
  if (info.referrer) return prettyReferrer(info.referrer);
  if (info.meta) return "Meta (pub ou lien)";
  return "Inconnue";
}

/** Clef de regroupement : ce qui distingue vraiment deux sources. */
export function sourceKey(info: UtmInfo | undefined): string {
  if (!info) return "unknown";
  if (info.source === "setter") return `setter:${info.content ?? ""}`;
  if (info.source) return `utm:${info.source}|${info.medium ?? ""}|${info.campaign ?? ""}|${info.content ?? ""}`;
  if (info.referrer) return `ref:${info.referrer}`;
  if (info.meta) return "meta";
  return "unknown";
}

/** Famille large, pour les totaux : Instagram, Landing page, Setter, Meta, Autre, Inconnue. */
export function sourceFamily(info: UtmInfo | undefined): string {
  if (!info) return "Inconnue";
  if (info.source === "setter") return "Lien setter";
  const s = info.source ?? "";
  if (/^(ig|insta|instagram)/.test(s)) return "Instagram";
  if (/manychat/.test(s)) return "ManyChat";
  if (/(fb|facebook|meta)/.test(s)) return "Meta";
  if (s) return capitalize(s);
  const r = info.referrer ?? "";
  if (/instagram\.com$/.test(r)) return "Instagram";
  if (/royalscalebymady\.fr$/.test(r)) return "Landing page";
  if (/beacons\.ai$/.test(r)) return "Beacons (bio)";
  if (/google\./.test(r)) return "Google";
  if (r) return r;
  if (info.meta) return "Meta";
  return "Inconnue";
}

function prettySource(s: string): string {
  if (/^(ig|insta|instagram)$/.test(s)) return "Instagram";
  if (s === "manychat") return "ManyChat";
  if (s === "fb" || s === "facebook") return "Facebook";
  if (s === "lp" || s === "landing") return "Landing page";
  return capitalize(s);
}

function prettyReferrer(host: string): string {
  if (/instagram\.com$/.test(host)) return "Instagram (lien)";
  if (/royalscalebymady\.fr$/.test(host)) return "Landing page";
  if (/beacons\.ai$/.test(host)) return "Beacons (bio)";
  if (/google\./.test(host)) return "Google";
  if (/facebook\.com$/.test(host)) return "Facebook (lien)";
  return host;
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
