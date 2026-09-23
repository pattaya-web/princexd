import { getSettings } from "./db";
import type {
  ContentFormat,
  FollowerPoint,
  IgAudience,
  IgAudienceSlice,
  IgDayPoint,
  IgProfileSnapshot,
  Post,
} from "./types";

/**
 * Connecteur Instagram Graph API (via la Page Facebook liée).
 * Le compte doit être professionnel, rattaché à une Page, et le token doit
 * porter instagram_basic + instagram_manage_insights + pages_show_list +
 * pages_read_engagement.
 */
export const GRAPH_VERSION = "v21.0";
export const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export class InstagramError extends Error {
  code: number;
  constructor(message: string, code = 500) {
    super(message);
    this.code = code;
  }
}

/** La variable d'environnement l'emporte sur la valeur saisie dans l'UI. */
export function getIgToken(): string {
  return process.env.IG_ACCESS_TOKEN?.trim() || getSettings().igAccessToken.trim();
}

export function getIgUserId(): string {
  return process.env.IG_USER_ID?.trim() || getSettings().igUserId.trim();
}

/* ------------------------------ Transport ------------------------------- */

interface GraphErrorBody {
  error?: { message?: string; type?: string; code?: number; error_subcode?: number };
}

async function call<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const token = getIgToken();
  if (!token) {
    throw new InstagramError(
      "Aucun token Instagram configuré (Réglages, ou IG_ACCESS_TOKEN dans .env.local).",
      401,
    );
  }

  const qs = new URLSearchParams({ ...params, access_token: token });
  const res = await fetch(`${GRAPH_BASE}${path}?${qs}`, { cache: "no-store" });
  const text = await res.text();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new InstagramError("Réponse Instagram illisible.", 502);
  }

  if (!res.ok) {
    const err = (parsed as GraphErrorBody).error;
    // 190 = token invalide ou expiré ; 10 et 200 = permission manquante ;
    // 4/17/32/613 = quota Meta épuisé (200 appels par heure).
    const quota = [4, 17, 32, 613].includes(err?.code ?? 0);
    const code = err?.code === 190 ? 401 : quota ? 429 : res.status;
    throw new InstagramError(
      `Erreur Instagram (HTTP ${res.status}${err?.code ? `, code ${err.code}` : ""}) : ${
        err?.message ?? text.slice(0, 250)
      }`,
      code,
    );
  }

  return parsed as T;
}

/**
 * Certaines métriques disparaissent ou changent de forme d'une version d'API à
 * l'autre. Plutôt que de faire échouer toute la synchro pour une métrique non
 * supportée, on isole chaque appel et on renvoie null en cas d'échec.
 */
async function tryCall<T>(path: string, params: Record<string, string> = {}): Promise<T | null> {
  try {
    return await call<T>(path, params);
  } catch (e) {
    const code = (e as InstagramError).code;
    // Un token mort ou un quota épuisé doivent stopper la synchro : les avaler
    // reviendrait à écrire des zéros par-dessus des statistiques valides.
    if (code === 401 || code === 429) throw e;
    return null;
  }
}

/* -------------------------------- Types --------------------------------- */

export interface IgProfile {
  id: string;
  username: string;
  name?: string;
  profile_picture_url?: string;
  biography?: string;
  website?: string;
  followers_count: number;
  follows_count: number;
  media_count: number;
}

export interface IgMedia {
  id: string;
  caption?: string;
  media_type: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
  media_product_type?: "FEED" | "REELS" | "STORY" | "AD";
  permalink: string;
  timestamp: string;
  thumbnail_url?: string;
  media_url?: string;
  like_count?: number;
  comments_count?: number;
}

interface InsightValue {
  value?: number;
  end_time?: string;
}

interface BreakdownResult {
  dimension_values?: string[];
  value?: number;
}

interface InsightEntry {
  name: string;
  period?: string;
  values?: InsightValue[];
  total_value?: {
    value?: number;
    breakdowns?: { dimension_keys?: string[]; results?: BreakdownResult[] }[];
  };
}

interface InsightResponse {
  data?: InsightEntry[];
}

