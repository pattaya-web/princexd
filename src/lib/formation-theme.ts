import path from "path";
import { RESOURCES_DIR } from "./formation-resources";

/**
 * Le thème Shopify de Mady déposé pour les élèves : un zip dans
 * data/formation/ (volume persistant du VPS), sous un nom généré.
 */

/** Chemin complet du zip stocké, ou null si le nom n'a pas le gabarit généré. */
export function themePath(stored: string): string | null {
  if (!/^theme-[a-z0-9]{6,40}\.zip$/.test(stored)) return null;
  const full = path.join(RESOURCES_DIR, stored);
  return full.startsWith(RESOURCES_DIR) ? full : null;
}
