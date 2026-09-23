"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, useCollection } from "@/lib/client";
import { FormatPosts } from "@/components/instagram";
import { Card, Empty, ErrorNote, PageHeader, Spinner, StatTile, Tabs, useToast } from "@/components/ui";
import { filterByKeywords } from "@/lib/analytics";
import { label } from "@/lib/format";
import type { Lead, Post, ProdFolder, SavedItem, Settings, Story } from "@/lib/types";

interface Strategy {
  verdict: string;
  spam: { format: string; pourquoi: string; combienParSemaine: number }[];
  stop: { format: string; pourquoi: string }[];
  tester: { idee: string; hypothese: string }[];
  hooksGagnants: string[];
  planSemaine: { jour: string; contenu: string; format: string; angle: string }[];
  alertes: string[];
}

export default function InsightsPage() {
  const posts = useCollection<Post>("posts", { light: true });
  const stories = useCollection<Story>("stories");
  const leads = useCollection<Lead>("leads");
  const saved = useCollection<SavedItem>("saved");
  const toast = useToast();

  const [strategy, setStrategy] = useState<Strategy | null>(null);
  // Aligne cette page sur le dashboard : par defaut on n'analyse que le
  // contenu business, un viral hors niche faussant toutes les moyennes.
  const [scope, setScope] = useState<"business" | "tout">("business");
  const [vSort, setVSort] = useState<"engagement" | "views" | "likes" | "comments" | "recent">("engagement");
  const [vAsc, setVAsc] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => {
    void api<Settings>("/api/settings").then(setSettings).catch(() => setSettings(null));
  }, []);
  const [loadingAi, setLoadingAi] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scoped = useMemo(
    () =>
      scope === "tout"
        ? posts.rows
        : filterByKeywords(posts.rows, settings?.postFilterKeywords ?? "commente"),
    [posts.rows, scope, settings],
  );


  const measured = scoped.filter((p) => p.status === "publie" && p.views > 0);

  /** Mes videos du perimetre, filtrees et triees. */
  const videos = useMemo(() => {
    const engagement = (p: Post) => p.comments + p.saves + p.shares + p.likes;
    const dir = vAsc ? -1 : 1;

    return scoped
      .filter((p) => p.status === "publie" && engagement(p) > 0)
      .sort((a, b) => {
        if (vSort === "recent") return dir * b.publishedAt.localeCompare(a.publishedAt);
        if (vSort === "views") return dir * (b.views - a.views);
        if (vSort === "likes") return dir * (b.likes - a.likes);
        if (vSort === "comments") return dir * (b.comments - a.comments);
        return dir * (engagement(b) - engagement(a));
      });
  }, [scoped, vSort, vAsc]);

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

  if (posts.loading) return <Spinner label="Chargement…" />;

  if (measured.length < 3) {
    return (
      <>
        <PageHeader title="Winning Format" actions={
          <Tabs
            value={scope}
            onChange={setScope}
            options={[
              { value: "business", label: "Business", count: filterByKeywords(posts.rows, settings?.postFilterKeywords ?? "commente").length },
              { value: "tout", label: "Tout", count: posts.rows.length },
            ]}
          />
        }
      />
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
        title="Winning Format"
        subtitle={`${measured.length} posts mesurés`}
        actions={
          <button className="btn btn-primary" onClick={() => void askAi()} disabled={loadingAi}>
            {loadingAi ? <span className="spinner" /> : "✦"} Demander le plan de la semaine
          </button>
        }
      />

      {videos.length > 0 && (
        <Card
          title="Mes vidéos"
          subtitle={`${videos.length} sur ${measured.length} publications mesurées`}
          className="mb-4"
          actions={
            <span className="flex items-center gap-1.5">
              <Tabs
                value={vSort}
                onChange={setVSort}
                options={[
                  { value: "engagement", label: "Engagement" },
                  { value: "views", label: "Vues" },
                  { value: "likes", label: "Likes" },
                  { value: "comments", label: "Comm." },
                  { value: "recent", label: "Récents" },
                ]}
              />
              <button className="btn btn-sm" onClick={() => setVAsc((v) => !v)}>
                {vAsc ? "↑" : "↓"}
              </button>
            </span>
          }
        >
          <FormatPosts
            posts={videos}
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
        </Card>
      )}

      <div className="grid lg:grid-cols-[1fr_320px] gap-4 items-start">
        <div className="flex flex-col gap-4">
          {error && <ErrorNote>{error}</ErrorNote>}

          {strategy && (
            <Card title="Le plan de la semaine">
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
        </div>
      </div>
    </>
  );
}
