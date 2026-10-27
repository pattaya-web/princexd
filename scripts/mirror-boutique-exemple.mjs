/*
 * Régénère la boutique d'exemple de Scale X (content/boutique-exemple/*.html) :
 * copie HTML en lecture seule d'une boutique Shopify de Mady, servie aux
 * élèves par /api/formation/boutique-exemple sans leur donner l'adresse.
 *
 *   node scripts/mirror-boutique-exemple.mjs
 *
 * - les pages sont téléchargées (accueil, deux produits, la collection) ;
 * - assets laissés sur le CDN Shopify (URL absolues) ;
 * - scripts d'analytics / checkout / apps retirés, le thème (theme.js…) gardé ;
 * - liens internes : les pages incluses pointent vers le miroir, les autres sont neutralisés ;
 * - bandeau « Boutique d'exemple » en haut, panier et formulaires désactivés.
 * Puis commit : le Dockerfile copie content/boutique-exemple dans l'image.
 */
import fs from "fs";
import path from "path";

const HOST = "aesthetics-lab.com";
const BASE = "/api/formation/boutique-exemple?p=";
const OUT = path.join(process.cwd(), "content", "boutique-exemple");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** Les pages du miroir : chemin téléchargé, et les chemins de la boutique qui y renvoient. */
const PAGES = {
  accueil: { source: "/", paths: ["/", "/#how-it-works"] },
  produit: { source: "/products/jawesthetic%C2%AE-3-0-jawline-trainer", paths: ["/products/jawesthetic%C2%AE-3-0-jawline-trainer", "/products/jawesthetic®-3-0-jawline-trainer"] },
  "produit-2": { source: "/products/mouthsthetic%C2%AE-anti-snoring-mouth-tape", paths: ["/products/mouthsthetic%C2%AE-anti-snoring-mouth-tape", "/products/mouthsthetic®-anti-snoring-mouth-tape"] },
  collection: { source: "/collections/all", paths: ["/collections/all", "/collections/protocol", "/collections/best-seller-2026", "/collections/vip-collection"] },
};
const pathToPage = new Map();
for (const [page, def] of Object.entries(PAGES)) for (const p of def.paths) pathToPage.set(p, page);

