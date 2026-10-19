/**
 * Generation d'une boutique, de bout en bout.
 *
 *  1. produits des concurrents (deja lus par l'apercu, ou lus ici) ;
 *  2. copywriting IA : marque, accueil, fiches produit ;
 *  3. produits + collection + pages crees dans la boutique du client ;
 *  4. theme : installe depuis le zip template (ou le theme actif), recolore,
 *     textes d'accueil remplaces, publie si demande.
 *
 * La tache tourne en fond : la fiche `shopBuilds` porte l'etape et le journal,
 * la page vient les lire toutes les quelques secondes. Chaque etape qui peut
 * rater sans empecher la suite (pages, publication, theme) est journalisee
 * au lieu d'arreter la generation.
 */
import { getSettings, insert, list, update } from "../db";
import type { ClientShop, ScrapedProduct, ShopBuild, ShopBuildBrief } from "../types";
import { recolor } from "./colors";
import { faqHtml, generateBrandCopy, generateProductCopy } from "./copy";
import { scrapeLinks, slug } from "./scrape";
import { adminFor, gidNumber } from "./shopify";

/** Cles de `settings` d'une section dont la valeur est un texte a reecrire. */
const TEXT_KEYS = /^(heading|title|subheading|subtitle|text|description|caption|label|content|announcement|button_label|button_label_1|button_label_2|quote|author|name|tagline|headline|rich_text|paragraph|link_label|promo|cta_text|intro)$/i;

export const DEFAULT_BRIEF: ShopBuildBrief = {
  brandName: "",
  language: "fr",
  notes: "",
  primaryColor: "",
  secondaryColor: "",
  installTheme: true,
  publishTheme: true,
  priceFactor: 1,
};

/** URL publique du zip du theme template, lue par Shopify. */
export function themeZipUrl(): string | null {
  const z = getSettings().shopThemeZip;
  if (!z) return null;
  const base = (process.env.PUBLIC_BASE_URL?.trim() || "https://mvdyprince.fr").replace(/\/$/, "");
  return `${base}/api/boutiques/theme/public/${z.token}.zip`;
}

interface IndexJson {
  sections?: Record<string, { type?: string; settings?: Record<string, unknown>; blocks?: Record<string, { type?: string; settings?: Record<string, unknown> }> }>;
  order?: string[];
}

/** Textes de la page d'accueil, par cle « section.cle » ou « section.bloc.cle ». */
function collectHomepageTexts(index: IndexJson): Record<string, string> {
  const out: Record<string, string> = {};
  const usable = (v: unknown): v is string =>
    typeof v === "string" && v.trim().length >= 2 && v.length <= 900 && !/^shopify:\/\/|^https?:\/\/|^#|^\d+$/.test(v.trim());
  for (const [sid, section] of Object.entries(index.sections ?? {})) {
    for (const [k, v] of Object.entries(section.settings ?? {})) {
      if (TEXT_KEYS.test(k) && usable(v)) out[`${sid}.${k}`] = v;
    }
    for (const [bid, block] of Object.entries(section.blocks ?? {})) {
      for (const [k, v] of Object.entries(block.settings ?? {})) {
        if (TEXT_KEYS.test(k) && usable(v)) out[`${sid}.${bid}.${k}`] = v;
      }
    }
  }
  return out;
}

/** Ecrit les textes reecrits et pointe les sections vers la nouvelle collection / le premier produit. */
function applyHomepage(index: IndexJson, texts: Record<string, string>, collectionHandle: string, productHandle: string): number {
  let changed = 0;
  for (const [sid, section] of Object.entries(index.sections ?? {})) {
    const settings = section.settings ?? {};
    for (const k of Object.keys(settings)) {
      const key = `${sid}.${k}`;
      if (texts[key] !== undefined) {
        settings[k] = texts[key];
        changed++;
      } else if (k === "collection" && typeof settings[k] === "string" && collectionHandle) {
        settings[k] = collectionHandle;
        changed++;
      } else if (k === "product" && typeof settings[k] === "string" && productHandle) {
        settings[k] = productHandle;
        changed++;
      }
    }
    for (const [bid, block] of Object.entries(section.blocks ?? {})) {
      const bs = block.settings ?? {};
      for (const k of Object.keys(bs)) {
        const key = `${sid}.${bid}.${k}`;
        if (texts[key] !== undefined) {
          bs[k] = texts[key];
          changed++;
        } else if (k === "collection" && typeof bs[k] === "string" && collectionHandle) {
          bs[k] = collectionHandle;
          changed++;
        } else if (k === "product" && typeof bs[k] === "string" && productHandle) {
          bs[k] = productHandle;
          changed++;
        }
      }
    }
  }
  return changed;
}

function applyPriceFactor(products: ScrapedProduct[], factor: number): ScrapedProduct[] {
  if (!factor || factor === 1) return products;
  const f = (v: string) => (v ? (Math.round(Number(v) * factor * 100) / 100).toFixed(2) : v);
  return products.map((p) => ({
    ...p,
    variants: p.variants.map((v) => ({ ...v, price: f(v.price), compareAtPrice: f(v.compareAtPrice) })),
  }));
}

