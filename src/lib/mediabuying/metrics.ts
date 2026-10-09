/**
 * Formules, agregation par periode, sante et recommandation.
 *
 * Tout est pur : pas d'acces a la base ni a Meta. Les memes fonctions
 * servent au serveur (vue agregee) et au navigateur (compare, tri).
 */

import { fmtMoney } from "../format";
import type {
  ConversionMetrics,
  DailyConversion,
  DailyInsight,
  DateRange,
  Health,
  MediaBuyingSettings,
  MetaStatus,
  Metrics,
  MetricKey,
  Phase,
  RawMetrics,
  Recommendation,
  UiStatus,
} from "./types";
import { PHASE_PREFIX } from "./types";

/* ------------------------------ Periodes ------------------------------ */

export type RangePreset = "today" | "yesterday" | "last3" | "last7" | "last14" | "last30" | "custom";

export const RANGE_PRESETS: { key: RangePreset; label: string }[] = [
  { key: "today", label: "Aujourd'hui" },
  { key: "yesterday", label: "Hier" },
  { key: "last3", label: "3 derniers jours" },
  { key: "last7", label: "7 derniers jours" },
  { key: "last14", label: "14 derniers jours" },
  { key: "last30", label: "30 derniers jours" },
  { key: "custom", label: "Personnalisé" },
];

/** « AAAA-MM-JJ » d'un instant dans un fuseau. */
export function dayIn(tz: string, at: Date = new Date()): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function shiftDay(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1;
}

export function rangeFor(preset: RangePreset, today: string, custom?: Partial<DateRange>): DateRange {
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const y = shiftDay(today, -1);
      return { from: y, to: y };
    }
    case "last3":
      return { from: shiftDay(today, -2), to: today };
    case "last7":
      return { from: shiftDay(today, -6), to: today };
    case "last14":
      return { from: shiftDay(today, -13), to: today };
    case "last30":
      return { from: shiftDay(today, -29), to: today };
    case "custom": {
      const from = custom?.from || shiftDay(today, -6);
      const to = custom?.to || today;
      return from <= to ? { from, to } : { from: to, to: from };
    }
  }
}

/** La periode de meme longueur juste avant : la base de comparaison. */
export function previousRange(r: DateRange): DateRange {
  const n = daysBetween(r.from, r.to);
  return { from: shiftDay(r.from, -n), to: shiftDay(r.from, -1) };
}

/* ------------------------------ Formules ------------------------------ */

export const emptyRaw = (): RawMetrics => ({ spend: 0, impressions: 0, reach: 0, linkClicks: 0, lpv: 0, leads: 0 });

export const emptyConv = (): ConversionMetrics => ({ validLeads: 0, qualifiedLeads: 0, bookings: 0, shows: 0, sales: 0, revenue: 0, cashCollected: 0 });

export function addConv(out: ConversionMetrics, r: ConversionMetrics) {
  out.validLeads += r.validLeads;
  out.qualifiedLeads += r.qualifiedLeads;
  out.bookings += r.bookings;
  out.shows += r.shows;
  out.sales += r.sales;
  out.revenue += r.revenue;
  out.cashCollected += r.cashCollected;
}

const div = (a: number, b: number) => (b > 0 ? a / b : null);

/** Toutes les metriques derivees. `conv` null = source business non connectee. */
export function computeMetrics(raw: RawMetrics, conv: ConversionMetrics | null): Metrics {
  const m: Metrics = {
    ...raw,
    frequency: div(raw.impressions, raw.reach),
    ctrLink: raw.impressions > 0 ? (raw.linkClicks / raw.impressions) * 100 : null,
    cpcLink: div(raw.spend, raw.linkClicks),
    cpm: raw.impressions > 0 ? (raw.spend / raw.impressions) * 1000 : null,
    costPerLpv: div(raw.spend, raw.lpv),
    cpl: div(raw.spend, raw.leads),
    leadRate: raw.lpv > 0 ? (raw.leads / raw.lpv) * 100 : null,
    clickToLpv: raw.linkClicks > 0 ? (raw.lpv / raw.linkClicks) * 100 : null,
    validLeads: null,
    qualifiedLeads: null,
    bookings: null,
    shows: null,
    sales: null,
    revenue: null,
    cashCollected: null,
    costPerBooking: null,
    costPerShow: null,
    leadToBooking: null,
    showRate: null,
    closeRate: null,
    cac: null,
    roas: null,
    cashRoas: null,
  };
  if (conv) {
    m.validLeads = conv.validLeads;
    m.qualifiedLeads = conv.qualifiedLeads;
    m.bookings = conv.bookings;
    m.shows = conv.shows;
    m.sales = conv.sales;
    m.revenue = conv.revenue;
    m.cashCollected = conv.cashCollected;
    m.costPerBooking = div(raw.spend, conv.bookings);
    m.costPerShow = div(raw.spend, conv.shows);
    m.leadToBooking = raw.leads > 0 ? (conv.bookings / raw.leads) * 100 : null;
    m.showRate = conv.bookings > 0 ? (conv.shows / conv.bookings) * 100 : null;
    m.closeRate = conv.shows > 0 ? (conv.sales / conv.shows) * 100 : null;
    m.cac = div(raw.spend, conv.sales);
    m.roas = div(conv.revenue, raw.spend);
    m.cashRoas = div(conv.cashCollected, raw.spend);
  }
  return m;
}

