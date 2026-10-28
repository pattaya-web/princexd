import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Page d'accueil : le Sales Dashboard (depuis le 2026-10-28).
 *
 * Le tableau de bord Instagram vit à /instagram (section Contenu, à côté de
 * Winning Format). Pour un setter, un closer, un monteur ou un élève, le
 * middleware a déjà redirigé « / » vers son propre espace avant d'arriver ici.
 */
export default function HomePage() {
  redirect("/sales/dashboard");
}
