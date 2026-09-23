"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { api, useCollection } from "@/lib/client";
import { BarChart, SERIES, Sparkline } from "@/components/charts";
import { Card, Empty, PageHeader, StatTile } from "@/components/ui";
import { DailyPanel, FormatPosts, GrowthPanel, IgProfileCard, RecentReels } from "@/components/instagram";
import { bestSlots, filterByKeywords, followerSeries, statsByDimension, verdictFormats } from "@/lib/analytics";
import { fmtCompact, fmtDateTime, fmtEur, fmtInt, label, mondayISO, relative, todayISO, WEEKDAYS } from "@/lib/format";
import { SkPage } from "@/components/Skeleton";
import type {
  CallEvent,
  ProdFolder,
  SavedItem,
  FollowerPoint,
  IgProfileSnapshot,
  Lead,
  Post,
  Settings,
  Todo,
} from "@/lib/types";

export default function DashboardPage() {
  const followers = useCollection<FollowerPoint>("followers");
  const posts = useCollection<Post>("posts", { light: true });
  const leads = useCollection<Lead>("leads");
  const calls = useCollection<CallEvent>("calls");
  const todos = useCollection<Todo>("todos");
  const saved = useCollection<SavedItem>("saved");

  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => {
    void api<Settings>("/api/settings").then(setSettings).catch(() => setSettings(null));
  }, []);

  // Synchro Instagram à chaque ouverture du dashboard. La route ne redemande à
  // Meta que si son cache a plus de 10 minutes : le quota est de 200 appels par
  // heure et il faut en garder pour la synchro des publications.
  const [ig, setIg] = useState<IgProfileSnapshot | null>(null);
  const [igWarning, setIgWarning] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Le rattrapage se rappelle lui-meme : on passe par une ref pour ne pas
  // recreer le callback a chaque rendu.
  const catchUp = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadIgRef = useRef<(force?: boolean, catchingUp?: boolean) => Promise<void>>(async () => {});

  /*
   * On ne depend que des fonctions de rechargement, stables d'un rendu a
   * l'autre. Dependre de `posts` et `followers` entiers recreait `loadIg` a
   * chaque rendu ; l'effet ci-dessous se relancait, appelait la route, qui
   * changeait l'etat, qui provoquait un rendu... Plusieurs milliers d'appels
   * par minute a /api/instagram/profile, et un ecran qui saccadait.
   */
  const reloadPosts = posts.reload;
  const reloadFollowers = followers.reload;

  const loadIg = useCallback(async (force = false, catchingUp = false) => {
    setRefreshing(true);
    try {
      const res = await api<{ profile: IgProfileSnapshot; error?: string; stale?: boolean }>(
        `/api/instagram/profile${force ? "?force=1" : ""}`,
      );
      setIg(res.profile);
      setIgWarning(res.error ?? null);

      // Cache perime : une synchro tourne en fond. On revient la chercher, et
      // on recharge les collections pour que les compteurs du jour suivent —
      // sans quoi il fallait rafraichir la page une seconde fois.
      // Un seul rattrapage : si le profil est toujours perime apres, c'est que
      // la synchro echoue (token, quota) et la relancer en boucle n'y changerait rien.
      if (res.stale && !catchingUp) {
        if (catchUp.current) clearTimeout(catchUp.current);
        catchUp.current = setTimeout(() => {
          void loadIgRef.current(false, true);
          void reloadPosts();
          void reloadFollowers();
        }, 6000);
      }
    } catch (e) {
      setIgWarning((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, [reloadPosts, reloadFollowers]);

  loadIgRef.current = loadIg;

  useEffect(() => () => { if (catchUp.current) clearTimeout(catchUp.current); }, []);

  useEffect(() => {
    void loadIg();
  }, [loadIg]);

  const today = todayISO();
  const now = Date.now();

  const series = useMemo(() => followerSeries(followers.rows).slice(-30), [followers.rows]);
  // Le classement des formats ne doit porter que sur le contenu qui vend :
  // un viral hors niche fausse toutes les moyennes sans rien dire d'utile.
  const businessPosts = useMemo(
    () => filterByKeywords(posts.rows, settings?.postFilterKeywords ?? "commente"),
    [posts.rows, settings],
  );
  const filtered = businessPosts.length !== posts.rows.length;

  /** Heures ou mes posts performent le mieux, calculees sur leur heure reelle. */
  const slots = useMemo(() => bestSlots(businessPosts), [businessPosts]);

  const verdict = useMemo(
    () => verdictFormats(statsByDimension(businessPosts, (p) => p.format)),
    [businessPosts],
  );

  /** Les publications du format gagnant, les plus vues d'abord : la preuve visuelle. */
  const spamPosts = useMemo(() => {
    const key = verdict.spam?.key;
    if (!key) return [];
    // Classement par interactions et non par vues : un reel a CTA se juge au
    // volume de commentaires et de saves qu'il declenche, pas a sa portee.
    const engagement = (p: Post) => p.comments + p.saves + p.shares + p.likes;
    return businessPosts
      .filter((p) => p.status === "publie" && engagement(p) > 0 && p.format === key)
      .sort((a, b) => engagement(b) - engagement(a));
  }, [businessPosts, verdict.spam]);

  const todayPoint = followers.rows.find((f) => f.date === today);
  // Publies aujourd'hui : la synchro legere reperant les nouveaux medias,
  // la cadence se met a jour sans intervention.
  const reelsToday = posts.rows.filter(
    (p) => p.status === "publie" && p.publishedAt.slice(0, 10) === today,
  ).length;

  // Photos et carrousels depuis lundi : cadence hebdomadaire, pas quotidienne.
  const photosThisWeek = posts.rows.filter(
    (p) =>
      p.status === "publie" &&
      (p.format === "post-image" || p.format === "carrousel") &&
      p.publishedAt.slice(0, 10) >= mondayISO(),
  ).length;
  const upcomingCalls = calls.rows
    .filter((c) => c.status === "book" && new Date(c.at).getTime() > now)
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(0, 5);
  const hotLeads = leads.rows
    .filter((l) => l.stage === "call-book" || l.stage === "call-fait" || l.stage === "conversation")
    .slice(0, 5);
  const dueTodos = todos.rows
    .filter((t) => !t.done && (!t.due || t.due <= today))
    .sort((a, b) => a.priority.localeCompare(b.priority))
    .slice(0, 6);

  const published30 = useMemo(() => {
    const cutoff = new Date(now - 30 * 86_400_000).toISOString();
    return posts.rows.filter((p) => p.status === "publie" && p.publishedAt >= cutoff);
  }, [posts.rows, now]);

  /*
   * Chiffre closé du mois.
   *
   * Il vient du module commercial (ventes enregistrees, date de vente, net des
   * remboursements). L'ancien calcul comptait les leads « closés » d'apres
   * leur date de creation : un lead cree en aout et closé en septembre
   * n'apparaissait pas, et l'inverse comptait double. Si le module commercial
   * ne repond pas, on retombe sur les leads pour ne pas afficher un tiret.
   */
  const [closedMonth, setClosedMonth] = useState<{ value: number; count: number; currency: string } | null>(null);
  useEffect(() => {
    void api<{ currency: string; kpis: { contractValue: number; sales: number } }>(
      "/api/sales/dashboard?period=month",
    )
      .then((r) => setClosedMonth({ value: r.kpis.contractValue, count: r.kpis.sales, currency: r.currency }))
      .catch(() => setClosedMonth(null));
  }, []);

  const wonThisMonth = useMemo(() => {
    const month = new Date().toISOString().slice(0, 7);
    return leads.rows.filter((l) => l.stage === "closed-won" && l.createdAt.slice(0, 7) === month);
  }, [leads.rows]);

  const closedValue = closedMonth
    ? new Intl.NumberFormat("fr-FR", {
        style: "currency",
        currency: closedMonth.currency || "EUR",
        maximumFractionDigits: 0,
      }).format(closedMonth.value)
    : fmtEur(wonThisMonth.reduce((a, l) => a + (l.dealValue || 0), 0));
  const closedCount = closedMonth ? closedMonth.count : wonThisMonth.length;

  const loading = followers.loading && posts.loading && leads.loading;
  if (loading) return <SkPage />;

  const weekday = new Date().getDay();
  const todayLabel = new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());

  return (
    <>
      <PageHeader title={`${WEEKDAYS[weekday]} ${todayLabel}`} />

      {ig && (
        <IgProfileCard
          profile={ig}
          verified={settings?.igVerified ?? true}
          channelMembers={settings?.igChannelMembers ?? 0}
          onRefresh={() => void loadIg(true)}
          refreshing={refreshing}
          warning={igWarning}
        />
      )}

      {ig && settings?.weekPlan && (
        <DailyPanel
          pictureUrl={ig.profilePictureUrl}
          username={ig.username}
          story={{
            count: todayPoint?.storyCount ?? 0,
            views: todayPoint?.storyViews ?? 0,
            reach: todayPoint?.storyReach ?? 0,
            replies: todayPoint?.storyReplies ?? 0,
            navigation: todayPoint?.storyNavigation ?? 0,
            profileVisits: todayPoint?.storyProfileVisits ?? 0,
          }}
          reelsDone={reelsToday}
          reelsGoal={settings.dailyReelsGoal ?? 3}
          channelDone={todayPoint?.channelPosts ?? 0}
          channelGoal={settings.dailyChannelGoal ?? 6}
          photosDone={photosThisWeek}
          photosGoal={settings.weeklyPhotoGoal ?? 4}
          onChannelChange={(next) => {
            if (todayPoint) void followers.patch(todayPoint.id, { channelPosts: next });
          }}
          plan={settings.weekPlan}
          weekday={weekday}
          days={WEEKDAYS}
        />
      )}

      <div className="grid lg:grid-cols-[1fr_330px] gap-4 items-start">
        <div className="flex flex-col gap-4">
          {ig && ig.history.length > 0 && (
            <Card title="Croissance">
              <GrowthPanel initial={ig.history} compact />
            </Card>
          )}

          <Card
            title="Derniers reels"
            subtitle="Clique sur une ligne pour le détail et l'audience"
            actions={<Link href="/contenu" className="btn btn-sm">Tout voir</Link>}
            padded={false}
          >
            <RecentReels posts={posts.rows} />
          </Card>

          {verdict.spam && (
            <Card
              title="Top vidéos"
              subtitle={
                filtered
                  ? `${businessPosts.length} posts à CTA retenus sur ${posts.rows.length}`
                  : undefined
              }
              actions={<Link href="/insights" className="btn btn-sm">Analyse complète</Link>}
            >
              {spamPosts.length > 0 && (
                <div className="mt-3">
                  <FormatPosts
                    posts={spamPosts}
                    title=""
                    savedUrls={new Set(saved.rows.map((r) => r.permalink))}
                    onSave={(p, folder: ProdFolder) =>
                      void saved.create({
                        source: "mine",
                        author: "moi",
                        permalink: p.url,
                        thumbnail: p.thumbnail ?? "",
                        caption: p.caption ?? p.title,
                        likes: p.likes,
                        comments: p.comments,
                        views: p.views,
                        isReel: p.format.startsWith("reel"),
                        folder,
                                          note: "",
                        postId: p.id,
                        transcript: p.transcript ?? "",
                      })
                    }
                  />
                </div>
              )}
            </Card>
          )}

          <div className="grid gap-4">
            <Card
              title="À faire aujourd'hui"
              actions={<Link href="/todo" className="btn btn-sm">Ouvrir</Link>}
              padded={false}
            >
              {!dueTodos.length ? (
                <Empty>Rien d&apos;urgent. Profite-en pour produire.</Empty>
              ) : (
                <ul>
                  {dueTodos.map((t, i) => (
                    <li
                      key={t.id}
                      className="px-3.5 py-2.5 flex items-center gap-2.5"
                      style={{ borderBottom: i < dueTodos.length - 1 ? "1px solid var(--border)" : "none" }}
                    >
                      <span
                        className="text-[10.5px] font-bold num shrink-0 w-[18px]"
                        style={{ color: t.priority === "P1" ? "var(--critical)" : t.priority === "P2" ? "var(--warning)" : "var(--text-3)" }}
                      >
                        {t.priority}
                      </span>
                      <span className="text-[12.5px] flex-1 min-w-0 truncate">{t.text}</span>
                      {t.due && t.due < today && <span className="badge badge-danger !text-[10px] !py-0">Retard</span>}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

        </div>

        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 lg:grid-cols-1 gap-3">
        <Link href="/contenu" className="block" title="Ouvrir le calendrier de contenu">
          <StatTile
            label="Posts (30 j)"
            value={fmtInt(published30.length)}
            hint={`${fmtCompact(published30.reduce((a, p) => a + p.views, 0))} vues cumulées · voir le calendrier`}
          />
        </Link>
        <StatTile
          label="Calls à venir"
          value={fmtInt(upcomingCalls.length)}
          hint={upcomingCalls.length ? `Prochain ${relative(upcomingCalls[0].at)}` : "Aucun call booké"}
          accent={upcomingCalls.length ? "var(--good)" : undefined}
        />
        <StatTile
          label="Closé ce mois"
          value={closedValue}
          hint={`${closedCount} vente${closedCount > 1 ? "s" : ""}`}
          accent="var(--good)"
        />
      </div>


          {slots.length > 0 && (
            <Card title="Meilleurs créneaux">
              <BarChart
                rows={slots.slice(0, 6).map((s, i) => ({
                  label: `${String(s.hour).padStart(2, "0")} h`,
                  value: s.avgViews,
                  color: SERIES[i % SERIES.length],
                  meta: `${s.posts} post${s.posts > 1 ? "s" : ""} publiés sur ce créneau`,
                }))}
                format={fmtCompact}
              />
            </Card>
          )}

          <Card
            title="Prochains calls"
            actions={<Link href="/calls" className="btn btn-sm">Tout voir</Link>}
            padded={false}
          >
            {!upcomingCalls.length ? (
              <Empty>Aucun call booké. C&apos;est le moment de pousser un CTA en story.</Empty>
            ) : (
              <ul>
                {upcomingCalls.map((c, i) => (
                  <li
                    key={c.id}
                    className="px-3.5 py-2.5"
                    style={{ borderBottom: i < upcomingCalls.length - 1 ? "1px solid var(--border)" : "none" }}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[13px] font-semibold leading-snug truncate">
                        {c.contact || c.title}
                      </span>
                      <span className="badge badge-accent !text-[10px] !py-0 shrink-0">{relative(c.at)}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className="text-[12px] num font-medium">{fmtDateTime(c.at)}</span>
                      {c.durationMin > 0 && <span className="dim text-[11.5px] num">{c.durationMin} min</span>}
                      {c.url && (
                        <a
                          href={c.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[11.5px]"
                          style={{ color: "var(--accent)" }}
                        >
                          Rejoindre
                        </a>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card
            title="Leads chauds"
            actions={<Link href="/crm" className="btn btn-sm">CRM</Link>}
            padded={false}
          >
            {!hotLeads.length ? (
              <Empty>Aucun lead en cours de conversation.</Empty>
            ) : (
              <ul>
                {hotLeads.map((l, i) => (
                  <li
                    key={l.id}
                    className="px-3.5 py-2.5 flex items-center gap-2"
                    style={{ borderBottom: i < hotLeads.length - 1 ? "1px solid var(--border)" : "none" }}
                  >
                    <span className="flex-1 min-w-0">
                      <span className="block text-[12.5px] font-medium truncate">{l.name}</span>
                      {l.nextAction && <span className="block dim text-[11px] truncate">{l.nextAction}</span>}
                    </span>
                    <span className="badge !text-[10px] !py-0 shrink-0">{label(l.stage)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {series.length >= 3 && (
            <Card title="30 derniers jours">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[19px] font-semibold num">
                    +{fmtInt(series[series.length - 1].followers - series[0].followers)}
                  </div>
                  <div className="dim text-[11.5px]">abonnés gagnés</div>
                </div>
                <Sparkline values={series.map((p) => p.followers)} color="var(--s1)" height={36} />
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
