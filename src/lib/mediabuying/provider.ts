/**
 * Contrat entre le module et Meta.
 *
 * Deux implementations : `MockMetaMarketingService` (donnees generees, pour
 * construire et tester le cockpit sans jeton) et `MetaMarketingApiService`
 * (Graph API). Le reste du module ne connait que cette interface : brancher
 * le vrai compte revient a changer de provider, pas a reecrire l'outil.
 *
 * Choix du provider, par connexion :
 *  - `META_PROVIDER=mock` force le mock partout (dev) ;
 *  - `META_PROVIDER=meta` force l'API (un jeton est alors obligatoire) ;
 *  - sans variable : l'API si la connexion a un jeton, le mock sinon.
 */

import type {
  BudgetType,
  DailyInsight,
  DateRange,
  EntityLevel,
  MetaAd,
  MetaAdSet,
  MetaCampaign,
  MetaConnection,
  MetaCreative,
} from "./types";
import { MockMetaMarketingService } from "./mock";
import { MetaMarketingApiService } from "./meta-api";

export interface ProviderContext {
  connection: MetaConnection;
  /** Jeton en clair, dechiffre a la volee et jamais conserve. Vide en mock. */
  token: string;
}

export interface AccountInfo {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  status: string;
}

export interface ConnectionCheck {
  ok: boolean;
  account: AccountInfo | null;
  permissions: string[];
  missingPermissions: string[];
  tokenExpiresAt: string;
  error: string;
}

export interface CampaignInput {
  name: string;
  objective: string;
  /** Null en ABO. */
  dailyBudget: number | null;
  lifetimeBudget: number | null;
  /** Toujours PAUSED a la creation : rien ne part sans confirmation. */
  status: "PAUSED";
}

export interface AdSetInput {
  campaignId: string;
  name: string;
  dailyBudget: number | null;
  lifetimeBudget: number | null;
  country: string;
  optimizationGoal: string;
  status: "PAUSED";
}

export interface AdInput {
  adsetId: string;
  name: string;
  /** Reutiliser un post existant (scaling) ou une creative existante. */
  postId: string;
  creativeId: string;
  status: "PAUSED";
}

export interface DuplicateTarget {
  /** « same » : meme parent ; sinon l'id du parent de destination. */
  parentId: string;
  name: string;
  /** Pour une ad : garder le Post ID (social proof) quand c'est possible. */
  keepPostId: boolean;
}

export interface MetaMarketingProvider {
  readonly kind: "mock" | "meta";
  validateConnection(ctx: ProviderContext): Promise<ConnectionCheck>;
  getCampaigns(ctx: ProviderContext): Promise<MetaCampaign[]>;
  getAdSets(ctx: ProviderContext): Promise<MetaAdSet[]>;
  getAds(ctx: ProviderContext): Promise<MetaAd[]>;
  getCreatives(ctx: ProviderContext, creativeIds: string[]): Promise<MetaCreative[]>;
  getCreative(ctx: ProviderContext, creativeId: string): Promise<MetaCreative | null>;
  /** Stats quotidiennes au niveau ad sur la periode. */
  getInsights(ctx: ProviderContext, range: DateRange): Promise<DailyInsight[]>;
  getPostId(ctx: ProviderContext, adId: string): Promise<string>;
  getVideoPreview(ctx: ProviderContext, creativeId: string): Promise<string>;
  updateStatus(ctx: ProviderContext, level: EntityLevel, id: string, status: "ACTIVE" | "PAUSED"): Promise<void>;
  updateBudget(ctx: ProviderContext, level: "campaign" | "adset", id: string, amount: number, type: BudgetType): Promise<void>;
  createCampaign(ctx: ProviderContext, input: CampaignInput): Promise<{ id: string }>;
  createAdSet(ctx: ProviderContext, input: AdSetInput): Promise<{ id: string }>;
  createAd(ctx: ProviderContext, input: AdInput): Promise<{ id: string; creativeId: string; postId: string }>;
  duplicateEntity(ctx: ProviderContext, level: EntityLevel, id: string, target: DuplicateTarget): Promise<{ id: string }>;
}

/** Permissions Marketing API dont le module a besoin. */
export const REQUIRED_PERMISSIONS = ["ads_read", "ads_management", "business_management"];

const mock = new MockMetaMarketingService();
const real = new MetaMarketingApiService();

export function providerKindFor(connection: Pick<MetaConnection, "encryptedAccessToken" | "provider">): "mock" | "meta" {
  const forced = process.env.META_PROVIDER?.trim().toLowerCase();
  if (forced === "mock") return "mock";
  if (forced === "meta") return "meta";
  return connection.encryptedAccessToken ? "meta" : "mock";
}

export function providerFor(connection: MetaConnection): MetaMarketingProvider {
  return providerKindFor(connection) === "meta" ? real : mock;
}

/** Erreur Meta lisible, avec le code d'origine pour le journal. */
export class MetaApiError extends Error {
  constructor(
    message: string,
    public readonly code: "token-expired" | "missing-permission" | "rate-limit" | "invalid-account" | "unavailable" | "not-found" | "invalid" | "unknown",
    public readonly status = 400,
  ) {
    super(message);
  }
}
