/**
 * Media buying Meta Ads : types du domaine.
 *
 * Deux familles cohabitent :
 *  - ce qui vient de Meta (campagnes, ad sets, ads, creatives, stats du jour),
 *    stocke tel quel dans un snapshot par compte ;
 *  - ce qui n'existe que dans l'outil (phase, objectif de leads, winners,
 *    notes, journal), qui ne modifie jamais Meta.
 */

import type { ID } from "../types";

/* ------------------------------ Phases ------------------------------- */

/** Methodologie : on teste, on confirme les winners, on met le budget. */
export type Phase = "testing" | "scaling-testing" | "hyper-scaling" | "unclassified";

export const PHASES: Phase[] = ["testing", "scaling-testing", "hyper-scaling"];

export const PHASE_LABEL: Record<Phase, string> = {
  testing: "Testing",
  "scaling-testing": "Scaling-Testing",
  "hyper-scaling": "Hyper-Scaling",
  unclassified: "Non classée",
};

/** Prefixe de nommage qui classe une campagne toute seule. */
export const PHASE_PREFIX: Record<Exclude<Phase, "unclassified">, string> = {
  testing: "[TESTING]",
  "scaling-testing": "[SCALING-TESTING]",
  "hyper-scaling": "[HYPER-SCALING]",
};

export type EntityLevel = "campaign" | "adset" | "ad";

/* ------------------------------- Meta -------------------------------- */

/** Statut configure ou effectif tel que Meta le renvoie. */
export type MetaStatus =
  | "ACTIVE"
  | "PAUSED"
  | "PENDING_REVIEW"
  | "DISAPPROVED"
  | "PREAPPROVED"
  | "PENDING_BILLING_INFO"
  | "CAMPAIGN_PAUSED"
  | "ADSET_PAUSED"
  | "ARCHIVED"
  | "DELETED"
  | "IN_PROCESS"
  | "WITH_ISSUES";

/** Les quatre etats que le cockpit affiche. */
export type UiStatus = "active" | "paused" | "pending" | "error";

export type BudgetType = "daily" | "lifetime";

export interface MetaBudget {
  amount: number;
  type: BudgetType;
  /** Ou vit le budget : CBO (campagne) ou ABO (ad set). */
  level: "campaign" | "adset";
}

export interface MetaCampaign {
  id: string;
  name: string;
  status: MetaStatus;
  effectiveStatus: MetaStatus;
  objective: string;
  buyingType: string;
  /** Budget de campagne (CBO). Null en ABO : le budget est sur les ad sets. */
  dailyBudget: number | null;
  lifetimeBudget: number | null;
  createdTime: string;
  updatedTime: string;
  startTime: string;
}

export interface MetaAdSet {
  id: string;
  campaignId: string;
  name: string;
  status: MetaStatus;
  effectiveStatus: MetaStatus;
  dailyBudget: number | null;
  lifetimeBudget: number | null;
  optimizationGoal: string;
  /** Resume lisible du ciblage : « Broad · FR · 25-55 ». */
  targetingSummary: string;
  createdTime: string;
  updatedTime: string;
}

export interface MetaAd {
  id: string;
  adsetId: string;
  campaignId: string;
  name: string;
  status: MetaStatus;
  effectiveStatus: MetaStatus;
  creativeId: string;
  /** `effective_object_story_id` : le Post ID que l'on reutilise en scaling. */
  postId: string;
  createdTime: string;
  updatedTime: string;
}

export type CreativeKind = "video" | "image" | "carousel" | "unknown";

export interface MetaCreative {
  id: string;
  name: string;
  kind: CreativeKind;
  thumbnailUrl: string;
  imageUrl: string;
  videoUrl: string;
  primaryText: string;
  headline: string;
  description: string;
  cta: string;
  pageId: string;
}

/** Stats d'un jour pour une ad : la maille la plus fine que l'on garde. */
export interface DailyInsight {
  adId: string;
  /** « AAAA-MM-JJ » dans le fuseau du compte. */
  date: string;
  spend: number;
  impressions: number;
  reach: number;
  /** Clics sur le lien, pas « tous les clics ». */
  linkClicks: number;
  /** Landing page views. */
  lpv: number;
  leads: number;
}