const DROP_SCRIPT_SRC = [/shopifycloud\/shop-js/, /standard-actions\.js/, /load_feature/, /origin_trials/, /\/checkouts\//, /\/apps\//, /consent-tracking/, /web-pixels/, /googletagmanager|gtag|facebook\.net|klaviyo|hotjar|clarity/];
const DROP_SCRIPT_INLINE = [/trekkie/, /ShopifyAnalytics/, /monorail/, /webPixelsManager/, /Shopify\.loadFeatures/, /BOOMR|boomerang/, /gtag\(|fbq\(|_learnq|klaviyo/, /consent/i, /shopify-pay|shop_pay|ShopPay/i];

function rewriteLink(href) {
  const h = href.trim();
  if (/^(mailto:|tel:|javascript:)/i.test(h)) return h;
  let p = h;
  const m = h.match(/^(?:https?:)?\/\/(?:www\.)?aesthetics?-lab\.com(\/.*)?$/i);
  if (m) p = m[1] || "/";
  if (/^(?:https?:)?\/\//.test(p)) return p; // autre domaine : laissé tel quel
  if (p.startsWith("#")) return p;
  const noQuery = p.split("?")[0].replace(/\s+$/, "");
  const hashless = noQuery.split("#")[0];
  const page = pathToPage.get(noQuery) ?? pathToPage.get(hashless);
  if (page) return BASE + page + (noQuery.includes("#") ? "#" + noQuery.split("#")[1] : "");
  return "#non-inclus";
}

const banner = `<div id="scalex-banner" style="position:sticky;top:0;z-index:99999;background:#111;color:#fff;font:600 13px/1.4 system-ui,sans-serif;padding:9px 14px;display:flex;flex-wrap:wrap;gap:6px 18px;align-items:center;border-bottom:1px solid #333">
<span>Boutique d&rsquo;exemple Scale X &middot; copie en lecture seule, pour regarder la structure (bandeau, b&eacute;n&eacute;fices, preuve, avis, FAQ, offre).</span>
<span style="display:flex;gap:12px;flex-wrap:wrap"><a href="${BASE}accueil" style="color:#ffd84d;text-decoration:none">Accueil</a><a href="${BASE}produit" style="color:#ffd84d;text-decoration:none">Page produit</a><a href="${BASE}produit-2" style="color:#ffd84d;text-decoration:none">Produit 2</a><a href="${BASE}collection" style="color:#ffd84d;text-decoration:none">Collection</a></span>
<span style="opacity:.7;font-weight:400">Les autres liens sont d&eacute;sactiv&eacute;s, le panier aussi.</span></div>
<script>document.addEventListener("click",function(e){var a=e.target.closest&&e.target.closest("a");if(a&&a.getAttribute("href")==="#non-inclus"){e.preventDefault();e.stopPropagation();}},true);document.addEventListener("submit",function(e){e.preventDefault();},true);</script>`;

function transform(page, html) {
  let dropped = 0;
  html = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (all, attrs, body) => {
    const srcM = attrs.match(/\bsrc=["']([^"']+)["']/i);
    if (srcM) {
      if (DROP_SCRIPT_SRC.some((re) => re.test(srcM[1]))) { dropped++; return ""; }
      return all;
    }
    if (DROP_SCRIPT_INLINE.some((re) => re.test(body))) { dropped++; return ""; }
    return all;
  });
  html = html.replace(/<noscript>[\s\S]*?<\/noscript>/gi, (s) => (/facebook|pixel|googletagmanager|klaviyo/i.test(s) ? "" : s));
  html = html.replace(/<link\b[^>]*(rel=["']canonical["']|hreflang=|\/checkouts\/|rel=["']preconnect["'][^>]*monorail)[^>]*>/gi, "");
  html = html.replace(/<meta\b[^>]*property=["']og:url["'][^>]*>/gi, "");
  html = html.replace(/<meta\b[^>]*name=["']robots["'][^>]*>/gi, "");

  html = html.replace(/(src|href|data-src|data-srcset|srcset|poster|content)=(["'])(\/cdn\/)/gi, (m, a, q) => `${a}=${q}https://${HOST}/cdn/`);
  html = html.replace(/url\((["']?)\/cdn\//gi, (m, q) => `url(${q}https://${HOST}/cdn/`);
  html = html.replace(/(["'(])\/\/aesthetics-lab\.com\//g, `$1https://${HOST}/`);

  html = html.replace(/<a\b([^>]*?)\bhref=(["'])([^"']*)\2/gi, (m, pre, q, href) => `<a${pre}href=${q}${rewriteLink(href)}${q}`);
  html = html.replace(/<form\b([^>]*?)\baction=(["'])[^"']*\2/gi, (m, pre, q) => `<form${pre}action=${q}#non-inclus${q}`);

  html = html.replace(/<title>[\s\S]*?<\/title>/i, "<title>Boutique d'exemple · Scale X</title>");
  html = html.replace(/<body([^>]*)>/i, (m) => `${m}\n${banner}`);
  return { html: `<!-- Boutique d'exemple Scale X : copie en lecture seule, page « ${page} ». Généré le ${new Date().toISOString().slice(0, 10)}. -->\n` + html, dropped };
}

fs.mkdirSync(OUT, { recursive: true });
for (const [page, def] of Object.entries(PAGES)) {
  const res = await fetch(`https://${HOST}${def.source}`, { headers: { "User-Agent": UA }, redirect: "follow" });
  if (!res.ok) throw new Error(`${page} : HTTP ${res.status}`);
  const raw = await res.text();
  const { html, dropped } = transform(page, raw);
  fs.writeFileSync(path.join(OUT, `${page}.html`), html);
  console.log(`${page}: ${raw.length} → ${html.length} octets, ${dropped} scripts retirés`);
}
console.log(`OK → ${OUT}`);
