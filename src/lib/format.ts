export const fmtInt = (n: number) => new Intl.NumberFormat("fr-FR").format(Math.round(n || 0));

export const fmtUsd = (n: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(n || 0);

export const fmtEur = (n: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n || 0);

/**
 * Montant dans la devise du module commercial.
 *
 * Le reste du tool raisonne en euros ; les offres de coaching se vendent en
 * dollars. Une seule fonction pour les deux evite les conversions sauvages.
 */
export const fmtMoney = (n: number, currency = "USD") =>
  new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency,
    maximumFractionDigits: Math.abs(n || 0) < 100 ? 2 : 0,
  }).format(n || 0);

export const fmtPct =(n: number, digits = 1) => `${(n || 0).toFixed(digits).replace(".", ",")} %`;

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
  reference: "Référence",
  livrable: "Montage livré",
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
  // module commercial
  admin: "Admin",
  booked: "Booké",
  confirmed: "Confirmé",
  rescheduled: "Reprogrammé",
  completed: "Call fait",
  cancelled: "Annulé",
  "follow-up": "Relance",
  "instagram-dm": "DM Instagram",
  "instagram-story": "Story Instagram",
  "instagram-reel": "Reel Instagram",
  inbound: "Inbound",
  outbound: "Outbound",
  referral: "Recommandation",
  other: "Autre",
  "too-expensive": "Trop cher",
  "no-money": "Pas de budget",
  "need-to-think": "Veut réfléchir",
  "need-partner-approval": "Doit en parler",
  "not-qualified": "Non qualifié",
  "not-interested": "Pas intéressé",
  timing: "Mauvais timing",
  competitor: "Parti chez un concurrent",
  "paid-in-full": "Payé en une fois",
  installments: "Paiement échelonné",
  deposit: "Acompte",
  "per-appointment": "Par rendez-vous",
  "per-show": "Par call honoré",
  "pct-revenue": "% de la valeur de contrat",
  "pct-cash": "% du cash encaissé",
  "fixed-plus-pct": "Fixe + pourcentage",
  custom: "Personnalisée",
  active: "Active",
  "partially-refunded": "Remboursée en partie",
  refunded: "Remboursée",
  pending: "En attente",
  done: "Faite",
  waiting: "En attente",
  queuing: "En file",
  generating: "Génération…",
  success: "Terminé",
  fail: "Échec",
};

export const label = (key: string) => LABELS[key] ?? key;

/** Dossiers de production. */
export const PROD_FOLDERS = [
  { value: "value", label: "Value" },
  { value: "lifestyle", label: "Lifestyle" },
  { value: "clipping", label: "Clipping" },
  { value: "facecam", label: "FaceCam" },
  { value: "eleve", label: "Élève" },
] as const;

/** Ponctuation qui termine une phrase parlee. */
const SENTENCE_END = new Set([".", "!", "?", "…"]);
/** Signes qui peuvent suivre cette ponctuation sans ouvrir une phrase. */
const TRAILING = new Set([".", "!", "?", "…", '"', "»", ")", "]"]);

/**
 * Aere une transcription brute en paragraphes lisibles.
 *
 * La fonction PARCOURT le texte au lieu de le decouper par expression
 * reguliere : une premiere version a base de match() perdait la ponctuation
 * isolee sur une cinquantaine de transcriptions. Ici chaque caractere est
 * conserve, seuls des espaces deviennent des sauts de ligne.
 */
export function formatTranscript(raw: string): string {
  const clean = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return "";

  const blocks: string[] = [];
  let start = 0;

  for (let i = 0; i < clean.length; i++) {
    if (!SENTENCE_END.has(clean[i])) continue;

    // Absorbe une eventuelle suite de ponctuation et le guillemet fermant.
    let end = i + 1;
    while (end < clean.length && TRAILING.has(clean[end])) end++;

    const atBoundary = end >= clean.length || clean[end] === " ";
    if (atBoundary && end - start >= 160) {
      blocks.push(clean.slice(start, end));
      // On saute l'unique espace separateur : les blancs sont deja normalises.
      start = end + 1;
      i = end;
    }
  }

  if (start < clean.length) blocks.push(clean.slice(start));
  return blocks.filter(Boolean).join("\n\n");
}

/** Lundi de la semaine en cours, au format YYYY-MM-DD. */
export function mondayISO(from = new Date()): string {
  const d = new Date(Date.UTC(from.getFullYear(), from.getMonth(), from.getDate()));
  // getUTCDay : 0 = dimanche. On recule jusqu'au lundi.
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/**
 * Duree attendue d'une generation, deduite de l'historique reel.
 *
 * Les fournisseurs ne publient aucune estimation, et une valeur theorique
 * vieillit mal. Les generations deja faites sur CE compte, avec CE modele,
 * sont la meilleure source disponible — et elle s'affine toute seule.
 *
 * On prend la mediane : une tache partie en heure de pointe peut doubler, et
 * une moyenne se laisserait tirer par ce genre de valeur isolee.
 */
export function estimateSec(
  model: string,
  rows: { model: string; state: string; costTimeSec?: number }[],
): { sec: number; sample: number } | null {
  const past = rows
    .filter((r) => r.model === model && r.state === "success" && (r.costTimeSec ?? 0) > 0)
    .map((r) => r.costTimeSec as number)
    .sort((a, b) => a - b);
  if (!past.length) return null;
  const mid = Math.floor(past.length / 2);
  const sec = past.length % 2 ? past[mid] : Math.round((past[mid - 1] + past[mid]) / 2);
  return { sec, sample: past.length };
}

/** « 6 min 12 » ou « 45 s ». */
export function duration(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m} min ${String(s).padStart(2, "0")}` : `${s} s`;
}
