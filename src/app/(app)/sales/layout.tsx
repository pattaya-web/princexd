"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { api } from "@/lib/client";
import { useSalesData, useSession } from "@/lib/sales/client";
import { Card, ErrorNote, Spinner } from "@/components/ui";
import { SalesContext, type SalesCtx } from "@/components/sales/context";
import { ReminderPopup } from "@/components/sales/SetterTasksCard";
import type { PeriodState } from "@/components/sales/bits";
import type { PublicMember } from "@/lib/sales/repo";
import { sessionHas } from "@/lib/sales/roles";
import type { Session } from "@/lib/types";

/* ------------------------------ Sous-menu ------------------------------- */

interface Tab {
  href: string;
  label: string;
  /** Onglets reserves a l'admin. */
  admin?: boolean;
  /** Onglet des membres seulement : l'admin a son Sales Dashboard. */
  member?: boolean;
  /** Onglet ouvert aux membres qui exercent ce metier (et a l'admin). */
  role?: "setter" | "closer";
  /** Range dans le menu « Plus » : utile, mais pas tous les jours. */
  more?: boolean;
}

/**
 * Quatre onglets pour le quotidien, le reste dans « Plus ».
 *
 * Avant, quinze onglets dont trois disaient la meme chose (CRM, Suivi,
 * Relances) : on ne savait plus ou aller statuer un call. Les relances et
 * le suivi des paiements sont des vues du CRM ; les reglages et les ecrans
 * d'equipe restent accessibles, mais ne prennent plus la place.
 */
const TABS: Tab[] = [
  { href: "/sales", label: "Mon espace", member: true },
  { href: "/sales/dashboard", label: "Pilotage", admin: true },
  { href: "/sales/calls", label: "Calls", admin: true },
  { href: "/sales/analyse", label: "Analyse", admin: true },
  { href: "/sales/leads", label: "Leads" },
  { href: "/sales/rendez-vous", label: "CRM" },
  { href: "/sales/agenda", label: "Agenda", admin: true },
  { href: "/sales/utm", label: "Liens UTM", admin: true },
  { href: "/sales/leads/appels", label: "Leads à appeler", more: true },
  { href: "/sales/equipe", label: "Équipe", admin: true, more: true },
  { href: "/sales/pointage", label: "Shifts", admin: true, more: true },
  { href: "/sales/commissions", label: "Commissions", more: true },
  { href: "/sales/setters", label: "Mes stats setter", role: "setter", more: true },
  { href: "/sales/closers", label: "Mes stats closer", role: "closer", more: true },
  { href: "/sales/messages", label: "Messages types", more: true },
  { href: "/sales/sources", label: "Sources", more: true },
  { href: "/sales/guide", label: "Guide", more: true },
];

/** Anciennes adresses, toujours tapables : elles menent au CRM. */
const FOLDED = ["/sales/relances", "/sales/suivi"];

/** L'onglet est-il ouvert a cette session ? */
function allowed(t: Tab, session: Session): boolean {
  if (session.isAdmin) return !t.member;
  if (t.admin) return false;
  if (t.role) return sessionHas(session, t.role);
  return true;
}

/**
 * Une adresse fermee a cette session ?
 *
 * Masquer l'onglet ne suffit pas : l'adresse reste tapable. Les API refusent
 * deja les donnees, mais un membre qui tombe sur une page vide aux boutons
 * inertes croit a un bug — autant lui dire franchement.
 */
function isBlockedRoute(pathname: string, session: Session): boolean {
  if (FOLDED.some((f) => pathname.startsWith(f))) return false;
  return TABS.some((t) => !t.member && !allowed(t, session) && (pathname === t.href || pathname.startsWith(`${t.href}/`)));
}

