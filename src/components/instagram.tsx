"use client";

/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { api } from "@/lib/client";
import { CopyButton, ErrorNote, Modal, Spinner } from "@/components/ui";
import { fmtCompact, fmtInt, PROD_FOLDERS } from "@/lib/format";
import type { IgAudience, IgDayPoint, IgProfileSnapshot, Post, PostScript, ProdFolder } from "@/lib/types";
import type { PostInsights } from "@/lib/instagram";

/* -------------------------------- Outils -------------------------------- */

const DAY_MS = 86_400_000;

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}

function timeAgo(isoDate: string): string {
  const min = Math.round((Date.now() - new Date(isoDate).getTime()) / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} j`;
}

/** Pastille certifiée. L'API n'expose pas is_verified, c'est un réglage. */
function VerifiedBadge() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-label="Compte certifié" role="img" className="shrink-0">
      <path
        fill="#3897f0"
        d="M12 1.5l2.6 2.1 3.3-.3.9 3.2 2.9 1.7-1.3 3.1 1.3 3.1-2.9 1.7-.9 3.2-3.3-.3L12 22.5l-2.6-2.1-3.3.3-.9-3.2L2.3 15.8l1.3-3.1-1.3-3.1 2.9-1.7.9-3.2 3.3.3z"
      />
      <path fill="#fff" d="M10.6 15.3l-2.9-2.9 1.3-1.3 1.6 1.6 4.4-4.4 1.3 1.3z" />
    </svg>
  );
}

/* -------------------------------- Profil --------------------------------- */

function Metric({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div>
      <div className="text-[17px] font-semibold num tracking-tight" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
      <div className="dim text-[11px] mt-0.5">{label}</div>
    </div>
  );
}

/**
 * Prochain palier : 10k d'abord, puis tous les 5 000.
 */
function nextMilestone(followers: number): number {
  if (followers < 10_000) return 10_000;
  return (Math.floor(followers / 5_000) + 1) * 5_000;
}

function kLabel(n: number): string {
  return n % 1000 === 0 ? `${n / 1000}k` : fmtInt(n);
}

/** Progression dans le palier courant, avec l'etincelle en bout de barre. */
function RoadBar({ followers }: { followers: number }) {
  const target = nextMilestone(followers);
  const floor = target - 5_000;
  // Plancher a 2 % pour que l'etincelle reste visible en debut de palier.
  const pct = Math.max(2, Math.min(((followers - floor) / 5_000) * 100, 100));

  return (
    <div className="mt-2" style={{ width: 134 }}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="label-xs">Road {kLabel(target)}</span>
        <span className="dim text-[10px] num">{fmtInt(target - followers)}</span>
      </div>
      <div className="relative mt-1">
        <div className="rounded-full overflow-hidden" style={{ height: 5, background: "var(--surface-3)" }}>
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{
              width: `${pct}%`,
              background:
                "linear-gradient(90deg, color-mix(in srgb, var(--emerald) 45%, transparent), var(--emerald))",
            }}
          />
        </div>
        <span
          className="ig-spark absolute text-[11px] leading-none pointer-events-none"
          style={{ left: `${pct}%`, top: -4 }}
          aria-hidden
        >
          ✨
        </span>
      </div>
    </div>
  );
}

export function IgProfileCard({
  profile,
  verified,
  channelMembers,
  onRefresh,
  refreshing,
  warning,
}: {
  profile: IgProfileSnapshot;
  verified: boolean;
  channelMembers: number;
  onRefresh: () => void;
  refreshing: boolean;
  warning?: string | null;
}) {
  // Le net des 7 derniers jours donne le rythme réel, pertes comprises.
  const net7 = profile.history.slice(-7).reduce((a, d) => a + d.net, 0);

  return (
    <section
      className="card overflow-hidden mb-4"
      style={{
        background:
          "linear-gradient(135deg, color-mix(in srgb, var(--accent) 7%, var(--surface)) 0%, var(--surface) 55%)",
      }}
    >
      <div className="p-4 flex flex-wrap items-start gap-4">
        <a
          href={`https://instagram.com/${profile.username}`}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 rounded-full"
          style={{ padding: 2, background: "linear-gradient(45deg,#f09433,#dc2743,#bc1888)" }}
          title="Ouvrir le profil Instagram"
        >
          {profile.profilePictureUrl ? (
            <img
              src={profile.profilePictureUrl}
              alt={profile.username}
              className="rounded-full block object-cover"
              style={{ width: 64, height: 64, border: "2px solid var(--surface)" }}
            />
          ) : (
            <span
              className="rounded-full grid place-items-center text-[20px] font-semibold"
              style={{ width: 64, height: 64, background: "var(--surface-3)", border: "2px solid var(--surface)" }}
            >
              {profile.username.slice(0, 1).toUpperCase()}
            </span>
          )}
        </a>

        <div className="flex-1 min-w-[200px]">
          <div className="flex items-center gap-1.5 flex-wrap">
            <h2 className="text-[16px] font-semibold tracking-tight">{profile.name}</h2>
            {verified && <VerifiedBadge />}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <a
              href={`https://instagram.com/${profile.username}`}
              target="_blank"
              rel="noreferrer"
              className="muted text-[12.5px] hover:underline"
            >
              @{profile.username}
            </a>
            {channelMembers > 0 && (
              <span className="badge badge-accent !text-[10.5px] !py-0" title="Membres de ton canal de diffusion">
                ✦ {fmtInt(channelMembers)} au canal
              </span>
            )}
          </div>
          {profile.biography && (
            <p className="dim text-[11.5px] mt-1.5 leading-snug whitespace-pre-line line-clamp-2">
              {profile.biography}
            </p>
          )}
        </div>

        <div className="flex gap-6 items-start">
          <div>
            <Metric label="Abonnés" value={fmtInt(profile.followers)} />
            <RoadBar followers={profile.followers} />
          </div>
          <Metric label="Abonnements" value={fmtInt(profile.follows)} />
          <Metric label="Publications" value={fmtInt(profile.mediaCount)} />
          {net7 !== 0 && (
            <Metric
              label="Net 7 j"
              value={`${net7 > 0 ? "+" : ""}${fmtInt(net7)}`}
              accent={net7 > 0 ? "var(--emerald)" : "var(--critical)"}
            />
          )}
        </div>
      </div>

      <div
        className="px-4 py-2.5 flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t"
        style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}
      >
        <span className="label-xs">Aujourd&apos;hui</span>
        <span className="text-[12px]">
          <span className="num font-semibold">{fmtCompact(profile.reach)}</span> <span className="dim">comptes touchés</span>
        </span>
        <span className="text-[12px]">
          <span className="num font-semibold">{fmtInt(profile.profileVisits)}</span> <span className="dim">visites profil</span>
        </span>
        <span className="text-[12px]" title={profile.website || undefined}>
          <span className="num font-semibold">{fmtInt(profile.linkClicks)}</span> <span className="dim">clics sur le lien bio</span>
        </span>
        <span className="text-[12px]">
          <span className="num font-semibold">{fmtInt(profile.accountsEngaged)}</span> <span className="dim">comptes engagés</span>
        </span>

        <span className="ml-auto flex items-center gap-2">
          <span className="dim text-[11px]">{warning ? "Cache" : "Synchro"} {timeAgo(profile.fetchedAt)}</span>
          <button className="btn btn-sm" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? <span className="spinner" /> : "Actualiser"}
          </button>
        </span>
      </div>

      {warning && (
        <div
          className="px-4 py-2 text-[11.5px]"
          style={{ background: "color-mix(in srgb, var(--warning) 12%, transparent)", color: "var(--text-2)" }}
        >
          Dernier profil connu affiché — {warning}
        </div>
      )}
    </section>
  );
}

