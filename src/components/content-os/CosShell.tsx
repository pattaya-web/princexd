"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Habillage commun des pages Content OS : accent bleu #006DBC (le même que
 * le Sales Dashboard) et la barre des quatre espaces.
 */
const TABS = [
  { href: "/content-os", label: "Aujourd'hui" },
  { href: "/content-os/strategie", label: "Stratégie" },
  { href: "/content-os/pipeline", label: "Pipeline" },
  { href: "/content-os/ressources", label: "Ressources & roadmap" },
];

export function CosShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div
      style={
        {
          "--accent": "#006dbc",
          "--accent-hover": "#005a9c",
          "--accent-soft": "#e6f1fa",
          "--accent-ring": "#9cc9ea",
          "--grad-accent": "linear-gradient(135deg, #006dbc 0%, #2a8fd8 100%)",
        } as React.CSSProperties
      }
    >
      <div className="inline-flex max-w-full gap-1 p-1 rounded-full overflow-x-auto mb-4" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
        {TABS.map((t) => {
          const active = t.href === "/content-os" ? pathname === t.href : pathname.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              className="px-3 py-1.5 rounded-full text-[12.5px] font-medium whitespace-nowrap"
              style={active ? { background: "var(--surface)", color: "var(--text)", boxShadow: "0 1px 2px rgba(0,0,0,0.08)" } : { color: "var(--text-2)" }}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
      {children}
    </div>
  );
}

/** Carte repliable, pour les sections secondaires. */
export function Fold({ title, children, open = false }: { title: string; children: ReactNode; open?: boolean }) {
  return (
    <details className="card p-4 sm:p-5" open={open}>
      <summary className="cursor-pointer font-semibold text-[14.5px]">{title}</summary>
      <div className="mt-3 text-[13.5px] leading-relaxed grid gap-2">{children}</div>
    </details>
  );
}
