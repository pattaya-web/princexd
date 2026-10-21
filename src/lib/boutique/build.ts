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
import { fileText, loadTemplateZip, mediaSlots, parseThemeJson, saveReadyZip, templateZipBuffer } from "./theme-zip";
import { uploadToKie } from "../kie";
import { getSettings, insert, list, update } from "../db";
import type { ClientShop, ScrapedProduct, ShopBuild, ShopBuildBrief } from "../types";
import { recolor, recolorCssRoot } from "./colors";
import { fallbackBrandCopy, faqHtml, generateBrandCopy, generateProductCopy, rewriteTemplateTexts } from "./copy";
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

/** Fichiers du theme dont les textes sont reecrits pour la niche. */
const COPY_FILES = ["templates/index.json", "templates/product.json", "sections/header-group.json", "sections/footer-group.json"];
/** Feuilles de style ou peut vivre la charte (`:root`) d'un theme sur mesure. */
const CSS_FILES = ["assets/base.css", "assets/theme.css", "assets/styles.css", "assets/main.css"];
const THEME_READ_FILES = ["config/settings_data.json", ...COPY_FILES, ...CSS_FILES];

/** Cles qui ne portent jamais de texte a reecrire (liens, medias, mise en page, identifiants). */
const SKIP_KEYS = /url|link$|href|asset|image|video|logo|icon|ratio|color|colour|font|align|size|width|height|layout|style|handle|^id$|_id$|product$|collection$|page$|menu|date|^time|seconds|delay|speed|count|columns|rows|position|anchor|class|css|js|^steps$/i;

export type TemplateJson = IndexJson;

/**
 * Tous les textes d'un template, par cle « fichier|section.cle » ou
 * « fichier|section.bloc.cle ». Une valeur est un texte si elle ressemble a
 * une phrase ou un libelle : pas une URL, un identifiant, une couleur, un
 * nombre ni un mot-cle technique.
 */
