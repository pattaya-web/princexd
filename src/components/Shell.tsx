"use client";

import Link from "next/link";
import { JobsDock } from "./JobsDock";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api, useLocalState } from "@/lib/client";
import { forgetSession, useSession } from "@/lib/sales/client";
import { ViewSwitcher } from "./sales/ViewSwitcher";
import { fmtInt, fmtUsd } from "@/lib/format";

/* --------------------------- Bascule de thème -------------------------- */

type Theme = "light" | "dark" | "system";

export function ThemeToggle() {
  const [theme, setTheme] = useLocalState<Theme>("mvp-theme", "system");

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
  }, [theme]);

  const options: { value: Theme; icon: string; title: string }[] = [
    { value: "light", icon: "☀", title: "Clair" },
    { value: "dark", icon: "☾", title: "Sombre" },
    { value: "system", icon: "◐", title: "Système" },
  ];

  return (
    <div
      className="flex gap-0.5 p-0.5 rounded-full"
      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
    >
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => setTheme(o.value)}
          title={o.title}
          aria-label={`Thème ${o.title}`}
          aria-pressed={theme === o.value}
          className="w-[26px] h-[24px] rounded-full text-[12px] transition-colors"
          style={{
            background: theme === o.value ? "var(--accent)" : "transparent",
            color: theme === o.value ? "var(--accent-on)" : "var(--text-3)",
          }}
        >
          {o.icon}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------ Horloges ------------------------------- */

const ZONES = [
  { label: "Paris", tz: "Europe/Paris" },
  { label: "New York", tz: "America/New_York" },
  { label: "Dubaï", tz: "Asia/Dubai" },
];

// Formateurs construits une fois : en creer six par seconde etait inutile.
const CLOCK_FMT = ZONES.map((z) => ({
  time: new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: z.tz, hour12: false }),
  hour: new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: z.tz }),
}));

export function Clocks() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    // On n'affiche que les minutes : inutile de re-rendre a chaque seconde.
    const id = setInterval(
      () =>
        setNow((prev) => {
          const next = new Date();
          return prev && Math.floor(prev.getTime() / 60_000) === Math.floor(next.getTime() / 60_000) ? prev : next;
        }),
      1000,
    );
    return () => clearInterval(id);
  }, []);

  // Rendu vide au premier passage : l'heure serveur et l'heure client
  // ne coïncident pas et provoqueraient une erreur d'hydratation.
  if (!now) return <div style={{ height: 30 }} />;

  return (
    <div className="flex items-center gap-4">
      {ZONES.map((z, i) => {
        const time = CLOCK_FMT[i].time.format(now);
        const hour = Number(CLOCK_FMT[i].hour.format(now));
        const awake = hour >= 8 && hour < 23;
        return (
          <div key={z.tz} className="flex items-center gap-1.5" title={z.tz}>
            <span
              className="inline-block rounded-full shrink-0"
              style={{
                width: 5,
                height: 5,
                background: awake ? "var(--good)" : "var(--border-strong)",
              }}
            />
            <span className="label-xs hidden lg:inline">{z.label}</span>
            <span className="mono text-[12px]">{time}</span>
          </div>
        );
      })}
    </div>
  );
}

/* --------------------------- Widget crédits ---------------------------- */

interface CreditsPayload {
  credits: number | null;
  usd: number | null;
  eur: number | null;
  error?: string;
}

