"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState } from "react";
import { api, useCollection } from "@/lib/client";
import { Card, Empty, ErrorNote, Field, Modal, PageHeader, Tabs, useToast } from "@/components/ui";
import { fmtCompact, fmtInt } from "@/lib/format";
import { SaveMenu } from "@/components/instagram";
import type { ContentAnalysis, Creator, CreatorPost, ProdFolder, SavedItem } from "@/lib/types";
import { SkPage } from "@/components/Skeleton";

type Sort = "engagement" | "comments" | "likes" | "recent";

const SORTS: { value: Sort; label: string }[] = [
  { value: "engagement", label: "Engagement" },
  { value: "comments", label: "Comm." },
  { value: "likes", label: "Likes" },
  { value: "recent", label: "Récents" },
];

export default function ContentPage() {
  const creators = useCollection<Creator>("creators");
  const posts = useCollection<CreatorPost>("creatorPosts");
  const saved = useCollection<SavedItem>("saved");
  const toast = useToast();

  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [active, setActive] = useState("");
  const [sort, setSort] = useState<Sort>("engagement");
  const [reelsOnly, setReelsOnly] = useState(false);
  const [playing, setPlaying] = useState<CreatorPost | null>(null);
  const [analysing, setAnalysing] = useState<string | null>(null);
  const [shownAnalysis, setShownAnalysis] = useState<{ who: string; data: ContentAnalysis } | null>(null);

  /** Un seul champ : la route reconnaît un profil, un pseudo ou une publication. */
  const resolve = async (value: string, deep?: number) => {
    if (!value.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ kind: string; username?: string; created?: number; already?: boolean }>(
        "/api/creators/resolve",
        { method: "POST", body: JSON.stringify(deep === undefined ? { input: value } : { input: value, deep }) },
      );
      await Promise.all([creators.reload(), posts.reload(), saved.reload()]);
      setInput("");
      toast(
        r.kind === "creator"
          ? `@${r.username} suivi — ${r.created ?? 0} nouveaux posts.`
          : r.already
            ? "Ce reel est déjà en production."
            : "Envoyé en production.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** Une seule ecriture serveur : plus de publications orphelines. */
  const removeCreator = async (c: Creator) => {
    await api("/api/creators/remove", {
      method: "POST",
      body: JSON.stringify({ username: c.username }),
    });
    await Promise.all([creators.reload(), posts.reload()]);
    if (active === c.username) setActive("");
  };

  /** Diagnostic IA : sans pseudo, l'analyse porte sur mon propre compte. */
  const analyse = async (who: string) => {
    setAnalysing(who);
    try {
      const r = await api<{ analysis: ContentAnalysis }>("/api/ai/profile-analysis", {
        method: "POST",
        body: JSON.stringify(who ? { creator: who } : {}),
      });
      setShownAnalysis({ who: `@${who}`, data: r.analysis });
      void creators.reload();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setAnalysing(null);
    }
  };

  const engagement = (p: CreatorPost) => p.likes + p.comments;
  const savedUrls = useMemo(() => new Set(saved.rows.map((r) => r.permalink)), [saved.rows]);

  /*
   * Rendu progressif.
   *
   * Sans plafond, la grille monte 1 610 vignettes d'un coup quand aucun
   * createur n'est selectionne : le navigateur bloque plusieurs secondes sur
   * la mise en page. On en pose 60, puis on etend a la demande.
   */
  const PAGE = 60;
  const [visible, setVisible] = useState(PAGE);

  const shown = useMemo(() => {
    const rows = posts.rows.filter((p) => {
      if (active && p.creator !== active) return false;
      if (reelsOnly && !p.isReel) return false;
      return true;
    });
    return rows.sort((a, b) => {
      if (sort === "recent") return b.timestamp.localeCompare(a.timestamp);
      if (sort === "comments") return b.comments - a.comments;
      if (sort === "likes") return b.likes - a.likes;
      return engagement(b) - engagement(a);
    });
  }, [posts.rows, active, reelsOnly, sort]);

  // Changer de createur, de tri ou de filtre repart du haut de la liste.
  useEffect(() => {
    setVisible(PAGE);
  }, [active, reelsOnly, sort]);

  if (creators.loading && posts.loading) return <SkPage />;

  return (
    <>
      <PageHeader title="Content" />

      {/* Collage universel : c'est le point d'entrée de toute la page. */}
      <Card className="mb-4">
        <div className="flex gap-2 items-end flex-wrap">
          <Field label="Colle un lien de reel, un lien de profil, ou un pseudo" className="flex-1 min-w-[260px]">
            <input
              className="input"
              placeholder="instagram.com/reel/… ou @createur"
              value={input}
              disabled={busy}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void resolve(input)}
            />
          </Field>
          <button className="btn btn-primary" disabled={busy || !input.trim()} onClick={() => void resolve(input)}>
            {busy ? "…" : "Ajouter"}
          </button>
        </div>
        {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}

      </Card>

      {shownAnalysis && (
        <Card
          title={`Ce que produit ${shownAnalysis.who}`}
          subtitle={`${shownAnalysis.data.posts} publications lues`}
          className="mb-4"
          actions={
            <button className="btn btn-sm btn-ghost" onClick={() => setShownAnalysis(null)}>✕</button>
          }
        >
          <div className="flex flex-col gap-3.5">
            <p className="text-[13.5px] font-medium leading-snug">{shownAnalysis.data.resume}</p>

            <div className="flex flex-col gap-1.5">
              {shownAnalysis.data.types.map((t) => (
                <div key={t.nom} className="flex items-center gap-2.5">
                  <span className="text-[12.5px] font-medium" style={{ width: 160 }}>{t.nom}</span>
                  <span className="flex-1 rounded-full overflow-hidden" style={{ height: 6, background: "var(--surface-3)" }}>
                    <span
                      className="block h-full rounded-full ig-grad"
                      style={{ width: `${Math.max(2, Math.min(t.part, 100))}%` }}
                    />
                  </span>
                  <span className="num text-[12px] font-semibold" style={{ width: 38, textAlign: "right" }}>
                    {t.part}%
                  </span>
                </div>
              ))}
            </div>

            <div className="grid sm:grid-cols-3 gap-3">
              {([
                ["Accroches", shownAnalysis.data.hooks],
                ["Appels à l'action", shownAnalysis.data.cta],
                ["À retenir", shownAnalysis.data.aRetenir],
              ] as [string, string[]][]).map(([label, items]) => (
                <div key={label}>
                  <div className="label-xs mb-1.5">{label}</div>
                  <ul className="flex flex-col gap-1">
                    {items.map((x, i) => (
                      <li key={i} className="text-[12px] muted leading-snug">• {x}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      {playing && (
        <Modal open onClose={() => setPlaying(null)} title={playing.creator}>
          <div className="flex flex-col gap-3">
            {/* La source resout le flux via yt-dlp puis redirige vers le CDN. */}
            <video
              src={`/api/creators/media?url=${encodeURIComponent(playing.permalink)}`}
              controls
              autoPlay
              playsInline
              className="w-full rounded-[9px]"
              style={{ maxHeight: "70vh", background: "#000" }}
            />
            <div className="flex items-center gap-2 flex-wrap">
              <a
                className="btn btn-sm btn-primary"
                href={`/api/creators/media?url=${encodeURIComponent(playing.permalink)}&download=1`}
              >
                Télécharger
              </a>
              <a className="btn btn-sm" href={playing.permalink} target="_blank" rel="noreferrer">
                Instagram
              </a>
              <span className="dim text-[11.5px] num ml-auto">
                {fmtCompact(playing.likes)} likes · {fmtCompact(playing.comments)} comm.
              </span>
            </div>
            <p className="dim text-[11.5px] leading-snug">
              Le chargement prend quelques secondes : le flux est résolu à la demande, les liens Instagram
              expirant très vite.
            </p>
          </div>
        </Modal>
      )}

      <div className="grid lg:grid-cols-[248px_1fr] gap-4 items-start">
        {/* Colonne des créateurs suivis */}
        <Card title="Mes créateurs" subtitle={`${creators.rows.length} suivis`} padded={false}>
          {!creators.rows.length ? (
            <Empty>Colle un lien de profil pour commencer.</Empty>
          ) : (
            <ul>
              {creators.rows.map((c, i) => {
                const mine = posts.rows.filter((p) => p.creator === c.username);
                const on = active === c.username;
                return (
                  <li
                    key={c.id}
                    className="row-hover px-3 py-2.5 flex items-center gap-2.5 cursor-pointer"
                    style={{
                      borderBottom: i < creators.rows.length - 1 ? "1px solid var(--border)" : "none",
                      background: on ? "var(--accent-soft)" : undefined,
                    }}
                    onClick={() => {
                      const next = on ? "" : c.username;
                      setActive(next);
                      // Diagnostic deja calcule : on l'affiche sans rappeler l'IA.
                      setShownAnalysis(next && c.analysis ? { who: `@${c.username}`, data: c.analysis } : null);
                    }}
                  >
                    {c.profilePicture ? (
                      <img
                        src={c.profilePicture}
                        alt=""
                        className="rounded-full object-cover shrink-0"
                        style={{ width: 32, height: 32 }}
                      />
                    ) : (
                      <span
                        className="rounded-full grid place-items-center shrink-0 text-[12px] font-semibold"
                        style={{ width: 32, height: 32, background: "var(--surface-3)" }}
                      >
                        {c.username.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] font-semibold truncate">@{c.username}</span>
                      <span className="block dim text-[10.5px] num">
                        {fmtCompact(c.followers)} abonnés · {mine.length} posts
                      </span>
                    </span>
                    <span className="flex flex-col gap-0.5 shrink-0">
                      <button
                        className="btn btn-sm !px-1.5"
                        title="Analyser ce que produit ce créateur"
                        disabled={analysing !== null}
                        onClick={(e) => { e.stopPropagation(); void analyse(c.username); }}
                        style={c.analysis ? { borderColor: "var(--emerald)", color: "var(--emerald)" } : undefined}
                      >
                        {analysing === c.username ? "…" : c.analysis ? "✓ IA" : "IA"}
                      </button>
                      <button
                        className="btn btn-ghost btn-sm !px-1"
                        title="Tout récupérer : remonte jusqu'à la première publication"
                        onClick={(e) => { e.stopPropagation(); void resolve(c.username, 0); }}
                      >
                        ↻
                      </button>
                      <button
                        className="btn btn-danger btn-sm !px-1"
                        title="Retirer"
                        onClick={(e) => { e.stopPropagation(); void removeCreator(c); }}
                      >
                        ✕
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* Les reels des créateurs suivis */}
        <div className="flex flex-col gap-4">
          {active && !shownAnalysis && (
            <Card>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <span className="text-[12.5px] muted">
                  Pas encore d&apos;analyse pour <strong>@{active}</strong>.
                </span>
                <button
                  className="btn btn-sm btn-primary"
                  disabled={analysing !== null}
                  onClick={() => void analyse(active)}
                >
                  {analysing === active ? "Analyse…" : "Analyser son contenu"}
                </button>
              </div>
            </Card>
          )}

          {posts.rows.length > 0 && (
          <Card
            title={active ? `@${active}` : "Tous les reels suivis"}
            subtitle={`${shown.length} sur ${posts.rows.length}`}
            actions={
              <span className="flex items-center gap-1.5">
                <Tabs value={sort} onChange={setSort} options={SORTS} />
                <button
                  className="btn btn-sm"
                  onClick={() => setReelsOnly((v) => !v)}
                  style={reelsOnly ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined}
                >
                  Reels
                </button>
              </span>
            }
          >
            {!shown.length ? (
              <Empty>Aucun post avec ces filtres.</Empty>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-5 gap-2">
                {shown.slice(0, visible).map((p) => (
                  <div
                    key={p.id}
                    className="tile relative rounded-[9px] overflow-hidden"
                    style={{ aspectRatio: "4 / 5", background: "var(--surface-3)" }}
                  >
                    <button
                      onClick={() => setPlaying(p)}
                      className="block w-full h-full text-left"
                      title="Lire la vidéo"
                    >
                      {p.thumbnail ? (
                        <img src={p.thumbnail} alt="" className="w-full h-full object-cover" loading="lazy" />
                      ) : (
                        <span className="absolute inset-0 grid place-items-center dim text-[11px] px-2 text-center">
                          {p.caption.slice(0, 50) || "Sans aperçu"}
                        </span>
                      )}
                      <span
                        className="absolute inset-x-0 bottom-0 px-2 py-1.5"
                        style={{ background: "linear-gradient(transparent, rgb(0 0 0 / 0.8))" }}
                      >
                        <span className="block text-[12px] font-semibold num" style={{ color: "#fff" }}>
                          {fmtInt(p.comments)} comm.
                        </span>
                        <span className="block text-[10.5px] num" style={{ color: "rgb(255 255 255 / 0.8)" }}>
                          {fmtCompact(p.likes)} likes
                        </span>
                      </span>
                    </button>

                    <span className="tile-actions absolute top-1.5 right-1.5 flex gap-1">
                      <a
                        href={`/api/creators/media?url=${encodeURIComponent(p.permalink)}&download=1`}
                        onClick={(e) => e.stopPropagation()}
                        className="rounded-[6px] px-1.5 py-1 text-[10.5px] font-semibold"
                        style={{ background: "rgb(0 0 0 / 0.7)", color: "#fff", backdropFilter: "blur(3px)" }}
                        title="Télécharger la vidéo"
                      >
                        ⬇
                      </a>
                      <SaveMenu
                        saved={savedUrls.has(p.permalink)}
                        onSave={(folder: ProdFolder) =>
                          void saved.create({
                            source: "creator",
                            author: p.creator,
                            permalink: p.permalink,
                            thumbnail: p.thumbnail,
                            caption: p.caption,
                            likes: p.likes,
                            comments: p.comments,
                            views: 0,
                            isReel: p.isReel,
                            folder,
                            note: "",
                          })
                        }
                      />
                    </span>
                  </div>
                ))}
              </div>
            )}

            {shown.length > visible && (
              <div className="flex justify-center pt-3">
                <button className="btn" onClick={() => setVisible((n) => n + PAGE)}>
                  Voir plus — {fmtInt(shown.length - visible)} restants
                </button>
              </div>
            )}
          </Card>
          )}
        </div>
      </div>
    </>
  );
}
