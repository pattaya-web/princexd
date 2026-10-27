import fs from "fs";
import path from "path";

/**
 * La boutique d'exemple de Mady : copie HTML en lecture seule dans
 * content/boutique-exemple (voir /api/formation/boutique-exemple).
 */
export const EXAMPLE_SHOP_DIR = path.join(process.cwd(), "content", "boutique-exemple");
export const EXAMPLE_SHOP_PAGES = ["accueil", "produit", "produit-2", "collection"] as const;
export type ExampleShopPage = (typeof EXAMPLE_SHOP_PAGES)[number];
/** Lien à ouvrir dans un nouvel onglet. */
export const EXAMPLE_SHOP_URL = "/api/formation/boutique-exemple?p=accueil";

/** Vrai quand le miroir est présent sur ce serveur (page d'accueil générée). */
export function exampleShopAvailable(): boolean {
  return fs.existsSync(path.join(EXAMPLE_SHOP_DIR, "accueil.html"));
}
