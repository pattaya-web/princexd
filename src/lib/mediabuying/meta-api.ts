/**
 * Provider Meta Marketing API (Graph API).
 *
 * Implementation reelle, prete a recevoir un jeton : memes methodes que le
 * mock, memes types en sortie. Chaque appel passe par `graph()`, qui ajoute
 * le jeton, pagine, et traduit les erreurs Meta (jeton expire, permission
 * manquante, limite de debit, compte invalide) en `MetaApiError` lisibles.
 * Le jeton n'apparait jamais dans un message d'erreur ni dans un log.
 */

import type {
  BudgetType,
  DailyInsight,
  DateRange,
  EntityLevel,
  MetaAd,
  MetaAdSet,
  MetaCampaign,
  MetaCreative,
  MetaStatus,
} from "./types";
import { redactToken } from "./crypto";
import {
  MetaApiError,
  REQUIRED_PERMISSIONS,
  type AdInput,
  type AdSetInput,
  type CampaignInput,
  type ConnectionCheck,
  type DuplicateTarget,
  type MetaMarketingProvider,
  type ProviderContext,
} from "./provider";

const GRAPH = "https://graph.facebook.com/v21.0";

type Json = Record<string, unknown>;

interface GraphError {
  error?: { message?: string; code?: number; error_subcode?: number; type?: string; fbtrace_id?: string };
}

/** Montants Meta : en centimes de la devise du compte. */
const fromCents = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n / 100 : null;
};
const toCents = (v: number) => String(Math.round(v * 100));

function translate(status: number, body: GraphError, token: string): MetaApiError {
  const e = body.error ?? {};
  const msg = redactToken(e.message ?? `Meta a répondu ${status}.`, token);
  if (e.code === 190) return new MetaApiError("Jeton Meta expiré ou invalide : reconnecte le compte.", "token-expired", 401);
  if (e.code === 10 || e.code === 200 || e.code === 294) return new MetaApiError(`Permission manquante côté Meta : ${msg}`, "missing-permission", 403);
  if (e.code === 4 || e.code === 17 || e.code === 32 || e.code === 613) return new MetaApiError("Limite de débit Meta atteinte : réessaie dans quelques minutes.", "rate-limit", 429);
  if (e.code === 100 && /act_|account/i.test(msg)) return new MetaApiError(`Compte publicitaire invalide : ${msg}`, "invalid-account", 400);
  if (e.code === 803 || status === 404) return new MetaApiError(`Introuvable côté Meta : ${msg}`, "not-found", 404);
  if (status >= 500 || e.code === 1 || e.code === 2) return new MetaApiError("Meta ne répond pas pour le moment. Réessaie.", "unavailable", 503);
  return new MetaApiError(msg, e.code === 100 ? "invalid" : "unknown", 400);
}

