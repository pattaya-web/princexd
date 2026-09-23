import type { FollowerPoint, Lead, Post, Story } from "./types";
import { avgBy, groupBy, label, sumBy } from "./format";

/** Agrégat de performance pour une dimension (format, angle, type de hook…). */
export interface DimensionStat {
  key: string;
  label: string;
  posts: number;
  views: number;
  avgViews: number;
  avgEngagementRate: number; // (likes+comments+saves+shares) / views
  avgSaveRate: number;
  followersGained: number;
  followersPerPost: number;
  callsBooked: number;
  linkClicks: number;
  /** Score composite 0-100 utilisé pour classer les formats. */
  score: number;
}

/** Minuscules sans accents : "Commente «IA»" et "commente ia" doivent matcher. */
function norm(v: string): string {
  return v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Ne garde que les publications qui portent un des mots-cles business.
 * Un compte a souvent un carton viral hors niche qui ecrase tous les classements
 * sans rien dire de ce qui vend : ce filtre l'ecarte.
 * Si aucun post ne correspond, on rend la liste complete plutot qu'un vide.
 */
export function filterByKeywords(posts: Post[], keywords: string): Post[] {
  const keys = keywords.split(",").map((k) => norm(k.trim())).filter(Boolean);
  if (!keys.length) return posts;

  const matched = posts.filter((p) => {
    const hay = norm(`${p.title} ${p.caption ?? ""}`);
    return keys.some((k) => hay.includes(k));
  });
  return matched.length ? matched : posts;
}

/** Appels a l'action reperes dans les legendes, du plus fort au plus faible. */
export const CTA_TERMS = ["commente", "envoie", "mp", "abonne", "lien en bio", "dm"];

export interface CtaStat {
  term: string;
  posts: number;
  avgViews: number;
  avgComments: number;
  avgSaves: number;
}

/**
 * Performance de chaque appel a l'action.
 *
 * Un post peut porter plusieurs CTA ("Commente IA et je t'envoie le process") :
 * il compte alors dans chaque ligne. C'est voulu — on mesure le rendement d'une
 * formulation, pas une repartition exclusive.
 */
export function ctaStats(posts: Post[], terms: string[] = CTA_TERMS): CtaStat[] {
  const published = posts.filter((p) => p.status === "publie" && p.views > 0);

  return terms
    .map((term) => {
      const key = norm(term);
      const group = published.filter((p) => norm(`${p.title} ${p.caption ?? ""}`).includes(key));
      if (!group.length) return null;
      return {
        term,
        posts: group.length,
        avgViews: sumBy(group, (p) => p.views) / group.length,
        avgComments: sumBy(group, (p) => p.comments) / group.length,
        avgSaves: sumBy(group, (p) => p.saves) / group.length,
      };
    })
    .filter((r): r is CtaStat => r !== null)
    .sort((a, b) => b.avgComments - a.avgComments);
}

const engagement = (p: Post) => p.likes + p.comments + p.saves + p.shares;

function rate(num: number, den: number) {
  return den > 0 ? num / den : 0;
}

/**
 * Score composite : la portée compte, mais ce qui décide c'est ce qui
 * transforme (abonnés gagnés, saves, clics, calls). Chaque terme est normalisé
 * par le meilleur du lot, donc le score est relatif à TA propre production.
 */
function scoreRows(rows: DimensionStat[]): DimensionStat[] {
  const max = {
    views: Math.max(...rows.map((r) => r.avgViews), 1),
    eng: Math.max(...rows.map((r) => r.avgEngagementRate), 0.0001),
    save: Math.max(...rows.map((r) => r.avgSaveRate), 0.0001),
    foll: Math.max(...rows.map((r) => r.followersPerPost), 0.0001),
    calls: Math.max(...rows.map((r) => r.callsBooked), 1),
  };
  return rows
    .map((r) => ({
      ...r,
      score: Math.round(
        (0.2 * (r.avgViews / max.views) +
          0.2 * (r.avgEngagementRate / max.eng) +
          0.15 * (r.avgSaveRate / max.save) +
          0.25 * (r.followersPerPost / max.foll) +
          0.2 * (r.callsBooked / max.calls)) *
          100,
      ),
    }))
    .sort((a, b) => b.score - a.score);
}

export function statsByDimension(posts: Post[], dimension: (p: Post) => string): DimensionStat[] {
  const published = posts.filter((p) => p.status === "publie" && p.views > 0);
  if (!published.length) return [];

  const rows: DimensionStat[] = [];
  for (const [key, group] of groupBy(published, dimension)) {
    if (!key) continue;
    const views = sumBy(group, (p) => p.views);
    const followersGained = sumBy(group, (p) => p.followersGained);
    rows.push({
      key,
      label: label(key),
      posts: group.length,
      views,
      avgViews: views / group.length,
      avgEngagementRate: avgBy(group, (p) => rate(engagement(p), p.views)),
      avgSaveRate: avgBy(group, (p) => rate(p.saves, p.views)),
      followersGained,
      followersPerPost: followersGained / group.length,
      callsBooked: sumBy(group, (p) => p.callsBooked),
      linkClicks: sumBy(group, (p) => p.linkClicks),
      score: 0,
    });
  }
  return scoreRows(rows);
}

/** Le format gagnant, celui à couper, et pourquoi — sans appel IA. */
export interface Verdict {
  spam: DimensionStat | null;
  stop: DimensionStat | null;
  /** Formats avec trop peu de posts pour conclure. */
  insuffisant: DimensionStat[];
  confiance: "faible" | "moyenne" | "bonne";
}

export function verdictFormats(stats: DimensionStat[], minPosts = 3): Verdict {
  const solides = stats.filter((s) => s.posts >= minPosts);
  const insuffisant = stats.filter((s) => s.posts < minPosts);
  const total = stats.reduce((a, s) => a + s.posts, 0);
  return {
    spam: solides[0] ?? null,
    stop: solides.length >= 2 ? solides[solides.length - 1] : null,
    insuffisant,
    confiance: total >= 20 && solides.length >= 2 ? "bonne" : total >= 8 ? "moyenne" : "faible",
  };
}

/** Série d'abonnés triée + croissance quotidienne dérivée. */
export function followerSeries(points: FollowerPoint[]) {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  return sorted.map((p, i) => ({
    date: p.date,
    followers: p.followers,
    delta: i === 0 ? 0 : p.followers - sorted[i - 1].followers,
    reach: p.reach,
    profileVisits: p.profileVisits,
    linkClicks: p.linkClicks,
  }));
}

export interface GoalProjection {
  current: number;
  goal: number;
  start: number;
  progressPct: number;
  remaining: number;
  perDay: number;
  daysLeft: number | null;
  etaISO: string | null;
}

export function projectGoal(points: FollowerPoint[], goal: number, start: number): GoalProjection {
  const series = followerSeries(points);
  const current = series.length ? series[series.length - 1].followers : start;
  const remaining = Math.max(goal - current, 0);

  // Vitesse mesurée sur les 14 derniers relevés, pas sur tout l'historique :
  // c'est le rythme actuel qui prédit la date, pas la moyenne de toujours.
  const window = series.slice(-14);
  const days =
    window.length >= 2
      ? Math.max(
          (new Date(window[window.length - 1].date).getTime() - new Date(window[0].date).getTime()) / 86_400_000,
          1,
        )
      : 0;
  const perDay = days > 0 ? (window[window.length - 1].followers - window[0].followers) / days : 0;

  const daysLeft = perDay > 0 && remaining > 0 ? Math.ceil(remaining / perDay) : null;
  const eta = daysLeft !== null ? new Date(Date.now() + daysLeft * 86_400_000).toISOString() : null;

  return {
    current,
    goal,
    start,
    progressPct: goal > start ? Math.min(((current - start) / (goal - start)) * 100, 100) : 0,
    remaining,
    perDay,
    daysLeft,
    etaISO: eta,
  };
}

/** Entonnoir contenu -> call -> vente. */
export function funnel(posts: Post[], stories: Story[], leads: Lead[]) {
  const published = posts.filter((p) => p.status === "publie");
  const views = sumBy(published, (p) => p.views) + sumBy(stories, (s) => s.views);
  const profileVisits = sumBy(published, (p) => p.profileVisits);
  const linkClicks = sumBy(published, (p) => p.linkClicks) + sumBy(stories, (s) => s.linkClicks);
  const callsBooked = sumBy(published, (p) => p.callsBooked) + sumBy(stories, (s) => s.callsBooked);
  const won = leads.filter((l) => l.stage === "closed-won");
  return {
    views,
    profileVisits,
    linkClicks,
    callsBooked,
    closed: won.length,
    revenue: sumBy(won, (l) => l.dealValue),
    // Taux de passage d'une étape à la suivante.
    visitRate: rate(profileVisits, views),
    clickRate: rate(linkClicks, profileVisits),
    bookRate: rate(callsBooked, linkClicks),
    closeRate: rate(won.length, callsBooked),
  };
}

/** Meilleur créneau de publication, déduit de l'heure de publication réelle. */
export function bestSlots(posts: Post[]) {
  const published = posts.filter((p) => p.status === "publie" && p.publishedAt && p.views > 0);
  const byHour = new Map<number, { views: number; n: number }>();
  for (const p of published) {
    const h = new Date(p.publishedAt).getHours();
    const cur = byHour.get(h) ?? { views: 0, n: 0 };
    byHour.set(h, { views: cur.views + p.views, n: cur.n + 1 });
  }
  return [...byHour.entries()]
    .map(([hour, v]) => ({ hour, avgViews: v.views / v.n, posts: v.n }))
    .sort((a, b) => b.avgViews - a.avgViews);
}
