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

/* ------------------------------ Sous-menu ------------------------------- */

interface Tab {
  href: string;
  label: string;
  /** Onglets reserves a l'admin. */
  admin?: boolean;
}

const TABS: Tab[] = [
  { href: "/sales", label: "Dashboard" },
  { href: "/sales/rendez-vous", label: "Rendez-vous" },
  { href: "/sales/relances", label: "Relances" },
  { href: "/sales/setters", label: "Setters", admin: true },
  { href: "/sales/closers", label: "Closers", admin: true },
  { href: "/sales/commissions", label: "Commissions" },
  { href: "/sales/equipe", label: "Comptes", admin: true },
];

/**
 * Un onglet reserve a l'admin couvre-t-il cette adresse ?
 *
 * Masquer l'onglet ne suffit pas : l'adresse reste tapable. Les API refusent
 * deja les donnees, mais un membre qui tombe sur une page vide aux boutons
 * inertes croit a un bug — autant lui dire franchement.
 */
function isAdminRoute(pathname: string): boolean {
  return TABS.some((t) => t.admin && (pathname === t.href || pathname.startsWith(`${t.href}/`)));
}

function SubNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const visible = TABS.filter((t) => !t.admin || isAdmin);

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
    if (!session?.isAdmin || synced.current) return;
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
      currency: data?.currency ?? "USD",
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
  if (!value || session?.role === "anonyme" || session?.role === "editor") {
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

  const blocked = !value.session.isAdmin && isAdminRoute(pathname);

  return (
    <SalesContext.Provider value={value}>
      <SubNav isAdmin={value.session.isAdmin} />
      {blocked ? (
        <Card>
          <ErrorNote>
            Cette page est réservée à l&apos;administrateur.{" "}
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
