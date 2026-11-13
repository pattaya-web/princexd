"use client";

import { MemberHome } from "@/components/sales/MemberHome";

/**
 * Ancien accueil d'un membre (lien signe, objectifs, Telegram, stats), garde
 * pour le Head of Setting dont « /sales » ouvre desormais le cockpit.
 */
export default function MemberHomePage() {
  return <MemberHome />;
}
