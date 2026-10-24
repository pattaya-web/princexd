import fs from "fs";
import path from "path";
import { RESOURCES_DIR } from "./formation-resources";
import type { Settings } from "./types";

/**
 * Le thème Shopify de Mady pour les élèves (Aesthetic Lab).
 *
 * Deux sources, dans l'ordre : le zip déposé par l'admin depuis la page Ta
 * boutique (data/formation/theme-<id>.zip, volume persistant du VPS), sinon
 * le zip livré avec le dépôt (content/theme/, hors de public/ : il n'est
 * servi qu'aux élèves connectés et à l'admin, par /api/formation/theme/file).
 */

export const BUNDLED_THEME_PATH = path.join(process.cwd(), "content", "theme", "aesthetic-lab-template.zip");
export const BUNDLED_THEME_NAME = "aesthetic-lab-template.zip";

/** Chemin complet du zip déposé, ou null si le nom n'a pas le gabarit généré. */
export function themePath(stored: string): string | null {
  if (!/^theme-[a-z0-9]{6,40}\.zip$/.test(stored)) return null;
  const full = path.join(RESOURCES_DIR, stored);
  return full.startsWith(RESOURCES_DIR) ? full : null;
}

export interface CurrentTheme {
  full: string;
  fileName: string;
  size: number;
  uploadedAt: string;
  /** Vrai pour le zip livré avec le dépôt (pas de bouton Retirer). */
  bundled: boolean;
}

/** Le thème à servir aux élèves : le dépôt de l'admin s'il existe encore sur le disque, sinon celui du dépôt. */
export function currentTheme(settings: Pick<Settings, "studentTheme">): CurrentTheme | null {
  const t = settings.studentTheme;
  const full = t ? themePath(t.stored) : null;
  if (t && full && fs.existsSync(full)) return { full, fileName: t.fileName, size: t.size, uploadedAt: t.uploadedAt, bundled: false };
  if (fs.existsSync(BUNDLED_THEME_PATH)) {
    const st = fs.statSync(BUNDLED_THEME_PATH);
    return { full: BUNDLED_THEME_PATH, fileName: BUNDLED_THEME_NAME, size: st.size, uploadedAt: st.mtime.toISOString(), bundled: true };
  }
  return null;
}
