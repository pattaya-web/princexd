import type { PaymentType, SourceChannel } from "@/lib/types";

/**
 * Brouillon d'un nouvel élève dicté au chat « Nouvel élève ».
 *
 * « Alexandre, closé 2500 en une fois aujourd'hui, vient d'Instagram » : le
 * texte est lu ici (règles simples, sans réseau), puis affiné par l'IA quand
 * une clé KIE est disponible. Le brouillon est toujours montré avant d'écrire
 * quoi que ce soit : c'est de l'argent et une fiche élève, on vérifie.
 * Module pur : partagé entre le serveur et le navigateur.
 */

export interface NewStudentDraft {
  name: string;
  /** Valeur du contrat, dans la devise des ventes. */
  contractValue: number;
  /** Encaissé le jour de la vente. */
  cashCollected: number;
  paymentType: PaymentType;
  /** Nombre de fois (paiement en plusieurs fois), 0 sinon. */
  installments: number;
  /** AAAA-MM-JJ. */
  soldAt: string;
  /** Clé de SOURCE_OPTIONS ; vide = inconnue. */
  source: string;
  offer: string;
  email: string;
  phone: string;
  igUsername: string;
  notes: string;
  /** Lead du CRM à rattacher ; vide = nouveau lead. */
  leadId: string;
  /** Setter à créditer quand le lead n'en a pas ; vide = réglages (setter par défaut, sinon moi). */
  setterId: string;
  /** Créer tout de suite l'accès à la plateforme de formation. */
  createAccess: boolean;
  contractSigned: boolean;
}

export interface SourceOption {
  key: string;
  label: string;
  channel: SourceChannel | "";
  funnel: string;
  /** Valeur historique de `Lead.source`. */
  leadSource: string;
}

export const SOURCE_OPTIONS: SourceOption[] = [
  { key: "instagram", label: "Instagram", channel: "INSTAGRAM", funnel: "instagram_dm", leadSource: "instagram-dm" },
  { key: "youtube", label: "YouTube", channel: "ORGANIC", funnel: "youtube", leadSource: "youtube" },
  { key: "tiktok", label: "TikTok", channel: "ORGANIC", funnel: "tiktok", leadSource: "tiktok" },
  { key: "ads", label: "Meta Ads", channel: "META_ADS", funnel: "lp1_ads", leadSource: "ads" },
  { key: "masterclass", label: "Masterclass organique", channel: "ORGANIC", funnel: "organic_masterclass", leadSource: "lp" },
  { key: "referral", label: "Parrainage / bouche à oreille", channel: "REFERRAL", funnel: "referral", leadSource: "referral" },
  { key: "affiliate", label: "Affiliation", channel: "AFFILIATE", funnel: "affiliate", leadSource: "affiliate" },
  { key: "other", label: "Autre", channel: "OTHER", funnel: "direct_booking", leadSource: "other" },
  { key: "", label: "Inconnue", channel: "", funnel: "", leadSource: "other" },
];

export const sourceOption = (key: string) => SOURCE_OPTIONS.find((o) => o.key === key) ?? SOURCE_OPTIONS[SOURCE_OPTIONS.length - 1];

export const PAYMENT_OPTIONS: { key: PaymentType; label: string }[] = [
  { key: "paid-in-full", label: "En une fois" },
  { key: "installments", label: "En plusieurs fois" },
  { key: "deposit", label: "Acompte" },
  { key: "other", label: "Autre / à préciser" },
];

export const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** Date du jour à Paris (AAAA-MM-JJ). */
export function parisToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

const shiftDay = (ymd: string, days: number) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const MONTHS = ["janv", "fev", "mars", "avr", "mai", "juin", "juil", "aout", "sept", "oct", "nov", "dec"];