/** Donnees business (bookings, ventes) venues d'ailleurs que Meta. */
export interface DailyConversion {
  adId: string;
  date: string;
  validLeads: number;
  qualifiedLeads: number;
  bookings: number;
  shows: number;
  sales: number;
  revenue: number;
  cashCollected: number;
}

/**
 * Photo complete d'un compte publicitaire, telle que la derniere synchro l'a
 * laissee. C'est ce que lit l'interface : jamais Meta en direct.
 */
export interface MetaSnapshot {
  id: ID;
  connectionId: ID;
  syncedAt: string;
  /** Duree de la derniere synchro, pour l'afficher. */
  syncMs: number;
  currency: string;
  timezone: string;
  campaigns: MetaCampaign[];
  adsets: MetaAdSet[];
  ads: MetaAd[];
  creatives: MetaCreative[];
  insights: DailyInsight[];
  /** Null tant qu'aucune source business n'est branchee. */
  conversions: DailyConversion[] | null;
  conversionSource: string;
}

/* ------------------------------ Metriques ----------------------------- */

export interface RawMetrics {
  spend: number;
  impressions: number;
  reach: number;
  linkClicks: number;
  lpv: number;
  leads: number;
}

export interface ConversionMetrics {
  validLeads: number;
  qualifiedLeads: number;
  bookings: number;
  shows: number;
  sales: number;
  revenue: number;
  cashCollected: number;
}

/**
 * Toutes les metriques d'une entite sur une periode. Les ratios valent
 * `null` quand le denominateur est nul : l'interface affiche « — ».
 * Les metriques business valent `null` tant que rien n'est branche.
 */
export interface Metrics extends RawMetrics {
  frequency: number | null;
  ctrLink: number | null;
  cpcLink: number | null;
  cpm: number | null;
  costPerLpv: number | null;
  cpl: number | null;
  leadRate: number | null;
  clickToLpv: number | null;
  validLeads: number | null;
  qualifiedLeads: number | null;
  bookings: number | null;
  shows: number | null;
  sales: number | null;
  revenue: number | null;
  cashCollected: number | null;
  costPerBooking: number | null;
  costPerShow: number | null;
  /** Bookings / leads, en %. */
  leadToBooking: number | null;
  showRate: number | null;
  closeRate: number | null;
  cac: number | null;
  roas: number | null;
  cashRoas: number | null;
}

export type MetricKey = keyof Metrics;

export type Health = "strong" | "watch" | "weak" | "none";

export type Verdict = "keep" | "watch" | "kill" | "none";

export interface Recommendation {
  verdict: Verdict;
  /** Phrase courte, ex. « 7 leads · CPL 9,31 € ». */
  reason: string;
}

/* ------------------------------ Interne ------------------------------- */

export type WinnerStatus = "" | "testing" | "potential-winner" | "winner" | "loser";

export const WINNER_LABEL: Record<WinnerStatus, string> = {
  "": "—",
  testing: "Testing",
  "potential-winner": "Potential winner",
  winner: "Winner",
  loser: "Loser",
};

export interface CampaignInternalData {
  id: ID;
  connectionId: ID;
  metaCampaignId: string;
  phase: Phase;
  /** Objectif de leads propre a cette campagne ; null = celui de la phase. */
  leadGoal: number | null;
  internalNotes: string;
  updatedAt: string;
}

export interface AdInternalData {
  id: ID;
  connectionId: ID;
  metaAdId: string;
  winnerStatus: WinnerStatus;
  notes: string;
  updatedAt: string;
}

export type RankingMetric = "cpl" | "bookings" | "costPerBooking" | "sales" | "cac" | "roas";

export interface MediaBuyingSettings {
  id: ID;
  connectionId: ID;
  targetCpl: number;
  targetCpb: number;
  targetCac: number;
  /** En pourcentage : 1 = 1 %. */
  minCtr: number;
  maxCpc: number;
  maxCostLpv: number;
  minLpvBeforeKill: number;
  minLeadsBeforeBookingJudgement: number;
  maxSpendWithoutLead: number;
  leadGoalTesting: number;
  leadGoalScaling: number;
  leadGoalHyper: number;
  rankingMetric: RankingMetric;
  updatedAt: string;
}

