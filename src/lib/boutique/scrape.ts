/**
 * Lecture des produits d'un site concurrent.
 *
 * La quasi-totalite des boutiques visees tournent sur Shopify, qui expose
 * chaque produit en JSON public (`/products/<handle>.json`) et la liste
 * complete (`/products.json`). On lit ca directement : titres, descriptions,
 * variantes, prix, images. Pour un site non Shopify, on se rabat sur le
 * JSON-LD « Product » de la page, puis sur les balises Open Graph.
 */
import type { ScrapedProduct } from "../types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

/** Produits lus au maximum quand on donne une boutique ou une collection entiere. */
export const MAX_PER_LINK = 12;
const MAX_IMAGES = 10;

export class ScrapeError extends Error {}

interface ShopifyVariant {
  title?: string;
  price?: string | number;
  compare_at_price?: string | number | null;
  sku?: string | null;
  option1?: string | null;
  option2?: string | null;
  option3?: string | null;
}
interface ShopifyProduct {
  title?: string;
  handle?: string;
  body_html?: string | null;
  vendor?: string;
  product_type?: string;
  tags?: string | string[];
  variants?: ShopifyVariant[];
  options?: { name?: string; values?: string[] }[];
  images?: { src?: string; alt?: string | null }[];
}

async function fetchText(url: string, accept: string): Promise<{ status: number; text: string }> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: accept, "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8" },
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    });
  } catch (e) {
    throw new ScrapeError(`Site injoignable (${new URL(url).hostname}) : ${(e as Error).message}`);
  }
  return { status: res.status, text: await res.text() };
}

function clean(url: string): URL {
  const u = new URL(url.trim());
  u.hash = "";
  u.search = "";
  return u;
}

const money = (v: string | number | null | undefined) => {
  if (v === null || v === undefined || v === "") return "";
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n.toFixed(2) : "";
};

export function slug(s: string): string {
  return (
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "produit"
  );
}

function fromShopify(p: ShopifyProduct, sourceUrl: string): ScrapedProduct | null {
  if (!p.title) return null;
  const options = (p.options ?? [])
    .filter((o) => o.name && o.name !== "Title")
    .map((o) => ({ name: o.name!, values: (o.values ?? []).filter(Boolean) }));
  const variants = (p.variants ?? []).map((v) => ({
    title: v.title ?? "",
    price: money(v.price),
    compareAtPrice: money(v.compare_at_price),
    sku: v.sku ?? "",
    optionValues: options.length ? [v.option1, v.option2, v.option3].slice(0, options.length).map((x) => x ?? "") : [],
  }));
  const tags = Array.isArray(p.tags) ? p.tags : (p.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  return {
    sourceUrl,
    handle: p.handle ?? slug(p.title),
    title: p.title,
    descriptionHtml: p.body_html ?? "",
    vendor: p.vendor ?? "",
    productType: p.product_type ?? "",
    tags,
    options,
    variants: variants.length ? variants : [{ title: "Default Title", price: "", compareAtPrice: "", sku: "", optionValues: [] }],
    images: (p.images ?? []).filter((i) => i.src).slice(0, MAX_IMAGES).map((i) => ({ src: i.src!, alt: i.alt ?? "" })),
  };
}

/** Un lien produit Shopify : `/products/<handle>` (avec ou sans prefixe de langue). */
function productHandle(u: URL): string | null {
  const m = u.pathname.match(/\/products\/([^/]+)\/?$/);
  return m ? decodeURIComponent(m[1]) : null;
}
function collectionHandle(u: URL): string | null {
  const m = u.pathname.match(/\/collections\/([^/]+)\/?$/);
  return m ? decodeURIComponent(m[1]) : null;
}

/* ------------------------- Repli non Shopify ---------------------------- */

interface LdOffer {
  price?: string | number;
  priceSpecification?: { price?: string | number };
}
interface LdProduct {
  "@type"?: string | string[];
  name?: string;
  description?: string;
  image?: string | string[] | { url?: string }[];
  brand?: { name?: string } | string;
  offers?: LdOffer | LdOffer[];
}

function findLdProduct(html: string): LdProduct | null {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const parsed = JSON.parse(m[1].trim()) as unknown;
      const nodes: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
      for (const n of nodes) {
        const obj = n as LdProduct & { "@graph"?: LdProduct[] };
        const cands = obj["@graph"] ? obj["@graph"] : [obj];
        for (const c of cands) {
          const t = c["@type"];
          if ((Array.isArray(t) ? t : [t]).includes("Product")) return c;
        }
      }
    } catch {
      // Bloc illisible : on passe au suivant.
    }
  }
  return null;
}

const meta = (html: string, prop: string) => {
  const m =
    html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']*)["']`, "i")) ??
    html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${prop}["']`, "i"));
  return m ? m[1].trim() : "";
};