/* ------------------------------- Calendrier ------------------------------ */

const MONTHS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];
const DOW = ["L", "M", "M", "J", "V", "S", "D"];

export function Calendar({
  from,
  to,
  onSelect,
}: {
  from: string;
  to: string;
  onSelect: (from: string, to: string) => void;
}) {
  const [cursor, setCursor] = useState(() => {
    const d = new Date(`${to || iso(new Date())}T00:00:00Z`);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  });
  // Première borne cliquée, en attente de la seconde.
  const [pending, setPending] = useState<string | null>(null);

  const today = iso(new Date());
  const year = cursor.getUTCFullYear();
  const month = cursor.getUTCMonth();

  const cells = useMemo(() => {
    const first = new Date(Date.UTC(year, month, 1));
    // getUTCDay : 0 = dimanche. On veut lundi en tête.
    const lead = (first.getUTCDay() + 6) % 7;
    const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const out: (string | null)[] = Array(lead).fill(null);
    for (let d = 1; d <= count; d++) out.push(iso(new Date(Date.UTC(year, month, d))));
    return out;
  }, [year, month]);

  const shift = (delta: number) => setCursor(new Date(Date.UTC(year, month + delta, 1)));

  const click = (date: string) => {
    if (!pending) {
      setPending(date);
      return;
    }
    const [a, b] = pending <= date ? [pending, date] : [date, pending];
    setPending(null);
    onSelect(a, b);
  };

  return (
    <div className="p-3" style={{ width: 268 }}>
      <div className="flex items-center justify-between mb-2">
        <button className="btn btn-ghost btn-sm" onClick={() => shift(-1)} aria-label="Mois précédent">‹</button>
        <span className="text-[12.5px] font-semibold">
          {MONTHS[month]} {year}
        </span>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => shift(1)}
          disabled={year === new Date().getUTCFullYear() && month >= new Date().getUTCMonth()}
          aria-label="Mois suivant"
        >
          ›
        </button>
      </div>

      <div className="grid grid-cols-7 gap-[2px] mb-1">
        {DOW.map((d, i) => (
          <span key={i} className="dim text-[10px] text-center">{d}</span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-[2px]">
        {cells.map((date, i) => {
          if (!date) return <span key={i} />;
          const future = date > today;
          const inRange = !pending && date >= from && date <= to;
          const edge = date === from || date === to || date === pending;
          return (
            <button
              key={date}
              disabled={future}
              onClick={() => click(date)}
              className="h-[26px] rounded-[6px] text-[11.5px] num transition-colors"
              style={{
                background: edge ? "var(--accent)" : inRange ? "var(--accent-soft)" : "transparent",
                color: edge ? "var(--accent-on)" : future ? "var(--text-3)" : "var(--text)",
                opacity: future ? 0.4 : 1,
                cursor: future ? "not-allowed" : "pointer",
              }}
            >
              {Number(date.slice(8))}
            </button>
          );
        })}
      </div>

      <p className="dim text-[11px] mt-2 leading-snug">
        {pending ? "Clique la date de fin." : "Clique la date de début, puis celle de fin."}
      </p>
    </div>
  );
}

/* --------------------------- Courbe gagnés/perdus ------------------------ */

/** Lissage par milieux de segments : joli sans inventer de valeurs extrêmes. */
function smooth(pts: { x: number; y: number }[]): string {
  if (!pts.length) return "";
  if (pts.length < 3) return `M ${pts.map((p) => `${p.x} ${p.y}`).join(" L ")}`;

  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    d += ` Q ${pts[i].x} ${pts[i].y} ${mx} ${my}`;
  }
  const last = pts[pts.length - 1];
  return `${d} L ${last.x} ${last.y}`;
}

export function GrowthChart({ history, height = 132 }: { history: IgDayPoint[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const W = 1000;
  const PAD = 10;
  const days = history;

  const max = useMemo(
    () => Math.max(...days.map((d) => Math.max(d.gained, d.lost)), 1),
    [days],
  );

  const geom = useMemo(() => {
    const x = (i: number) => (days.length < 2 ? W / 2 : (i / (days.length - 1)) * W);
    const y = (v: number) => height - PAD - (v / max) * (height - PAD * 2);
    const gained = days.map((d, i) => ({ x: x(i), y: y(d.gained) }));
    const lost = days.map((d, i) => ({ x: x(i), y: y(d.lost) }));
    return { x, y, gained, lost };
  }, [days, max, height]);

  if (!days.length) {
    return <p className="dim text-[12.5px] py-6 text-center">Aucune donnée sur cette période.</p>;
  }

  const move = (e: React.MouseEvent) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const ratio = (e.clientX - box.left) / box.width;
    setHover(Math.max(0, Math.min(days.length - 1, Math.round(ratio * (days.length - 1)))));
  };

  const shown = hover !== null ? days[hover] : null;
  const measurable = days.some((d) => d.known);

  return (
    <div>
      <div
        ref={ref}
        className="relative"
        style={{ height }}
        onMouseMove={move}
        onMouseLeave={() => setHover(null)}
      >
        <svg
          width="100%"
          height={height}
          viewBox={`0 0 ${W} ${height}`}
          preserveAspectRatio="none"
          className="block overflow-visible"
        >
          <defs>
            <linearGradient id="ig-gain" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--emerald)" stopOpacity="0.24" />
              <stop offset="100%" stopColor="var(--emerald)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Aire sous les gains */}
          <path
            d={`${smooth(geom.gained)} L ${W} ${height - PAD} L 0 ${height - PAD} Z`}
            fill="url(#ig-gain)"
          />

          {/* Perdus d'abord : la courbe verte reste au-dessus */}
          <path
            d={smooth(geom.lost)}
            fill="none"
            stroke="var(--critical)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={smooth(geom.gained)}
            fill="none"
            stroke="var(--emerald)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />

          {hover !== null && (
            <>
              <line
                x1={geom.x(hover)}
                x2={geom.x(hover)}
                y1={PAD - 6}
                y2={height - PAD}
                stroke="var(--border-strong)"
                strokeWidth={1}
                strokeDasharray="3 3"
                vectorEffect="non-scaling-stroke"
              />
              <circle cx={geom.x(hover)} cy={geom.y(days[hover].gained)} r={3.5} fill="var(--emerald)"
                stroke="var(--surface)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
              {days[hover].known && (
                <circle cx={geom.x(hover)} cy={geom.y(days[hover].lost)} r={3.5} fill="var(--critical)"
                  stroke="var(--surface)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
              )}
            </>
          )}
        </svg>
      </div>

      <div className="flex justify-between dim text-[10.5px] mt-1 num">
        <span>{days[0].date.slice(8)}/{days[0].date.slice(5, 7)}</span>
        <span>{days[days.length - 1].date.slice(8)}/{days[days.length - 1].date.slice(5, 7)}</span>
      </div>

      <p className="dim text-[11.5px] pt-2 leading-snug min-h-[30px]">
        {shown ? (
          <>
            <strong className="num">{shown.date}</strong> · <span style={{ color: "var(--emerald)" }}>+{shown.gained}</span>
            {shown.known ? (
              <>
                {" "}<span style={{ color: "var(--critical)" }}>−{shown.lost}</span> · net {shown.net > 0 ? "+" : ""}
                {shown.net} · {fmtCompact(shown.reach)} comptes touchés
              </>
            ) : (
              <> gagné{shown.gained > 1 ? "s" : ""} · pertes non mesurables ce jour · {fmtCompact(shown.reach)} comptes touchés</>
            )}
          </>
        ) : measurable ? (
          <>Survole la courbe pour le détail d&apos;un jour.</>
        ) : (
          <>
            La courbe rouge reste à zéro : Meta ne publie pas les désabonnements, ils se déduisent de deux relevés
            quotidiens consécutifs. Le premier date d&apos;aujourd&apos;hui, les pertes apparaîtront dès demain.
          </>
        )}
      </p>
    </div>
  );
}

/* ------------------------- Panneau avec sélecteur ------------------------ */

const PRESETS = [7, 14, 30];

export function GrowthPanel({ initial, compact = false }: { initial: IgDayPoint[]; compact?: boolean }) {
  const [days, setDays] = useState(30);
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);
  const [openCal, setOpenCal] = useState(false);
  const [fetched, setFetched] = useState<IgDayPoint[] | null>(null);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 7/14/30 se découpent dans l'instantané déjà chargé : aucun appel réseau.
  const history = custom ? (fetched ?? []) : initial.slice(-days);

  const load = useCallback(async (from: string, to: string) => {
    setLoading(true);
    setError(null);
    try {
      const r = await api<{ history: IgDayPoint[]; gainsMissing?: boolean }>(
        `/api/instagram/history?since=${from}&until=${to}`,
      );
      setFetched(r.history);
      setStale(Boolean(r.gainsMissing));
    } catch (e) {
      setError((e as Error).message);
      setFetched([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (custom) void load(custom.from, custom.to);
  }, [custom, load]);

  const totals = history.reduce(
    (a, d) => ({ gained: a.gained + d.gained, lost: a.lost + d.lost, net: a.net + d.net }),
    { gained: 0, lost: 0, net: 0 },
  );

  const defaultFrom = custom?.from ?? iso(new Date(Date.now() - 29 * DAY_MS));
  const defaultTo = custom?.to ?? iso(new Date());

  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div className="flex items-baseline gap-4 flex-wrap">
          <span className="text-[12.5px]">
            <span className="num font-semibold" style={{ color: "var(--emerald)" }}>+{fmtInt(totals.gained)}</span>{" "}
            <span className="dim">gagnés</span>
          </span>
          <span className="text-[12.5px]">
            <span className="num font-semibold" style={{ color: "var(--critical)" }}>−{fmtInt(totals.lost)}</span>{" "}
            <span className="dim">perdus</span>
          </span>
          <span className="text-[12.5px]">
            <span className="num font-semibold">{totals.net > 0 ? "+" : ""}{fmtInt(totals.net)}</span>{" "}
            <span className="dim">net</span>
          </span>
        </div>

        <div className="flex items-center gap-1 relative">
          {PRESETS.map((d) => {
            const active = !custom && days === d;
            return (
              <button
                key={d}
                onClick={() => { setCustom(null); setStale(false); setDays(d); setOpenCal(false); }}
                className="px-2.5 h-[26px] rounded-[7px] text-[12px] font-medium num transition-colors"
                style={{
                  background: active ? "var(--accent)" : "var(--surface-3)",
                  color: active ? "var(--accent-on)" : "var(--text-2)",
                }}
              >
                {d} j
              </button>
            );
          })}
          <button
            onClick={() => setOpenCal((v) => !v)}
            className="px-2.5 h-[26px] rounded-[7px] text-[12px] font-medium transition-colors"
            style={{
              background: custom ? "var(--accent)" : "var(--surface-3)",
              color: custom ? "var(--accent-on)" : "var(--text-2)",
            }}
            title="Choisir une période"
          >
            {custom ? `${custom.from.slice(5)} → ${custom.to.slice(5)}` : "📅"}
          </button>

          {openCal && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setOpenCal(false)} />
              <div
                className="card absolute right-0 top-[30px] z-50 fade-in"
                style={{ boxShadow: "var(--shadow)" }}
              >
                <Calendar
                  from={defaultFrom}
                  to={defaultTo}
                  onSelect={(from, to) => { setCustom({ from, to }); setOpenCal(false); }}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {stale && !loading && (
        <div
          className="rounded-lg px-3 py-2 text-[11.5px] leading-snug mb-3"
          style={{ background: "color-mix(in srgb, var(--warning) 12%, transparent)", color: "var(--text-2)" }}
        >
          Instagram ne conserve les abonnés gagnés que sur environ 30 jours. Sur cette période Meta ne renvoie
          plus que la portée — choisis une plage plus récente pour voir la courbe verte.
        </div>
      )}

      {loading ? (
        <div className="py-10 text-center"><span className="spinner" /></div>
      ) : error ? (
        <p className="dim text-[12.5px] py-6 text-center">{error}</p>
      ) : (
        <GrowthChart history={history} height={compact ? 84 : 132} />
      )}
    </div>
  );
}

/* --------------------------- Derniers reels ----------------------------- */

/** Taux d'engagement : interactions rapportees aux vues. */
function engagementRate(p: { views: number; likes: number; comments: number; saves: number; shares: number }) {
  if (!p.views) return 0;
  return ((p.likes + p.comments + p.saves + p.shares) / p.views) * 100;
}

function pct(n: number) {
  return `${n.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
}

function watch(sec: number | null) {
  if (sec === null) return "—";
  if (sec < 60) return `${sec} s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m} min ${String(sec % 60).padStart(2, "0")}`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
}

/**
 * Les dernieres publications, avec leurs chiffres, cliquables.
 *
 * C'est la vue « qu'est-ce qui s'est passe depuis hier » : on ouvre le
 * dashboard le matin et on voit tout de suite comment le reel de la veille
 * tourne. Le detail au clic redemande les chiffres a Meta.
 */
export function RecentReels({ posts, limit = 8 }: { posts: Post[]; limit?: number }) {
  const [open, setOpen] = useState<Post | null>(null);
  const recent = useMemo(
    () =>
      posts
        .filter((p) => p.status === "publie" && p.igMediaId)
        .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
        .slice(0, limit),
    [posts, limit],
  );

  if (!recent.length) {
    return <p className="dim text-[12.5px] px-4 py-6 text-center">Aucune publication synchronisée pour l&apos;instant.</p>;
  }

  return (
    <>
      <div className="hidden sm:grid grid-cols-[1fr_repeat(6,64px)] gap-2 px-4 py-2 label-xs" style={{ borderBottom: "1px solid var(--border)" }}>
        <span>Publication</span>
        <span className="text-right">Vues</span>
        <span className="text-right">Likes</span>
        <span className="text-right">Comm.</span>
        <span className="text-right">Saves</span>
        <span className="text-right">Partages</span>
        <span className="text-right">Engag.</span>
      </div>
      <ul>
        {recent.map((p) => (
          <li key={p.id} style={{ borderBottom: "1px solid var(--border)" }}>
            <button
              type="button"
              onClick={() => setOpen(p)}
              className="row-hover w-full text-left grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_repeat(6,64px)] gap-2 items-center px-4 py-2"
              title="Voir le détail"
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <span className="relative shrink-0 rounded-[6px] overflow-hidden" style={{ width: 34, height: 42, background: "var(--surface-3)" }}>
                  {p.thumbnail && <Thumb src={p.thumbnail} title="" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-[12.5px] font-medium truncate">{p.title}</span>
                  <span className="block dim text-[11px]">
                    {timeAgo(p.publishedAt)} · {p.format.startsWith("reel") ? "Reel" : p.format === "carrousel" ? "Carrousel" : "Photo"}
                  </span>
                </span>
              </span>
              <span className="num text-[12.5px] text-right font-medium sm:font-normal">{fmtCompact(p.views)}<span className="sm:hidden dim text-[10.5px]"> vues</span></span>
              <span className="num text-[12.5px] text-right hidden sm:block">{fmtCompact(p.likes)}</span>
              <span className="num text-[12.5px] text-right hidden sm:block">{fmtCompact(p.comments)}</span>
              <span className="num text-[12.5px] text-right hidden sm:block">{fmtCompact(p.saves)}</span>
              <span className="num text-[12.5px] text-right hidden sm:block">{fmtCompact(p.shares)}</span>
              <span className="num text-[12.5px] text-right hidden sm:block" style={{ color: engagementRate(p) >= 5 ? "var(--emerald)" : undefined }}>
                {pct(engagementRate(p))}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <ReelDetailModal post={open} onClose={() => setOpen(null)} />
    </>
  );
}

function Bars({ rows, total, label }: { rows: { key: string; value: number }[]; total: number; label: (k: string) => string }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map((r) => {
        const share = total ? (r.value / total) * 100 : 0;
        return (
          <li key={r.key} className="grid grid-cols-[110px_1fr_48px] items-center gap-2 text-[12px]">
            <span className="truncate" title={label(r.key)}>{label(r.key)}</span>
            <span className="h-[6px] rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
              <span className="block h-full rounded-full" style={{ width: `${Math.max(share, 1)}%`, background: "var(--accent)" }} />
            </span>
            <span className="num text-right dim">{pct(share)}</span>
          </li>
        );
      })}
    </ul>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-[10px] px-3 py-2.5" style={{ background: "var(--surface-2)" }}>
      <span className="label-xs block">{label}</span>
      <span className="num text-[18px] font-semibold block mt-0.5" style={{ letterSpacing: "-0.02em" }}>{value}</span>
      {hint && <span className="dim text-[10.5px] block">{hint}</span>}
    </div>
  );
}

const REGION = typeof Intl !== "undefined" && "DisplayNames" in Intl ? new Intl.DisplayNames(["fr"], { type: "region" }) : null;
const AGE_ORDER = ["13-17", "18-24", "25-34", "35-44", "45-54", "55-64", "65+"];

/** Detail d'une publication : chiffres a jour chez Meta et audience du compte. */
function ReelDetailModal({ post, onClose }: { post: Post | null; onClose: () => void }) {
  const [data, setData] = useState<{ insights: PostInsights; audience: IgAudience } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    if (!post) return;
    let alive = true;
    api<{ insights: PostInsights; audience: IgAudience }>(`/api/instagram/post-detail?postId=${post.id}`)
      .then((r) => { if (alive) setData(r); })
      .catch((e) => { if (alive) setError((e as Error).message); });
    return () => { alive = false; };
  }, [post]);

  if (!post) return null;

  const i = data?.insights;
  const a = data?.audience;
  const genderTotal = a ? a.gender.f + a.gender.m + a.gender.u : 0;
  const ageTotal = a ? a.age.reduce((s, r) => s + r.value, 0) : 0;
  const countryTotal = a ? a.countries.reduce((s, r) => s + r.value, 0) : 0;
  const cityTotal = a ? a.cities.reduce((s, r) => s + r.value, 0) : 0;

  return (
    <Modal open onClose={onClose} title={post.title || "Publication"} wide>
      <div className="flex flex-col gap-4">
        <div className="flex gap-3 items-start">
          <span className="relative shrink-0 rounded-[8px] overflow-hidden" style={{ width: 64, height: 80, background: "var(--surface-3)" }}>
            {post.thumbnail && <Thumb src={post.thumbnail} title="" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="dim text-[12px]">Publié {timeAgo(post.publishedAt)}</p>
            {post.caption && <p className="text-[12px] mt-1 leading-snug line-clamp-3 whitespace-pre-line">{post.caption}</p>}
            <a href={post.url} target="_blank" rel="noreferrer" className="link text-[12px] inline-block mt-1.5">
              Ouvrir sur Instagram ↗
            </a>
          </div>
        </div>

        {error ? (
          <ErrorNote>{error}</ErrorNote>
        ) : !data ? (
          <div className="py-8 text-center"><Spinner label="Chiffres en cours de récupération chez Meta…" /></div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Stat label="Vues" value={fmtInt(i!.views)} />
              <Stat label="Portée" value={fmtInt(i!.reach)} hint="comptes uniques" />
              <Stat label="Likes" value={fmtInt(i!.likes)} />
              <Stat label="Commentaires" value={fmtInt(i!.comments)} />
              <Stat label="Enregistrements" value={fmtInt(i!.saves)} />
              <Stat label="Partages" value={fmtInt(i!.shares)} />
              <Stat label="Engagement" value={pct(engagementRate({ ...i!, saves: i!.saves }))} hint="interactions / vues" />
              <Stat label="Interactions" value={fmtInt(i!.interactions)} />
              {i!.avgWatchSec !== null && <Stat label="Visionnage moyen" value={watch(i!.avgWatchSec)} hint="par vue" />}
              {i!.totalWatchSec !== null && <Stat label="Temps total visionné" value={watch(i!.totalWatchSec)} />}
            </div>

            <div>
              <div className="flex items-baseline justify-between gap-2 mb-2">
                <h4 className="text-[13px] font-semibold">Audience</h4>
                <span className="dim text-[11px]">Abonnés du compte · Instagram ne détaille pas par publication</span>
              </div>
              <div className="grid sm:grid-cols-2 gap-x-6 gap-y-4">
                <div>
                  <span className="label-xs block mb-1.5">Genre</span>
                  <Bars
                    total={genderTotal}
                    rows={[
                      { key: "m", value: a!.gender.m },
                      { key: "f", value: a!.gender.f },
                      { key: "u", value: a!.gender.u },
                    ]}
                    label={(k) => (k === "m" ? "Hommes" : k === "f" ? "Femmes" : "Non précisé")}
                  />
                </div>
                <div>
                  <span className="label-xs block mb-1.5">Âge</span>
                  <Bars
                    total={ageTotal}
                    rows={[...a!.age].sort((x, y) => AGE_ORDER.indexOf(x.key) - AGE_ORDER.indexOf(y.key))}
                    label={(k) => `${k} ans`}
                  />
                </div>
                <div>
                  <span className="label-xs block mb-1.5">Pays</span>
                  <Bars total={countryTotal} rows={a!.countries} label={(k) => REGION?.of(k) ?? k} />
                </div>
                <div>
                  <span className="label-xs block mb-1.5">Villes</span>
                  <Bars total={cityTotal} rows={a!.cities} label={(k) => k.split(",")[0]} />
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

/* --------------------------- Panneau du jour ----------------------------- */

interface StoryStats {
  count: number;
  views: number;
  reach: number;
  replies: number;
  navigation: number;
  profileVisits: number;
}

/**
 * Story du jour, cadence de reels et plan de la semaine, dans un seul bloc.
 *
 * Instagram efface les statistiques de story au bout de 24 h sans en garder
 * d'historique : ce qui n'est pas releve aujourd'hui est perdu pour toujours.
 */
export function DailyPanel({
  pictureUrl,
  username,
  story,
  reelsDone,
  reelsGoal,
  channelDone,
  channelGoal,
  onChannelChange,
  photosDone,
  photosGoal,
  plan,
  weekday,
  days,
}: {
  pictureUrl: string;
  username: string;
  story: StoryStats;
  reelsDone: number;
  reelsGoal: number;
  channelDone: number;
  channelGoal: number;
  onChannelChange: (next: number) => void;
  photosDone: number;
  photosGoal: number;
  plan: Record<string, { theme: string; objectif: string }>;
  weekday: number;
  days: string[];
}) {
  const live = story.count > 0;
  const pct = reelsGoal > 0 ? Math.min((reelsDone / reelsGoal) * 100, 100) : 0;
  const done = reelsDone >= reelsGoal;
  const chanPct = channelGoal > 0 ? Math.min((channelDone / channelGoal) * 100, 100) : 0;
  const chanDone = channelDone >= channelGoal;
  const photoPct = photosGoal > 0 ? Math.min((photosDone / photosGoal) * 100, 100) : 0;
  const photoDone = photosDone >= photosGoal;

  const cell = { borderColor: "var(--border)" };

  return (
    <section className="card overflow-hidden mb-4">
      <div className="grid md:grid-cols-2 xl:grid-cols-4">
        {/* Story du jour */}
        <div className="px-4 py-3 border-b md:border-b-0 md:border-r" style={cell}>
          <div className="flex items-center gap-3">
            <span
              className={`shrink-0 rounded-full grid place-items-center ${live ? "ig-grad" : ""}`}
              style={{ padding: 2.5, background: live ? undefined : "var(--border-strong)" }}
            >
              {pictureUrl ? (
                <img
                  src={pictureUrl}
                  alt={username}
                  className="rounded-full block object-cover"
                  style={{ width: 38, height: 38, border: "2px solid var(--surface)" }}
                />
              ) : (
                <span
                  className="rounded-full grid place-items-center text-[13px] font-semibold"
                  style={{ width: 38, height: 38, background: "var(--surface-3)", border: "2px solid var(--surface)" }}
                >
                  {username.slice(0, 1).toUpperCase()}
                </span>
              )}
            </span>
            <div className="min-w-0">
              <div className="label-xs">Story today</div>
              <p className="text-[12.5px] font-semibold mt-0.5">
                {live ? `${story.count} en ligne` : "Aucune story"}
              </p>
            </div>
          </div>

          {live && (
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-2.5">
              {([
                ["Vues", story.views],
                ["Touchés", story.reach],
                ["Navig.", story.navigation],
                ["Visites", story.profileVisits],
                ["Rép.", story.replies],
              ] as [string, number][]).map(([label, value]) => (
                <span key={label} className="text-[12px]">
                  <span className="num font-semibold">{fmtCompact(value)}</span>{" "}
                  <span className="dim">{label}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Cadence de reels */}
        <div className="px-4 py-3 border-b md:border-b-0 md:border-r" style={cell}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="label-xs">Reels du jour</span>
            <span className="text-[12px] num font-semibold" style={{ color: done ? "var(--emerald)" : undefined }}>
              {reelsDone} / {reelsGoal}
              {done && " ✓"}
            </span>
          </div>
          <div className="rounded-full overflow-hidden mt-2" style={{ height: 5, background: "var(--surface-3)" }}>
            <div
              className={done ? "h-full rounded-full" : "h-full rounded-full ig-grad"}
              style={{ width: `${pct}%`, background: done ? "var(--emerald)" : undefined }}
            />
          </div>
        </div>

        {/* Canal de diffusion : compteur manuel, aucune API cote Meta */}
        <div className="px-4 py-3 border-b xl:border-b-0 xl:border-r" style={cell}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="label-xs">Canal de diffusion</span>
            <span className="flex items-center gap-1.5">
              <button
                className="btn btn-ghost btn-sm !px-1.5"
                onClick={() => onChannelChange(Math.max(0, channelDone - 1))}
                disabled={channelDone <= 0}
                aria-label="Retirer un message"
              >
                −
              </button>
              <span
                className="text-[12px] num font-semibold"
                style={{ color: chanDone ? "var(--emerald)" : undefined }}
              >
                {channelDone} / {channelGoal}
                {chanDone && " ✓"}
              </span>
              <button
                className="btn btn-ghost btn-sm !px-1.5"
                onClick={() => onChannelChange(channelDone + 1)}
                aria-label="Ajouter un message"
              >
                +
              </button>
            </span>
          </div>
          <div className="rounded-full overflow-hidden mt-2" style={{ height: 5, background: "var(--surface-3)" }}>
            <div
              className={chanDone ? "h-full rounded-full" : "h-full rounded-full ig-grad"}
              style={{ width: `${chanPct}%`, background: chanDone ? "var(--emerald)" : undefined }}
            />
          </div>
        </div>
        {/* Publications photo : cadence hebdomadaire, pas quotidienne */}
        <div className="px-4 py-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="label-xs">Photos cette semaine</span>
            <span
              className="text-[12px] num font-semibold"
              style={{ color: photoDone ? "var(--emerald)" : undefined }}
            >
              {photosDone} / {photosGoal}
              {photoDone && " ✓"}
            </span>
          </div>
          <div className="rounded-full overflow-hidden mt-2" style={{ height: 5, background: "var(--surface-3)" }}>
            <div
              className={photoDone ? "h-full rounded-full" : "h-full rounded-full ig-grad"}
              style={{ width: `${photoPct}%`, background: photoDone ? "var(--emerald)" : undefined }}
            />
          </div>
        </div>
      </div>

      {/* Plan de la semaine, en bandeau */}
      <div className="grid grid-cols-4 sm:grid-cols-7 border-t" style={cell}>
        {[1, 2, 3, 4, 5, 6, 0].map((d) => {
          const entry = plan[String(d)];
          if (!entry) return null;
          const active = d === weekday;
          return (
            <div
              key={d}
              className="px-2.5 py-2 border-r last:border-r-0"
              style={{ ...cell, background: active ? "var(--accent-soft)" : undefined }}
              title={entry.objectif}
            >
              <div className="label-xs" style={{ color: active ? "var(--accent)" : undefined }}>
                {days[d].slice(0, 3)}
              </div>
              <p className="text-[11.5px] leading-snug mt-0.5">{entry.theme}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ------------------------------ Sauvegarde ------------------------------- */

/**
 * Bouton d'enregistrement vers la production.
 * Un clic ouvre les dossiers, un second range : l'etage de tunnel se choisit
 * ensuite sur la page Production, ou il est modifiable en masse.
 */
export function SaveMenu({
  saved,
  onSave,
  align = "right",
}: {
  saved: boolean;
  onSave: (folder: ProdFolder) => void;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);

  return (
    <span className="relative">
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="rounded-[6px] px-1.5 py-1 text-[10.5px] font-semibold"
        style={{
          background: saved ? "var(--emerald)" : "rgb(0 0 0 / 0.62)",
          color: "#fff",
          backdropFilter: "blur(3px)",
        }}
        title={saved ? "Déjà en production" : "Enregistrer en production"}
      >
        {saved ? "✓" : "＋"}
      </button>

      {open && (
        <>
          <span className="fixed inset-0 z-40" onClick={(e) => { e.preventDefault(); setOpen(false); }} />
          <span
            className="card absolute z-50 top-[26px] py-1 flex flex-col"
            style={{ [align]: 0, minWidth: 118, boxShadow: "var(--shadow)" }}
          >
            {PROD_FOLDERS.map((f) => (
              <button
                key={f.value}
                className="text-left px-2.5 py-1.5 text-[12px] hover:opacity-70"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onSave(f.value);
                  setOpen(false);
                }}
              >
                {f.label}
              </button>
            ))}
          </span>
        </>
      )}
    </span>
  );
}

/* ---------------------- Publications du format gagnant ------------------- */

function ScriptModal({ post, onClose }: { post: Post | null; onClose: () => void }) {
  const [transcript, setTranscript] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Décomposition en plans : optionnelle, jamais lancée toute seule.
  const [blueprint, setBlueprint] = useState<PostScript | null>(null);
  const [loadingPlans, setLoadingPlans] = useState(false);

  const doTranscribe = useCallback(
    async (target: Post, force = false) => {
      setLoading(true);
      setError(null);
      try {
        const r = await api<{ transcript: string }>("/api/ai/transcribe", {
          method: "POST",
          body: JSON.stringify({ postId: target.id, force }),
        });
        setTranscript(r.transcript);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const doPlans = useCallback(async () => {
    if (!post) return;
    setLoadingPlans(true);
    setError(null);
    try {
      const r = await api<{ blueprint: PostScript }>("/api/ai/script", {
        method: "POST",
        body: JSON.stringify({ postId: post.id, transcript, force: true }),
      });
      setBlueprint(r.blueprint);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingPlans(false);
    }
  }, [post, transcript]);

  useEffect(() => {
    if (!post) return;
    setError(null);
    setBlueprint(null);
    setTranscript(post.transcript ?? "");
    // Le clic sert à obtenir le texte : on transcrit tout de suite, sauf si
    // c'est déjà fait (la transcription est conservée, jamais refacturée).
    if (!post.transcript) void doTranscribe(post);
  }, [post, doTranscribe]);

  if (!post) return null;

  return (
    <Modal open onClose={onClose} title="Script de la vidéo" wide>
      <div className="flex gap-3 items-start mb-4">
        {post.thumbnail && (
          <Thumb src={post.thumbnail} title={post.title} className="rounded-[8px] shrink-0" style={{ width: 52, height: 65 }} />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium leading-snug">{post.title}</p>
          <p className="dim text-[11.5px] mt-0.5 num">
            {fmtCompact(post.views)} vues · {fmtCompact(post.saves)} saves
          </p>
        </div>
        <a
          className="btn btn-sm shrink-0"
          href={`/api/instagram/media?postId=${post.id}`}
          target="_blank"
          rel="noreferrer"
        >
          Télécharger la vidéo
        </a>
      </div>

      {loading && (
        <div className="py-10 text-center">
          <Spinner label="Transcription de la vidéo…" />
        </div>
      )}

      {error && !loading && <ErrorNote>{error}</ErrorNote>}

      {!loading && transcript && (
        <div className="flex flex-col gap-3">
          <textarea
            className="input"
            rows={9}
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            style={{ lineHeight: 1.65, fontSize: 13.5 }}
          />

          <div className="flex gap-2 flex-wrap items-center">
            <CopyButton text={transcript} label="Copier le script" />
            <button
              className="btn btn-sm"
              disabled={loading}
              onClick={() => void doTranscribe(post, true)}
            >
              Retranscrire
            </button>
            <button
              className="btn btn-sm btn-ghost ml-auto"
              disabled={loadingPlans}
              onClick={() => void doPlans()}
            >
              {loadingPlans ? "…" : blueprint ? "Regénérer les plans" : "Découper en plans de tournage"}
            </button>
          </div>

          {blueprint && blueprint.pourquoiCaMarche.length > 0 && (
            <div className="pt-1">
              <div className="label-xs mb-1.5">Pourquoi ça a marché</div>
              <ul className="flex flex-col gap-1">
                {blueprint.pourquoiCaMarche.map((x, i) => (
                  <li key={i} className="text-[12.5px] flex gap-2 leading-snug">
                    <span style={{ color: "var(--emerald)" }}>•</span>
                    <span>{x}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {blueprint && (
            <div className="flex flex-col gap-2 pt-1">
              {blueprint.plans.map((pl) => (
                <div
                  key={pl.n}
                  className="rounded-[9px] p-2.5 flex gap-2.5"
                  style={{ background: "var(--surface-3)" }}
                >
                  <span
                    className="shrink-0 rounded-full grid place-items-center text-[11px] font-bold num"
                    style={{ width: 20, height: 20, background: "var(--emerald)", color: "#fff" }}
                  >
                    {pl.n}
                  </span>
                  <div className="min-w-0 text-[12.5px] leading-snug">
                    <p className="font-medium">{pl.visuel}</p>
                    {pl.voix && <p className="muted mt-0.5">{pl.voix}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

/**
 * Miniature Instagram.
 *
 * Les URL CDN expirent en quelques jours : quand la synchro Meta ne les
 * rafraichit plus, chaque vignette affichait l'icone d'image cassee. On
 * retombe sur le titre, comme pour une publication sans miniature.
 */
function Thumb({
  src,
  title,
  className = "w-full h-full",
  style,
}: {
  src: string;
  title: string;
  className?: string;
  style?: CSSProperties;
}) {
  const [broken, setBroken] = useState(false);
  // Nouvelle URL (synchro passee) : on retente.
  useEffect(() => setBroken(false), [src]);
  if (broken) {
    return (
      <span
        className={`${className} grid place-items-center dim text-[11px] px-2 text-center`}
        style={{ background: "var(--surface-3)", ...style }}
      >
        {title}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      className={`${className} object-cover`}
      style={style}
      loading="lazy"
      onError={() => setBroken(true)}
    />
  );
}

/** Lecteur inline : evite d'etre renvoye sur Instagram pour un simple visionnage. */
function PlayerModal({ post, onClose }: { post: Post | null; onClose: () => void }) {
  if (!post) return null;
  const src = `/api/instagram/media?postId=${post.id}`;

  return (
    <Modal open onClose={onClose} title={post.title || "Reel"}>
      <div className="flex flex-col gap-3">
        <video
          src={src}
          controls
          autoPlay
          playsInline
          className="w-full rounded-[9px]"
          style={{ maxHeight: "70vh", background: "#000" }}
        />
        <div className="flex items-center gap-2 flex-wrap">
          <a className="btn btn-sm btn-primary" href={`${src}&download=1`}>
            Télécharger
          </a>
          <a className="btn btn-sm" href={post.url || undefined} target="_blank" rel="noreferrer">
            Ouvrir sur Instagram
          </a>
          <span className="dim text-[11.5px] num ml-auto">
            {fmtCompact(post.views)} vues · {fmtCompact(post.comments)} comm. · {fmtCompact(post.likes)} likes
          </span>
        </div>
      </div>
    </Modal>
  );
}

export function FormatPosts({
  posts,
  title,
  savedUrls,
  onSave,
}: {
  posts: Post[];
  title: string;
  savedUrls?: Set<string>;
  onSave?: (post: Post, folder: ProdFolder) => void;
}) {
  const [target, setTarget] = useState<Post | null>(null);
  const [playing, setPlaying] = useState<Post | null>(null);
  if (!posts.length) return null;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <span className="label-xs">{title}</span>
        <span className="dim text-[11px] num">{posts.length} publications</span>
      </div>

      {/* Pas de hauteur imposee : toutes les vignettes sont rendues et c'est la
          page qui defile. Les images sont en chargement paresseux. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-2">
        {posts.map((p) => (
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
                <Thumb src={p.thumbnail} title={p.title} />
              ) : (
                <span className="absolute inset-0 grid place-items-center dim text-[11px] px-2 text-center">
                  {p.title}
                </span>
              )}
              <span
                className="absolute inset-x-0 bottom-0 px-2 py-1.5"
                style={{ background: "linear-gradient(transparent, rgb(0 0 0 / 0.78))" }}
              >
                <span className="block text-[12px] font-semibold num" style={{ color: "#fff" }}>
                  {fmtCompact(p.views)} vues
                </span>
                <span className="block text-[10.5px] num" style={{ color: "rgb(255 255 255 / 0.8)" }}>
                  {fmtCompact(p.comments)} comm. · {fmtCompact(p.likes)} likes · {fmtCompact(p.saves)} saves
                </span>
              </span>
            </button>

            <span className="tile-actions absolute top-1.5 right-1.5 flex items-center gap-1">
              <a
                href={`/api/instagram/media?postId=${p.id}&download=1`}
                onClick={(e) => e.stopPropagation()}
                className="rounded-[6px] px-1.5 py-1 text-[10.5px] font-semibold"
                style={{ background: "rgb(0 0 0 / 0.62)", color: "#fff", backdropFilter: "blur(3px)" }}
                title="Télécharger la vidéo"
              >
                ⬇
              </a>
              {onSave && (
                <SaveMenu saved={savedUrls?.has(p.url) ?? false} onSave={(f) => onSave(p, f)} />
              )}
              <button
                onClick={() => setTarget(p)}
                className="rounded-[6px] px-1.5 py-1 text-[10.5px] font-semibold"
                style={{ background: "rgb(0 0 0 / 0.62)", color: "#fff", backdropFilter: "blur(3px)" }}
                title="Transcrire ce reel"
              >
                {p.transcript || p.hasTranscript ? "✓ Script" : "Take Script"}
              </button>
            </span>
          </div>
        ))}
      </div>

      <PlayerModal post={playing} onClose={() => setPlaying(null)} />
      <ScriptModal post={target} onClose={() => setTarget(null)} />
    </div>
  );
}