/* ----------------------------- Agregation ----------------------------- */

/**
 * Somme des stats quotidiennes d'un ensemble d'ads sur une periode.
 * Le reach se somme (approximation : Meta dedoublonne, pas nous), la
 * frequence en decoule.
 */
export function sumInsights(rows: DailyInsight[], adIds: Set<string>, range: DateRange): RawMetrics {
  const out = emptyRaw();
  for (const r of rows) {
    if (!adIds.has(r.adId) || r.date < range.from || r.date > range.to) continue;
    out.spend += r.spend;
    out.impressions += r.impressions;
    out.reach += r.reach;
    out.linkClicks += r.linkClicks;
    out.lpv += r.lpv;
    out.leads += r.leads;
  }
  return out;
}

export function sumConversions(rows: DailyConversion[] | null, adIds: Set<string>, range: DateRange): ConversionMetrics | null {
  if (!rows) return null;
  const out = emptyConv();
  for (const r of rows) {
    if (!adIds.has(r.adId) || r.date < range.from || r.date > range.to) continue;
    addConv(out, r);
  }
  return out;
}

/** Index « adId -> lignes » : evite de rebalayer 5 000 lignes par entite. */
export function indexByAd<T extends { adId: string }>(rows: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) m.set(r.adId, [...(m.get(r.adId) ?? []), r]);
  return m;
}

export function sumIndexed(index: Map<string, DailyInsight[]>, adIds: Iterable<string>, range: DateRange): RawMetrics {
  const out = emptyRaw();
  for (const id of adIds) {
    for (const r of index.get(id) ?? []) {
      if (r.date < range.from || r.date > range.to) continue;
      out.spend += r.spend;
      out.impressions += r.impressions;
      out.reach += r.reach;
      out.linkClicks += r.linkClicks;
      out.lpv += r.lpv;
      out.leads += r.leads;
    }
  }
  return out;
}

export function sumIndexedConv(index: Map<string, DailyConversion[]> | null, adIds: Iterable<string>, range: DateRange): ConversionMetrics | null {
  if (!index) return null;
  const out = emptyConv();
  for (const id of adIds) {
    for (const r of index.get(id) ?? []) {
      if (r.date < range.from || r.date > range.to) continue;
      addConv(out, r);
    }
  }
  return out;
}

/* ------------------------------- Statuts ------------------------------ */

export function uiStatus(effective: MetaStatus, configured: MetaStatus): UiStatus {
  if (effective === "ACTIVE") return "active";
  if (effective === "PENDING_REVIEW" || effective === "IN_PROCESS" || effective === "PREAPPROVED" || effective === "PENDING_BILLING_INFO") return "pending";
  if (effective === "DISAPPROVED" || effective === "WITH_ISSUES") return "error";
  if (configured === "ACTIVE" && (effective === "CAMPAIGN_PAUSED" || effective === "ADSET_PAUSED")) return "paused";
  return "paused";
}

export const STATUS_LABEL: Record<UiStatus, string> = { active: "Active", paused: "En pause", pending: "En attente", error: "Erreur" };

/* ------------------------------- Phases ------------------------------- */

export function phaseFromName(name: string): Phase {
  const n = name.toUpperCase();
  if (n.includes(PHASE_PREFIX["hyper-scaling"])) return "hyper-scaling";
  if (n.includes(PHASE_PREFIX["scaling-testing"])) return "scaling-testing";
  if (n.includes(PHASE_PREFIX.testing)) return "testing";
  return "unclassified";
}

