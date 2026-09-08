"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api, useLocalState } from "@/lib/client";
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
    <div className="flex gap-0.5 p-0.5 rounded-[8px]" style={{ background: "var(--surface-3)" }}>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => setTheme(o.value)}
          title={o.title}
          aria-label={`Thème ${o.title}`}
          aria-pressed={theme === o.value}
          className="w-[26px] h-[24px] rounded-[6px] text-[12px] transition-colors"
          style={{
            background: theme === o.value ? "var(--surface)" : "transparent",
            color: theme === o.value ? "var(--text)" : "var(--text-3)",
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

export function Clocks() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Rendu vide au premier passage : l'heure serveur et l'heure client
  // ne coïncident pas et provoqueraient une erreur d'hydratation.
  if (!now) return <div style={{ height: 30 }} />;

  return (
    <div className="flex items-center gap-3.5">
      {ZONES.map((z) => {
        const time = new Intl.DateTimeFormat("fr-FR", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: z.tz,
          hour12: false,
        }).format(now);
        const hour = Number(
          new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: z.tz }).format(now),
        );
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
            <span className="dim text-[11px] hidden lg:inline">{z.label}</span>
            <span className="mono text-[12.5px] font-medium">{time}</span>
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
      className="rounded-[10px] px-3 py-2.5"
      style={{
        background: "var(--surface-2)",
        border: `1px solid ${low ? "color-mix(in srgb, var(--warning) 45%, transparent)" : "var(--border)"}`,
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="label-xs">Crédits KIE</span>
        <button
          className="btn btn-ghost btn-sm !h-[18px] !px-1 !text-[11px]"
          onClick={() => void load()}
          disabled={loading}
          title="Rafraîchir"
        >
          {loading ? <span className="spinner" /> : "↻"}
        </button>
      </div>

      {data?.error ? (
        <p className="text-[11.5px] mt-1 leading-snug" style={{ color: "var(--warning)" }}>
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
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className="text-[19px] font-semibold num tracking-tight">
              {data?.credits !== null && data?.credits !== undefined ? fmtInt(data.credits) : "—"}
            </span>
            <span className="dim text-[11px]">crédits</span>
          </div>
          <div className="flex items-center justify-between gap-2 mt-0.5">
            <span className="text-[12.5px] font-medium num" style={{ color: low ? "var(--warning)" : "var(--good)" }}>
              ≈ {data?.usd !== null && data?.usd !== undefined ? fmtUsd(data.usd) : "—"}
            </span>
            {low && <span className="badge badge-warn !text-[10px] !py-0">Bas</span>}
          </div>
        </>
      )}
    </div>
  );
}

/* -------------------------------- Nav ---------------------------------- */

const NAV: { section: string; items: { href: string; label: string; icon: string }[] }[] = [
  {
    section: "Pilotage",
    items: [
      { href: "/", label: "Dashboard", icon: "◈" },
      { href: "/croissance", label: "Croissance", icon: "↗" },
      { href: "/insights", label: "Quoi spammer", icon: "◎" },
    ],
  },
  {
    section: "Contenu",
    items: [
      { href: "/studio", label: "Studio IA", icon: "✦" },
      { href: "/swipe", label: "Swipe file", icon: "⇥" },
      { href: "/contenu", label: "Calendrier", icon: "▦" },
      { href: "/stories", label: "Story OS", icon: "◍" },
      { href: "/montage", label: "Montage", icon: "✂" },
    ],
  },
  {
    section: "Business",
    items: [
      { href: "/crm", label: "CRM", icon: "◉" },
      { href: "/eleves", label: "Élèves", icon: "✓" },
      { href: "/calls", label: "Calls", icon: "☏" },
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

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Referme le tiroir mobile dès qu'on change de page.
  useEffect(() => setOpen(false), [pathname]);

  return (
    <div className="min-h-screen flex">
      {open && (
        <div
          className="fixed inset-0 z-30 md:hidden"
          style={{ background: "rgb(0 0 0 / 0.45)" }}
          onClick={() => setOpen(false)}
        />
      )}

      <aside
        className={`fixed md:sticky top-0 z-40 h-screen w-[218px] shrink-0 flex flex-col transition-transform md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{ background: "var(--surface)", borderRight: "1px solid var(--border)" }}
      >
        <div className="px-4 h-[52px] flex items-center gap-2 shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
          <span
            className="w-[22px] h-[22px] rounded-[6px] grid place-items-center text-[12px] font-bold shrink-0"
            style={{ background: "var(--accent)", color: "var(--accent-on)" }}
          >
            M
          </span>
          <span className="font-semibold text-[13.5px] tracking-tight">mvdyprince</span>
        </div>

        <nav className="flex-1 overflow-y-auto px-2.5 py-3">
          {NAV.map((group) => (
            <div key={group.section} className="mb-4">
              <div className="label-xs px-2 mb-1.5">{group.section}</div>
              <div className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const active = pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="flex items-center gap-2.5 px-2 h-[30px] rounded-[7px] text-[13px] transition-colors"
                      style={{
                        background: active ? "var(--accent-soft)" : "transparent",
                        color: active ? "var(--accent)" : "var(--text-2)",
                        fontWeight: active ? 600 : 400,
                      }}
                    >
                      <span className="w-[14px] text-center text-[12px] opacity-80">{item.icon}</span>
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="p-2.5 shrink-0" style={{ borderTop: "1px solid var(--border)" }}>
          <CreditsWidget />
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header
          className="sticky top-0 z-20 h-[52px] flex items-center justify-between gap-3 px-4"
          style={{
            background: "color-mix(in srgb, var(--bg) 88%, transparent)",
            backdropFilter: "blur(10px)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <button className="btn btn-ghost btn-sm md:hidden" onClick={() => setOpen(true)} aria-label="Menu">
            ☰
          </button>
          <div className="flex-1" />
          <Clocks />
          <ThemeToggle />
        </header>

        <main className="flex-1 p-4 sm:p-6 max-w-[1500px] w-full">{children}</main>
      </div>
    </div>
  );
}