/** Aplatit une réponse insights en { nom: valeur }, quelle que soit sa forme. */
function flatten(res: InsightResponse | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const entry of res?.data ?? []) {
    if (typeof entry.total_value?.value === "number") {
      out[entry.name] = entry.total_value.value;
      continue;
    }
    const values = entry.values ?? [];
    if (values.length) out[entry.name] = values.reduce((acc, v) => acc + (v.value ?? 0), 0);
  }
  return out;
}

/* ------------------------------ Lectures -------------------------------- */

export async function fetchProfile(): Promise<IgProfile> {
  const id = getIgUserId();
  if (!id) {
    throw new InstagramError(
      "Aucun IG User ID configuré (Réglages, ou IG_USER_ID dans .env.local).",
      400,
    );
  }
  return call<IgProfile>(`/${id}`, {
    fields:
      "id,username,name,profile_picture_url,biography,website,followers_count,follows_count,media_count",
  });
}

/**
 * Insights du compte sur la journée.
 * `reach` est une série temporelle ; les autres métriques passent par
 * metric_type=total_value depuis les versions récentes de l'API — d'où les
 * deux appels séparés.
 */
export async function fetchAccountInsights(): Promise<Record<string, number>> {
  const id = getIgUserId();

  const [timeseries, totals, extra] = await Promise.all([
    tryCall<InsightResponse>(`/${id}/insights`, { metric: "reach", period: "day" }),
    tryCall<InsightResponse>(`/${id}/insights`, {
      metric: "profile_views,website_clicks,accounts_engaged",
      period: "day",
      metric_type: "total_value",
    }),
    // Metriques d'interaction : elles n'existent qu'en total_value, jamais en
    // serie temporelle. On les capture donc jour apres jour.
    tryCall<InsightResponse>(`/${id}/insights`, {
      metric: "total_interactions,likes,comments,shares,views",
      period: "day",
      metric_type: "total_value",
    }),
  ]);

  return { ...flatten(timeseries), ...flatten(totals), ...flatten(extra) };
}

const MEDIA_FIELDS =
  "id,caption,media_type,media_product_type,permalink,timestamp,thumbnail_url,media_url,like_count,comments_count";

interface MediaPage {
  data?: IgMedia[];
  paging?: { cursors?: { after?: string }; next?: string };
}

/** Meta plafonne /media a 100 elements par page : on suit le curseur. */
/**
 * Stories en ligne et leurs insights, agreges pour la journee.
 *
 * Les stories disparaissent au bout de 24 h et Meta ne conserve AUCUN
 * historique : si on ne releve pas aujourd'hui, la donnee est perdue a jamais.
 * D'ou la capture a chaque synchro.
 */
export async function fetchStoriesToday(): Promise<{
  count: number;
  views: number;
  reach: number;
  replies: number;
  navigation: number;
  profileVisits: number;
  interactions: number;
}> {
  const id = getIgUserId();
  const empty = { count: 0, views: 0, reach: 0, replies: 0, navigation: 0, profileVisits: 0, interactions: 0 };

  const list = await tryCall<{ data?: { id: string }[] }>(`/${id}/stories`, { fields: "id,timestamp" });
  const stories = list?.data ?? [];
  if (!stories.length) return empty;

  const out = { ...empty, count: stories.length };
  for (const story of stories) {
    const res = await tryCall<InsightResponse>(`/${story.id}/insights`, {
      metric: "views,reach,replies,navigation,total_interactions,profile_visits",
    });
    const m = flatten(res);
    out.views += m.views ?? 0;
    out.reach += m.reach ?? 0;
    out.replies += m.replies ?? 0;
    out.navigation += m.navigation ?? 0;
    out.profileVisits += m.profile_visits ?? 0;
    out.interactions += m.total_interactions ?? 0;
  }
  return out;
}

export async function fetchMedia(limit = 50): Promise<IgMedia[]> {
  const id = getIgUserId();
  const out: IgMedia[] = [];
  let after: string | undefined;

  while (out.length < limit) {
    const params: Record<string, string> = {
      fields: MEDIA_FIELDS,
      limit: String(Math.min(100, limit - out.length)),
    };
    if (after) params.after = after;

    const res = await call<MediaPage>(`/${id}/media`, params);
    const batch = res.data ?? [];
    out.push(...batch);

    after = res.paging?.cursors?.after;
    if (!batch.length || !res.paging?.next || !after) break;
  }

  return out.slice(0, limit);
}

