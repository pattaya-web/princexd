import fs from "fs/promises";
import os from "os";
import path from "path";
import type { Generation } from "@/lib/types";
import { downloadToMedia, runFf, storeBuffer } from "./media";

/**
 * Format 32:9 (écran ultra-large de Mady), réservé à l'admin.
 *
 * Aucun modèle image de KIE ne sort du 32:9 : le plus large documenté est
 * 4:1 (Nano Banana 2), 3:1 (GPT Image 2), 8:1 (Wan 2.7) ou 21:9 (les autres).
 * On demande donc au modèle le format large le plus proche de 32:9 qu'il
 * connaisse, puis on recadre le résultat au centre, par ffmpeg, en 32:9.
 * Partir de 4:1 ou 3:1 ne coupe qu'une bande fine ; partir de 21:9 coupe un
 * tiers de la hauteur : on choisit toujours la perte la plus faible.
 */
export const WIDE_RATIO = "32:9";
const WIDE = 32 / 9;

/** Formats larges acceptés par chaque modèle (doc KIE, 2026-10-30). Absent = 21:9 seulement. */
const WIDE_OPTIONS: Record<string, string[]> = {
  "nano-banana-2": ["4:1", "8:1", "21:9"],
  "nano-banana-pro": ["21:9"],
  "wan/2-7-image-pro": ["8:1", "21:9"],
  "gpt-image-2-text-to-image": ["3:1", "2:1", "21:9"],
  "gpt-image-2-image-to-image": ["3:1", "2:1", "21:9"],
  "gpt-image-2-5-flare-text-to-image": ["21:9"],
  "gpt-image-2-5-flare-image-to-image": ["21:9"],
  "google/nano-banana": ["21:9"],
  "google/nano-banana-edit": ["21:9"],
};

function ratioOf(opt: string): number {
  const [w, h] = opt.split(":").map(Number);
  return w && h ? w / h : 1;
}

/**
 * Valeur à envoyer à KIE à la place de « 32:9 » : le format large connu du
 * modèle dont le ratio est le plus proche (en proportion) de 32:9.
 */
export function wideSubstitute(model: string, key: string): string {
  if (key === "image_size") return "landscape_21_9";
  const options = WIDE_OPTIONS[model] ?? ["21:9"];
  return options.reduce((best, opt) => (Math.abs(Math.log(ratioOf(opt) / WIDE)) < Math.abs(Math.log(ratioOf(best) / WIDE)) ? opt : best), options[0]);
}

/** Recadre une image locale au centre en 32:9 (largeur ou hauteur, selon ce qui dépasse). Renvoie un PNG. */
async function cropFile(src: string): Promise<Buffer> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "princexd-wide-"));
  const out = path.join(dir, "wide.png");
  try {
    // Dans un graphe ffmpeg la virgule sépare les filtres : celles des expressions s'échappent.
    const w = `if(gt(iw/ih\\,${WIDE})\\,floor(ih*${WIDE}/2)*2\\,iw)`;
    const h = `if(gt(iw/ih\\,${WIDE})\\,ih\\,floor(iw/${WIDE}/2)*2)`;
    await runFf("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", src, "-vf", `crop=${w}:${h}`, "-frames:v", "1", out], 120_000);
    return await fs.readFile(out);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/**
 * Applique le recadrage 32:9 à une génération réussie dont les résultats sont
 * encore chez KIE : chaque image est rapatriée, recadrée, servie depuis
 * data/media. Vrai si les URLs ont changé. Un échec laisse les originaux
 * (l'image large reste exploitable) et se contente d'un journal.
 */
export async function applyWideCrop(gen: Generation): Promise<boolean> {
  if (gen.crop !== WIDE_RATIO || gen.state !== "success" || gen.kind !== "image") return false;
  const remote = (gen.resultUrls ?? []).filter((u) => /^https?:\/\//.test(u));
  if (!remote.length) return false;
  const next: string[] = [];
  let changed = false;
  for (const url of gen.resultUrls) {
    if (!/^https?:\/\//.test(url)) {
      next.push(url);
      continue;
    }
    try {
      const local = await downloadToMedia(url, { trusted: true });
      try {
        const png = await cropFile(local.path);
        const stored = await storeBuffer(png, ".png");
        next.push(stored.url);
        changed = true;
      } finally {
        await fs.rm(local.path, { force: true });
      }
    } catch (e) {
      console.error(`[studio] recadrage 32:9 impossible (${gen.taskId}) : ${(e as Error).message}`);
      next.push(url);
    }
  }
  if (changed) gen.resultUrls = next;
  return changed;
}