export function leadGoalFor(phase: Phase, s: MediaBuyingSettings): number {
  if (phase === "scaling-testing") return s.leadGoalScaling;
  if (phase === "hyper-scaling") return s.leadGoalHyper;
  return s.leadGoalTesting;
}

/* --------------------------- Sante et verdict ------------------------- */

/**
 * Sante d'une entite d'apres les cibles du compte.
 *
 * Priorite business : une ad qui amene des bookings ou des ventes au bon
 * prix est forte, quel que soit son CPL. Sinon on regarde le CPL, puis le
 * CTR lien. Rien n'est jamais coupe automatiquement : c'est une couleur.
 */
export function healthOf(m: Metrics, s: MediaBuyingSettings, conversionsConnected: boolean): Health {
  if (m.spend <= 0) return "none";
  if (conversionsConnected) {
    if ((m.sales ?? 0) > 0 && m.cac !== null && m.cac <= s.targetCac) return "strong";
    if ((m.bookings ?? 0) > 0 && m.costPerBooking !== null && m.costPerBooking <= s.targetCpb) return "strong";
  }
  const signals: Health[] = [];
  if (m.ctrLink !== null) signals.push(m.ctrLink >= s.minCtr * 2 ? "strong" : m.ctrLink >= s.minCtr ? "watch" : "weak");
  if (m.leads > 0 && m.cpl !== null) {
    signals.push(m.cpl <= s.targetCpl ? "strong" : m.cpl <= s.targetCpl * 1.3 ? "watch" : "weak");
  } else if (m.spend >= s.maxSpendWithoutLead) {
    signals.push("weak");
  } else if (m.lpv < s.minLpvBeforeKill) {
    signals.push("watch");
  }
  if (!signals.length) return "watch";
  if (signals.includes("weak")) return "weak";
  if (signals.includes("watch")) return "watch";
  return "strong";
}