/**
 * Insights d'une publication, ou null si Meta n'a pas répondu.
 * Le null est important : il dit a l'appelant de CONSERVER les stats connues
 * au lieu de les remplacer par des zéros.
 */
/**
 * URL du fichier media, redemandee a la volee.
 * Les URL CDN Instagram expirent en quelques jours : impossible de reutiliser
 * celle stockee lors de la synchro pour telecharger la video.
 */
export async function fetchMediaUrl(mediaId: string): Promise<{ media_url?: string; media_type?: string }> {
  return call<{ media_url?: string; media_type?: string }>(`/${mediaId}`, {
    fields: "media_url,media_type,media_product_type",
  });
}

export async function fetchMediaInsights(mediaId: string): Promise<Record<string, number> | null> {
  const res = await tryCall<InsightResponse>(`/${mediaId}/insights`, {
    metric: "reach,saved,shares,views,total_interactions",
  });
  return res ? flatten(res) : null;
}

/* --------------------------- Veille createurs ---------------------------- */

/* ------------------------ Detail d'une publication ------------------------ */

export interface PostInsights {
  reach: number;
  views: number;
  likes: number;
  comments: number;
  saves: number;
  shares: number;
  interactions: number;
  /** Duree moyenne de visionnage, en secondes. Reels uniquement. */
  avgWatchSec: number | null;
  /** Temps total de visionnage cumule, en secondes. Reels uniquement. */
  totalWatchSec: number | null;
}

const POST_METRICS = "reach,saved,shares,views,total_interactions,likes,comments";
const REEL_METRICS = `${POST_METRICS},ig_reels_avg_watch_time,ig_reels_video_view_total_time`;

/**
 * Insights complets d'une publication.
 *
 * Les metriques de visionnage n'existent que pour les reels, et Meta refuse
 * la requete entiere si l'une d'elles ne s'applique pas : on retente sans.
 */
export async function fetchPostInsights(mediaId: string, reel: boolean): Promise<PostInsights> {
  let res: InsightResponse | null = null;
  if (reel) res = await tryCall<InsightResponse>(`/${mediaId}/insights`, { metric: REEL_METRICS });
  if (!res) res = await call<InsightResponse>(`/${mediaId}/insights`, { metric: POST_METRICS });
  const f = flatten(res);
  // Meta publie les durees en millisecondes.
  const ms = (k: string) => (k in f ? Math.round(f[k] / 1000) : null);
  return {
    reach: f.reach ?? 0,
    views: f.views ?? 0,
    likes: f.likes ?? 0,
    comments: f.comments ?? 0,
    saves: f.saved ?? 0,
    shares: f.shares ?? 0,
    interactions: f.total_interactions ?? 0,
    avgWatchSec: ms("ig_reels_avg_watch_time"),
    totalWatchSec: ms("ig_reels_video_view_total_time"),
  };
}

function slices(res: InsightResponse | null): IgAudienceSlice[] {
  const results = res?.data?.[0]?.total_value?.breakdowns?.[0]?.results ?? [];
  return results
    .map((r) => ({ key: r.dimension_values?.[0] ?? "?", value: r.value ?? 0 }))
    .sort((a, b) => b.value - a.value);
}

/** Repartition des abonnes : genre, age, pays, villes. Quatre appels. */
export async function fetchAudience(): Promise<IgAudience> {
  const id = getIgUserId();
  const one = (breakdown: string) =>
    tryCall<InsightResponse>(`/${id}/insights`, {
      metric: "follower_demographics",
      period: "lifetime",
      metric_type: "total_value",
      breakdown,
    });
  const [gender, age, country, city] = await Promise.all([one("gender"), one("age"), one("country"), one("city")]);
  const g = Object.fromEntries(slices(gender).map((s) => [s.key, s.value]));
  return {
    gender: { f: g.F ?? 0, m: g.M ?? 0, u: g.U ?? 0 },
    age: slices(age).sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true })),
    countries: slices(country).slice(0, 6),
    cities: slices(city).slice(0, 6),
    fetchedAt: new Date().toISOString(),
  };
}

export interface DiscoveredCreator {
  username: string;
  name?: string;
  profile_picture_url?: string;
  biography?: string;
  followers_count?: number;
  media_count?: number;
  media?: { data?: IgMedia[]; paging?: { cursors?: { after?: string } } };
}

