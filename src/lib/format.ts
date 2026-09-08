export const fmtInt = (n: number) => new Intl.NumberFormat("fr-FR").format(Math.round(n || 0));

export const fmtUsd = (n: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(n || 0);

export const fmtEur = (n: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n || 0);

export const fmtPct = (n: number, digits = 1) => `${(n || 0).toFixed(digits).replace(".", ",")} %`;

/** Compact : 12 400 -> 12,4 k */
export function fmtCompact(n: number) {
  const v = n || 0;
  if (Math.abs(v) >= 1000) return new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 }).format(v);
  return fmtInt(v);
}

export const todayISO = () => new Date().toISOString().slice(0, 10);

export function daysAgoISO(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export function fmtDate(iso: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short" }).format(d);
}

export function fmtDateTime(iso: string, tz = "Europe/Paris") {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: tz,
  }).format(d);
}

/** "dans 3 j" / "il y a 2 h" */
export function relative(iso: string) {
  if (!iso) return "";
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return "";
  const diff = d - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat("fr-FR", { numeric: "auto" });
  if (abs < 60_000) return "maintenant";
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), "minute");
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), "hour");
  return rtf.format(Math.round(diff / 86_400_000), "day");
}

export const WEEKDAYS = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];

/** Somme sûre sur une clé numérique. */
export function sumBy<T>(rows: T[], key: (r: T) => number) {
  return rows.reduce((acc, r) => acc + (Number(key(r)) || 0), 0);
}

export function avgBy<T>(rows: T[], key: (r: T) => number) {
  if (!rows.length) return 0;
  return sumBy(rows, key) / rows.length;
}

export function groupBy<T>(rows: T[], key: (r: T) => string) {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const bucket = map.get(k);
    if (bucket) bucket.push(r);
    else map.set(k, [r]);
  }
  return map;
}

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Libellés FR des énumérations, partagés entre les pages. */
export const LABELS: Record<string, string> = {
  // formats
  "reel-face-cam": "Reel face cam",
  "reel-voiceover": "Reel voix off",
  "reel-broll": "Reel B-roll",
  "reel-screen-record": "Reel screen record",
  carrousel: "Carrousel",
  "post-image": "Post image",
  "story-serie": "Série de stories",
  live: "Live",
  // angles
  value: "Value",
  proof: "Preuve / résultats",
  lifestyle: "Lifestyle",
  "daily-life": "Daily life",
  "story-perso": "Story perso",
  opinion: "Opinion",
  tuto: "Tuto",
  "cta-offre": "CTA offre",
  // statuts post
  idee: "Idée",
  script: "Script",
  tournage: "Tournage",
  montage: "Montage",
  programme: "Programmé",
  publie: "Publié",
  // stories
  "proof-shopify": "Preuve Shopify",
  coulisses: "Coulisses",
  engagement: "Engagement",
  "cta-call": "CTA call",
  temoignage: "Témoignage",
  matin: "Matin",
  midi: "Midi",
  aprem: "Après-midi",
  soir: "Soir",
  // leads
  nouveau: "Nouveau",
  contacte: "Contacté",
  conversation: "Conversation",
  "call-book": "Call booké",
  "call-fait": "Call fait",
  "closed-won": "Closé ✅",
  "closed-lost": "Perdu",
  // montage
  "rush-a-deposer": "Rushs à déposer",
  "a-monter": "À monter",
  "en-cours": "En cours",
  livre: "Livré",
  retouches: "Retouches",
  poste: "Posté",
  rapide: "Rapide (cuts serrés)",
  cinematique: "Cinématique",
  "talking-head": "Talking head",
  "carrousel-video": "Carrousel vidéo",
  story: "Story",
  // divers
  onboarding: "Onboarding",
  actif: "Actif",
  pause: "Pause",
  termine: "Terminé",
  book: "Booké",
  show: "Présent",
  "no-show": "No-show",
  closed: "Closé",
  perdu: "Perdu",
  brouillon: "Brouillon",
  stoppe: "Stoppé",
  setter: "Setter",
  closer: "Closer",
  monteur: "Monteur",
  assistant: "Assistant",
  essai: "Essai",
  inactif: "Inactif",
  "a-analyser": "À analyser",
  analyse: "Analysé",
  "a-tourner": "À tourner",
  fait: "Fait",
  waiting: "En attente",
  queuing: "En file",
  generating: "Génération…",
  success: "Terminé",
  fail: "Échec",
};

export const label = (key: string) => LABELS[key] ?? key;
