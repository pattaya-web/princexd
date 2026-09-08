"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, useCollection } from "@/lib/client";
import { GoalGauge, LineChart, SERIES, Sparkline } from "@/components/charts";
import { Card, Empty, PageHeader, Spinner, StatTile } from "@/components/ui";
import { followerSeries, projectGoal, statsByDimension, verdictFormats } from "@/lib/analytics";
import { fmtCompact, fmtDate, fmtDateTime, fmtEur, fmtInt, label, relative, todayISO, WEEKDAYS } from "@/lib/format";
import type { CallEvent, FollowerPoint, Generation, Lead, Post, Settings, Story, Todo } from "@/lib/types";

export default function DashboardPage() {
  const followers = useCollection<FollowerPoint>("followers");
  const posts = useCollection<Post>("posts");
  const stories = useCollection<Story>("stories");
  const leads = useCollection<Lead>("leads");
  const calls = useCollection<CallEvent>("calls");
  const todos = useCollection<Todo>("todos");
  const generations = useCollection<Generation>("generations");

  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => {
    void api<Settings>("/api/settings").then(setSettings).catch(() => setSettings(null));
  }, []);

  const today = todayISO();
  const now = Date.now();

  const goal = useMemo(
    () => projectGoal(followers.rows, settings?.followersGoal ?? 10000, settings?.followersStart ?? 9500),
    [followers.rows, settings],
  );
  const series = useMemo(() => followerSeries(followers.rows).slice(-30), [followers.rows]);
  const verdict = useMemo(() => verdictFormats(statsByDimension(posts.rows, (p) => p.format)), [posts.rows]);

  const todayStories = stories.rows.filter((s) => s.date === today);
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
  const inProduction = posts.rows.filter((p) => p.status !== "publie" && p.status !== "idee").slice(0, 5);
  const recentGens = generations.rows.filter((g) => g.state === "success" && g.resultUrls.length).slice(0, 6);

  const published30 = useMemo(() => {
    const cutoff = new Date(now - 30 * 86_400_000).toISOString();
    return posts.rows.filter((p) => p.status === "publie" && p.publishedAt >= cutoff);
  }, [posts.rows, now]);

  const wonThisMonth = useMemo(() => {
    const month = new Date().toISOString().slice(0, 7);
    return leads.rows.filter((l) => l.stage === "closed-won" && l.createdAt.slice(0, 7) === month);
  }, [leads.rows]);

  const loading = followers.loading && posts.loading && leads.loading;
  if (loading) return <Spinner label="Chargement du cockpit…" />;

  const weekday = new Date().getDay();

  return (
    <>
      <PageHeader
        title={`${WEEKDAYS[weekday]} — le point`}
        subtitle="Ton objectif, ce qui doit sortir aujourd'hui, et ce qui attend une action de ta part."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <StatTile
          label="Abonnés"
          value={fmtInt(goal.current)}
          trend={series.length >= 2 ? series[series.length - 1].delta : undefined}
          hint={
            goal.daysLeft !== null
              ? `${fmtInt(goal.remaining)} avant l'objectif · ≈ ${goal.daysLeft} j`
              : `${fmtInt(goal.remaining)} avant l'objectif`
          }
        />
        <StatTile
          label="Posts (30 j)"
          value={fmtInt(published30.length)}
          hint={`${fmtCompact(published30.reduce((a, p) => a + p.views, 0))} vues cumulées`}
        />
        <StatTile
          label="Calls à venir"
          value={fmtInt(upcomingCalls.length)}
          hint={upcomingCalls.length ? `Prochain ${relative(upcomingCalls[0].at)}` : "Aucun call booké"}
          accent={upcomingCalls.length ? "var(--good)" : undefined}
        />
        <StatTile
          label="Closé ce mois"
          value={fmtEur(wonThisMonth.reduce((a, l) => a + (l.dealValue || 0), 0))}
          hint={`${wonThisMonth.length} vente${wonThisMonth.length > 1 ? "s" : ""}`}
          accent="var(--good)"
        />
      </div>

      <div className="grid lg:grid-cols-[1fr_330px] gap-4 items-start">
        <div className="flex flex-col gap-4">
          <Card
            title="Objectif abonnés"
            actions={<Link href="/croissance" className="btn btn-sm">Détail</Link>}
          >
            <div className="grid md:grid-cols-[auto_1fr] gap-5 items-center">
              <GoalGauge current={goal.current} goal={goal.goal} start={goal.start} />
              <div className="min-w-0">
                {series.length >= 2 ? (
                  <LineChart
                    points={series.map((p) => ({ label: fmtDate(p.date), values: [p.followers] }))}
                    series={[{ name: "Abonnés", color: SERIES[0] }]}
                    height={150}
                    format={fmtCompact}
                  />
                ) : (
                  <Empty action={<Link href="/croissance" className="btn btn-sm btn-primary">Ajouter un relevé</Link>}>
                    Enregistre tes abonnés chaque jour pour voir la courbe et la date d&apos;atteinte de l&apos;objectif.
                  </Empty>
                )}
              </div>
            </div>
          </Card>

          {verdict.spam && (
            <Card
              title="Ce que disent tes chiffres"
              actions={<Link href="/insights" className="btn btn-sm">Analyse complète</Link>}
            >
              <div className="grid sm:grid-cols-2 gap-3">
                <div
                  className="p-3 rounded-[9px]"
                  style={{ background: "color-mix(in srgb, var(--good) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--good) 30%, transparent)" }}
                >
                  <div className="label-xs" style={{ color: "var(--good)" }}>Spam ce format</div>
                  <div className="text-[16px] font-semibold mt-1">{verdict.spam.label}</div>
                  <p className="muted text-[12px] mt-1 leading-relaxed">
                    {fmtCompact(verdict.spam.avgViews)} vues/post · {verdict.spam.callsBooked} calls générés
                  </p>
                </div>
                {verdict.stop && verdict.stop.key !== verdict.spam.key && (
                  <div
                    className="p-3 rounded-[9px]"
                    style={{ background: "color-mix(in srgb, var(--critical) 7%, transparent)", border: "1px solid color-mix(in srgb, var(--critical) 28%, transparent)" }}
                  >
                    <div className="label-xs" style={{ color: "var(--critical)" }}>Arrête ce format</div>
                    <div className="text-[16px] font-semibold mt-1">{verdict.stop.label}</div>
                    <p className="muted text-[12px] mt-1 leading-relaxed">
                      {fmtCompact(verdict.stop.avgViews)} vues/post · {verdict.stop.callsBooked} calls
                    </p>
                  </div>
                )}
              </div>
              {verdict.confiance !== "bonne" && (
                <p className="dim text-[11.5px] mt-2.5">
                  Confiance {verdict.confiance} — le classement peut encore bouger.
                </p>
              )}
            </Card>
          )}

          <div className="grid md:grid-cols-2 gap-4">
            <Card
              title="Stories du jour"
              subtitle={`${todayStories.filter((s) => s.done).length} / ${todayStories.length} postées`}
              actions={<Link href="/stories" className="btn btn-sm">Ouvrir</Link>}
              padded={false}
            >
              {!todayStories.length ? (
                <Empty action={<Link href="/stories" className="btn btn-sm btn-primary">Écrire la journée</Link>}>
                  Aucune story planifiée aujourd&apos;hui.
                </Empty>
              ) : (
                <ul>
                  {todayStories.map((s, i) => (
                    <li
                      key={s.id}
                      className="px-3.5 py-2.5 flex items-center gap-2.5"
                      style={{ borderBottom: i < todayStories.length - 1 ? "1px solid var(--border)" : "none" }}
                    >
                      <span
                        className="w-[6px] h-[6px] rounded-full shrink-0"
                        style={{ background: s.done ? "var(--good)" : "var(--border-strong)" }}
                      />
                      <span className="badge !text-[10px] !py-0 shrink-0">{label(s.slot)}</span>
                      <span className="text-[12.5px] flex-1 min-w-0 truncate" title={s.idea}>
                        {s.idea || label(s.type)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

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

          {recentGens.length > 0 && (
            <Card
              title="Dernières générations"
              actions={<Link href="/studio" className="btn btn-sm">Studio</Link>}
              padded={false}
            >
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 p-3">
                {recentGens.map((g) => (
                  <Link
                    key={g.id}
                    href="/studio"
                    className="block rounded-[7px] overflow-hidden"
                    style={{ aspectRatio: "4 / 5", background: "var(--surface-3)" }}
                    title={g.prompt}
                  >
                    {g.kind === "video" ? (
                      <video src={g.resultUrls[0]} className="w-full h-full object-cover" muted />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={g.resultUrls[0]} alt="" className="w-full h-full object-cover" loading="lazy" />
                    )}
                  </Link>
                ))}
              </div>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-4">
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
                    <div className="text-[12.5px] font-medium leading-snug">{c.contact || c.title}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="dim text-[11.5px] num">{fmtDateTime(c.at)}</span>
                      <span className="badge badge-accent !text-[10px] !py-0">{relative(c.at)}</span>
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

          <Card
            title="En production"
            actions={<Link href="/contenu" className="btn btn-sm">Calendrier</Link>}
            padded={false}
          >
            {!inProduction.length ? (
              <Empty>Aucun contenu en cours de production.</Empty>
            ) : (
              <ul>
                {inProduction.map((p, i) => (
                  <li
                    key={p.id}
                    className="px-3.5 py-2.5 flex items-center gap-2"
                    style={{ borderBottom: i < inProduction.length - 1 ? "1px solid var(--border)" : "none" }}
                  >
                    <span className="text-[12.5px] flex-1 min-w-0 truncate" title={p.title}>
                      {p.title || "Sans titre"}
                    </span>
                    <span className="badge !text-[10px] !py-0 shrink-0">{label(p.status)}</span>
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