/**
 * Profil public d'un autre createur via Business Discovery.
 *
 * Ne fonctionne que sur les comptes professionnels publics. Meta renvoie la
 * legende, la miniature, les likes et les commentaires, mais JAMAIS le fichier
 * video d'un reel ni le nombre de vues (verifie sur plusieurs comptes).
 */
/**
 * Profil public d'un autre createur, page par page.
 *
 * Business Discovery plafonne chaque reponse, mais l'edge `media` accepte un
 * curseur : `media.limit(N).after(CUR)`. On enchaine donc les pages jusqu'a
 * `maxPosts`, ce qui permet de descendre bien au-dela des quelques dizaines de
 * publications que renvoie un appel simple.
 *
 * Ne fonctionne que sur les comptes professionnels publics. Meta renvoie la
 * legende, la miniature, les likes et les commentaires, mais JAMAIS le fichier
 * video ni le nombre de vues (verifie sur plusieurs comptes).
 */
export async function fetchCreatorPages(
  username: string,
  maxPosts = 300,
  onPage?: (total: number) => void,
): Promise<DiscoveredCreator> {
  const id = getIgUserId();
  const clean = username.trim().replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(clean)) {
    throw new InstagramError("Nom d'utilisateur invalide.", 400);
  }

  const PAGE = 50;
  // maxPosts <= 0 signifie « tout le compte ». Le garde-fou n'est la que pour
  // eviter une boucle infinie si Meta renvoyait indefiniment le meme curseur.
  const unlimited = maxPosts <= 0;
  const HARD_STOP = 50_000;
  const ceiling = unlimited ? HARD_STOP : maxPosts;

  const media: IgMedia[] = [];
  const seen = new Set<string>();
  let profile: DiscoveredCreator | null = null;
  let after: string | undefined;

  while (media.length < ceiling) {
    const take = Math.min(PAGE, ceiling - media.length);
    const edge = `media.limit(${take})${after ? `.after(${after})` : ""}`;
    const fields =
      `business_discovery.username(${clean}){username,name,profile_picture_url,biography,` +
      `followers_count,media_count,${edge}{id,caption,media_type,` +
      `media_product_type,permalink,thumbnail_url,media_url,like_count,comments_count,timestamp}}`;

    let res: { business_discovery?: DiscoveredCreator };
    try {
      res = await call<{ business_discovery?: DiscoveredCreator }>(`/${id}`, { fields });
    } catch (e) {
      const err = e as InstagramError;
      // Meta repond "Invalid user id" aussi bien pour un compte inexistant que
      // pour un compte prive ou personnel : on explique les trois cas.
      if (/invalid user id/i.test(err.message)) {
        throw new InstagramError(
          `@${clean} est introuvable, privé, ou n'est pas un compte professionnel. ` +
            `Business Discovery ne lit que les comptes Business ou Créateur publics.`,
          404,
        );
      }
      // Une page intermediaire qui echoue ne doit pas perdre ce qu'on a deja.
      if (media.length) break;
      throw err;
    }

    const found = res.business_discovery;
    if (!found) {
      if (profile) break;
      throw new InstagramError(
        `Impossible de lire @${clean}. Business Discovery n'accepte que les comptes professionnels publics.`,
        404,
      );
    }

    profile ??= found;
    const batch = found.media?.data ?? [];

    // Un curseur qui tourne en rond renverrait les memes ids indefiniment.
    let fresh = 0;
    for (const m of batch) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      media.push(m);
      fresh++;
    }
    onPage?.(media.length);

    const next = found.media?.paging?.cursors?.after;
    if (!batch.length || !fresh || !next || next === after) break;
    after = next;
  }

  return { ...(profile as DiscoveredCreator), media: { data: media } };
}

/* ------------------------------- Mapping -------------------------------- */

export function mapFormat(m: IgMedia): ContentFormat {
  if (m.media_product_type === "REELS") return "reel-face-cam";
  if (m.media_type === "CAROUSEL_ALBUM") return "carrousel";
  if (m.media_type === "VIDEO") return "reel-broll";
  return "post-image";
}

