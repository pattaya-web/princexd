"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { api, useCollection } from "@/lib/client";
import { BarChart, Funnel, SERIES } from "@/components/charts";
import { Card, Empty, ErrorNote, InfoNote, PageHeader, Spinner, StatTile, Tabs, useToast } from "@/components/ui";
import { funnel, statsByDimension, verdictFormats, bestSlots, type DimensionStat } from "@/lib/analytics";
import { fmtCompact, fmtInt, fmtPct, label } from "@/lib/format";
import type { Lead, Post, Story } from "@/lib/types";

interface Strategy {
  verdict: string;
  spam: { format: string; pourquoi: string; combienParSemaine: number }[];
  stop: { format: string; pourquoi: string }[];
  tester: { idee: string; hypothese: string }[];
  hooksGagnants: string[];
  planSemaine: { jour: string; contenu: string; format: string; angle: string }[];
  alertes: string[];
}

type Dim = "format" | "angle" | "hook";

export default function InsightsPage() {
  const posts = useCollection<Post>("posts");
  const stories = useCollection<Story>("stories");
  const leads = useCollection<Lead>("leads");
  const toast = useToast();

  const [dim, setDim] = useState<Dim>("format");
  const [metric, setMetric] = useState<"score" | "avgViews" | "followersPerPost" | "callsBooked">("score");
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [loadingAi, setLoadingAi] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selector = useMemo(() => {
    if (dim === "angle") return (p: Post) => p.angle;
    if (dim === "hook") return (p: Post) => (p.hook ? p.hook.slice(0, 42) : "sans hook");
    return (p: Post) => p.format;
  }, [dim]);

  const stats = useMemo(() => statsByDimension(posts.rows, selector), [posts.rows, selector]);
  const formatStats = useMemo(() => statsByDimension(posts.rows, (p) => p.format), [posts.rows]);
  const verdict = useMemo(() => verdictFormats(formatStats), [formatStats]);
  const fun = useMemo(() => funnel(posts.rows, stories.rows, leads.rows), [posts.rows, stories.rows, leads.rows]);
  const slots = useMemo(() => bestSlots(posts.rows), [posts.rows]);

  const measured = posts.rows.filter((p) => p.status === "publie" && p.views > 0);

  const askAi = async () => {
    setLoadingAi(true);
    setError(null);
    try {
      const res = await api<{ strategy: Strategy }>("/api/ai/strategy", { method: "POST" });
      setStrategy(res.strategy);
      toast("Reco générée.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingAi(false);
    }
  };

  const chartRows = useMemo(() => {
    const value = (s: DimensionStat) =>
      metric === "score" ? s.score : metric === "avgViews" ? s.avgViews : metric === "followersPerPost" ? s.followersPerPost : s.callsBooked;
    return stats.map((s, i) => ({
      label: s.label,
      value: value(s),
      color: SERIES[i % SERIES.length],
      meta: `${s.posts} posts · ${fmtCompact(s.avgViews)} vues/post · ${fmtPct(s.avgEngagementRate * 100)} d'engagement · ${s.callsBooked} calls`,
    }));
  }, [stats, metric]);

  if (posts.loading) return <Spinner label="Chargement…" />;

  if (measured.length < 3) {
    return (
      <>
        <PageHeader title="Quoi spammer" subtitle="Le tool te dit sur quel format itérer — à partir de tes chiffres, pas d'une intuition." />
        <Card>
          <Empty action={<Link href="/contenu" className="btn btn-primary">Aller au calendrier de contenu</Link>}>
            Il faut au moins 3 posts publiés avec leurs stats pour que cette page dise quelque chose d&apos;honnête.
            Tu en as {measured.length}. Va renseigner les vues, abonnés gagnés et calls générés de tes posts publiés.
          </Empty>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Quoi spammer"
        subtitle={`Calculé sur ${measured.length} posts mesurés. Le score pondère la portée, l'engagement, les abonnés gagnés et surtout les calls générés.`}
        actions={
          <button className="btn btn-primary" onClick={() => void askAi()} disabled={loadingAi}>
            {loadingAi ? <span className="spinner" /> : "✦"} Demander le plan de la semaine
          </button>
        }
      />

      {/* Le verdict chiffré, avant tout appel IA. */}
      <div className="grid md:grid-cols-2 gap-3 mb-4">
        <div
          className="card px-4 py-3.5"
          style={{ borderColor: "color-mix(in srgb, var(--good) 45%, transparent)" }}
        >
          <div className="label-xs" style={{ color: "var(--good)" }}>À spammer</div>
          {verdict.spam ? (
            <>
              <div className="text-[19px] font-semibold mt-1">{verdict.spam.label}</div>
              <p className="muted text-[12.5px] mt-1 leading-relaxed">
                {fmtCompact(verdict.spam.avgViews)} vues/post en moyenne, {verdict.spam.followersPerPost.toFixed(1)}{" "}
                abonné{verdict.spam.followersPerPost >= 2 ? "s" : ""}/post et {verdict.spam.callsBooked} call
                {verdict.spam.callsBooked > 1 ? "s" : ""} générés sur {verdict.spam.posts} posts. Score{" "}
                {verdict.spam.score}/100.
              </p>
            </>
          ) : (
            <p className="dim text-[12.5px] mt-1.5">Aucun format n&apos;a encore assez de posts pour trancher.</p>
          )}
        </div>

        <div
          className="card px-4 py-3.5"
          style={{ borderColor: verdict.stop ? "color-mix(in srgb, var(--critical) 40%, transparent)" : "var(--border)" }}
        >
          <div className="label-xs" style={{ color: verdict.stop ? "var(--critical)" : undefined }}>
            À arrêter
          </div>
          {verdict.stop && verdict.stop.key !== verdict.spam?.key ? (
            <>
              <div className="text-[19px] font-semibold mt-1">{verdict.stop.label}</div>
              <p className="muted text-[12.5px] mt-1 leading-relaxed">
                {fmtCompact(verdict.stop.avgViews)} vues/post, {verdict.stop.callsBooked} call
                {verdict.stop.callsBooked > 1 ? "s" : ""} sur {verdict.stop.posts} posts. Score {verdict.stop.score}/100
                — ce temps de production est mieux investi ailleurs.
              </p>
            </>
          ) : (
            <p className="dim text-[12.5px] mt-1.5">Rien à couper pour l&apos;instant.</p>
          )}
        </div>
      </div>

      {verdict.confiance !== "bonne" && (
        <div className="mb-4">
          <InfoNote>
            Confiance <strong>{verdict.confiance}</strong> : avec {measured.length} posts mesurés, le classement peut
            encore bouger. Vise une vingtaine de posts avec stats et au moins 3 posts par format avant de prendre une
            décision définitive.
          </InfoNote>
        </div>
      )}

      <div className="grid lg:grid-cols-[1fr_320px] gap-4 items-start">
        <div className="flex flex-col gap-4">
          <Card
            title="Classement"
            actions={
              <Tabs
                value={dim}
                onChange={setDim}
                options={[
                  { value: "format", label: "Format" },
                  { value: "angle", label: "Angle" },
                  { value: "hook", label: "Hook" },
                ]}
              />
            }
          >
            <div className="mb-3">
              <Tabs
                value={metric}
                onChange={setMetric}
                options={[
                  { value: "score", label: "Score global" },
                  { value: "avgViews", label: "Vues/post" },
                  { value: "followersPerPost", label: "Abonnés/post" },
                  { value: "callsBooked", label: "Calls" },
                ]}
              />
            </div>
            <BarChart
              rows={chartRows}
              format={metric === "score" ? (n) => `${Math.round(n)}` : metric === "followersPerPost" ? (n) => n.toFixed(1) : fmtCompact}
              unit={metric === "score" ? "/100" : undefined}
            />
          </Card>

          <Card title="Le détail chiffré" padded={false}>
            <div className="scroll-x">
              <table className="table">
                <thead>
                  <tr>
                    <th>{dim === "format" ? "Format" : dim === "angle" ? "Angle" : "Hook"}</th>
                    <th>Posts</th>
                    <th>Vues/post</th>
                    <th>Engagement</th>
                    <th>Saves</th>
                    <th>Abonnés/post</th>
                    <th>Calls</th>
                    <th>Score</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.map((s) => (
                    <tr key={s.key}>
                      <td className="font-medium">{s.label}</td>
                      <td className="num">{s.posts}</td>
                      <td className="num">{fmtCompact(s.avgViews)}</td>
                      <td className="num">{fmtPct(s.avgEngagementRate * 100)}</td>
                      <td className="num">{fmtPct(s.avgSaveRate * 100)}</td>
                      <td className="num">{s.followersPerPost.toFixed(1)}</td>
                      <td className="num">{s.callsBooked}</td>
                      <td className="num font-semibold">{s.score}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {error && <ErrorNote>{error}</ErrorNote>}

          {strategy && (
            <Card title="Le plan de la semaine" subtitle="Généré par l'IA à partir de tes chiffres.">
              <div className="flex flex-col gap-4">
                <p
                  className="text-[14px] leading-relaxed font-medium p-3 rounded-[8px]"
                  style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
                >
                  {strategy.verdict}
                </p>

                {strategy.spam?.length > 0 && (
                  <div>
                    <span className="label-xs block mb-2" style={{ color: "var(--good)" }}>Produire en volume</span>
                    <div className="flex flex-col gap-2">
                      {strategy.spam.map((s, i) => (
                        <div key={i} className="card-flat p-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[13px] font-semibold">{s.format}</span>
                            <span className="badge badge-good">{s.combienParSemaine}× / semaine</span>
                          </div>
                          <p className="muted text-[12.5px] mt-1 leading-relaxed">{s.pourquoi}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {strategy.stop?.length > 0 && (
                  <div>
                    <span className="label-xs block mb-2" style={{ color: "var(--critical)" }}>Arrêter</span>
                    <div className="flex flex-col gap-2">
                      {strategy.stop.map((s, i) => (
                        <div key={i} className="card-flat p-2.5">
                          <span className="text-[13px] font-semibold">{s.format}</span>
                          <p className="muted text-[12.5px] mt-1 leading-relaxed">{s.pourquoi}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {strategy.planSemaine?.length > 0 && (
                  <div>
                    <span className="label-xs block mb-2">Planning</span>
                    <div className="scroll-x">
                      <table className="table">
                        <thead>
                          <tr>
                            <th style={{ width: 80 }}>Jour</th>
                            <th>Contenu</th>
                            <th style={{ width: 130 }}>Format</th>
                            <th style={{ width: 100 }}>Angle</th>
                          </tr>
                        </thead>
                        <tbody>
                          {strategy.planSemaine.map((d, i) => (
                            <tr key={i}>
                              <td className="font-medium">{d.jour}</td>
                              <td>{d.contenu}</td>
                              <td className="muted">{d.format}</td>
                              <td className="muted">{d.angle}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {strategy.tester?.length > 0 && (
                  <div>
                    <span className="label-xs block mb-2">À tester</span>
                    <ul className="flex flex-col gap-1.5">
                      {strategy.tester.map((t, i) => (
                        <li key={i} className="text-[13px] leading-relaxed">
                          <strong>{t.idee}</strong> <span className="dim">— {t.hypothese}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {strategy.alertes?.length > 0 && (
                  <div>
                    <span className="label-xs block mb-2" style={{ color: "var(--warning)" }}>Alertes</span>
                    <ul className="flex flex-col gap-1">
                      {strategy.alertes.map((a, i) => (
                        <li key={i} className="text-[12.5px] muted leading-relaxed">⚠ {a}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <Card title="Entonnoir contenu → call">
            <Funnel
              steps={[
                { label: "Vues", value: fun.views },
                { label: "Visites de profil", value: fun.profileVisits, rate: fun.visitRate },
                { label: "Clics sur le lien", value: fun.linkClicks, rate: fun.clickRate },
                { label: "Calls bookés", value: fun.callsBooked, rate: fun.bookRate },
                { label: "Closés", value: fun.closed, rate: fun.closeRate },
              ]}
            />
          </Card>

          {slots.length > 0 && (
            <Card title="Meilleurs créneaux" subtitle="Heure de publication réelle de tes posts.">
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

          <Card title="Ce qui manque">
            <ul className="flex flex-col gap-2 text-[12.5px]">
              {verdict.insuffisant.length > 0 && (
                <li className="muted leading-relaxed">
                  Formats sous-testés (moins de 3 posts) :{" "}
                  <strong>{verdict.insuffisant.map((s) => s.label).join(", ")}</strong>. Impossible de conclure dessus.
                </li>
              )}
              {posts.rows.filter((p) => p.status === "publie" && !p.views).length > 0 && (
                <li className="muted leading-relaxed">
                  <strong>{fmtInt(posts.rows.filter((p) => p.status === "publie" && !p.views).length)}</strong> posts
                  publiés sans stats. Ils ne comptent pas dans le classement.
                </li>
              )}
              {posts.rows.filter((p) => p.status === "publie" && !p.hook).length > 0 && (
                <li className="muted leading-relaxed">
                  <strong>{fmtInt(posts.rows.filter((p) => p.status === "publie" && !p.hook).length)}</strong> posts
                  sans hook renseigné : l&apos;onglet « Hook » est aveugle pour eux.
                </li>
              )}
              {!verdict.insuffisant.length && (
                <li className="muted leading-relaxed">Tes données sont propres. Continue comme ça.</li>
              )}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