export function collectHomepageTexts(index: TemplateJson, prefix = "templates/index.json"): Record<string, string> {
  const out: Record<string, string> = {};
  const usable = (k: string, v: unknown): v is string => {
    if (SKIP_KEYS.test(k)) return false;
    if (typeof v !== "string") return false;
    const t = v.trim();
    if (t.length < 2 || t.length > 1500) return false;
    if (/^(shopify:\/\/|https?:\/\/|\/|#|mailto:|tel:)/i.test(t)) return false;
    if (/^[\d\s.,%€$:+-]+$/.test(t)) return false;
    if (/^[a-z0-9_-]+$/.test(t)) return false; // identifiant, handle, mot-cle (left, right, auto…)
    return true;
  };
  for (const [sid, section] of Object.entries(index.sections ?? {})) {
    for (const [k, v] of Object.entries(section.settings ?? {})) {
      if (usable(k, v)) out[`${prefix}|${sid}.${k}`] = v;
    }
    for (const [bid, block] of Object.entries(section.blocks ?? {})) {
      for (const [k, v] of Object.entries(block.settings ?? {})) {
        if (usable(k, v)) out[`${prefix}|${sid}.${bid}.${k}`] = v;
      }
    }
  }
  return out;
}

/** Ecrit les textes reecrits et pointe les sections vers la nouvelle collection / le premier produit. */
export function applyHomepage(index: TemplateJson, texts: Record<string, string>, prefix: string, collectionHandle: string, productHandle: string): number {
  let changed = 0;
  for (const [sid, section] of Object.entries(index.sections ?? {})) {
    const settings = section.settings ?? {};
    for (const k of Object.keys(settings)) {
      const key = `${prefix}|${sid}.${k}`;
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
        const key = `${prefix}|${sid}.${bid}.${k}`;
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
    const tpls: Record<string, TemplateJson> = {};
    const cssFiles: Record<string, string> = {};
    let settingsJson = "";
    let themeInstalled = false;
    let readyZipFile = "";
    // Le zip template lu localement : sert de repli si Shopify refuse l'installation par l'API.
    const template = zipUrl ? await loadTemplateZip() : null;
    if (zipUrl) {
      say("Installation du thème template (1 à 3 min)…");
      try {
        /*
         * Shopify télécharge le zip lui-même et exige un en-tête Content-Length.
         * Derrière Cloudflare, notre URL n'en a plus (réponse en flux) et
         * Shopify répond « Src is empty ». On héberge donc le zip quelques
         * minutes sur le stockage KIE (qui garde l'en-tête), notre URL servant
         * de repli si cet envoi échoue.
         */
        let source = zipUrl;
        try {
          const raw = await templateZipBuffer();
          if (raw) {
            const file = new File([raw.buffer as ArrayBuffer], "theme-template.zip", { type: "application/zip" });
            source = await uploadToKie(file, "princexd/themes");
            note("Zip du thème hébergé temporairement pour Shopify.");
          }
        } catch (e) {
          note(`Hébergement temporaire du zip impossible (${(e as Error).message}) : essai avec l'URL du site.`);
        }
        const newThemeName = `${brief.brandName || "Boutique"} · ${new Date().toISOString().slice(0, 10)}`;
        const onWait = (sec: number) => update("shopBuilds", id, { step: `Installation du thème template… ${sec}s` });
        let t: { id: string; name: string };
        try {
          t = await admin.createTheme(source, newThemeName, onWait);
        } catch (e) {
          if (source === zipUrl) throw e;
          note(`Installation depuis l'hébergement temporaire refusée (${(e as Error).message}) : essai avec l'URL du site.`);
          t = await admin.createTheme(zipUrl, newThemeName, onWait);
        }
        themeId = t.id;
        themeName = t.name;
        themeInstalled = true;
        note(`Thème installé : ${t.name}.`);
      } catch (e) {
        note(`Thème non installé par l'API : ${(e as Error).message}`);
        note(
          template
            ? "Pas grave : le thème actif du client n'est pas touché. Un zip « thème prêt » (ton template recoloré, textes d'accueil réécrits) sera à télécharger en fin de génération, à importer dans Boutique en ligne → Thèmes → Ajouter un thème → Importer un fichier zip, puis Publier."
            : "À faire à la main : Boutique en ligne → Thèmes → Ajouter un thème → Importer un fichier zip, puis relance une génération sans « Installer le thème » pour le recolorer.",
        );
      }
    }
    if (!themeId && !template) {
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
    if (themeId || template) {
      let files: { filename: string; content: string }[] = [];
      if (themeId) {
        say("Lecture du thème…");
        try {
          files = await admin.readThemeFiles(themeId, THEME_READ_FILES);
        } catch (e) {
          note(`Lecture du thème impossible : ${(e as Error).message}`);
        }
      } else if (template) {
        say("Lecture du thème template (zip)…");
        for (const filename of THEME_READ_FILES) {
          const content = fileText(template.files, filename);
          if (content) files.push({ filename, content });
        }
      }
      settingsJson = files.find((f) => f.filename === "config/settings_data.json")?.content ?? "";
      for (const f of files) {
        if (COPY_FILES.includes(f.filename)) {
          try {
            tpls[f.filename] = parseThemeJson<TemplateJson>(f.content);
            Object.assign(homepageTexts, collectHomepageTexts(tpls[f.filename], f.filename));
          } catch {
            note(`${f.filename} illisible : ses textes ne seront pas réécrits.`);
          }
        } else if (CSS_FILES.includes(f.filename) && /:root\s*{/.test(f.content)) {
          cssFiles[f.filename] = f.content;
        }
      }
      const n = Object.keys(homepageTexts).length;
      if (n) note(`${n} textes du thème à adapter à la niche (${Object.keys(tpls).map((f) => f.replace(/^.*\//, "").replace(/\.json$/, "")).join(", ")}).`);
    }

    say("Copywriting de la marque (IA)…");
    let brand: Awaited<ReturnType<typeof generateBrandCopy>>;
    try {
      brand = await generateBrandCopy(brief, products);
    } catch (e) {
      // Le modèle texte KIE a lâché trois fois : on continue sans slogan ni accueil réécrit.
      brand = fallbackBrandCopy(brief);
      note(`Copywriting de marque indisponible (KIE : ${(e as Error).message}) : slogan, À propos, FAQ et textes d'accueil non générés, relance plus tard pour les avoir. Les produits continuent.`);
    }
    const brandSlug = slug(brand.brandName);
    const tag = `marque:${brandSlug}`;
    note(`Marque : ${brand.brandName}${brand.tagline ? ` — ${brand.tagline}` : ""}. Palette ${brand.palette.primary} / ${brand.palette.secondary}.`);
    if (brand.niche) note(`Niche : ${brand.niche.replace(/\s+/g, " ").slice(0, 300)}${brand.niche.length > 300 ? "…" : ""}`);
    update("shopBuilds", id, { brief: { ...brief, brandName: brand.brandName } });

    say("Réécriture des fiches produit (IA)…");
    const copies = await generateProductCopy(brief, brand, products, (done, total) =>
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

    let rewritten: Record<string, string> = {};
    const totalTexts = Object.keys(homepageTexts).length;
    if (totalTexts) {
      say(`Copywriting du thème pour la niche (IA)… 0/${totalTexts}`);
      rewritten = await rewriteTemplateTexts(brief, brand, homepageTexts, (done, total) =>
        update("shopBuilds", id, { step: `Copywriting du thème pour la niche (IA)… ${done}/${total}` }),
      );
      const got = Object.keys(rewritten).length;
      note(got === totalTexts ? `${got} textes du thème réécrits pour la niche.` : `${got} textes du thème réécrits sur ${totalTexts} : les autres gardent le texte du template (modèle texte capricieux), relance pour compléter.`);
    }

    if (themeId || template) {
      say("Couleurs et textes du thème…");
      const files: { filename: string; content: string }[] = [];
      if (settingsJson) {
        const { json, replaced } = recolor(settingsJson, brand.palette);
        if (replaced) files.push({ filename: "config/settings_data.json", content: json });
        note(replaced ? `${replaced} couleur${replaced > 1 ? "s" : ""} du thème remplacée${replaced > 1 ? "s" : ""}.` : "Aucune couleur saturée trouvée dans le thème : couleurs inchangées.");
      }
      for (const [filename, tpl] of Object.entries(tpls)) {
        const changed = applyHomepage(tpl, rewritten, filename, collectionHandle, created[0]?.handle ?? "");
        // Les accents de couleur des sections (boutons, badges) prennent la couleur secondaire.
        const r = recolor(JSON.stringify(tpl, null, 2), brand.palette, "accent");
        if (changed || r.replaced) {
          files.push({ filename, content: r.json });
          note(`${filename.replace(/^.*\//, "")} : ${changed} texte${changed > 1 ? "s" : ""}${r.replaced ? `, ${r.replaced} couleur${r.replaced > 1 ? "s" : ""} d'accent` : ""}.`);
        }
      }
      for (const [filename, css] of Object.entries(cssFiles)) {
        const r = recolorCssRoot(css, brand.palette);
        if (r.replaced) {
          files.push({ filename, content: r.css });
          note(`${filename.replace(/^.*\//, "")} : charte (:root) passée à la teinte de la marque (${r.replaced} couleurs).`);
        }
      }
      if (themeId) {
        try {
          await admin.writeThemeFiles(themeId, files);
        } catch (e) {
          note(`Écriture du thème : ${(e as Error).message}`);
        }
      }
      if (template) {
        try {
          readyZipFile = await saveReadyZip(template.files, files, id);
          note(
            themeId
              ? "Thème prêt (zip) disponible aussi en téléchargement, au cas où."
              : "Thème prêt (zip) à télécharger ci-dessus : Boutique en ligne → Thèmes → Ajouter un thème → Importer un fichier zip, puis ⋯ → Publier.",
          );
        } catch (e) {
          note(`Zip du thème prêt non généré : ${(e as Error).message}`);
        }
        const media = mediaSlots(template.files).filter((m) => m.file).length;
        if (media) note(`${media} médias (images / vidéos) du template sont à fournir et déposer dans la boutique : voir « Médias du template » dans la colonne de gauche.`);
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
        readyZipFile,
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