/** Première ligne de la légende, tronquée — sert de titre lisible. */
export function mapTitle(m: IgMedia): string {
  const first = (m.caption ?? "").split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  if (!first) return `Publication du ${m.timestamp.slice(0, 10)}`;
  return first.length > 80 ? `${first.slice(0, 77)}…` : first;
}

export interface PostStats {
  views: number;
  likes: number;
  comments: number;
  saves: number;
  shares: number;
}

export function mapStats(m: IgMedia, insights: Record<string, number>): PostStats {
  return {
    views: insights.views ?? 0,
    likes: m.like_count ?? 0,
    comments: m.comments_count ?? 0,
    saves: insights.saved ?? 0,
    shares: insights.shares ?? 0,
  };
}

/** Nouveau Post créé depuis une publication déjà en ligne. */
export function toPost(m: IgMedia, insights: Record<string, number>, id: string): Post {
  return {
    id,
    title: mapTitle(m),
    format: mapFormat(m),
    angle: "value",
    status: "publie",
    hook: "",
    script: "",
    cta: "",
    plannedAt: "",
    publishedAt: m.timestamp,
    url: m.permalink,
    thumbnail: mapThumbnail(m),
    caption: m.caption ?? "",
    igMediaId: m.id,
    swipeId: "",
    ...mapStats(m, insights),
    followersGained: 0,
    profileVisits: 0,
    linkClicks: 0,
    callsBooked: 0,
    notes: "",
    createdAt: new Date().toISOString(),
  };
}

export function toFollowerPoint(
  profile: IgProfile,
  insights: Record<string, number>,
  id: string,
  date: string,
  stories?: { count: number; views: number; reach: number; replies: number; navigation: number; profileVisits: number },
): FollowerPoint {
  return {
    id,
    date,
    followers: profile.followers_count ?? 0,
    reach: insights.reach ?? 0,
    profileVisits: insights.profile_views ?? 0,
    linkClicks: insights.website_clicks ?? 0,
    accountsEngaged: insights.accounts_engaged ?? 0,
    views: insights.views ?? 0,
    interactions: insights.total_interactions ?? 0,
    likes: insights.likes ?? 0,
    comments: insights.comments ?? 0,
    shares: insights.shares ?? 0,
    storyCount: stories?.count ?? 0,
    storyViews: stories?.views ?? 0,
    storyReach: stories?.reach ?? 0,
    storyReplies: stories?.replies ?? 0,
    storyNavigation: stories?.navigation ?? 0,
    storyProfileVisits: stories?.profileVisits ?? 0,
    notes: "Relevé automatique Instagram",
  };
}

/** Poster d'un reel, ou l'image elle-meme pour un post photo. */
export function mapThumbnail(m: IgMedia): string {
  return m.thumbnail_url ?? m.media_url ?? "";
}

/**
 * Meta date chaque valeur par la FIN de sa fenetre : une valeur dont
 * end_time tombe le 11 a minuit decrit la journee du 10. On recale donc
 * d'un jour pour que la date affichee soit celle vecue.
 */
function seriesToMap(res: InsightResponse | null, name: string): Record<string, number> {
  const out: Record<string, number> = {};
  const entry = (res?.data ?? []).find((e) => e.name === name);
  for (const v of entry?.values ?? []) {
    if (!v.end_time) continue;
    const day = new Date(new Date(v.end_time).getTime() - 86_400_000).toISOString().slice(0, 10);
    out[day] = v.value ?? 0;
  }
  return out;
}

/**
 * Abonnes gagnes et portee sur une plage libre.
 * Meta refuse les fenetres de plus de 30 jours, donc on decoupe et on fusionne.
 */
export async function fetchFollowerRange(sinceSec: number, untilSec: number) {
  const id = getIgUserId();
  const gains: Record<string, number> = {};
  const reach: Record<string, number> = {};
  const WINDOW = 30 * 86_400;

  for (let start = sinceSec; start < untilSec; start += WINDOW) {
    const end = Math.min(start + WINDOW, untilSec);
    const range = { period: "day", since: String(start), until: String(end) };

    const [g, r] = await Promise.all([
      tryCall<InsightResponse>(`/${id}/insights`, { metric: "follower_count", ...range }),
      tryCall<InsightResponse>(`/${id}/insights`, { metric: "reach", ...range }),
    ]);

    Object.assign(gains, seriesToMap(g, "follower_count"));
    Object.assign(reach, seriesToMap(r, "reach"));
  }

  return { gains, reach };
}

