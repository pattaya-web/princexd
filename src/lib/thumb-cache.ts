import fs from "node:fs/promises";
import path from "node:path";

/**
 * Cache local des miniatures Instagram.
 *
 * Les URL CDN de Meta expirent en quelques jours : une galerie synchronisee
 * la semaine derniere n'affiche plus que des icones d'image cassee. On
 * telecharge donc chaque miniature une fois, dans data/media, et on stocke
 * l'adresse locale a la place. Quelques dizaines de Ko par image : mille
 * publications tiennent dans moins de 100 Mo.
 *
 * Le nom de fichier ne contient que des lettres et des chiffres : c'est la
 * regle de la route /api/media, qui refuse tout autre nom.
 */
const MEDIA_DIR = path.join(process.cwd(), "data", "media");
const TIMEOUT_MS = 15_000;

function safeKey(key: string) {
  return key.replace(/[^A-Za-z0-9]/g, "");
}

/** Petit hachage stable, pour deriver un nom de fichier d'un pseudo. */
export function hashKey(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/**
 * Renvoie l'URL locale de l'image, en la telechargeant si besoin.
 * En cas d'echec (CDN deja expire, reseau), on renvoie l'URL d'origine :
 * mieux vaut une image qui expirera qu'aucune image.
 */
export async function cacheImage(url: string, key: string): Promise<string> {
  if (!url || url.startsWith("/api/media/")) return url;
  const name = `${safeKey(key)}.jpg`;
  const target = path.join(MEDIA_DIR, name);
  const local = `/api/media/${name}`;

  try {
    await fs.access(target);
    return local;
  } catch {
    // Pas encore en cache.
  }

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    if (!res.ok) return url;
    const type = res.headers.get("content-type") ?? "";
    if (!type.startsWith("image/")) return url;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) return url;
    await fs.mkdir(MEDIA_DIR, { recursive: true });
    await fs.writeFile(target, buf);
    return local;
  } catch {
    return url;
  }
}

/** Met en cache une liste d'images, quelques-unes a la fois. */
export async function cacheImages(
  items: { url: string; key: string }[],
  concurrency = 8,
): Promise<string[]> {
  const out = new Array<string>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await cacheImage(items[i].url, items[i].key);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return out;
}
