/**
 * Provider Meta simule.
 *
 * Un compte realiste pour une offre high ticket (masterclass e-commerce,
 * ~3 000 €) : campagnes de test, de scaling et d'hyper-scaling, ads avec
 * des profils contrastes (CPL bas sans booking, CPL eleve qui convertit…),
 * 75 jours de stats quotidiennes generees de maniere deterministe. Le meme
 * compte revient a chaque synchro, la journee en cours grossit au fil des
 * heures, et les ads creees ou dupliquees depuis l'outil vivent dans le
 * snapshot, pas ici.
 */

import type {
  BudgetType,
  DailyConversion,
  DailyInsight,
  DateRange,
  EntityLevel,
  MetaAd,
  MetaAdSet,
  MetaCampaign,
  MetaCreative,
  MetaStatus,
} from "./types";
import { dayIn, daysBetween, shiftDay } from "./metrics";
import type {
  AdInput,
  AdSetInput,
  CampaignInput,
  ConnectionCheck,
  DuplicateTarget,
  MetaMarketingProvider,
  ProviderContext,
} from "./provider";

/* ------------------------------ Aleatoire ----------------------------- */

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 : rapide, reproductible, largement suffisant pour des stats. */
function rng(seed: string): () => number {
  let a = hash(seed);
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Binomiale par tirages : petits effectifs, ca suffit. */
function binomial(n: number, p: number, r: () => number): number {
  let k = 0;
  for (let i = 0; i < n; i++) if (r() < p) k++;
  return k;
}

/* ------------------------------- Compte ------------------------------- */

const TZ = "Europe/Paris";
const CURRENCY = "EUR";

interface AdProfile {
  /** CTR lien en %. */
  ctr: number;
  cpm: number;
  /** Clic -> LPV. */
  c2l: number;
  /** LPV -> lead, en %. */
  l2lead: number;
  /** Lead -> booking, lead -> qualifie, booking -> show, show -> vente (0..1). */
  bookRate: number;
  qualRate: number;
  showRate: number;
  closeRate: number;
  /** Part du budget de l'ad set. */
  weight: number;
  createdDaysAgo: number;
  pausedDaysAgo: number | null;
  status: MetaStatus;
  kind: "video" | "image";
}

interface AdSpec extends Partial<AdProfile> {
  name: string;
  /** Reutilise le Post ID d'une autre ad (scaling). */
  postOf?: string;
}

interface AdSetSpec {
  key: string;
  name: string;
  budget: number | null;
  createdDaysAgo: number;
  status?: MetaStatus;
  targeting: string;
  ads: AdSpec[];
}

interface CampaignSpec {
  key: string;
  name: string;
  objective: string;
  createdDaysAgo: number;
  status?: MetaStatus;
  pausedDaysAgo?: number;
  /** Budget de campagne : CBO. */
  cbo?: number;
  adsets: AdSetSpec[];
}

const BASE: AdProfile = {
  ctr: 1.6,
  cpm: 14,
  c2l: 0.72,
  l2lead: 9,
  bookRate: 0.12,
  qualRate: 0.55,
  showRate: 0.7,
  closeRate: 0.3,
  weight: 1,
  createdDaysAgo: 20,
  pausedDaysAgo: null,
  status: "ACTIVE",
  kind: "video",
};

/** Le compte : pense pour que V3 (CPL bas, 0 booking) et V8 (CPL eleve, bookings) coexistent. */
const ACCOUNT: CampaignSpec[] = [
  {
    key: "c1",
    name: "[TESTING] | MASTERCLASS ECOM AI | ABO",
    objective: "OUTCOME_LEADS",
    createdDaysAgo: 21,
    adsets: [
      {
        key: "as1",
        name: "VIDEO | BROAD | FR",
        budget: 100,
        createdDaysAgo: 21,
        targeting: "Broad · FR · 25-55",
        ads: [
          { name: "V1", ctr: 2.3, l2lead: 10, bookRate: 0.16, closeRate: 0.4, createdDaysAgo: 21 },
          { name: "V2", ctr: 0.9, l2lead: 5, createdDaysAgo: 21, pausedDaysAgo: 10, status: "PAUSED" },
          { name: "V3", ctr: 2.8, cpm: 11, l2lead: 11, bookRate: 0.0, createdDaysAgo: 21, weight: 0.8 },
          { name: "V4", ctr: 0.7, l2lead: 2, createdDaysAgo: 21, pausedDaysAgo: 12, status: "PAUSED" },
          { name: "V5", ctr: 1.3, l2lead: 6, bookRate: 0.08, createdDaysAgo: 14 },
          { name: "V6", ctr: 1.9, l2lead: 8, createdDaysAgo: 3 },
        ],
      },
      {
        key: "as2",
        name: "VIDEO | BROAD | FR | BATCH 02",
        budget: 100,
        createdDaysAgo: 8,
        targeting: "Broad · FR · 25-55",
        ads: [
          { name: "V7", ctr: 1.4, l2lead: 6, createdDaysAgo: 8, weight: 0.8 },
          { name: "V8", ctr: 1.7, cpm: 16, l2lead: 4, bookRate: 0.7, qualRate: 0.9, showRate: 0.9, closeRate: 0.6, createdDaysAgo: 8, weight: 0.6 },
          { name: "V9", ctr: 1.8, l2lead: 9, createdDaysAgo: 8, status: "PENDING_REVIEW", weight: 0 },
          { name: "V10", ctr: 0.8, cpm: 18, l2lead: 4, createdDaysAgo: 8 },
        ],
      },
    ],
  },
  {
    key: "c2",
    name: "[TESTING] | MASTERCLASS ECOM AI | BATCH 03 | ABO",
    objective: "OUTCOME_LEADS",
    createdDaysAgo: 3,
    adsets: [
      {
        key: "as3",
        name: "IMAGE | BROAD | FR | BATCH 03",
        budget: 60,
        createdDaysAgo: 3,
        targeting: "Broad · FR · 25-55",
        ads: [
          { name: "V11", ctr: 2.0, l2lead: 9, createdDaysAgo: 3, kind: "image" },
          { name: "V12", ctr: 1.1, l2lead: 6, createdDaysAgo: 3, kind: "image" },
          { name: "V13", ctr: 1.5, createdDaysAgo: 1, status: "PENDING_REVIEW", weight: 0, kind: "image" },
        ],
      },
    ],
  },
  {
    key: "c3",
    name: "[SCALING-TESTING] | MASTERCLASS ECOM AI | ABO",
    objective: "OUTCOME_LEADS",
    createdDaysAgo: 14,
    adsets: [
      {
        key: "as4",
        name: "BROAD | FR | BATCH 01",
        budget: 300,
        createdDaysAgo: 14,
        targeting: "Broad · FR · 25-55",
        ads: [
          { name: "V1", postOf: "V1", ctr: 2.1, l2lead: 9, bookRate: 0.15, closeRate: 0.35, createdDaysAgo: 14, weight: 1.3 },
          { name: "V8", postOf: "V8", ctr: 1.6, cpm: 15, l2lead: 3, bookRate: 0.6, qualRate: 0.9, showRate: 0.85, closeRate: 0.5, createdDaysAgo: 14 },
        ],
      },
      {
        key: "as5",
        name: "BROAD | FR | BATCH 02",
        budget: 150,
        createdDaysAgo: 5,
        targeting: "Broad · FR · 25-55",
        ads: [
          { name: "V9", ctr: 1.9, l2lead: 8, bookRate: 0.1, createdDaysAgo: 5 },
          { name: "V10", ctr: 1.0, l2lead: 5, createdDaysAgo: 5 },
          { name: "V11", postOf: "V11", ctr: 2.2, l2lead: 9, bookRate: 0.12, createdDaysAgo: 5, kind: "image" },
        ],
      },
    ],
  },
  {
    key: "c4",
    name: "[HYPER-SCALING] | MASTERCLASS ECOM AI | CBO",
    objective: "OUTCOME_LEADS",
    createdDaysAgo: 30,
    cbo: 900,
    adsets: [
      {
        key: "as6",
        name: "POST-ID-SALES",
        budget: null,
        createdDaysAgo: 30,
        targeting: "Broad · FR · 25-55",
        ads: [
          { name: "V1", postOf: "V1", ctr: 1.9, cpm: 15.5, l2lead: 8.5, bookRate: 0.14, closeRate: 0.38, createdDaysAgo: 30, weight: 1.2 },
          { name: "V8", postOf: "V8", ctr: 1.5, cpm: 16, l2lead: 3.2, bookRate: 0.55, qualRate: 0.9, showRate: 0.85, closeRate: 0.5, createdDaysAgo: 30 },
        ],
      },
      {
        key: "as7",
        name: "POST-ID-BOOKINGS",
        budget: null,
        createdDaysAgo: 30,
        targeting: "Broad · FR · 25-55",
        ads: [
          { name: "V3", postOf: "V3", ctr: 2.4, cpm: 12, l2lead: 11, bookRate: 0.05, createdDaysAgo: 30 },
          { name: "V1", postOf: "V1", ctr: 1.8, l2lead: 8, bookRate: 0.13, closeRate: 0.35, createdDaysAgo: 30, weight: 0.8 },
        ],
      },
    ],
  },
  {
    key: "c5",
    name: "[TESTING] | FORMATION DROPSHIPPING | ABO",
    objective: "OUTCOME_LEADS",
    createdDaysAgo: 45,
    status: "PAUSED",
    pausedDaysAgo: 20,
    adsets: [
      {
        key: "as8",
        name: "VIDEO | BROAD | FR",
        budget: 80,
        createdDaysAgo: 45,
        status: "PAUSED",
        targeting: "Broad · FR · 18-45",
        ads: [
          { name: "D1", ctr: 1.2, l2lead: 6, createdDaysAgo: 45, pausedDaysAgo: 20, status: "PAUSED" },
          { name: "D2", ctr: 0.9, l2lead: 4, createdDaysAgo: 45, pausedDaysAgo: 20, status: "PAUSED" },
          { name: "D3", ctr: 1.6, l2lead: 7, bookRate: 0.1, createdDaysAgo: 45, pausedDaysAgo: 20, status: "PAUSED" },
        ],
      },
    ],
  },
  {
    key: "c6",
    name: "Retargeting Warm — Masterclass",
    objective: "OUTCOME_LEADS",
    createdDaysAgo: 35,
    cbo: 40,
    adsets: [
      {
        key: "as9",
        name: "RETARGETING | 30J | FR",
        budget: null,
        createdDaysAgo: 35,
        targeting: "Visiteurs 30 j · FR",
        ads: [
          { name: "RT1", ctr: 3.4, cpm: 22, l2lead: 14, bookRate: 0.2, closeRate: 0.4, createdDaysAgo: 35 },
          { name: "RT2", ctr: 2.6, cpm: 21, l2lead: 11, bookRate: 0.15, createdDaysAgo: 35, kind: "image" },
        ],
      },
    ],
  },
];

/* ------------------------------ Structure ----------------------------- */

interface Built {
  campaigns: MetaCampaign[];
  adsets: MetaAdSet[];
  ads: MetaAd[];
  creatives: MetaCreative[];
  profiles: Map<string, AdProfile>;
  /** adId -> budget quotidien de l'ad (part de l'ad set ou de la campagne). */
  dailyBudget: Map<string, number>;
}

const PRIMARY_TEXTS = [
  "J'ai lancé ma boutique Shopify avec 0 expérience. 14 mois plus tard, je vis de mon e-commerce. Dans cette masterclass gratuite, je te montre exactement la méthode que j'utilise (et les erreurs qui m'ont coûté 6 mois).",
  "Si tu veux lancer un e-commerce rentable en 2026, ne commence pas par chercher un produit. Commence par ça 👇",
  "L'IA a changé la façon de tester des produits. Masterclass gratuite : comment je trouve un produit gagnant en 48 h avec 100 € de budget.",
  "Tu as déjà une boutique mais tu plafonnes ? Je t'explique comment on passe de 3 k€ à 30 k€ / mois avec des pubs qui convertissent.",
];
const HEADLINES = ["Masterclass gratuite : lance ton e-commerce", "Trouve un produit gagnant en 48 h", "De 0 à 10 k€/mois en e-commerce", "Réserve ta place (gratuit)"];

const ISO = (daysAgo: number, hour = 9) => {
  const d = new Date(Date.now() - daysAgo * 86_400_000);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};

function build(seedKey: string): Built {
  const r = rng(`${seedKey}:structure`);
  const campaigns: MetaCampaign[] = [];
  const adsets: MetaAdSet[] = [];
  const ads: MetaAd[] = [];
  const creatives: MetaCreative[] = [];
  const profiles = new Map<string, AdProfile>();
  const dailyBudget = new Map<string, number>();
  const postIds = new Map<string, string>();
  const numeric = (k: string) => `1202${String(hash(`${seedKey}:${k}`)).padStart(10, "0")}${String(hash(k) % 10000).padStart(4, "0")}`;

  for (const c of ACCOUNT) {
    const cid = numeric(c.key);
    const cStatus: MetaStatus = c.status ?? "ACTIVE";
    campaigns.push({
      id: cid,
      name: c.name,
      status: cStatus,
      effectiveStatus: cStatus,
      objective: c.objective,
      buyingType: "AUCTION",
      dailyBudget: c.cbo ?? null,
      lifetimeBudget: null,
      createdTime: ISO(c.createdDaysAgo),
      updatedTime: ISO(Math.min(c.createdDaysAgo, c.pausedDaysAgo ?? c.createdDaysAgo)),
      startTime: ISO(c.createdDaysAgo),
    });
    const activeAdsets = c.adsets.filter((a) => (a.status ?? "ACTIVE") === "ACTIVE").length || 1;
    for (const a of c.adsets) {
      const aid = numeric(a.key);
      const aStatus: MetaStatus = a.status ?? "ACTIVE";
      const effective: MetaStatus = cStatus !== "ACTIVE" ? "CAMPAIGN_PAUSED" : aStatus;
      adsets.push({
        id: aid,
        campaignId: cid,
        name: a.name,
        status: aStatus,
        effectiveStatus: effective,
        dailyBudget: a.budget,
        lifetimeBudget: null,
        optimizationGoal: "LEAD_GENERATION",
        targetingSummary: a.targeting,
        createdTime: ISO(a.createdDaysAgo),
        updatedTime: ISO(a.createdDaysAgo),
      });
      const adsetBudget = a.budget ?? (c.cbo ?? 0) / activeAdsets;
      const weights = a.ads.map((s) => s.weight ?? 1);
      const totalWeight = weights.reduce((x, y) => x + y, 0) || 1;
      a.ads.forEach((s, i) => {
        const adId = numeric(`${a.key}:${s.name}`);
        const profile: AdProfile = { ...BASE, ...s, status: s.status ?? "ACTIVE" };
        profiles.set(adId, profile);
        dailyBudget.set(adId, (adsetBudget * weights[i]) / totalWeight);
        const creativeId = numeric(`cr:${a.key}:${s.name}`);
        const postKey = s.postOf ?? `${a.key}:${s.name}`;
        if (!postIds.has(postKey)) postIds.set(postKey, numeric(`post:${postKey}`));
        const adStatus = profile.status;
        const adEffective: MetaStatus =
          cStatus !== "ACTIVE" ? "CAMPAIGN_PAUSED" : aStatus !== "ACTIVE" ? "ADSET_PAUSED" : adStatus;
        ads.push({
          id: adId,
          adsetId: aid,
          campaignId: cid,
          name: s.name,
          status: adStatus,
          effectiveStatus: adEffective,
          creativeId,
          postId: postIds.get(postKey)!,
          createdTime: ISO(profile.createdDaysAgo),
          updatedTime: ISO(profile.pausedDaysAgo ?? profile.createdDaysAgo),
        });
        const n = Math.floor(r() * PRIMARY_TEXTS.length);
        const video = profile.kind === "video";
        creatives.push({
          id: creativeId,
          name: `${s.name} — ${video ? "UGC vidéo" : "Image statique"}`,
          kind: video ? "video" : "image",
          thumbnailUrl: `https://picsum.photos/seed/${hash(creativeId) % 1000}/360/450`,
          imageUrl: `https://picsum.photos/seed/${hash(creativeId) % 1000}/1080/1350`,
          videoUrl: video ? "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4" : "",
          primaryText: PRIMARY_TEXTS[n],
          headline: HEADLINES[Math.floor(r() * HEADLINES.length)],
          description: "Places limitées · 100 % gratuit",
          cta: "SIGN_UP",
          pageId: "1049382716",
        });
      });
    }
  }
  return { campaigns, adsets, ads, creatives, profiles, dailyBudget };
}

const BUILT = new Map<string, Built>();

/** Structure du compte simule (sans stats) : les leads de demo s'y rattachent. */
export function mockStructure(seedKey: string): { campaigns: MetaCampaign[]; adsets: MetaAdSet[]; ads: MetaAd[] } {
  const b = built(seedKey);
  return { campaigns: b.campaigns, adsets: b.adsets, ads: b.ads };
}
const built = (key: string) => {
  if (!BUILT.has(key)) BUILT.set(key, build(key));
  return BUILT.get(key)!;
};

/* ------------------------------- Stats -------------------------------- */

/** Fraction de la journee ecoulee dans le fuseau du compte (0..1). */
function dayProgress(tz: string): number {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const h = Number(p.find((x) => x.type === "hour")?.value ?? 0);
  const m = Number(p.find((x) => x.type === "minute")?.value ?? 0);
  return Math.max(0.03, (h * 60 + m) / 1440);
}

function dayRow(seedKey: string, adId: string, profile: AdProfile, budget: number, date: string, scale: number): { insight: DailyInsight; conv: DailyConversion } {
  const r = rng(`${seedKey}:${adId}:${date}`);
  const spend = Math.round(budget * (0.82 + r() * 0.3) * scale * 100) / 100;
  const cpm = profile.cpm * (0.85 + r() * 0.3);
  const impressions = Math.round((spend / cpm) * 1000);
  const reach = Math.round(impressions / (1.15 + r() * 0.5));
  const linkClicks = Math.round(impressions * (profile.ctr / 100) * (0.8 + r() * 0.4));
  const lpv = Math.round(linkClicks * profile.c2l * (0.9 + r() * 0.2));
  const leads = binomial(lpv, profile.l2lead / 100, r);
  const validLeads = leads - binomial(leads, 0.08, r);
  const qualifiedLeads = binomial(validLeads, profile.qualRate, r);
  const bookings = binomial(leads, profile.bookRate, r);
  const shows = binomial(bookings, profile.showRate, r);
  const sales = binomial(shows, profile.closeRate, r);
  const revenue = sales * 2990;
  // Une vente sur trois est payee en plusieurs fois : le cash suit plus tard.
  const cashCollected = sales * 2990 - binomial(sales, 0.33, r) * 1990;
  return {
    insight: { adId, date, spend, impressions, reach, linkClicks, lpv, leads },
    conv: { adId, date, validLeads, qualifiedLeads, bookings, shows, sales, revenue, cashCollected },
  };
}

/**
 * Stats quotidiennes de toutes les ads du compte sur la periode, et les
 * conversions business qui vont avec (le mock joue aussi le role de CRM).
 */
export function mockDailyData(seedKey: string, range: DateRange, tz = TZ): { insights: DailyInsight[]; conversions: DailyConversion[] } {
  const b = built(seedKey);
  const today = dayIn(tz);
  const progress = dayProgress(tz);
  const insights: DailyInsight[] = [];
  const conversions: DailyConversion[] = [];
  const n = daysBetween(range.from, range.to);
  for (const ad of b.ads) {
    const profile = b.profiles.get(ad.id)!;
    const budget = b.dailyBudget.get(ad.id) ?? 0;
    if (!budget) continue;
    const start = shiftDay(today, -profile.createdDaysAgo);
    const end = profile.pausedDaysAgo !== null ? shiftDay(today, -profile.pausedDaysAgo) : today;
    for (let i = 0; i < n; i++) {
      const date = shiftDay(range.from, i);
      if (date > today || date < start || date > end) continue;
      const { insight, conv } = dayRow(seedKey, ad.id, profile, budget, date, date === today ? progress : 1);
      insights.push(insight);
      conversions.push(conv);
    }
  }
  return { insights, conversions };
}

/* ------------------------------ Provider ------------------------------ */

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class MockMetaMarketingService implements MetaMarketingProvider {
  readonly kind = "mock" as const;

  private seed(ctx: ProviderContext) {
    return ctx.connection.adAccountId || ctx.connection.id;
  }

  async validateConnection(ctx: ProviderContext): Promise<ConnectionCheck> {
    await wait(350);
    const acct = ctx.connection.adAccountId.trim();
    if (acct && !/^act_\d{6,}$/.test(acct)) {
      return { ok: false, account: null, permissions: [], missingPermissions: [], tokenExpiresAt: "", error: "Ad Account ID invalide : attendu « act_123456789 »." };
    }
    return {
      ok: true,
      account: { id: acct || "act_000000000", name: `${ctx.connection.name || "Compte"} (simulé)`, currency: CURRENCY, timezone: TZ, status: "ACTIVE" },
      permissions: ["ads_read", "ads_management", "business_management"],
      missingPermissions: [],
      tokenExpiresAt: new Date(Date.now() + 60 * 86_400_000).toISOString(),
      error: "",
    };
  }

  async getCampaigns(ctx: ProviderContext) {
    await wait(120);
    return built(this.seed(ctx)).campaigns.map((c) => ({ ...c }));
  }
  async getAdSets(ctx: ProviderContext) {
    await wait(120);
    return built(this.seed(ctx)).adsets.map((a) => ({ ...a }));
  }
  async getAds(ctx: ProviderContext) {
    await wait(120);
    return built(this.seed(ctx)).ads.map((a) => ({ ...a }));
  }
  async getCreatives(ctx: ProviderContext, ids: string[]) {
    const want = new Set(ids);
    return built(this.seed(ctx)).creatives.filter((c) => want.has(c.id)).map((c) => ({ ...c }));
  }
  async getCreative(ctx: ProviderContext, id: string) {
    return built(this.seed(ctx)).creatives.find((c) => c.id === id) ?? null;
  }
  async getInsights(ctx: ProviderContext, range: DateRange) {
    await wait(250);
    return mockDailyData(this.seed(ctx), range).insights;
  }
  async getPostId(ctx: ProviderContext, adId: string) {
    return built(this.seed(ctx)).ads.find((a) => a.id === adId)?.postId ?? "";
  }
  async getVideoPreview(ctx: ProviderContext, creativeId: string) {
    return (await this.getCreative(ctx, creativeId))?.videoUrl ?? "";
  }

  /* Mutations : le mock dit oui ; le snapshot est mis a jour par le module. */
  async updateStatus(_ctx: ProviderContext, _level: EntityLevel, _id: string, _status: "ACTIVE" | "PAUSED") {
    await wait(300);
  }
  async updateBudget(_ctx: ProviderContext, _level: "campaign" | "adset", _id: string, _amount: number, _type: BudgetType) {
    await wait(300);
  }
  async createCampaign(_ctx: ProviderContext, input: CampaignInput) {
    await wait(300);
    return { id: `mock_c_${hash(input.name + Date.now())}` };
  }
  async createAdSet(_ctx: ProviderContext, input: AdSetInput) {
    await wait(200);
    return { id: `mock_as_${hash(input.name + Date.now())}` };
  }
  async createAd(_ctx: ProviderContext, input: AdInput) {
    await wait(200);
    const id = `mock_ad_${hash(input.name + input.adsetId + Date.now())}`;
    return { id, creativeId: input.creativeId || `mock_cr_${hash(id)}`, postId: input.postId };
  }
  async duplicateEntity(_ctx: ProviderContext, level: EntityLevel, id: string, _target: DuplicateTarget) {
    await wait(300);
    return { id: `mock_${level}_${hash(id + Date.now())}` };
  }
}