async function graph<T = Json>(ctx: ProviderContext, path: string, params: Record<string, string> = {}, init: { method?: "GET" | "POST" | "DELETE"; body?: Record<string, string> } = {}): Promise<T> {
  const url = new URL(`${GRAPH}/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const method = init.method ?? "GET";
  const form = new URLSearchParams({ ...(init.body ?? {}), access_token: ctx.token });
  let res: Response;
  try {
    res = await fetch(
      method === "GET" ? `${url}&access_token=${encodeURIComponent(ctx.token)}`.replace("?&", "?") : url,
      method === "GET" ? { signal: AbortSignal.timeout(25_000) } : { method, body: form, signal: AbortSignal.timeout(25_000) },
    );
  } catch {
    throw new MetaApiError("Meta injoignable (réseau ou délai dépassé).", "unavailable", 503);
  }
  const text = await res.text();
  let body: Json = {};
  try {
    body = text ? (JSON.parse(text) as Json) : {};
  } catch {
    body = {};
  }
  if (!res.ok || (body as GraphError).error) throw translate(res.status, body as GraphError, ctx.token);
  return body as T;
}

/** Suit `paging.next` jusqu'au bout : Meta pagine a 25 par defaut. */
async function graphAll<T>(ctx: ProviderContext, path: string, params: Record<string, string>): Promise<T[]> {
  const out: T[] = [];
  let page = await graph<{ data: T[]; paging?: { next?: string } }>(ctx, path, { limit: "200", ...params });
  out.push(...(page.data ?? []));
  let guard = 0;
  while (page.paging?.next && guard++ < 50) {
    let res: Response;
    try {
      res = await fetch(page.paging.next, { signal: AbortSignal.timeout(25_000) });
    } catch {
      throw new MetaApiError("Meta injoignable pendant la pagination.", "unavailable", 503);
    }
    const body = (await res.json()) as { data: T[]; paging?: { next?: string } } & GraphError;
    if (!res.ok || body.error) throw translate(res.status, body, ctx.token);
    out.push(...(body.data ?? []));
    page = body;
  }
  return out;
}

const act = (ctx: ProviderContext) => ctx.connection.adAccountId.trim();

const status = (v: unknown): MetaStatus => (typeof v === "string" ? (v as MetaStatus) : "PAUSED");

/** Somme d'une action Meta parmi plusieurs noms possibles. */
function action(list: unknown, ...names: string[]): number {
  if (!Array.isArray(list)) return 0;
  let total = 0;
  for (const a of list as { action_type?: string; value?: string }[]) {
    if (a.action_type && names.includes(a.action_type)) total += Number(a.value ?? 0);
  }
  return total;
}

export class MetaMarketingApiService implements MetaMarketingProvider {
  readonly kind = "meta" as const;

  async validateConnection(ctx: ProviderContext): Promise<ConnectionCheck> {
    if (!ctx.token) return { ok: false, account: null, permissions: [], missingPermissions: REQUIRED_PERMISSIONS, tokenExpiresAt: "", error: "Aucun Access Token." };
    if (!/^act_\d{6,}$/.test(act(ctx))) {
      return { ok: false, account: null, permissions: [], missingPermissions: [], tokenExpiresAt: "", error: "Ad Account ID invalide : attendu « act_123456789 »." };
    }
    try {
      const perms = await graph<{ data: { permission: string; status: string }[] }>(ctx, "me/permissions");
      const granted = (perms.data ?? []).filter((p) => p.status === "granted").map((p) => p.permission);
      const missing = REQUIRED_PERMISSIONS.filter((p) => !granted.includes(p));
      const a = await graph<Json>(ctx, act(ctx), { fields: "id,name,currency,timezone_name,account_status" });
      let tokenExpiresAt = "";
      try {
        const dbg = await graph<{ data?: { expires_at?: number } }>(ctx, "debug_token", { input_token: ctx.token });
        if (dbg.data?.expires_at) tokenExpiresAt = new Date(dbg.data.expires_at * 1000).toISOString();
      } catch {
        /* debug_token demande un app token : facultatif */
      }
      return {
        ok: missing.length === 0,
        account: {
          id: String(a.id ?? act(ctx)),
          name: String(a.name ?? ""),
          currency: String(a.currency ?? "EUR"),
          timezone: String(a.timezone_name ?? "Europe/Paris"),
          status: String(a.account_status ?? ""),
        },
        permissions: granted,
        missingPermissions: missing,
        tokenExpiresAt,
        error: missing.length ? `Permissions manquantes : ${missing.join(", ")}` : "",
      };
    } catch (e) {
      const err = e as MetaApiError;
      return { ok: false, account: null, permissions: [], missingPermissions: err.code === "missing-permission" ? REQUIRED_PERMISSIONS : [], tokenExpiresAt: "", error: err.message };
    }
  }

  async getCampaigns(ctx: ProviderContext): Promise<MetaCampaign[]> {
    const rows = await graphAll<Json>(ctx, `${act(ctx)}/campaigns`, {
      fields: "id,name,status,effective_status,objective,buying_type,daily_budget,lifetime_budget,created_time,updated_time,start_time",
      effective_status: JSON.stringify(["ACTIVE", "PAUSED", "PENDING_REVIEW", "DISAPPROVED", "PREAPPROVED", "PENDING_BILLING_INFO", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "IN_PROCESS", "WITH_ISSUES"]),
    });
    return rows.map((c) => ({
      id: String(c.id),
      name: String(c.name ?? ""),
      status: status(c.status),
      effectiveStatus: status(c.effective_status),
      objective: String(c.objective ?? ""),
      buyingType: String(c.buying_type ?? ""),
      dailyBudget: fromCents(c.daily_budget),
      lifetimeBudget: fromCents(c.lifetime_budget),
      createdTime: String(c.created_time ?? ""),
      updatedTime: String(c.updated_time ?? ""),
      startTime: String(c.start_time ?? ""),
    }));
  }

  async getAdSets(ctx: ProviderContext): Promise<MetaAdSet[]> {
    const rows = await graphAll<Json>(ctx, `${act(ctx)}/adsets`, {
      fields: "id,campaign_id,name,status,effective_status,daily_budget,lifetime_budget,optimization_goal,targeting{geo_locations,age_min,age_max},created_time,updated_time",
    });
    return rows.map((a) => {
      const t = (a.targeting ?? {}) as { geo_locations?: { countries?: string[] }; age_min?: number; age_max?: number };
      const countries = t.geo_locations?.countries?.join(", ") ?? "";
      const ages = t.age_min || t.age_max ? `${t.age_min ?? 18}-${t.age_max ?? 65}` : "";
      return {
        id: String(a.id),
        campaignId: String(a.campaign_id ?? ""),
        name: String(a.name ?? ""),
        status: status(a.status),
        effectiveStatus: status(a.effective_status),
        dailyBudget: fromCents(a.daily_budget),
        lifetimeBudget: fromCents(a.lifetime_budget),
        optimizationGoal: String(a.optimization_goal ?? ""),
        targetingSummary: ["Broad", countries, ages].filter(Boolean).join(" · "),
        createdTime: String(a.created_time ?? ""),
        updatedTime: String(a.updated_time ?? ""),
      };
    });
  }

  async getAds(ctx: ProviderContext): Promise<MetaAd[]> {
    const rows = await graphAll<Json>(ctx, `${act(ctx)}/ads`, {
      fields: "id,adset_id,campaign_id,name,status,effective_status,creative{id},effective_object_story_id,created_time,updated_time",
    });
    return rows.map((a) => ({
      id: String(a.id),
      adsetId: String(a.adset_id ?? ""),
      campaignId: String(a.campaign_id ?? ""),
      name: String(a.name ?? ""),
      status: status(a.status),
      effectiveStatus: status(a.effective_status),
      creativeId: String((a.creative as { id?: string } | undefined)?.id ?? ""),
      postId: String(a.effective_object_story_id ?? ""),
      createdTime: String(a.created_time ?? ""),
      updatedTime: String(a.updated_time ?? ""),
    }));
  }

  private mapCreative(c: Json): MetaCreative {
    const spec = (c.object_story_spec ?? {}) as { video_data?: Json; link_data?: Json; page_id?: string };
    const video = spec.video_data;
    const link = spec.link_data;
    const cta = ((video?.call_to_action ?? link?.call_to_action) as { type?: string } | undefined)?.type ?? "";
    const kind = video || c.video_id ? "video" : (link as { child_attachments?: unknown[] } | undefined)?.child_attachments ? "carousel" : c.image_url || c.thumbnail_url ? "image" : "unknown";
    return {
      id: String(c.id),
      name: String(c.name ?? ""),
      kind,
      thumbnailUrl: String(c.thumbnail_url ?? c.image_url ?? ""),
      imageUrl: String(c.image_url ?? link?.picture ?? ""),
      videoUrl: "",
      primaryText: String(c.body ?? video?.message ?? link?.message ?? ""),
      headline: String(c.title ?? video?.title ?? link?.name ?? ""),
      description: String(video?.link_description ?? link?.description ?? ""),
      cta,
      pageId: String(spec.page_id ?? ""),
    };
  }

  async getCreatives(ctx: ProviderContext, ids: string[]): Promise<MetaCreative[]> {
    const out: MetaCreative[] = [];
    // Lots de 50 ids par requete (`?ids=`), bien en dessous de la limite Meta.
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50);
      if (!batch.length) continue;
      const res = await graph<Record<string, Json>>(ctx, "", {
        ids: batch.join(","),
        fields: "id,name,body,title,image_url,thumbnail_url,video_id,object_story_spec,effective_object_story_id",
      });
      for (const c of Object.values(res)) if (c && typeof c === "object" && "id" in c) out.push(this.mapCreative(c));
    }
    return out;
  }

  async getCreative(ctx: ProviderContext, id: string): Promise<MetaCreative | null> {
    try {
      const c = await graph<Json>(ctx, id, { fields: "id,name,body,title,image_url,thumbnail_url,video_id,object_story_spec" });
      const creative = this.mapCreative(c);
      if (c.video_id) creative.videoUrl = await this.getVideoPreview(ctx, String(c.video_id));
      return creative;
    } catch (e) {
      if ((e as MetaApiError).code === "not-found") return null;
      throw e;
    }
  }

  async getInsights(ctx: ProviderContext, range: DateRange): Promise<DailyInsight[]> {
    const rows = await graphAll<Json>(ctx, `${act(ctx)}/insights`, {
      level: "ad",
      time_increment: "1",
      time_range: JSON.stringify({ since: range.from, until: range.to }),
      fields: "ad_id,date_start,spend,impressions,reach,inline_link_clicks,actions",
      limit: "500",
    });
    return rows.map((r) => ({
      adId: String(r.ad_id),
      date: String(r.date_start),
      spend: Number(r.spend ?? 0),
      impressions: Number(r.impressions ?? 0),
      reach: Number(r.reach ?? 0),
      linkClicks: Number(r.inline_link_clicks ?? 0),
      lpv: action(r.actions, "landing_page_view"),
      leads: action(r.actions, "lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead"),
    }));
  }

  async getPostId(ctx: ProviderContext, adId: string): Promise<string> {
    const a = await graph<Json>(ctx, adId, { fields: "effective_object_story_id" });
    return String(a.effective_object_story_id ?? "");
  }

  /** `video_id` -> `source` (mp4 lisible) ; vide si la video n'est pas accessible. */
  async getVideoPreview(ctx: ProviderContext, videoOrCreativeId: string): Promise<string> {
    try {
      const v = await graph<Json>(ctx, videoOrCreativeId, { fields: "source" });
      return String(v.source ?? "");
    } catch {
      return "";
    }
  }

  async updateStatus(ctx: ProviderContext, _level: EntityLevel, id: string, next: "ACTIVE" | "PAUSED") {
    await graph(ctx, id, {}, { method: "POST", body: { status: next } });
  }

  async updateBudget(ctx: ProviderContext, _level: "campaign" | "adset", id: string, amount: number, type: BudgetType) {
    await graph(ctx, id, {}, { method: "POST", body: type === "daily" ? { daily_budget: toCents(amount) } : { lifetime_budget: toCents(amount) } });
  }

  async createCampaign(ctx: ProviderContext, input: CampaignInput) {
    const body: Record<string, string> = {
      name: input.name,
      objective: input.objective || "OUTCOME_LEADS",
      status: "PAUSED",
      special_ad_categories: "[]",
      buying_type: "AUCTION",
    };
    if (input.dailyBudget) body.daily_budget = toCents(input.dailyBudget);
    if (input.lifetimeBudget) body.lifetime_budget = toCents(input.lifetimeBudget);
    const r = await graph<{ id: string }>(ctx, `${act(ctx)}/campaigns`, {}, { method: "POST", body });
    return { id: String(r.id) };
  }

  async createAdSet(ctx: ProviderContext, input: AdSetInput) {
    const body: Record<string, string> = {
      name: input.name,
      campaign_id: input.campaignId,
      status: "PAUSED",
      billing_event: "IMPRESSIONS",
      optimization_goal: input.optimizationGoal || "LEAD_GENERATION",
      targeting: JSON.stringify({ geo_locations: { countries: [input.country || "FR"] }, age_min: 18, age_max: 65 }),
    };
    if (input.dailyBudget) body.daily_budget = toCents(input.dailyBudget);
    if (input.lifetimeBudget) body.lifetime_budget = toCents(input.lifetimeBudget);
    const r = await graph<{ id: string }>(ctx, `${act(ctx)}/adsets`, {}, { method: "POST", body });
    return { id: String(r.id) };
  }

  async createAd(ctx: ProviderContext, input: AdInput) {
    // Un Post ID = une creative qui pointe sur ce post : la social proof suit.
    const creative = input.creativeId
      ? { creative_id: input.creativeId }
      : { object_story_id: input.postId };
    const r = await graph<{ id: string }>(ctx, `${act(ctx)}/ads`, {}, { method: "POST", body: { name: input.name, adset_id: input.adsetId, status: "PAUSED", creative: JSON.stringify(creative) } });
    const ad = await graph<Json>(ctx, String(r.id), { fields: "creative{id},effective_object_story_id" });
    return { id: String(r.id), creativeId: String((ad.creative as { id?: string } | undefined)?.id ?? input.creativeId), postId: String(ad.effective_object_story_id ?? input.postId) };
  }

  /** `/copies` : Meta duplique en profondeur (ad sets et ads compris) et garde le post quand la creative pointe dessus. */
  async duplicateEntity(ctx: ProviderContext, level: EntityLevel, id: string, target: DuplicateTarget) {
    const body: Record<string, string> = { status_option: "PAUSED", rename_options: JSON.stringify({ rename_strategy: "ONLY_TOP_LEVEL_RENAME", rename_suffix: " — copie" }) };
    if (level === "adset" && target.parentId !== "same") body.campaign_id = target.parentId;
    if (level === "ad" && target.parentId !== "same") body.adset_id = target.parentId;
    if (level !== "campaign") body.deep_copy = "false";
    const r = await graph<{ copied_campaign_id?: string; copied_adset_id?: string; copied_ad_id?: string; id?: string }>(ctx, `${id}/copies`, {}, { method: "POST", body });
    const newId = r.copied_campaign_id ?? r.copied_adset_id ?? r.copied_ad_id ?? r.id ?? "";
    if (newId && target.name) await graph(ctx, newId, {}, { method: "POST", body: { name: target.name } });
    return { id: String(newId) };
  }
}
