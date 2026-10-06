"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { api } from "@/lib/client";
import { useSalesData, useSession } from "@/lib/sales/client";
import { Card, ErrorNote, Spinner } from "@/components/ui";
import { SalesContext, type SalesCtx } from "@/components/sales/context";
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
  /** Onglet ouvert aux membres qui exercent ce metier (et a l'admin). */
  role?: "setter" | "closer";
}

const TABS: Tab[] = [
  { href: "/sales", label: "Dashboard" },
  { href: "/sales/leads", label: "À appeler" },
  { href: "/sales/rendez-vous", label: "Rendez-vous" },
  { href: "/sales/agenda", label: "Agenda", admin: true },
  { href: "/sales/pointage", label: "Shifts équipe", admin: true },
  { href: "/sales/suivi", label: "Suivi" },
  { href: "/sales/sources", label: "Sources" },
  { href: "/sales/relances", label: "Relances" },
  { href: "/sales/setters", label: "Setters", role: "setter" },
  { href: "/sales/closers", label: "Closers", role: "closer" },
  { href: "/sales/commissions", label: "Commissions" },
  { href: "/sales/equipe", label: "Comptes", admin: true },
  { href: "/sales/guide", label: "Guide" },
];

/** L'onglet est-il ouvert a cette session ? */
function allowed(t: Tab, session: Session): boolean {
  if (session.isAdmin) return true;
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
  return TABS.some((t) => !allowed(t, session) && (pathname === t.href || pathname.startsWith(`${t.href}/`)));
}

function SubNav({ session }: { session: Session }) {
  const pathname = usePathname();
  const visible = TABS.filter((t) => allowed(t, session));

  return (
    <nav
      className="flex gap-1 p-1 rounded-[10px] mb-4 overflow-x-auto"
      style={{ background: "var(--surface-3)" }}
    >
      {visible.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            className="px-3 h-[28px] rounded-[7px] text-[12.5px] font-medium whitespace-nowrap flex items-center transition-colors"
            style={{
              background: active ? "var(--surface)" : "transparent",
              color: active ? "var(--text)" : "var(--text-2)",
              boxShadow: active ? "var(--shadow)" : "none",
            }}
          >
            {t.label}
          </Link>
        );
      })}
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
    </SalesContext.Provider>
  );
}
