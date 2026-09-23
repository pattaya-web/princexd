"use client";

import { createContext, useContext } from "react";
import type { PublicMember } from "@/lib/sales/repo";
import type { Session } from "@/lib/types";
import type { PeriodState } from "./bits";

/**
 * Contexte du module commercial.
 *
 * Sorti du layout pour que les pages imbriquees l'importent par un chemin
 * stable (`@/components/sales/context`) plutot que par des `../../layout`
 * qui cassent des qu'on deplace un fichier.
 */
export interface SalesCtx {
  session: Session;
  members: PublicMember[];
  currency: string;
  period: PeriodState;
  setPeriod: (p: PeriodState) => void;
  /** Incremente apres une ecriture : les ecrans qui l'observent se rechargent. */
  version: number;
  bump: () => void;
  reloadMembers: () => void;
}

export const SalesContext = createContext<SalesCtx | null>(null);

export function useSales(): SalesCtx {
  const ctx = useContext(SalesContext);
  if (!ctx) throw new Error("useSales doit être utilisé dans l'espace /sales.");
  return ctx;
}