export function CreditsWidget() {
  const [data, setData] = useState<CreditsPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      setData(await api<CreditsPayload>("/api/kie/credits"));
    } catch (e) {
      setData({ credits: null, usd: null, eur: null, error: (e as Error).message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // Un rafraîchissement toutes les 2 min suffit : le solde bouge peu.
    const id = setInterval(() => void load(), 120_000);
    return () => clearInterval(id);
  }, []);

  const low = data?.credits !== null && data?.credits !== undefined && data.credits < 400;

  return (
    <div
      className="rounded-[12px] px-3.5 py-3"
      style={{
        background: "var(--surface)",
        border: `1px solid ${low ? "color-mix(in srgb, var(--warning) 45%, transparent)" : "var(--border)"}`,
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="label-xs">Crédits KIE</span>
        <button
          className="btn btn-ghost btn-sm !h-[20px] !px-1.5 !text-[11px]"
          onClick={() => void load()}
          disabled={loading}
          title="Rafraîchir"
        >
          {loading ? <span className="spinner" /> : "↻"}
        </button>
      </div>

      {data?.error ? (
        <p className="text-[12px] mt-1.5 leading-snug" style={{ color: "var(--warning)" }}>
          {data.error.includes("clé") || data.error.includes("cle") ? (
            <>
              Clé API manquante —{" "}
              <Link href="/reglages" className="link">
                configurer
              </Link>
            </>
          ) : (
            data.error
          )}
        </p>
      ) : (
        <>
          <div className="flex items-baseline gap-1.5 mt-1.5">
            <span className="text-[22px] font-medium num" style={{ letterSpacing: "-0.03em" }}>
              {data?.credits !== null && data?.credits !== undefined ? fmtInt(data.credits) : "—"}
            </span>
            <span className="dim text-[11.5px]">crédits</span>
          </div>
          <div className="flex items-center justify-between gap-2 mt-0.5">
            <span className="mono text-[11.5px]" style={{ color: low ? "var(--warning)" : "var(--text-2)" }}>
              ≈ {data?.usd !== null && data?.usd !== undefined ? fmtUsd(data.usd) : "—"}
            </span>
            {low && <span className="badge badge-warn !py-0">Bas</span>}
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------ Widget solde Higgsfield ----------------------- */

interface HiggsfieldPayload {
  configured: boolean;
  balanceUsd: number | null;
  setAt: string;
  spentUsd: number;
  jobs: number;
  remainingUsd: number | null;
  secondsLeft720p: number | null;
  error?: string;
}

/**
 * Higgsfield n'a pas d'API de solde : on affiche le montant saisi moins les
 * rendus Genjutsu livres depuis. Le crayon permet de resaisir le vrai solde
 * lu sur console.higgsfield.ai.
 */
export function HiggsfieldWidget() {
  const [data, setData] = useState<HiggsfieldPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      setData(await api<HiggsfieldPayload>("/api/higgsfield/balance"));
    } catch (e) {
      setData({ configured: false, balanceUsd: null, setAt: "", spentUsd: 0, jobs: 0, remainingUsd: null, secondsLeft720p: null, error: (e as Error).message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 120_000);
    return () => clearInterval(id);
  }, []);

  const save = async () => {
    const n = Number(draft.replace(",", "."));
    if (!Number.isFinite(n) || n < 0) return;
    setLoading(true);
    try {
      setData(await api<HiggsfieldPayload>("/api/higgsfield/balance", { method: "PATCH", body: JSON.stringify({ balanceUsd: n }) }));
      setEditing(false);
    } finally {
      setLoading(false);
    }
  };

  if (data && !data.configured) return null;

  const remaining = data?.remainingUsd ?? null;
  const low = remaining !== null && remaining < 5;

  return (
    <div
      className="rounded-[12px] px-3.5 py-3"
      style={{
        background: "var(--surface)",
        border: `1px solid ${low ? "color-mix(in srgb, var(--warning) 45%, transparent)" : "var(--border)"}`,
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="label-xs">Solde Higgsfield</span>
        <div className="flex items-center gap-1">
          <button
            className="btn btn-ghost btn-sm !h-[20px] !px-1.5 !text-[11px]"
            onClick={() => {
              setDraft(data?.balanceUsd !== null && data?.balanceUsd !== undefined ? String(data.balanceUsd) : "");
              setEditing((v) => !v);
            }}
            title="Saisir le solde lu sur console.higgsfield.ai"
          >
            ✎
          </button>
          <button className="btn btn-ghost btn-sm !h-[20px] !px-1.5 !text-[11px]" onClick={() => void load()} disabled={loading} title="Rafraîchir">
            {loading ? <span className="spinner" /> : "↻"}
          </button>
        </div>
      </div>

      {editing ? (
        <div className="flex items-center gap-1.5 mt-1.5">
          <input
            className="input num !h-[28px] !text-[12px] w-full"
            type="number"
            step="0.01"
            min="0"
            placeholder="Solde en $"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
              if (e.key === "Escape") setEditing(false);
            }}
          />
          <button className="btn btn-primary btn-sm !h-[28px]" onClick={() => void save()} disabled={loading}>
            OK
          </button>
        </div>
      ) : remaining === null ? (
        <p className="text-[12px] mt-1.5 leading-snug dim">
          Solde inconnu —{" "}
          <button className="link" onClick={() => setEditing(true)}>
            saisir
          </button>{" "}
          le montant de{" "}
          <a className="link" href="https://console.higgsfield.ai" target="_blank" rel="noreferrer">
            la console
          </a>
          .
        </p>
      ) : (
        <>
          <div className="flex items-baseline gap-1.5 mt-1.5">
            <span className="text-[22px] font-medium num" style={{ letterSpacing: "-0.03em" }}>
              {fmtUsd(remaining)}
            </span>
            <span className="dim text-[11.5px]">estimés</span>
          </div>
          <div className="flex items-center justify-between gap-2 mt-0.5">
            <span className="mono text-[11.5px]" style={{ color: low ? "var(--warning)" : "var(--text-2)" }}>
              ≈ {data?.secondsLeft720p ?? 0} s Genjutsu 720p
            </span>
            {low && <span className="badge badge-warn !py-0">Bas</span>}
          </div>
          {data && data.jobs > 0 && (
            <p className="text-[11px] mt-1 dim leading-snug">
              {data.jobs} rendu{data.jobs > 1 ? "s" : ""} déduit{data.jobs > 1 ? "s" : ""} ({fmtUsd(data.spentUsd)}) depuis ta saisie.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/* -------------------------------- Nav ---------------------------------- */

interface Today {
  reelsDone: number;
  reelsGoal: number;
  channelDone: number;
  channelGoal: number;
  storyCount: number;
  photosDone: number;
  photosGoal: number;
  theme: string;
}

/** Pastille d'objectif : verte une fois atteint. */
function Goal({ label, done, goal }: { label: string; done: number; goal: number }) {
  const ok = done >= goal;
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 h-[22px] rounded-full mono text-[10.5px] uppercase whitespace-nowrap"
      style={{
        letterSpacing: "0.03em",
        background: ok ? "color-mix(in srgb, var(--emerald) 10%, var(--surface))" : "var(--surface)",
        border: `1px solid ${ok ? "color-mix(in srgb, var(--emerald) 30%, transparent)" : "var(--border)"}`,
        color: ok ? "var(--emerald)" : "var(--text-2)",
      }}
      title={`${label} : ${done} sur ${goal}`}
    >
      <span>{label}</span>
      <span style={{ color: ok ? "inherit" : "var(--text)" }}>
        {done}/{goal}
      </span>
      {ok && "✓"}
    </span>
  );
}

/**
 * Objectifs du jour, presents sur toutes les pages.
 *
 * Le Shell etant monte partout, la barre tape une route dediee et minuscule
 * plutot que de charger les collections completes a chaque navigation.
 */
function DailyBar() {
  const pathname = usePathname();
  const [today, setToday] = useState<Today | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/today", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: Today) => { if (alive) setToday(d); })
      .catch(() => {});
    return () => { alive = false; };
    // Rechargé à chaque navigation : les compteurs bougent pendant la session.
  }, [pathname]);

  if (!today) return null;

  return (
    <Link href="/" className="flex items-center gap-1.5 min-w-0" title={today.theme}>
      <span className="label-xs hidden sm:inline mr-1">Aujourd&apos;hui</span>
      <Goal label="Reels" done={today.reelsDone} goal={today.reelsGoal} />
      <Goal label="Canal" done={today.channelDone} goal={today.channelGoal} />
      <Goal label="Photos/sem." done={today.photosDone} goal={today.photosGoal} />
      <span
        className="inline-flex items-center gap-1 px-2 h-[22px] rounded-full mono text-[10.5px] uppercase whitespace-nowrap"
        style={{
          letterSpacing: "0.03em",
          background: today.storyCount > 0
            ? "color-mix(in srgb, var(--emerald) 10%, var(--surface))"
            : "var(--surface)",
          border: `1px solid ${
            today.storyCount > 0 ? "color-mix(in srgb, var(--emerald) 30%, transparent)" : "var(--border)"
          }`,
          color: today.storyCount > 0 ? "var(--emerald)" : "var(--text-2)",
        }}
        title={today.storyCount > 0 ? `${today.storyCount} story en ligne` : "Aucune story aujourd'hui"}
      >
        Story {today.storyCount > 0 ? "✓" : "—"}
      </span>
      {today.theme && (
        <span className="dim text-[12px] truncate hidden lg:inline ml-1.5">{today.theme}</span>
      )}
    </Link>
  );
}

/**
 * Menu principal.
 *
 * La section « Sales » est la seule visible pour un setter ou un closer : le
 * reste du tool (studio IA, contenus, reglages) ne les concerne pas, et le
 * middleware leur en refuse de toute facon l'acces.
 */
const NAV: { section: string; items: { href: string; label: string; icon: string }[] }[] = [
  {
    section: "Pilotage",
    items: [
      { href: "/", label: "Dashboard", icon: "◈" },
      { href: "/insights", label: "Winning Format", icon: "◎" },
    ],
  },
  {
    section: "Contenu",
    items: [
      { href: "/content", label: "Content", icon: "◫" },
      { href: "/production", label: "Production", icon: "▣" },
    ],
  },
  {
    section: "Création",
    items: [
      { href: "/studio", label: "Studio IA", icon: "✦" },
      { href: "/montage", label: "Espace monteur", icon: "✂" },
    ],
  },
  {
    section: "Sales",
    items: [
      { href: "/sales", label: "Sales Dashboard", icon: "◈" },
      { href: "/sales/rendez-vous", label: "Rendez-vous", icon: "☏" },
      { href: "/sales/relances", label: "Relances", icon: "↻" },
      { href: "/sales/commissions", label: "Commissions", icon: "▦" },
    ],
  },
  {
    section: "Business",
    items: [
      { href: "/crm", label: "CRM", icon: "◉" },
      { href: "/eleves", label: "Élèves", icon: "✓" },
      { href: "/calls", label: "Calls", icon: "☏" },
      { href: "/ads/creas", label: "Ads & Scripts", icon: "▶" },
      { href: "/ads", label: "Meta Ads", icon: "◐" },
      { href: "/equipe", label: "Équipe", icon: "⚇" },
    ],
  },
  {
    section: "Perso",
    items: [
      { href: "/ressources", label: "Ressources", icon: "▤" },
      { href: "/todo", label: "To-do", icon: "☑" },
      { href: "/reglages", label: "Réglages", icon: "⚙" },
    ],
  },
];

/** Marque : carré ardoise + mot-symbole, réutilisé sur la page de connexion. */
export function Brand({ size = "md" }: { size?: "md" | "lg" }) {
  const box = size === "lg" ? 30 : 24;
  return (
    <span className="inline-flex items-center gap-2.5">
      <span
        className="grid place-items-center shrink-0 mono"
        style={{
          width: box,
          height: box,
          borderRadius: 8,
          background: "var(--grad-accent)",
          color: "var(--accent-on)",
          boxShadow: "0 4px 12px -4px color-mix(in srgb, var(--accent) 60%, transparent)",
          fontSize: size === "lg" ? 11 : 9.5,
          letterSpacing: "0.02em",
        }}
      >
        MP
      </span>
      <span
        className="font-medium"
        style={{ fontSize: size === "lg" ? 17 : 14.5, letterSpacing: "-0.025em" }}
      >
        MPGate
      </span>
    </span>
  );
}

/**
 * Badge du membre connecte, avec sa sortie.
 *
 * Rien pour moi, et rien non plus en apercu : dans ce cas c'est le selecteur
 * de vue juste au-dessus qui sert a revenir, un second bouton de sortie
 * n'apporterait que de la confusion.
 */
const ROLE_LABEL: Record<string, string> = {
  owner: "propriétaire",
  admin: "admin",
  setter: "setter",
  closer: "closer",
  editor: "monteur",
};

function SessionBadge() {
  const { session } = useSession();
  if (!session || session.role === "anonyme") return null;
  // Le proprietaire n'a une sortie que s'il s'est connecte (site en ligne).
  if (session.role === "owner" && !session.canLogout) return null;
  if (session.impersonated) return null;

  const logout = async () => {
    await api("/api/sales/session", { method: "DELETE" }).catch(() => {});
    forgetSession();
    window.location.href = "/login";
  };

  return (
    <div className="flex items-center justify-between gap-2 mb-2.5 px-1">
      <span className="min-w-0">
        <span className="block text-[13px] font-medium truncate">{session.memberName}</span>
        <span className="label-xs">{ROLE_LABEL[session.role] ?? session.role}</span>
      </span>
      <button className="btn btn-ghost btn-sm shrink-0" onClick={() => void logout()} title="Se déconnecter">
        ⏻
      </button>
    </div>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const { session } = useSession();

  // Referme le tiroir mobile dès qu'on change de page.
  useEffect(() => setOpen(false), [pathname]);

  // Un commercial ne voit que son espace : afficher des liens qui renvoient
  // vers une redirection est une fausse promesse.
  const isSalesOnly = session?.role === "setter" || session?.role === "closer";
  // Le monteur ne voit que ses deux outils : son board et le Studio IA.
  const isEditor = session?.role === "editor";
  const nav = isSalesOnly
    ? NAV.filter((g) => g.section === "Sales")
    : isEditor
      ? [
          {
            section: "Montage",
            items: [
              { href: "/monteur", label: "Mes vidéos à monter", icon: "✂" },
              { href: "/studio?kind=swap", label: "Swap vidéo (IA)", icon: "✦" },
              { href: "/studio?kind=talk", label: "Photo qui parle", icon: "◉" },
            ],
          },
        ]
      : NAV;

  return (
    <div className="min-h-screen flex">
      {open && (
        <div
          className="fixed inset-0 z-30 md:hidden"
          style={{ background: "rgb(35 49 55 / 0.35)", backdropFilter: "blur(2px)" }}
          onClick={() => setOpen(false)}
        />
      )}

      {/*
        Barre latérale posée sur le fond de page, séparée par un simple
        liseré : le contenu et la navigation partagent la même surface, comme
        les sections de Qoves.
      */}
      <aside
        className={`fixed md:sticky top-0 z-40 h-screen w-[236px] shrink-0 flex flex-col transition-transform md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{ background: "var(--bg)", borderRight: "1px solid var(--border)" }}
      >
        <div className="px-5 h-[60px] flex items-center shrink-0">
          <Brand />
        </div>

        <nav className="flex-1 overflow-y-auto px-3 pb-3">
          {nav.map((group) => (
            <div key={group.section} className="mb-5">
              <div className="label-xs px-3 mb-2">{group.section}</div>
              <div className="flex flex-col gap-[3px]">
                {group.items.map((item) => {
                  // Le monteur a des liens avec paramètre (/studio?kind=swap) : on
                  // compare le chemin seul, et la query désigne l'onglet actif.
                  const [itemPath, itemQuery] = item.href.split("?");
                  const active =
                    pathname === itemPath &&
                    (!itemQuery || (typeof window !== "undefined" && window.location.search.includes(itemQuery)));
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="nav-link flex items-center gap-2.5 px-3 h-[34px] rounded-full text-[13.5px]"
                      data-active={active}
                      style={{
                        color: active ? "var(--accent)" : "var(--text-2)",
                        fontWeight: active ? 600 : 400,
                      }}
                    >
                      <span
                        className="w-[14px] text-center text-[12px]"
                        style={{ color: active ? "var(--accent)" : "var(--text-3)" }}
                      >
                        {item.icon}
                      </span>
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="p-3 shrink-0" style={{ borderTop: "1px solid var(--border)" }}>
          <ViewSwitcher />
          <SessionBadge />
          {/* Le solde de credits IA ne concerne pas l'equipe commerciale. */}
          {!isSalesOnly && <CreditsWidget />}
          {!isSalesOnly && <HiggsfieldWidget />}
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header
          className="sticky top-0 z-20 h-[60px] flex items-center justify-between gap-3 px-5 lg:px-8"
          style={{
            background: "color-mix(in srgb, var(--bg) 85%, transparent)",
            backdropFilter: "blur(12px)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <button className="btn btn-ghost btn-sm md:hidden shrink-0" onClick={() => setOpen(true)} aria-label="Menu">
            ☰
          </button>
          {/* Sur téléphone, les objectifs du jour défilent horizontalement au lieu de déborder. */}
          <div className="min-w-0 flex-1 overflow-x-auto scroll-x">
            {/* Attendre la session : monté trop tôt, le monteur déclenchait un appel refusé à /api/today. */}
            {session && !isSalesOnly && !isEditor && <DailyBar />}
          </div>
          <div className="hidden md:block shrink-0">
            <Clocks />
          </div>
          <div className="shrink-0">
            <ThemeToggle />
          </div>
        </header>

        {/*
          Colonne centrée, bornée à 1240 px.
          En pleine largeur, un grand écran dispersait les cartes et les
          tableaux d'un bord à l'autre ; trop étroit, tout se tassait. Cette
          largeur garde les blocs lisibles d'un seul regard, comme les sections
          de Qoves, avec une respiration latérale qui grandit avec l'écran.
        */}
        <main className="relative z-[1] flex-1 w-full px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
          {/* La cle force le rejeu de l'animation a chaque page. */}
          <div key={pathname} className="rise w-full max-w-[1240px] mx-auto">{children}</div>
        </main>
      </div>

      {/* Hors du <main> : il ne doit pas etre remonte a chaque navigation. */}
      <JobsDock />
    </div>
  );
}