export type ConnectionStatus = "connected" | "error" | "disconnected";

export interface MetaConnection {
  id: ID;
  name: string;
  businessManagerId: string;
  adAccountId: string;
  /** AES-256-GCM, jamais renvoye au navigateur. Vide en mode mock. */
  encryptedAccessToken: string;
  /** Quatre derniers caracteres, pour reconnaitre le jeton sans le montrer. */
  tokenHint: string;
  provider: "mock" | "meta";
  status: ConnectionStatus;
  lastError: string;
  lastSyncAt: string;
  lastTestAt: string;
  /** Permissions accordees au jeton, et celles qui manquent au module. */
  permissions: string[];
  missingPermissions: string[];
  accountName: string;
  currency: string;
  timezone: string;
  tokenExpiresAt: string;
  createdAt: string;
  updatedAt: string;
}

/** Ce que le navigateur recoit : la connexion sans son secret. */
export type PublicConnection = Omit<MetaConnection, "encryptedAccessToken">;

export type AuditEntityType = EntityLevel | "connection" | "draft" | "settings";

export interface MediaBuyingAuditLog {
  id: ID;
  at: string;
  userId: string;
  userName: string;
  connectionId: ID;
  entityType: AuditEntityType;
  entityId: string;
  entityName: string;
  /** Verbe machine : « budget.update », « status.pause », « postId.copy »… */
  action: string;
  before: string;
  after: string;
  summary: string;
}

/* ------------------------------- Builder ------------------------------ */

export interface DraftAd {
  name: string;
  /** Post ID a reutiliser (scaling) ; vide pour une creative a monter. */
  postId: string;
  /** Ad d'origine quand elle vient d'un winner existant. */
  sourceAdId: string;
}

export interface DraftAdSet {
  name: string;
  /** Budget de l'ad set en ABO ; ignore en CBO. */
  budget: number;
  ads: DraftAd[];
}

export interface CampaignDraft {
  id: ID;
  connectionId: ID;
  phase: Exclude<Phase, "unclassified">;
  name: string;
  objective: string;
  country: string;
  budgetType: BudgetType;
  budgetLevel: "campaign" | "adset";
  /** Budget de campagne en CBO. */
  budget: number;
  adsets: DraftAdSet[];
  status: "draft" | "published" | "failed";
  publishedCampaignId: string;
  error: string;
  createdAt: string;
  updatedAt: string;
}

/* ----------------------------- Vue agregee ---------------------------- */

/**
 * Une ligne de la table (campagne, ad set ou ad) avec tout ce que
 * l'interface affiche : metriques sur la periode, periode precedente,
 * dernieres 24 h, sante, recommandation, donnees internes.
 */
export interface EntityRow {
  level: EntityLevel;
  id: string;
  parentId: string;
  campaignId: string;
  name: string;
  status: UiStatus;
  configuredStatus: MetaStatus;
  effectiveStatus: MetaStatus;
  phase: Phase;
  budget: MetaBudget | null;
  metrics: Metrics;
  prev: Metrics;
  last24h: RawMetrics;
  health: Health;
  recommendation: Recommendation;
  /** Ads seulement. */
  postId: string;
  creative: MetaCreative | null;
  winnerStatus: WinnerStatus;
  notes: string;
  leadGoal: number | null;
  targetingSummary: string;
  objective: string;
  updatedTime: string;
  /** Nombre d'enfants (ad sets d'une campagne, ads d'un ad set). */
  children: number;
}

export interface DateRange {
  from: string;
  to: string;
}

export interface Overview {
  connection: PublicConnection;
  settings: MediaBuyingSettings;
  range: DateRange;
  prevRange: DateRange;
  syncedAt: string;
  syncMs: number;
  /** Une synchro tourne en arriere-plan : les chiffres affiches datent de `syncedAt`. */
  syncing: boolean;
  currency: string;
  timezone: string;
  campaigns: EntityRow[];
  adsets: EntityRow[];
  ads: EntityRow[];
  conversionsConnected: boolean;
  conversionSource: string;
  /** Totaux du compte sur la periode. */
  totals: Metrics;
  prevTotals: Metrics;
}