const n0 = (v: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(v);

/**
 * KEEP / WATCH / KILL, avec la raison en une ligne. Toujours une
 * recommandation, jamais une action : le media buyer decide.
 */
export function recommend(m: Metrics, s: MediaBuyingSettings, conversionsConnected: boolean, currency: string): Recommendation {
  const money = (v: number) => fmtMoney(v, currency);
  if (m.spend <= 0) return { verdict: "none", reason: "Aucune dépense sur la période" };

  if (conversionsConnected) {
    const sales = m.sales ?? 0;
    const bookings = m.bookings ?? 0;
    if (sales > 0 && m.cac !== null && m.cac <= s.targetCac) {
      return { verdict: "keep", reason: `${sales} vente${sales > 1 ? "s" : ""} · CAC ${money(m.cac)}` };
    }
    if (bookings > 0 && m.costPerBooking !== null && m.costPerBooking <= s.targetCpb) {
      return { verdict: "keep", reason: `${bookings} booking${bookings > 1 ? "s" : ""} · ${money(m.costPerBooking)} / booking` };
    }
  }

  if (m.leads === 0) {
    if (m.lpv < s.minLpvBeforeKill) {
      return { verdict: "watch", reason: `Trop tôt : ${n0(m.lpv)} LPV sur ${s.minLpvBeforeKill} minimum` };
    }
    if (m.spend >= s.maxSpendWithoutLead) {
      return { verdict: "kill", reason: `${money(m.spend)} dépensés / 0 lead` };
    }
    return { verdict: "watch", reason: `${money(m.spend)} dépensés / 0 lead, sous le seuil de ${money(s.maxSpendWithoutLead)}` };
  }

  const cpl = m.cpl ?? 0;
  const leads = `${m.leads} lead${m.leads > 1 ? "s" : ""}`;
  const lowCtr = m.ctrLink !== null && m.ctrLink < s.minCtr && m.lpv >= s.minLpvBeforeKill;

  if (cpl <= s.targetCpl) {
    if (conversionsConnected && m.leads >= s.minLeadsBeforeBookingJudgement && (m.bookings ?? 0) === 0) {
      return { verdict: "watch", reason: `${leads} / aucun booking` };
    }
    if (lowCtr) return { verdict: "watch", reason: `${leads} · CPL ${money(cpl)} mais CTR ${m.ctrLink!.toFixed(2).replace(".", ",")} %` };
    return { verdict: "keep", reason: `${leads} · CPL ${money(cpl)}` };
  }
  if (cpl <= s.targetCpl * 1.3) {
    return { verdict: "watch", reason: `CPL ${money(cpl)} vs cible ${money(s.targetCpl)}` };
  }
  if ((m.bookings ?? 0) > 0) {
    return { verdict: "watch", reason: `CPL élevé (${money(cpl)}) mais ${m.bookings} booking${(m.bookings ?? 0) > 1 ? "s" : ""}` };
  }
  return { verdict: "kill", reason: `CPL ${money(cpl)}, cible ${money(s.targetCpl)}` };
}

/* ------------------------------ Affichage ----------------------------- */

export type MetricFormat = "money" | "int" | "pct" | "ratio" | "x";

export interface MetricDef {
  key: MetricKey;
  label: string;
  short: string;
  format: MetricFormat;
  /** Une baisse est une bonne nouvelle (CPL, CPC…). */
  lowerIsBetter?: boolean;
  /** Vient d'une source business, pas de Meta. */
  business?: boolean;
}

export const METRIC_DEFS: MetricDef[] = [
  { key: "spend", label: "Dépense", short: "Spend", format: "money" },
  { key: "leads", label: "Leads", short: "Leads", format: "int" },
  { key: "cpl", label: "Coût par lead", short: "CPL", format: "money", lowerIsBetter: true },
  { key: "validLeads", label: "Leads valides", short: "Valid", format: "int", business: true },
  { key: "qualifiedLeads", label: "Leads qualifiés", short: "Qualif.", format: "int", business: true },
  { key: "bookings", label: "Bookings", short: "Bookings", format: "int", business: true },
  { key: "leadToBooking", label: "Booking rate", short: "Bkg rate", format: "pct", business: true },
  { key: "costPerBooking", label: "Coût par booking", short: "Cost / Booking", format: "money", lowerIsBetter: true, business: true },
  { key: "shows", label: "Shows", short: "Shows", format: "int", business: true },
  { key: "showRate", label: "Show rate", short: "Show rate", format: "pct", business: true },
  { key: "costPerShow", label: "Coût par show", short: "Cost / Show", format: "money", lowerIsBetter: true, business: true },
  { key: "sales", label: "Ventes", short: "Sales", format: "int", business: true },
  { key: "closeRate", label: "Close rate", short: "Close rate", format: "pct", business: true },
  { key: "cac", label: "CAC", short: "CAC", format: "money", lowerIsBetter: true, business: true },
  { key: "revenue", label: "Chiffre d'affaires", short: "Revenue", format: "money", business: true },
  { key: "cashCollected", label: "Cash encaissé", short: "Cash", format: "money", business: true },
  { key: "roas", label: "ROAS", short: "ROAS", format: "x", business: true },
  { key: "cashRoas", label: "Cash ROAS", short: "Cash ROAS", format: "x", business: true },
  { key: "linkClicks", label: "Clics lien", short: "Link Clicks", format: "int" },
  { key: "ctrLink", label: "CTR lien", short: "CTR Link", format: "pct" },
  { key: "cpcLink", label: "CPC lien", short: "CPC Link", format: "money", lowerIsBetter: true },
  { key: "lpv", label: "Landing page views", short: "LPV", format: "int" },
  { key: "costPerLpv", label: "Coût par LPV", short: "Cost / LPV", format: "money", lowerIsBetter: true },
  { key: "leadRate", label: "LPV → Lead", short: "Lead rate", format: "pct" },
  { key: "clickToLpv", label: "Clic → LPV", short: "Click → LPV", format: "pct" },
  { key: "impressions", label: "Impressions", short: "Impr.", format: "int" },
  { key: "reach", label: "Reach", short: "Reach", format: "int" },
  { key: "frequency", label: "Fréquence", short: "Freq.", format: "ratio", lowerIsBetter: true },
  { key: "cpm", label: "CPM", short: "CPM", format: "money", lowerIsBetter: true },
];

export const METRIC_BY_KEY = new Map(METRIC_DEFS.map((d) => [d.key, d]));

export function fmtMetric(key: MetricKey, value: number | null | undefined, currency: string): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const def = METRIC_BY_KEY.get(key);
  switch (def?.format) {
    case "money":
      return fmtMoney(value, currency);
    case "pct":
      return `${value.toFixed(2).replace(".", ",")} %`;
    case "ratio":
      return value.toFixed(2).replace(".", ",");
    case "x":
      return `${value.toFixed(2).replace(".", ",")}×`;
    default:
      return new Intl.NumberFormat("fr-FR").format(Math.round(value));
  }
}

/** Variation en % entre deux valeurs ; null si pas comparable. */
export function deltaPct(now: number | null, before: number | null): number | null {
  if (now === null || before === null || before === 0) return null;
  return ((now - before) / before) * 100;
}
