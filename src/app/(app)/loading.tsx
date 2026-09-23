import { SkPage } from "@/components/Skeleton";

/**
 * Affiché instantanément par Next pendant une navigation, avant même que la
 * page cible ait chargé ses données. C'est ce qui supprime la sensation de
 * page figée au changement d'onglet.
 */
export default function Loading() {
  return <SkPage />;
}