export function startBuild(shop: ClientShop, urls: string[], brief: ShopBuildBrief, preloaded?: ScrapedProduct[]): ShopBuild {
  const build = insert("shopBuilds", {
    shopId: shop.id,
    status: "running",
    step: "Démarrage…",
    log: [],
    competitorUrls: urls,
    brief,
    createdAt: new Date().toISOString(),
  }) as unknown as ShopBuild;
  void run(build.id, shop, urls, brief, preloaded);
  return build;
}

async function run(id: string, shop: ClientShop, urls: string[], brief: ShopBuildBrief, preloaded?: ScrapedProduct[]) {
  const log: string[] = [];
  const say = (step: string, line?: string) => {
    if (line) log.push(line);
    update("shopBuilds", id, { step, log: [...log] });
  };
  const note = (line: string) => {
    log.push(line);
    update("shopBuilds", id, { log: [...log] });
  };

  try {
    say("Connexion à la boutique…");
    const admin = await adminFor(shop);
    const info = await admin.shopInfo();
    note(`Connecté à ${info.name} (${info.myshopifyDomain}, ${info.currency}).`);

    say("Lecture des produits concurrents…");
    let products = preloaded?.length ? preloaded : (await scrapeLinks(urls)).products;
    if (!products.length) throw new Error("Aucun produit lisible sur les liens donnés.");
    products = applyPriceFactor(products, brief.priceFactor);
    note(`${products.length} produit${products.length > 1 ? "s" : ""} à recréer${brief.priceFactor !== 1 ? ` (prix × ${brief.priceFactor})` : ""}.`);

    // Theme cible : installe depuis le zip, sinon le theme actif du client.
    let themeId = "";
    let themeName = "";
    const zipUrl = brief.installTheme ? themeZipUrl() : null;
    if (brief.installTheme && !zipUrl) note("Aucun zip de thème déposé : on travaille sur le thème actif de la boutique.");

    let homepageTexts: Record<string, string> = {};
    let indexJson: IndexJson | null = null;
    let settingsJson = "";
    let themeInstalled = false;
    if (zipUrl) {
      say("Installation du thème template (1 à 3 min)…");
      try {
        const t = await admin.createTheme(zipUrl, `${brief.brandName || "Boutique"} · ${new Date().toISOString().slice(0, 10)}`, (sec) =>
          update("shopBuilds", id, { step: `Installation du thème template… ${sec}s` }),
        );
        themeId = t.id;
        themeName = t.name;
        themeInstalled = true;
        note(`Thème installé : ${t.name}.`);
      } catch (e) {
        note(`Thème non installé par l'API : ${(e as Error).message}`);
        note("À faire à la main : Boutique en ligne → Thèmes → Ajouter un thème → Importer un fichier zip, puis relance une génération sans « Installer le thème » pour le recolorer.");
      }
    }
    if (!themeId) {
      try {
        const main = await admin.mainTheme();
        if (main) {
          themeId = main.id;
          themeName = main.name;
          note(`Thème actif : ${main.name}.`);
        }
      } catch (e) {
        note(`Thèmes inaccessibles : ${(e as Error).message}`);
      }
    }
    if (themeId) {
      say("Lecture du thème…");
      let files: { filename: string; content: string }[] = [];
      try {
        files = await admin.readThemeFiles(themeId, ["config/settings_data.json", "templates/index.json"]);
      } catch (e) {
        note(`Lecture du thème impossible : ${(e as Error).message}`);
      }
      settingsJson = files.find((f) => f.filename === "config/settings_data.json")?.content ?? "";
      const idx = files.find((f) => f.filename === "templates/index.json")?.content ?? "";
      try {
        indexJson = idx ? (JSON.parse(idx) as IndexJson) : null;
      } catch {
        indexJson = null;
        note("templates/index.json illisible : les textes d'accueil ne seront pas réécrits.");
      }
      if (indexJson) homepageTexts = collectHomepageTexts(indexJson);
    }

    say("Copywriting de la marque (IA)…");
    const brand = await generateBrandCopy(brief, products, homepageTexts);
    const brandSlug = slug(brand.brandName);
    const tag = `marque:${brandSlug}`;
    note(`Marque : ${brand.brandName}${brand.tagline ? ` — ${brand.tagline}` : ""}. Palette ${brand.palette.primary} / ${brand.palette.secondary}.`);
    update("shopBuilds", id, { brief: { ...brief, brandName: brand.brandName } });

    say("Réécriture des fiches produit (IA)…");
    const copies = await generateProductCopy(brief, brand.brandName, products, (done, total) =>
      update("shopBuilds", id, { step: `Réécriture des fiches produit (IA)… ${done}/${total}` }),
    );

    const created: { title: string; handle: string; id: string }[] = [];
    for (let i = 0; i < products.length; i++) {
      const p = { ...products[i], title: copies[i].title, descriptionHtml: copies[i].descriptionHtml, vendor: brand.brandName };
      say(`Création des produits… ${i + 1}/${products.length}`);
      try {
        const r = await admin.createProduct(p, [tag]);
        created.push({ title: r.title, handle: r.handle, id: r.id });
        note(`Produit créé : ${r.title} (${p.images.length} image${p.images.length > 1 ? "s" : ""}, ${p.variants.length} variante${p.variants.length > 1 ? "s" : ""}).`);
      } catch (e) {
        note(`Produit ignoré « ${p.title} » : ${(e as Error).message}`);
      }
    }
    if (!created.length) throw new Error("Aucun produit n'a pu être créé dans la boutique.");

    say("Collection et pages…");
    let collectionHandle = "";
    let collectionId = "";
    try {
      const c = await admin.createCollection("Tous nos produits", `tous-nos-produits-${brandSlug}`.slice(0, 60), tag, brand.tagline ? `<p>${brand.tagline}</p>` : "");
      collectionHandle = c.handle;
      collectionId = c.id;
      note(`Collection créée : ${c.handle}.`);
    } catch (e) {
      note(`Collection non créée : ${(e as Error).message}`);
    }
    try {
      if (brand.about) await admin.createPage("À propos", "a-propos", brand.about);
      if (brand.faq.length) await admin.createPage("FAQ", "faq", faqHtml(brand.faq));
      note("Pages À propos et FAQ créées.");
    } catch (e) {
      note(`Pages non créées : ${(e as Error).message}`);
    }

    say("Publication sur la boutique en ligne…");
    try {
      const pub = await admin.onlineStorePublicationId();
      if (pub) {
        await admin.publish([...created.map((c) => c.id), ...(collectionId ? [collectionId] : [])], pub);
        note("Produits et collection publiés sur la boutique en ligne.");
      } else note("Canal « Boutique en ligne » introuvable : publie les produits à la main.");
    } catch (e) {
      note(`Publication : ${(e as Error).message}`);
    }

    if (themeId) {
      say("Couleurs et textes du thème…");
      const files: { filename: string; content: string }[] = [];
      if (settingsJson) {
        const { json, replaced } = recolor(settingsJson, brand.palette);
        if (replaced) files.push({ filename: "config/settings_data.json", content: json });
        note(replaced ? `${replaced} couleur${replaced > 1 ? "s" : ""} du thème remplacée${replaced > 1 ? "s" : ""}.` : "Aucune couleur saturée trouvée dans le thème : couleurs inchangées.");
      }
      if (indexJson) {
        const changed = applyHomepage(indexJson, brand.homepage, collectionHandle, created[0]?.handle ?? "");
        if (changed) files.push({ filename: "templates/index.json", content: JSON.stringify(indexJson, null, 2) });
        note(`${changed} texte${changed > 1 ? "s" : ""} de la page d'accueil réécrit${changed > 1 ? "s" : ""}.`);
      }
      try {
        await admin.writeThemeFiles(themeId, files);
      } catch (e) {
        note(`Écriture du thème : ${(e as Error).message}`);
      }
      if (brief.publishTheme && themeInstalled) {
        try {
          await admin.publishTheme(themeId);
          note("Thème publié : il est maintenant le thème actif.");
        } catch (e) {
          note(`Thème non publié : ${(e as Error).message}`);
        }
      }
    }

    const storeUrl = info.url || `https://${info.myshopifyDomain}`;
    const previewUrl = themeId ? `${storeUrl}/?preview_theme_id=${gidNumber(themeId)}` : storeUrl;
    update("shopBuilds", id, {
      status: "done",
      step: "Terminé",
      finishedAt: new Date().toISOString(),
      result: {
        brandName: brand.brandName,
        tagline: brand.tagline,
        palette: brand.palette,
        products: created.map((c) => ({ title: c.title, handle: c.handle, adminUrl: admin.adminUrl(`/products/${gidNumber(c.id)}`) })),
        collectionHandle,
        themeId,
        themeName,
        previewUrl,
        storeUrl,
        adminUrl: admin.adminUrl(themeId ? "/themes" : "/products"),
      },
    });
    update("shops", shop.id, { updatedAt: new Date().toISOString() });
  } catch (e) {
    update("shopBuilds", id, {
      status: "error",
      step: "Échec",
      error: (e as Error).message || "Échec de la génération.",
      finishedAt: new Date().toISOString(),
      log: [...log],
    });
  }
}

/** Une generation encore en cours pour cette boutique ? */
export function runningBuild(shopId: string): ShopBuild | undefined {
  return (list("shopBuilds") as ShopBuild[]).find((b) => b.shopId === shopId && b.status === "running");
}

/** Au demarrage du serveur, les generations coupees en plein vol passent en erreur. */
export function failInterruptedBuilds() {
  for (const b of list("shopBuilds") as ShopBuild[]) {
    if (b.status === "running") {
      update("shopBuilds", b.id, { status: "error", step: "Interrompu", error: "Le serveur a redémarré pendant la génération. Relance-la.", finishedAt: new Date().toISOString() });
    }
  }
}