/** Lit une date dans le texte ; renvoie aussi le texte sans elle (pour ne pas la prendre pour un montant). */
function extractDate(text: string, today: string): { date: string; rest: string } {
  const f = fold(text);
  if (/avant[- ]hier/.test(f)) return { date: shiftDay(today, -2), rest: text.replace(/avant[- ]hier/i, " ") };
  if (/\bhier\b/.test(f)) return { date: shiftDay(today, -1), rest: text.replace(/\bhier\b/i, " ") };
  if (/aujourd|\bauj\b|ce jour|a l'instant/.test(f)) return { date: today, rest: text.replace(/aujourd'?hui|\bauj\b/i, " ") };

  const numeric = text.match(/\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?\b/);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      let year = numeric[3] ? Number(numeric[3]) : Number(today.slice(0, 4));
      if (year < 100) year += 2000;
      const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      return { date: fixYear(date, today, Boolean(numeric[3])), rest: text.replace(numeric[0], " ") };
    }
  }

  const re = /\b(\d{1,2})(?:er)?\s+(janv\w*|f[eé]v\w*|mars|avr\w*|mai|juin|juil\w*|ao[uû]t|sept\w*|oct\w*|nov\w*|d[eé]c\w*)\.?(?:\s+(\d{4}))?/i;
  const m = text.match(re);
  if (m) {
    const day = Number(m[1]);
    const monthIdx = MONTHS.findIndex((mm) => fold(m[2]).startsWith(mm));
    if (day >= 1 && day <= 31 && monthIdx >= 0) {
      const year = m[3] ? Number(m[3]) : Number(today.slice(0, 4));
      const date = `${year}-${String(monthIdx + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      return { date: fixYear(date, today, Boolean(m[3])), rest: text.replace(m[0], " ") };
    }
  }
  return { date: today, rest: text };
}

/** « le 28 décembre » dit en janvier : c'était l'an dernier. */
function fixYear(date: string, today: string, explicitYear: boolean): string {
  if (explicitYear) return date;
  const diff = (new Date(`${date}T12:00:00Z`).getTime() - new Date(`${today}T12:00:00Z`).getTime()) / 86_400_000;
  if (diff > 7) return `${Number(date.slice(0, 4)) - 1}${date.slice(4)}`;
  return date;
}

/** Nombre écrit « 2500 », « 2 500 », « 2.500 », « 2,5k », « 2k5 ». */
function readAmount(raw: string): number {
  const s = raw.trim().toLowerCase().replace(/\s| /g, "");
  const k5 = s.match(/^(\d+)k(\d)$/);
  if (k5) return Number(k5[1]) * 1000 + Number(k5[2]) * 100;
  const k = s.match(/^(\d+(?:[.,]\d+)?)k$/);
  if (k) return Math.round(Number(k[1].replace(",", ".")) * 1000);
  // « 2.500 » / « 2,500 » = séparateur de milliers ; « 2,5 » = décimale.
  const grouped = s.match(/^(\d{1,3})([.,])(\d{3})$/);
  if (grouped) return Number(grouped[1] + grouped[3]);
  return Number(s.replace(",", "."));
}

const AMOUNT_RE = /(\d{1,3}(?:[  ]\d{3})+|\d+k\d|\d+(?:[.,]\d+)?k|\d+(?:[.,]\d+)?)\s*(€|euros?|eur\b|balles?|\$)?/gi;

/** Mots de liaison et mots-clés qui ne font jamais partie d'un nom (testés mot entier, accents compris). */
const KEYWORDS = /^(clos[eé]e?s?|close|closing|vendu|sign[eé]e?|a|pris|paye|pay[eé]|encaiss[eé]|vient|arrive|venu|de|du|d'|en|instant|cash|aujourd|aujourd'hui|hier|le|la|les|un|une|nouvel|nouvelle|nouveau|eleve|élève|ajoute|ajouter|client|cliente|contrat|offre|coaching|accompagnement|pour|avec|et|via|par|source|note|notes|mail|email|tel|tél|insta|instagram|youtube|tiktok|ads|pub|meta|facebook|parrainage|bouche|oreille|masterclass|lp|landing|fois|mois|x|il|elle|lui|qui|j'ai|on|hey|salut|yo)$/i;

/** Le nom : ce qui précède la première virgule ou le premier mot-clé, sans les mots de liaison. */
function extractName(text: string): string {
  // Segment par segment (« nouvel élève : Léa Dupont, 2500 ») : le premier qui donne un nom gagne.
  const segments = text.split(/[,;:\n(]|\s+[-–—]\s+/);
  for (const seg of segments) {
    const kept: string[] = [];
    for (const raw of seg.replace(/[@#]\S*/g, " ").split(/\s+/)) {
      if (!raw) continue;
      if (/\d/.test(raw)) break;
      const w = raw.replace(/[^\p{L}'’-]/gu, "");
      if (!w) continue;
      if (KEYWORDS.test(w)) {
        if (kept.length) break;
        continue;
      }
      kept.push(w);
      if (kept.length === 4) break;
    }
    if (kept.length) return kept.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  }
  return "";
}

export interface ParsedHints {
  /** L'encaissé a été dit explicitement (« payé 1000 », « acompte 500 »). */
  explicitCash: boolean;
  /** Un montant de contrat a été trouvé. */
  foundAmount: boolean;
}

/** Lecture sans IA. Les champs absents restent vides : l'IA, puis l'humain, complètent. */
export function parseStudentText(text: string, today = parisToday()): { draft: Partial<NewStudentDraft>; hints: ParsedHints } {
  const draft: Partial<NewStudentDraft> = {};
  const hints: ParsedHints = { explicitCash: false, foundAmount: false };
  let work = text.trim();

  const email = work.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  if (email) {
    draft.email = email[0];
    work = work.replace(email[0], " ");
  }
  const ig = work.match(/(?:^|[\s(])@([a-z0-9._]{2,30})/i);
  if (ig) {
    draft.igUsername = ig[1].replace(/\.$/, "");
    work = work.replace(ig[0], " ");
  }
  const phone = work.match(/(?:\+\d{1,3}[\s.-]?)?(?:\(?0\)?[\s.-]?)?[1-9](?:[\s.-]?\d){8,11}/);
  if (phone && phone[0].replace(/\D/g, "").length >= 9) {
    draft.phone = phone[0].trim();
    work = work.replace(phone[0], " ");
  }

  const { date, rest } = extractDate(work, today);
  draft.soldAt = date;
  work = rest;

  /* --- Paiement --- */
  const f = fold(work);
  const times = f.match(/\ben\s+(\d{1,2})\s*(?:fois|x|mensualit)/) ?? f.match(/\b(\d{1,2})\s*(?:fois|x\b|mensualites?)/);
  if (times && Number(times[1]) >= 2) {
    draft.paymentType = "installments";
    draft.installments = Number(times[1]);
    work = work.replace(new RegExp(times[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), " ");
  } else if (/acompte|deposit|arrhes/.test(f)) {
    draft.paymentType = "deposit";
  } else if (/instant|une fois|1 fois|comptant|cash|full|one shot|one-shot|direct|integral|en entier|totalite/.test(f)) {
    draft.paymentType = "paid-in-full";
  }
  if (/contrat (?:signe|ok|valide)|signe le contrat|a signe/.test(f)) draft.contractSigned = true;
  const unpaid = /pas (?:encore )?paye|rien (?:encaisse|paye|recu)|contrat envoye|paiement (?:en attente|a venir)|attend (?:le|son) paiement/.test(f);

  /* --- Montants --- */
  const cashMatch =
    work.match(/(?:pay[eé]|encaiss[eé]|acompte(?: de)?|vers[eé]|re[cç]u|cash)\D{0,12}?(\d{1,3}(?:[  ]\d{3})+|\d+k\d|\d+(?:[.,]\d+)?k|\d+(?:[.,]\d+)?)\s*(?:€|euros?|eur\b|balles?)?/i) ??
    work.match(/(\d{1,3}(?:[  ]\d{3})+|\d+k\d|\d+(?:[.,]\d+)?k|\d+(?:[.,]\d+)?)\s*(?:€|euros?|eur\b|balles?)?\s*(?:d'acompte|pay[eé]s?|encaiss[eé]s?|vers[eé]s?|cash|d'avance)/i);
  const amounts: number[] = [];
  for (const m of work.matchAll(AMOUNT_RE)) {
    const v = readAmount(m[1]);
    const hasUnit = Boolean(m[2]) || /k/i.test(m[1]);
    if (!Number.isFinite(v) || v <= 0) continue;
    if (!hasUnit && v < 100) continue; // « en 3 fois », « 22 » : pas un montant.
    amounts.push(v);
  }
  if (cashMatch) {
    const v = readAmount(cashMatch[1]);
    if (Number.isFinite(v) && v > 0) {
      draft.cashCollected = v;
      hints.explicitCash = true;
    }
  }
  const contract = amounts.length ? Math.max(...amounts) : 0;
  if (contract > 0) {
    draft.contractValue = contract;
    hints.foundAmount = true;
    if (!hints.explicitCash) {
      if (unpaid) draft.cashCollected = 0;
      else if (draft.paymentType === "installments" && draft.installments) draft.cashCollected = Math.round(contract / draft.installments);
      else if (draft.paymentType === "deposit") draft.cashCollected = 0;
      else draft.cashCollected = contract;
    }
    if (!draft.paymentType) draft.paymentType = unpaid ? "other" : hints.explicitCash && (draft.cashCollected ?? 0) < contract ? "deposit" : "paid-in-full";
  }

  /* --- Source --- */
  if (/insta|\big\b/.test(f)) draft.source = "instagram";
  else if (/youtube|\byt\b/.test(f)) draft.source = "youtube";
  else if (/tik ?tok/.test(f)) draft.source = "tiktok";
  else if (/\bads?\b|\bpubs?\b|\bmeta\b|facebook|\bfb\b/.test(f)) draft.source = "ads";
  else if (/masterclass|landing|\blp\b/.test(f)) draft.source = "masterclass";
  else if (/parrain|bouche|recommand|referral|ami de|pote de|cousin|frere|frère|soeur/.test(f)) draft.source = "referral";
  else if (/affili/.test(f)) draft.source = "affiliate";

  const name = extractName(work);
  if (name) draft.name = name;

  return { draft, hints };
}

/** Brouillon complet à partir de morceaux, avec des valeurs sûres partout. */
export function completeDraft(p: Partial<NewStudentDraft>, defaults: { offer: string; today: string }): NewStudentDraft {
  const contractValue = Math.max(0, Math.round(Number(p.contractValue) || 0));
  const paymentType: PaymentType = PAYMENT_OPTIONS.some((o) => o.key === p.paymentType) ? (p.paymentType as PaymentType) : "paid-in-full";
  const installments = paymentType === "installments" ? Math.max(2, Math.round(Number(p.installments) || 2)) : 0;
  const cash = p.cashCollected === undefined || p.cashCollected === null ? (paymentType === "paid-in-full" ? contractValue : 0) : Math.max(0, Math.round(Number(p.cashCollected) || 0));
  return {
    name: (p.name ?? "").trim(),
    contractValue,
    cashCollected: Math.min(cash, contractValue || cash),
    paymentType,
    installments,
    soldAt: /^\d{4}-\d{2}-\d{2}$/.test(p.soldAt ?? "") ? p.soldAt! : defaults.today,
    source: SOURCE_OPTIONS.some((o) => o.key === p.source) ? (p.source as string) : "",
    offer: (p.offer ?? "").trim() || defaults.offer,
    email: (p.email ?? "").trim(),
    phone: (p.phone ?? "").trim(),
    igUsername: (p.igUsername ?? "").trim().replace(/^@/, ""),
    notes: (p.notes ?? "").trim(),
    leadId: (p.leadId ?? "").trim(),
    setterId: (p.setterId ?? "").trim(),
    createAccess: p.createAccess !== false,
    contractSigned: Boolean(p.contractSigned),
  };
}

/** Phrase de contrôle affichée par le bot. */
export function describeDraft(d: NewStudentDraft, currency = "EUR"): string {
  const money = (n: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
  const date = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long" }).format(new Date(`${d.soldAt}T12:00:00Z`));
  const pay =
    d.paymentType === "installments"
      ? `en ${d.installments} fois (${money(d.cashCollected)} encaissés aujourd'hui)`
      : d.paymentType === "deposit"
        ? `acompte de ${money(d.cashCollected)}`
        : d.cashCollected >= d.contractValue
          ? "payé en une fois"
          : `${money(d.cashCollected)} encaissés`;
  const src = d.source ? sourceOption(d.source).label : "source inconnue";
  return `${d.name || "Sans nom"} : ${money(d.contractValue)} le ${date}, ${pay}, ${src}.`;
}