function SubNav({ session }: { session: Session }) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const visible = TABS.filter((t) => allowed(t, session));
  const main = visible.filter((t) => !t.more);
  const more = visible.filter((t) => t.more);
  const moreActive = more.some((t) => pathname === t.href || pathname.startsWith(`${t.href}/`));

  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [moreOpen]);
  useEffect(() => setMoreOpen(false), [pathname]);

  const tabStyle = (active: boolean) => ({
    background: active ? "var(--surface)" : "transparent",
    color: active ? "var(--text)" : "var(--text-2)",
    boxShadow: active ? "var(--shadow)" : "none",
  });

  return (
    <nav className="flex gap-1 p-1 rounded-[10px] mb-4 overflow-x-auto items-center" style={{ background: "var(--surface-3)" }}>
      {main.map((t) => {
        const active = pathname === t.href || (t.href !== "/sales" && pathname.startsWith(`${t.href}/`) && !TABS.some((o) => o.href !== t.href && o.href.startsWith(`${t.href}/`) && pathname.startsWith(o.href))) || (t.href === "/sales/rendez-vous" && FOLDED.some((f) => pathname.startsWith(f)));
        return (
          <Link key={t.href} href={t.href} className="px-3 h-[28px] rounded-[7px] text-[12.5px] font-medium whitespace-nowrap flex items-center transition-colors" style={tabStyle(active)}>
            {t.label}
          </Link>
        );
      })}
      {more.length > 0 && (
        <div className="relative ml-auto" ref={moreRef}>
          <button type="button" className="px-3 h-[28px] rounded-[7px] text-[12.5px] font-medium whitespace-nowrap flex items-center gap-1 transition-colors" style={tabStyle(moreActive)} onClick={() => setMoreOpen((v) => !v)} aria-haspopup="menu" aria-expanded={moreOpen}>
            {moreActive ? more.find((t) => pathname === t.href || pathname.startsWith(`${t.href}/`))?.label : "Plus"} <span className="text-[10px]">▾</span>
          </button>
          {moreOpen && (
            <div className="card absolute right-0 top-full mt-1.5 min-w-[200px] py-1 z-40" style={{ boxShadow: "var(--shadow-lg)" }} role="menu">
              {more.map((t) => {
                const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
                return (
                  <Link key={t.href} href={t.href} role="menuitem" className="block px-3 py-1.5 text-[12.5px] hover:bg-[var(--surface-2)]" style={{ color: active ? "var(--text)" : "var(--text-2)", fontWeight: active ? 600 : 500 }}>
                    {t.label}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}
    </nav>
  );
}

/* ------------------------------- Layout --------------------------------- */

/**
 * Enveloppe de l'espace commercial.
 *
 * Charge la session et l'annuaire une seule fois pour toutes les pages : sans
 * cela chaque navigation redemandait les memes donnees, qui ne bougent
 * pourtant jamais d'un ecran a l'autre. La periode est partagee elle aussi,
 * pour qu'en passant du dashboard aux commissions on garde la meme fenetre.
 */
export default function SalesLayout({ children }: { children: ReactNode }) {
  const { session, loading } = useSession();
  const pathname = usePathname();
  const [period, setPeriod] = useState<PeriodState>({ period: "30d", from: "", to: "" });
  const [version, setVersion] = useState(0);

  const { data, reload } = useSalesData<{ members: PublicMember[]; currency: string }>(
    session ? "/api/sales/members" : null,
  );

  /*
   * Synchronisation iClosed a l'ouverture.
   *
   * Une seule tentative par montage de l'espace, et la route s'auto-limite a
   * une synchro toutes les dix minutes : le quota iClosed est de 200 appels
   * par heure, il ne doit pas partir en navigation entre deux onglets.
   *
   * Silencieuse par construction — si elle echoue, l'ecran s'affiche quand
   * meme et le bouton d'import manuel reste disponible.
   */
  const synced = useRef(false);
  useEffect(() => {
    // Toute l'equipe declenche la synchro : un closer doit voir ses calls du
    // jour sans attendre que l'admin ouvre le tool.
    if (!session || session.role === "anonyme" || session.role === "editor" || session.role === "va" || synced.current) return;
    synced.current = true;
    void api<{ created: number }>("/api/sales/iclosed/sync", { method: "POST" })
      .then((r) => {
        if (r.created > 0) setVersion((v) => v + 1);
      })
      .catch(() => {});
  }, [session]);

  const value = useMemo<SalesCtx | null>(() => {
    if (!session) return null;
    return {
      session,
      members: data?.members ?? [],
      currency: data?.currency ?? "EUR",
      period,
      setPeriod,
      version,
      bump: () => setVersion((v) => v + 1),
      reloadMembers: reload,
    };
  }, [session, data, period, version, reload]);

  if (loading) {
    return (
      <Card>
        <Spinner label="Chargement de l'espace commercial…" />
      </Card>
    );
  }

  // Le monteur et les comptes desactives n'ont rien a faire ici. Le middleware
  // les redirige deja ; ce garde-fou couvre le cas ou la page est atteinte
  // malgre tout, par exemple apres une desactivation en cours de session.
  if (!value || session?.role === "anonyme" || session?.role === "editor" || session?.role === "va") {
    return (
      <Card>
        <ErrorNote>
          Cet espace est réservé à l&apos;équipe commerciale.{" "}
          <Link href="/login" className="link">
            Se connecter
          </Link>
        </ErrorNote>
      </Card>
    );
  }

  const blocked = isBlockedRoute(pathname, value.session);

  return (
    <SalesContext.Provider value={value}>
      <SubNav session={value.session} />
      {blocked ? (
        <Card>
          <ErrorNote>
            Cette page ne concerne pas ton rôle.{" "}
            <Link href="/sales" className="link">
              Retour à mon espace
            </Link>
          </ErrorNote>
        </Card>
      ) : (
        children
      )}
      {/* Relances du jour du setter, en bas a droite, quelle que soit la page. */}
      <ReminderPopup />
    </SalesContext.Provider>
  );
}
