"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useRef, useState } from "react";
import { api, useCollection } from "@/lib/client";
import { Card, Empty, ErrorNote, Field, Modal, PageHeader, Tabs, useToast } from "@/components/ui";
import { fmtCompact, fmtInt, relative } from "@/lib/format";
import { SaveMenu, Thumb } from "@/components/instagram";
import { CreatorPlayer, DownloadButton } from "@/components/CreatorPlayer";
import type { ContentAnalysis, Creator, CreatorPost, ProdFolder, SavedItem } from "@/lib/types";
import { SkPage } from "@/components/Skeleton";

/**
 * Content → Concurrence (2026-10-29).
 *
 * Un champ : un @ ou un lien de profil, et le compte est suivi. La page
 * liste mes concurrents (abonnes, nombre de videos, derniere synchro) ; un
 * clic ouvre son profil avec toutes ses videos, triees, lisibles, et son
 * analyse IA. Les comptes suivis se rafraichissent tout seuls (toutes les
 * 12 h, planificateur), le bouton ↻ force une recuperation complete.
 */

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
  const [showAnalysis, setShowAnalysis] = useState(true);
  const [syncing, setSyncing] = useState("");

  /** Un seul champ : la route reconnait un profil, un pseudo ou une publication. */
  const resolve = async (value: string, deep?: number) => {
    if (!value.trim()) return;
    setBusy(true);
    setError(null);
    if (deep !== undefined) setSyncing(value.replace(/^@/, "").toLowerCase());
    try {
      const r = await api<{ kind: string; username?: string; created?: number; already?: boolean }>("/api/creators/resolve", {
        method: "POST",
        body: JSON.stringify(deep === undefined ? { input: value } : { input: value, deep }),
        timeoutMs: 600_000,
      });
      await Promise.all([creators.reload(), posts.reload(), saved.reload()]);
      setInput("");
      if (r.kind === "creator" && r.username) {
        toast(`@${r.username} suivi — ${r.created ?? 0} nouvelle${(r.created ?? 0) > 1 ? "s" : ""} vidéo${(r.created ?? 0) > 1 ? "s" : ""}.`);
        setActive(r.username);
      } else toast(r.already ? "Ce reel est déjà en production." : "Envoyé en production.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setSyncing("");
    }
  };

  const removeCreator = async (c: Creator) => {
    if (!window.confirm(`Retirer @${c.username} et ses vidéos de la liste ?`)) return;
    await api("/api/creators/remove", { method: "POST", body: JSON.stringify({ username: c.username }) });
    await Promise.all([creators.reload(), posts.reload()]);
    if (active === c.username) setActive("");
  };

  /** Diagnostic IA de ce que produit un concurrent. */
  const analyse = async (who: string) => {
    setAnalysing(who);
    try {
      await api<{ analysis: ContentAnalysis }>("/api/ai/profile-analysis", { job: true, method: "POST", body: JSON.stringify({ creator: who }) });
      await creators.reload();
      setShowAnalysis(true);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setAnalysing(null);
    }
  };

  const engagement = (p: CreatorPost) => p.likes + p.comments;
  const savedUrls = useMemo(() => new Set(saved.rows.map((r) => r.permalink)), [saved.rows]);

  const PAGE = 60;
  const [visible, setVisible] = useState(PAGE);
  const followed = useMemo(() => new Set(creators.rows.map((c) => c.username)), [creators.rows]);

  const shown = useMemo(() => {
    const rows = posts.rows.filter((p) => {
      if (!followed.has(p.creator)) return false;
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
  }, [posts.rows, active, reelsOnly, sort, followed]);

  useEffect(() => {
    setVisible(PAGE);
  }, [active, reelsOnly, sort]);

  /* Concurrents, les plus suivis d'abord, avec leurs compteurs. */
  const competitors = useMemo(() => {
    const byCreator = new Map<string, CreatorPost[]>();
    for (const p of posts.rows) byCreator.set(p.creator, [...(byCreator.get(p.creator) ?? []), p]);
    return [...creators.rows]
      .map((c) => {
        const mine = byCreator.get(c.username) ?? [];
        const top = [...mine].sort((a, b) => engagement(b) - engagement(a))[0] ?? null;
        const avg = mine.length ? Math.round(mine.reduce((n, p) => n + engagement(p), 0) / mine.length) : 0;
        return { c, posts: mine.length, reels: mine.filter((p) => p.isReel).length, top, avg };
      })
      .sort((a, b) => b.c.followers - a.c.followers);
  }, [creators.rows, posts.rows]);

  /*
   * Auto-reparation des vignettes : un post dont la vignette pointe encore
   * vers le CDN Instagram finira en image cassee ; on resynchronise le
   * createur une fois par ouverture de page.
   */
  const repairing = useRef<Set<string>>(new Set());
  const reloadPosts = posts.reload;
  const reloadCreators = creators.reload;
  useEffect(() => {
    if (posts.loading || creators.loading) return;
    let cancelled = false;
    (async () => {
      let health: { broken: string[] } = { broken: [] };
      try {
        health = await api("/api/creators/thumb-health");
      } catch {
        return;
      }
      const todo = creators.rows.map((c) => c.username).filter((u) => health.broken.includes(u) && !repairing.current.has(u));
      for (const u of todo) {
        if (cancelled) return;
        repairing.current.add(u);
        try {
          await api("/api/creators/resolve", { method: "POST", body: JSON.stringify({ input: u, deep: 60 }) });
        } catch {
          /* on retentera a la prochaine ouverture */
        }
      }
      if (todo.length && !cancelled) {
        void reloadPosts();
        void reloadCreators();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [posts.rows, posts.loading, creators.rows, creators.loading, reloadPosts, reloadCreators]);

  if (creators.loading && posts.loading) return <SkPage />;

  const current = active ? (creators.rows.find((c) => c.username === active) ?? null) : null;
  const currentPosts = current ? posts.rows.filter((p) => p.creator === current.username) : [];

  return (
    <>
      <PageHeader title="Concurrence" subtitle="Colle un @ ou un lien de profil : le compte est suivi, ses vidéos arrivent, et tout se met à jour tout seul toutes les 12 h." />

      <Card className="mb-4">
        <div className="flex gap-2 items-end flex-wrap">
          <Field label="Un @, un lien de profil, ou un lien de reel (envoyé en production)" className="flex-1 min-w-[260px]">
            <input className="input" placeholder="@createur ou instagram.com/createur" value={input} disabled={busy} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void resolve(input)} />
          </Field>
          <button className="btn btn-primary" disabled={busy || !input.trim()} onClick={() => void resolve(input)}>
            {busy && !syncing ? "Récupération…" : "Suivre"}
          </button>
        </div>
        {error && (
          <div className="mt-3">
            <ErrorNote>{error}</ErrorNote>
          </div>
        )}
      </Card>

      {playing && (
        <Modal open onClose={() => setPlaying(null)} title={`@${playing.creator}`}>
          <div className="flex flex-col gap-3">
            <CreatorPlayer permalink={playing.permalink} src={`/api/creators/media?url=${encodeURIComponent(playing.permalink)}`} />
            <div className="flex items-center gap-2 flex-wrap">
              <DownloadButton href={`/api/creators/media?url=${encodeURIComponent(playing.permalink)}&download=1`} />
              <a className="btn btn-sm" href={playing.permalink} target="_blank" rel="noreferrer">
                Instagram ↗
              </a>
              <span className="dim text-[11.5px] num ml-auto">
                {fmtCompact(playing.likes)} likes · {fmtCompact(playing.comments)} comm.
              </span>
            </div>
            {playing.caption && <p className="text-[12.5px] leading-relaxed whitespace-pre-line max-h-[30vh] overflow-y-auto">{playing.caption}</p>}
          </div>
        </Modal>
      )}

      {current ? (
        <div className="flex flex-col gap-4">
          <button type="button" className="btn btn-sm self-start" onClick={() => setActive("")}>
            ← Tous mes concurrents
          </button>

          {/* Profil */}
          <Card>
            <div className="flex gap-4 items-start flex-wrap">
              {current.profilePicture ? (
                <img src={current.profilePicture} alt="" className="rounded-full object-cover shrink-0" style={{ width: 72, height: 72 }} />
              ) : (
                <span className="rounded-full grid place-items-center shrink-0 text-[22px] font-semibold" style={{ width: 72, height: 72, background: "var(--surface-3)" }}>
                  {current.username.slice(0, 1).toUpperCase()}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <a href={`https://www.instagram.com/${current.username}/`} target="_blank" rel="noreferrer" className="text-[20px] font-semibold hover:underline">
                    @{current.username}
                  </a>
                  {current.name && current.name !== current.username && <span className="muted text-[13px]">{current.name}</span>}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-[13px] num">
                  <span>
                    <strong>{fmtCompact(current.followers)}</strong> abonnés
                  </span>
                  <span>
                    <strong>{fmtInt(current.mediaCount)}</strong> publications sur Instagram
                  </span>
                  <span>
                    <strong>{fmtInt(currentPosts.length)}</strong> vidéos ici
                  </span>
                  <span className="dim">synchro {current.lastSync ? relative(current.lastSync) : "jamais"}</span>
                </div>
                {current.biography && <p className="muted text-[12.5px] leading-relaxed mt-2 whitespace-pre-line line-clamp-3">{current.biography}</p>}
              </div>
              <div className="flex flex-col gap-1.5 shrink-0">
                <button className="btn btn-sm btn-primary" disabled={analysing !== null} onClick={() => void analyse(current.username)} title="Ce qu'il produit : types de contenus, accroches, CTA, à retenir">
                  {analysing === current.username ? "Analyse…" : current.analysis ? "Refaire l'analyse IA" : "Analyser son contenu (IA)"}
                </button>
                <button className="btn btn-sm" disabled={busy} onClick={() => void resolve(current.username, 0)} title="Remonte jusqu'à sa première publication">
                  {syncing === current.username ? "Récupération…" : "↻ Tout récupérer"}
                </button>
                <button className="btn btn-sm btn-danger" onClick={() => void removeCreator(current)}>
                  Retirer
                </button>
              </div>
            </div>
          </Card>

          {current.analysis && showAnalysis && (
            <Card
              title={`Ce que produit @${current.username}`}
              subtitle={`${current.analysis.posts} publications lues · ${relative(current.analysis.generatedAt)}`}
              actions={
                <button className="btn btn-sm btn-ghost" onClick={() => setShowAnalysis(false)}>
                  ✕
                </button>
              }
            >
              <div className="flex flex-col gap-3.5">
                <p className="text-[13.5px] font-medium leading-snug">{current.analysis.resume}</p>
                <div className="flex flex-col gap-1.5">
                  {current.analysis.types.map((t) => (
                    <div key={t.nom} className="flex items-center gap-2.5">
                      <span className="text-[12.5px] font-medium" style={{ width: 160 }}>
                        {t.nom}
                      </span>
                      <span className="flex-1 rounded-full overflow-hidden" style={{ height: 6, background: "var(--surface-3)" }}>
                        <span className="block h-full rounded-full ig-grad" style={{ width: `${Math.max(2, Math.min(t.part, 100))}%` }} />
                      </span>
                      <span className="num text-[12px] font-semibold" style={{ width: 38, textAlign: "right" }}>
                        {t.part}%
                      </span>
                    </div>
                  ))}
                </div>
                <div className="grid sm:grid-cols-3 gap-3">
                  {(
                    [
                      ["Accroches", current.analysis.hooks],
                      ["Appels à l'action", current.analysis.cta],
                      ["À retenir", current.analysis.aRetenir],
                    ] as [string, string[]][]
                  ).map(([label, items]) => (
                    <div key={label}>
                      <div className="label-xs mb-1.5">{label}</div>
                      <ul className="flex flex-col gap-1">
                        {items.map((x, i) => (
                          <li key={i} className="text-[12px] muted leading-snug">
                            • {x}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          )}

          <PostsGrid title={`Ses vidéos`} shown={shown} total={currentPosts.length} sort={sort} setSort={setSort} reelsOnly={reelsOnly} setReelsOnly={setReelsOnly} visible={visible} more={() => setVisible((n) => n + PAGE)} onPlay={setPlaying} savedUrls={savedUrls} onSave={(p, folder) => void saved.create({ source: "creator", author: p.creator, permalink: p.permalink, thumbnail: p.thumbnail, caption: p.caption, likes: p.likes, comments: p.comments, views: 0, isReel: p.isReel, folder, note: "" })} />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Card title="Mes concurrents" subtitle={`${creators.rows.length} compte${creators.rows.length > 1 ? "s" : ""} suivi${creators.rows.length > 1 ? "s" : ""} · clique pour voir le profil et toutes ses vidéos`} padded={false}>
            {!competitors.length ? (
              <Empty>Colle un @ ou un lien de profil ci-dessus pour suivre ton premier concurrent.</Empty>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px" style={{ background: "var(--border)" }}>
                {competitors.map(({ c, posts: n, reels, top, avg }) => (
                  <button key={c.id} type="button" className="text-left flex gap-3 items-start px-4 py-3.5 hover:bg-[var(--surface-2)] transition-colors" style={{ background: "var(--surface)" }} onClick={() => setActive(c.username)}>
                    {c.profilePicture ? (
                      <img src={c.profilePicture} alt="" className="rounded-full object-cover shrink-0" style={{ width: 48, height: 48 }} />
                    ) : (
                      <span className="rounded-full grid place-items-center shrink-0 text-[16px] font-semibold" style={{ width: 48, height: 48, background: "var(--surface-3)" }}>
                        {c.username.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-semibold truncate">@{c.username}</span>
                      {c.name && c.name !== c.username && <span className="block muted text-[12px] truncate">{c.name}</span>}
                      <span className="block text-[12px] num mt-1">
                        <strong>{fmtCompact(c.followers)}</strong> abonnés · {n} vidéo{n > 1 ? "s" : ""}
                        {reels ? ` (${reels} reels)` : ""}
                        {avg ? ` · ${fmtCompact(avg)} eng. moy.` : ""}
                      </span>
                      <span className="block dim text-[11px] mt-0.5">
                        {top ? `Top : ${fmtCompact(engagement(top))} · ` : ""}synchro {c.lastSync ? relative(c.lastSync) : "jamais"}
                        {c.analysis ? " · analysé ✓" : ""}
                      </span>
                    </span>
                    {top?.thumbnail && (
                      <span className="shrink-0 rounded-md overflow-hidden" style={{ width: 38, height: 60, background: "var(--surface-3)" }}>
                        <img src={top.thumbnail} alt="" className="w-full h-full object-cover" />
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </Card>

          {posts.rows.length > 0 && (
            <PostsGrid title="Les meilleures vidéos de tous mes concurrents" shown={shown} total={posts.rows.length} sort={sort} setSort={setSort} reelsOnly={reelsOnly} setReelsOnly={setReelsOnly} visible={visible} more={() => setVisible((n) => n + PAGE)} onPlay={setPlaying} savedUrls={savedUrls} onSave={(p, folder) => void saved.create({ source: "creator", author: p.creator, permalink: p.permalink, thumbnail: p.thumbnail, caption: p.caption, likes: p.likes, comments: p.comments, views: 0, isReel: p.isReel, folder, note: "" })} showAuthor />
          )}
        </div>
      )}
    </>
  );
}

function PostsGrid({ title, shown, total, sort, setSort, reelsOnly, setReelsOnly, visible, more, onPlay, savedUrls, onSave, showAuthor }: { title: string; shown: CreatorPost[]; total: number; sort: Sort; setSort: (s: Sort) => void; reelsOnly: boolean; setReelsOnly: (f: (v: boolean) => boolean) => void; visible: number; more: () => void; onPlay: (p: CreatorPost) => void; savedUrls: Set<string>; onSave: (p: CreatorPost, folder: ProdFolder) => void; showAuthor?: boolean }) {
  return (
    <Card
      title={title}
      subtitle={`${shown.length} sur ${total}`}
      actions={
        <span className="flex flex-wrap items-center gap-1.5 min-w-0 max-w-full">
          <Tabs value={sort} onChange={setSort} options={SORTS} />
          <button className="btn btn-sm" onClick={() => setReelsOnly((v) => !v)} style={reelsOnly ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined}>
            Reels
          </button>
        </span>
      }
    >
      {!shown.length ? (
        <Empty>Aucune vidéo avec ces filtres.</Empty>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-5 gap-2">
          {shown.slice(0, visible).map((p) => (
            <div key={p.id} className="tile relative rounded-[9px] overflow-hidden" style={{ aspectRatio: "4 / 5", background: "var(--surface-3)" }}>
              <button onClick={() => onPlay(p)} className="block w-full h-full text-left" title="Lire la vidéo">
                {p.thumbnail ? <Thumb src={p.thumbnail} title={p.caption.slice(0, 50) || "Sans aperçu"} /> : <span className="absolute inset-0 grid place-items-center dim text-[11px] px-2 text-center">{p.caption.slice(0, 50) || "Sans aperçu"}</span>}
                <span className="absolute inset-x-0 bottom-0 px-2 py-1.5" style={{ background: "linear-gradient(transparent, rgb(0 0 0 / 0.8))" }}>
                  {showAuthor && (
                    <span className="block text-[10.5px] font-semibold truncate" style={{ color: "#fff" }}>
                      @{p.creator}
                    </span>
                  )}
                  <span className="block text-[12px] font-semibold num" style={{ color: "#fff" }}>
                    {fmtInt(p.comments)} comm.
                  </span>
                  <span className="block text-[10.5px] num" style={{ color: "rgb(255 255 255 / 0.8)" }}>
                    {fmtCompact(p.likes)} likes
                  </span>
                </span>
              </button>
              <span className="tile-actions absolute top-1.5 right-1.5 flex gap-1">
                <span onClick={(e) => e.stopPropagation()}>
                  <DownloadButton href={`/api/creators/media?url=${encodeURIComponent(p.permalink)}&download=1`} label="⬇" className="rounded-[6px] px-1.5 py-1 text-[10.5px] font-semibold" style={{ background: "rgb(0 0 0 / 0.7)", color: "#fff", backdropFilter: "blur(3px)" }} />
                </span>
                <SaveMenu saved={savedUrls.has(p.permalink)} onSave={(folder: ProdFolder) => onSave(p, folder)} />
              </span>
            </div>
          ))}
        </div>
      )}
      {shown.length > visible && (
        <div className="flex justify-center pt-3">
          <button className="btn" onClick={more}>
            Voir plus — {fmtInt(shown.length - visible)} restants
          </button>
        </div>
      )}
    </Card>
  );
}
