"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { MbProvider, useMb } from "@/components/mediabuying/context";
import { RANGE_PRESETS } from "@/lib/mediabuying/metrics";
import { fmtDate } from "@/lib/format";

/* ------------------------------ Sous-menu ------------------------------- */

const TABS = [
  { href: "/mediabuying", label: "Cockpit" },
  { href: "/mediabuying/campaigns", label: "Campagnes" },
  { href: "/mediabuying/builder", label: "Builder" },
  { href: "/mediabuying/connections", label: "Connexions" },
  { href: "/mediabuying/settings", label: "Réglages" },
  { href: "/mediabuying/audit", label: "Journal" },
];

function SubNav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 p-1 rounded-[10px] mb-3 overflow-x-auto" style={{ background: "var(--surface-3)" }}>
      {TABS.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            className="px-3 h-[28px] rounded-[7px] text-[12.5px] font-medium whitespace-nowrap flex items-center transition-colors"
            style={{ background: active ? "var(--surface)" : "transparent", color: active ? "var(--text)" : "var(--text-2)", boxShadow: active ? "var(--shadow)" : "none" }}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

/* ------------------------------- Barre haute ----------------------------- */

function ago(iso: string, now: number): string {
  if (!iso) return "jamais";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `il y a ${s} s`;
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86_400) return `il y a ${Math.floor(s / 3600)} h`;
  return fmtDate(iso);
}

function TopBar() {
  const mb = useMb();
  const pathname = usePathname();
  const onConnections = pathname === "/mediabuying/connections";
  const o = mb.overview;
  return (
    <div className="card px-3 sm:px-4 py-2.5 mb-4 flex flex-wrap items-center gap-2 sm:gap-3 sticky top-0 z-[5]" style={{ boxShadow: "var(--shadow)" }}>
      {/* Compte Meta */}
      <label className="flex items-center gap-2 min-w-0">
        <span className="label-xs hidden sm:inline">Meta account</span>
        {mb.connections.length ? (
          <select className="select select-sm !w-auto max-w-[220px]" value={mb.connection?.id ?? ""} onChange={(e) => mb.setConnectionId(e.target.value)} title="Changer de compte publicitaire">
            {mb.connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.provider === "mock" ? " (simulé)" : ""}
              </option>
            ))}
          </select>
        ) : (
          !onConnections && (
            <Link href="/mediabuying/connections" className="btn btn-sm btn-primary">
              + Connecter un compte Meta
            </Link>
          )
        )}
      </label>

      {/* Periode */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <select className="select select-sm !w-auto" value={mb.preset} onChange={(e) => mb.setPreset(e.target.value as typeof mb.preset)} title="Plage de dates">
          {RANGE_PRESETS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
        {mb.preset === "custom" && (
          <>
            <input className="input !h-[30px] !w-auto !text-[12.5px]" type="date" value={mb.custom.from} onChange={(e) => mb.setCustom({ ...mb.custom, from: e.target.value })} />
            <span className="dim text-[12px]">→</span>
            <input className="input !h-[30px] !w-auto !text-[12.5px]" type="date" value={mb.custom.to} onChange={(e) => mb.setCustom({ ...mb.custom, to: e.target.value })} />
          </>
        )}
        {o && (
          <span className="dim text-[11.5px] num hidden md:inline" title="Dates utilisées pour toutes les métriques">
            {o.range.from === o.range.to ? fmtDate(`${o.range.from}T12:00:00Z`) : `${fmtDate(`${o.range.from}T12:00:00Z`)} → ${fmtDate(`${o.range.to}T12:00:00Z`)}`}
            <span className="opacity-60"> · vs {fmtDate(`${o.prevRange.from}T12:00:00Z`)} → {fmtDate(`${o.prevRange.to}T12:00:00Z`)}</span>
          </span>
        )}
      </div>

      {/* Synchro */}
      <div className="ml-auto flex items-center gap-2">
        {mb.connection && (
          <span className="dim text-[11.5px] num whitespace-nowrap">
            {mb.syncing || o?.syncing ? (
              <span className="flex items-center gap-1.5">
                <span className="spinner" /> Synchronisation Meta en cours…
              </span>
            ) : (
              <>
                Dernière synchro : {ago(o?.syncedAt ?? mb.connection.lastSyncAt, mb.now)}
                {o?.syncMs ? <span className="opacity-60"> ({(o.syncMs / 1000).toFixed(1).replace(".", ",")} s)</span> : null}
              </>
            )}
          </span>
        )}
        {mb.connection && (
          <button className="btn btn-sm" onClick={() => void mb.sync()} disabled={mb.syncing} title="Demander des chiffres frais à Meta maintenant">
            {mb.syncing ? <span className="spinner" /> : "↻ Synchroniser maintenant"}
          </button>
        )}
        {mb.loading && !mb.syncing && <span className="spinner" title="Chargement" />}
      </div>
    </div>
  );
}

/**
 * Module media buying : couleur de marque (#006DBC) appliquee par variables
 * CSS sur ce seul conteneur, sans toucher au reste de l'application.
 */
export default function MediaBuyingLayout({ children }: { children: ReactNode }) {
  return (
    <MbProvider>
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
        <SubNav />
        <TopBar />
        {children}
      </div>
    </MbProvider>
  );
}