/**
 * Desabonnements reels, jour par jour.
 *
 * `follows_and_unfollows` n'accepte pas de serie temporelle : il faut un appel
 * par journee, avec metric_type=total_value et breakdown=follow_type. Le
 * breakdown renvoie FOLLOWER (abonnements gagnes, identique a follower_count,
 * verifie) et NON_FOLLOWER (desabonnements).
 *
 * Decalage : la valeur affichee au jour L se lit dans la fenetre [L+1, L+2),
 * comme pour follower_count dont Meta date les valeurs par la fin de fenetre.
 */
export async function fetchUnfollows(dates: string[]): Promise<Record<string, number>> {
  const id = getIgUserId();
  const out: Record<string, number> = {};

  for (const label of dates) {
    const base = new Date(`${label}T00:00:00Z`).getTime();
    if (!Number.isFinite(base)) continue;
    const since = Math.floor((base + 86_400_000) / 1000);

    const res = await tryCall<InsightResponse>(`/${id}/insights`, {
      metric: "follows_and_unfollows",
      metric_type: "total_value",
      breakdown: "follow_type",
      period: "day",
      since: String(since),
      until: String(since + 86_400),
    });

    const results = res?.data?.[0]?.total_value?.breakdowns?.[0]?.results;
    if (!results?.length) continue;
    const row = results.find((r) => r.dimension_values?.[0] === "NON_FOLLOWER");
    if (row) out[label] = row.value ?? 0;
  }

  return out;
}

/** Historique quotidien sur les N derniers jours. */
export async function fetchFollowerHistory(days = 30) {
  const until = Math.floor(Date.now() / 1000);
  return fetchFollowerRange(until - (days - 1) * 86_400, until);
}

/**
 * Assemble la serie quotidienne.
 * Les desabonnements viennent de Meta quand ils ont ete recuperes ; sinon on
 * retombe sur la deduction perdus = gagnes - variation reelle du total, qui
 * exige deux releves consecutifs. `known` distingue les deux cas.
 */
export function buildHistory(
  gains: Record<string, number>,
  reach: Record<string, number>,
  totals: { date: string; followers: number }[],
  unfollows: Record<string, number> = {},
): IgDayPoint[] {
  const known = new Map(totals.filter((t) => t.followers > 0).map((t) => [t.date, t.followers]));
  const dates = [...new Set([...Object.keys(gains), ...Object.keys(reach)])].sort();

  return dates.map((date) => {
    const gained = gains[date] ?? 0;
    const prevDate = new Date(new Date(`${date}T00:00:00Z`).getTime() - 86_400_000)
      .toISOString()
      .slice(0, 10);
    // Chiffre reel de Meta si on l'a ; sinon deduction par deux totaux consecutifs.
    const real = unfollows[date];
    if (real !== undefined) {
      return { date, gained, lost: real, net: gained - real, reach: reach[date] ?? 0, known: true };
    }

    const today = known.get(date);
    const yesterday = known.get(prevDate);
    const measurable = today !== undefined && yesterday !== undefined;
    const net = measurable ? today - yesterday : gained;

    return {
      date,
      gained,
      lost: measurable ? Math.max(gained - net, 0) : 0,
      net,
      reach: reach[date] ?? 0,
      known: measurable,
    };
  });
}

export function toSnapshot(
  profile: IgProfile,
  insights: Record<string, number>,
  history: IgDayPoint[],
): IgProfileSnapshot {
  return {
    username: profile.username,
    name: profile.name ?? profile.username,
    profilePictureUrl: profile.profile_picture_url ?? "",
    biography: profile.biography ?? "",
    website: profile.website ?? "",
    followers: profile.followers_count ?? 0,
    follows: profile.follows_count ?? 0,
    mediaCount: profile.media_count ?? 0,
    reach: insights.reach ?? 0,
    profileVisits: insights.profile_views ?? 0,
    linkClicks: insights.website_clicks ?? 0,
    accountsEngaged: insights.accounts_engaged ?? 0,
    history,
    fetchedAt: new Date().toISOString(),
  };
}