function fromHtml(html: string, url: string): ScrapedProduct | null {
  const ld = findLdProduct(html);
  const title = ld?.name || meta(html, "og:title") || (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "").trim();
  if (!title) return null;
  const images: string[] = [];
  if (ld?.image) {
    const arr = Array.isArray(ld.image) ? ld.image : [ld.image];
    for (const i of arr) {
      const src = typeof i === "string" ? i : i?.url;
      if (src) images.push(src);
    }
  }
  for (const m of html.matchAll(/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/gi)) images.push(m[1]);
  const offers = ld?.offers ? (Array.isArray(ld.offers) ? ld.offers : [ld.offers]) : [];
  const price = money(
    offers[0]?.price ?? offers[0]?.priceSpecification?.price ?? meta(html, "product:price:amount") ?? meta(html, "og:price:amount"),
  );
  const description = ld?.description || meta(html, "og:description") || meta(html, "description");
  const brand = typeof ld?.brand === "string" ? ld.brand : (ld?.brand?.name ?? "");
  return {
    sourceUrl: url,
    handle: slug(title),
    title,
    descriptionHtml: description ? `<p>${description}</p>` : "",
    vendor: brand,
    productType: "",
    tags: [],
    options: [],
    variants: [{ title: "Default Title", price, compareAtPrice: "", sku: "", optionValues: [] }],
    images: [...new Set(images)].slice(0, MAX_IMAGES).map((src) => ({ src: src.startsWith("//") ? `https:${src}` : src, alt: "" })),
  };
}

/* ------------------------------ Entree -------------------------------- */

/**
 * Lit les produits derriere un lien : un produit precis, une collection ou
 * une boutique entiere (plafonnee a MAX_PER_LINK).
 */
export async function scrapeLink(raw: string): Promise<ScrapedProduct[]> {
  let u: URL;
  try {
    u = clean(raw);
  } catch {
    throw new ScrapeError(`Lien invalide : ${raw}`);
  }
  const origin = u.origin;
  const langPrefix = u.pathname.match(/^(\/[a-z]{2}(?:-[a-z]{2})?)\/(?:products|collections)\//i)?.[1] ?? "";

  const handle = productHandle(u);
  if (handle) {
    const r = await fetchText(`${origin}${langPrefix}/products/${encodeURIComponent(handle)}.json`, "application/json");
    if (r.status === 200 && r.text.trim().startsWith("{")) {
      try {
        const p = fromShopify((JSON.parse(r.text) as { product?: ShopifyProduct }).product ?? {}, u.toString());
        if (p) return [p];
      } catch {
        // JSON inattendu : on tente la page HTML.
      }
    }
    const page = await fetchText(u.toString(), "text/html");
    if (page.status === 200) {
      const p = fromHtml(page.text, u.toString());
      if (p) return [p];
    }
    throw new ScrapeError(
      `Impossible de lire le produit sur ${u.hostname} (HTTP ${page.status}). Le site est peut-être protégé par mot de passe.`,
    );
  }

  const coll = collectionHandle(u);
  const listUrl = coll
    ? `${origin}${langPrefix}/collections/${encodeURIComponent(coll)}/products.json?limit=${MAX_PER_LINK}`
    : `${origin}/products.json?limit=${MAX_PER_LINK}`;
  const r = await fetchText(listUrl, "application/json");
  if (r.status === 200 && r.text.trim().startsWith("{")) {
    try {
      const list = (JSON.parse(r.text) as { products?: ShopifyProduct[] }).products ?? [];
      const out = list
        .map((p) => fromShopify(p, `${origin}${langPrefix}/products/${p.handle ?? ""}`))
        .filter((p): p is ScrapedProduct => Boolean(p));
      if (out.length) return out;
    } catch {
      // On continue vers le repli HTML.
    }
  }
  const page = await fetchText(u.toString(), "text/html");
  if (page.status === 200) {
    const p = fromHtml(page.text, u.toString());
    if (p) return [p];
  }
  throw new ScrapeError(`Aucun produit lisible sur ${u.hostname} (HTTP ${r.status}). Donne plutôt le lien direct d'une fiche produit.`);
}

/** Lit plusieurs liens, deduplique par titre, remonte les erreurs par lien. */
export async function scrapeLinks(urls: string[]): Promise<{ products: ScrapedProduct[]; errors: string[] }> {
  const products: ScrapedProduct[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  const results = await Promise.allSettled(urls.map((u) => scrapeLink(u)));
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      errors.push((r.reason as Error).message || `Lien illisible : ${urls[i]}`);
      return;
    }
    for (const p of r.value) {
      const key = p.title.toLowerCase().trim();
      if (seen.has(key)) continue;
      seen.add(key);
      products.push(p);
    }
  });
  return { products, errors };
}
