/**
 * Client Admin GraphQL Shopify pour une boutique cliente.
 *
 * Chaque boutique est reliee par une « app personnalisee » creee dans son
 * admin (Parametres → Applications → Developper des applications). Le jeton
 * Admin API (shpat_…) qui en sort est celui qu'on stocke sur la fiche.
 *
 * Tout passe par GraphQL (version 2025-01) : l'API REST « Asset », qui
 * servait a ecrire les fichiers d'un theme, n'est plus ouverte aux nouvelles
 * apps ; `themeFilesUpsert` la remplace.
 */
import { update } from "../db";
import type { ClientShop, ScrapedProduct } from "../types";

export const API_VERSION = "2025-01";

export class ShopifyError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
  }
}

/** Portees que l'app personnalisee doit avoir, affichees dans les prerequis. */
export const REQUIRED_SCOPES = [
  "read_products",
  "write_products",
  "read_themes",
  "write_themes",
  "read_content",
  "write_content",
  "read_publications",
  "write_publications",
  "read_files",
  "write_files",
];

export interface ShopInfo {
  name: string;
  myshopifyDomain: string;
  currency: string;
  url: string;
  plan: string;
}

export interface ThemeFile {
  filename: string;
  content: string;
}

export function normalizeDomain(input: string): string {
  let d = input.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (d && !d.includes(".")) d = `${d}.myshopify.com`;
  return d;
}

export class ShopifyAdmin {
  private endpoint: string;
  constructor(
    public domain: string,
    private token: string,
  ) {
    this.endpoint = `https://${normalizeDomain(domain)}/admin/api/${API_VERSION}/graphql.json`;
  }

  /** Lien vers l'admin, pour les boutons « Ouvrir ». */
  adminUrl(path = ""): string {
    const store = normalizeDomain(this.domain).replace(/\.myshopify\.com$/, "");
    return `https://admin.shopify.com/store/${store}${path}`;
  }

  async query<T>(query: string, variables: Record<string, unknown> = {}, attempt = 1): Promise<T> {
    let res: Response;
    try {
      res = await fetch(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": this.token },
        body: JSON.stringify({ query, variables }),
        cache: "no-store",
        signal: AbortSignal.timeout(90_000),
      });
    } catch (e) {
      throw new ShopifyError(`Shopify injoignable (${normalizeDomain(this.domain)}) : ${(e as Error).message}`, 504);
    }
    const text = await res.text();
    if (res.status === 401 || res.status === 403) {
      throw new ShopifyError("Jeton refusé par Shopify. Vérifie le jeton Admin API de l'app personnalisée et ses accès.", 401);
    }
    if (res.status === 404) {
      throw new ShopifyError(`Boutique introuvable : ${normalizeDomain(this.domain)}. Vérifie le domaine .myshopify.com.`, 404);
    }
    if (res.status === 429 && attempt < 5) {
      await new Promise((r) => setTimeout(r, 2000 * attempt));
      return this.query<T>(query, variables, attempt + 1);
    }
    let json: { data?: T; errors?: { message: string; extensions?: { code?: string } }[] };
    try {
      json = JSON.parse(text) as typeof json;
    } catch {
      throw new ShopifyError(`Réponse Shopify illisible (HTTP ${res.status}) : ${text.slice(0, 200)}`, res.status);
    }
    if (json.errors?.length) {
      const throttled = json.errors.some((e) => e.extensions?.code === "THROTTLED");
      if (throttled && attempt < 6) {
        await new Promise((r) => setTimeout(r, 2500 * attempt));
        return this.query<T>(query, variables, attempt + 1);
      }
      const msg = json.errors.map((e) => e.message).join(" · ");
      if (/access denied|not approved|scope/i.test(msg)) {
        throw new ShopifyError(`Accès refusé par Shopify : ${msg}. Ajoute les accès manquants à l'app personnalisée, puis réinstalle-la.`, 403);
      }
      throw new ShopifyError(`Erreur Shopify : ${msg}`, 400);
    }
    if (!json.data) throw new ShopifyError("Shopify n'a rien renvoyé.", 500);
    return json.data;
  }

  async shopInfo(): Promise<ShopInfo> {
    const d = await this.query<{
      shop: { name: string; myshopifyDomain: string; currencyCode: string; url: string; plan: { displayName: string } };
    }>(`{ shop { name myshopifyDomain currencyCode url plan { displayName } } }`);
    return {
      name: d.shop.name,
      myshopifyDomain: d.shop.myshopifyDomain,
      currency: d.shop.currencyCode,
      url: d.shop.url,
      plan: d.shop.plan?.displayName ?? "",
    };
  }

  /** Identifiant du canal « Boutique en ligne », pour publier produits et collections. */
  async onlineStorePublicationId(): Promise<string | null> {
    const d = await this.query<{ publications: { nodes: { id: string; name: string }[] } }>(
      `{ publications(first: 25) { nodes { id name } } }`,
    );
    const pub = d.publications.nodes.find((p) => /online store|boutique en ligne/i.test(p.name)) ?? d.publications.nodes[0];
    return pub?.id ?? null;
  }

  async publish(ids: string[], publicationId: string): Promise<void> {
    for (const id of ids) {
      const d = await this.query<{ publishablePublish: { userErrors: { message: string }[] } }>(
        `mutation($id: ID!, $input: [PublicationInput!]!) {
          publishablePublish(id: $id, input: $input) { userErrors { message } }
        }`,
        { id, input: [{ publicationId }] },
      );
      const err = d.publishablePublish.userErrors[0]?.message;
      if (err && !/already/i.test(err)) throw new ShopifyError(`Publication impossible : ${err}`);
    }
  }

  /**
   * Cree un produit complet en un appel (`productSet`) : options, variantes,
   * prix, images. Shopify telecharge lui-meme les images depuis leurs URL.
   */
  async createProduct(p: ScrapedProduct, extraTags: string[] = []): Promise<{ id: string; handle: string; title: string }> {
    const hasOptions = p.options.length > 0;
    const productOptions = hasOptions
      ? p.options.map((o, i) => ({ name: o.name, position: i + 1, values: o.values.map((v) => ({ name: v })) }))
      : [{ name: "Title", position: 1, values: [{ name: "Default Title" }] }];
    const variants = p.variants.slice(0, 100).map((v) => ({
      optionValues: hasOptions
        ? p.options.map((o, i) => ({ optionName: o.name, name: v.optionValues[i] || o.values[0] || "" }))
        : [{ optionName: "Title", name: "Default Title" }],
      price: v.price || "0.00",
      ...(v.compareAtPrice && Number(v.compareAtPrice) > Number(v.price || 0) ? { compareAtPrice: v.compareAtPrice } : {}),
      ...(v.sku ? { sku: v.sku } : {}),
      inventoryPolicy: "CONTINUE",
      inventoryItem: { tracked: false },
    }));
    const files = p.images.map((i) => ({ originalSource: i.src, alt: i.alt || p.title, contentType: "IMAGE" }));

    const d = await this.query<{
      productSet: { product: { id: string; handle: string; title: string } | null; userErrors: { field?: string[]; message: string }[] };
    }>(
      `mutation($input: ProductSetInput!) {
        productSet(synchronous: true, input: $input) {
          product { id handle title }
          userErrors { field message }
        }
      }`,
      {
        input: {
          title: p.title,
          descriptionHtml: p.descriptionHtml,
          vendor: p.vendor || undefined,
          productType: p.productType || undefined,
          tags: [...new Set([...p.tags, ...extraTags])],
          status: "ACTIVE",
          productOptions,
          variants,
          files,
        },
      },
    );
    const errs = d.productSet.userErrors;
    if (errs.length && !d.productSet.product) {
      throw new ShopifyError(`Produit « ${p.title} » refusé : ${errs.map((e) => e.message).join(" · ")}`);
    }
    if (!d.productSet.product) throw new ShopifyError(`Produit « ${p.title} » non créé.`);
    return d.productSet.product;
  }

  /** Collection automatique : tous les produits portant le tag donne. */
  async createCollection(title: string, handle: string, tag: string, descriptionHtml = ""): Promise<{ id: string; handle: string }> {
    const d = await this.query<{
      collectionCreate: { collection: { id: string; handle: string } | null; userErrors: { message: string }[] };
    }>(
      `mutation($input: CollectionInput!) {
        collectionCreate(input: $input) { collection { id handle } userErrors { message } }
      }`,
      {
        input: {
          title,
          handle,
          descriptionHtml,
          ruleSet: { appliedDisjunctively: false, rules: [{ column: "TAG", relation: "EQUALS", condition: tag }] },
        },
      },
    );
    if (!d.collectionCreate.collection) {
      throw new ShopifyError(`Collection refusée : ${d.collectionCreate.userErrors.map((e) => e.message).join(" · ")}`);
    }
    return d.collectionCreate.collection;
  }

  async createPage(title: string, handle: string, body: string): Promise<string | null> {
    const d = await this.query<{ pageCreate: { page: { id: string } | null; userErrors: { message: string }[] } }>(
      `mutation($page: PageCreateInput!) {
        pageCreate(page: $page) { page { id } userErrors { message } }
      }`,
      { page: { title, handle, body, isPublished: true } },
    );
    return d.pageCreate.page?.id ?? null;
  }

  /* ------------------------------ Themes ------------------------------ */

  async mainTheme(): Promise<{ id: string; name: string } | null> {
    const d = await this.query<{ themes: { nodes: { id: string; name: string }[] } }>(
      `{ themes(first: 1, roles: [MAIN]) { nodes { id name } } }`,
    );
    return d.themes.nodes[0] ?? null;
  }

  /** Installe un theme depuis l'URL publique d'un zip, et attend que Shopify l'ait traite. */
  async createTheme(zipUrl: string, name: string, onWait?: (sec: number) => void): Promise<{ id: string; name: string }> {
    const d = await this.query<{
      themeCreate: { theme: { id: string; name: string } | null; userErrors: { message: string }[] };
    }>(
      `mutation($source: URL!, $name: String!) {
        themeCreate(source: $source, name: $name) { theme { id name } userErrors { message } }
      }`,
      { source: zipUrl, name },
    );
    if (!d.themeCreate.theme) {
      throw new ShopifyError(`Thème refusé : ${d.themeCreate.userErrors.map((e) => e.message).join(" · ")}`);
    }
    const theme = d.themeCreate.theme;
    const t0 = Date.now();
    for (;;) {
      await new Promise((r) => setTimeout(r, 4000));
      const s = await this.query<{ theme: { processing: boolean; processingFailed: boolean } | null }>(
        `query($id: ID!) { theme(id: $id) { processing processingFailed } }`,
        { id: theme.id },
      );
      if (!s.theme) throw new ShopifyError("Le thème a disparu pendant son installation.");
      if (s.theme.processingFailed) throw new ShopifyError("Shopify n'a pas réussi à installer le thème (zip invalide ?).");
      if (!s.theme.processing) return theme;
      onWait?.(Math.round((Date.now() - t0) / 1000));
      if (Date.now() - t0 > 6 * 60_000) throw new ShopifyError("Installation du thème trop longue (6 min).");
    }
  }

  /**
   * Dépose un fichier dans Contenu → Fichiers en gardant son nom : les
   * `shopify://shop_images/<nom>` du thème importé le retrouvent tout seuls.
   */
  async uploadFile(filename: string, buf: Uint8Array, mimeType: string): Promise<{ id: string; status: string }> {
    const isVideo = mimeType.startsWith("video/");
    const isImage = mimeType.startsWith("image/");
    const resource = isVideo ? "VIDEO" : isImage ? "IMAGE" : "FILE";
    const staged = await this.query<{
      stagedUploadsCreate: { stagedTargets: { url: string; resourceUrl: string; parameters: { name: string; value: string }[] }[]; userErrors: { message: string }[] };
    }>(
      `mutation($input: [StagedUploadInput!]!) {
        stagedUploadsCreate(input: $input) { stagedTargets { url resourceUrl parameters { name value } } userErrors { message } }
      }`,
      { input: [{ filename, mimeType, resource, httpMethod: "POST", fileSize: String(buf.byteLength) }] },
    );
    const target = staged.stagedUploadsCreate.stagedTargets[0];
    if (!target) throw new ShopifyError(`Envoi refusé : ${staged.stagedUploadsCreate.userErrors.map((e) => e.message).join(" · ") || "pas de cible d'envoi"}`);
    const form = new FormData();
    for (const p of target.parameters) form.append(p.name, p.value);
    form.append("file", new Blob([new Uint8Array(buf).buffer as ArrayBuffer], { type: mimeType }), filename);
    const up = await fetch(target.url, { method: "POST", body: form, signal: AbortSignal.timeout(180_000) });
    if (!up.ok) throw new ShopifyError(`Envoi du fichier refusé par le stockage Shopify (HTTP ${up.status}).`);
    const created = await this.query<{ fileCreate: { files: { id: string; fileStatus: string }[]; userErrors: { message: string }[] } }>(
      `mutation($files: [FileCreateInput!]!) { fileCreate(files: $files) { files { id fileStatus } userErrors { message } } }`,
      { files: [{ originalSource: target.resourceUrl, filename, contentType: resource, duplicateResolutionMode: "REPLACE" }] },
    );
    const f = created.fileCreate.files[0];
    if (!f) throw new ShopifyError(`Fichier non créé : ${created.fileCreate.userErrors.map((e) => e.message).join(" · ")}`);
    return { id: f.id, status: f.fileStatus };
  }

  async readThemeFiles(themeId: string, filenames: string[]): Promise<ThemeFile[]> {
    const d = await this.query<{
      theme: { files: { nodes: { filename: string; body: { content?: string } }[] } } | null;
    }>(
      `query($id: ID!, $filenames: [String!]!) {
        theme(id: $id) {
          files(filenames: $filenames, first: 20) {
            nodes { filename body { ... on OnlineStoreThemeFileBodyText { content } } }
          }
        }
      }`,
      { id: themeId, filenames },
    );
    return (d.theme?.files.nodes ?? [])
      .filter((n) => typeof n.body?.content === "string")
      .map((n) => ({ filename: n.filename, content: n.body.content! }));
  }

  async writeThemeFiles(themeId: string, files: ThemeFile[]): Promise<void> {
    if (!files.length) return;
    const d = await this.query<{
      themeFilesUpsert: { upsertedThemeFiles: { filename: string }[] | null; userErrors: { filename?: string; message: string }[] };
    }>(
      `mutation($themeId: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) {
        themeFilesUpsert(themeId: $themeId, files: $files) {
          upsertedThemeFiles { filename }
          userErrors { filename message }
        }
      }`,
      { themeId, files: files.map((f) => ({ filename: f.filename, body: { type: "TEXT", value: f.content } })) },
    );
    const errs = d.themeFilesUpsert.userErrors;
    if (errs.length) throw new ShopifyError(`Écriture du thème refusée : ${errs.map((e) => `${e.filename ?? ""} ${e.message}`).join(" · ")}`);
  }

  async publishTheme(themeId: string): Promise<void> {
    const d = await this.query<{ themePublish: { userErrors: { message: string }[] } }>(
      `mutation($id: ID!) { themePublish(id: $id) { theme { id } userErrors { message } } }`,
      { id: themeId },
    );
    const err = d.themePublish.userErrors[0]?.message;
    if (err) throw new ShopifyError(`Publication du thème refusée : ${err}`);
  }
}

/* ------------------------------ Jetons ------------------------------- */

/**
 * Jeton Admin API utilisable maintenant.
 *
 * App Dev Dashboard : echange Client ID + Client secret contre un jeton de
 * 24 h (`grant_type=client_credentials`), garde en cache sur la fiche et
 * renouvele une minute avant expiration. App legacy : le shpat_ tel quel.
 */
export async function resolveAccessToken(shop: ClientShop): Promise<string> {
  const id = shop.clientId?.trim();
  const secret = shop.clientSecret?.trim();
  if (id && secret) {
    const cached = shop.tokenCache;
    if (cached?.token && Date.parse(cached.expiresAt) - Date.now() > 60_000) return cached.token;
    const domain = normalizeDomain(shop.domain);
    let res: Response;
    try {
      res = await fetch(`https://${domain}/admin/oauth/access_token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secret }),
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      throw new ShopifyError(`Shopify injoignable (${domain}) : ${(e as Error).message}`, 504);
    }
    const text = await res.text();
    let json: { access_token?: string; expires_in?: number; error?: string; error_description?: string } = {};
    try {
      json = JSON.parse(text) as typeof json;
    } catch {
      // Reponse non JSON : traitee ci-dessous.
    }
    if (!res.ok || !json.access_token) {
      const code = json.error ?? `HTTP ${res.status}`;
      if (/shop_not_permitted/i.test(text)) {
        throw new ShopifyError(
          "Shopify refuse (shop_not_permitted) : l'app doit être créée dans le Dev Dashboard de l'organisation du client (depuis son admin : Paramètres → Applications → Développer des applications → Dev Dashboard) et installée sur cette boutique.",
          403,
        );
      }
      if (res.status === 401 || res.status === 404 || /invalid_client|invalid_request/i.test(code)) {
        throw new ShopifyError(
          "Client ID ou Client secret refusé par Shopify. Vérifie-les dans Dev Dashboard → App settings → Credentials, et que l'app est bien installée sur la boutique.",
          401,
        );
      }
      throw new ShopifyError(`Jeton refusé par Shopify (${code}) : ${(json.error_description ?? text).slice(0, 200)}`, 401);
    }
    const expiresAt = new Date(Date.now() + Math.max(600, json.expires_in ?? 86399) * 1000).toISOString();
    update("shops", shop.id, { tokenCache: { token: json.access_token, expiresAt } });
    return json.access_token;
  }
  if (shop.accessToken?.trim()) return shop.accessToken.trim();
  throw new ShopifyError("Aucun accès enregistré pour cette boutique : Client ID + Client secret (Dev Dashboard) ou jeton shpat_.", 401);
}

/** Client pret a l'emploi pour une boutique cliente. */
export async function adminFor(shop: ClientShop): Promise<ShopifyAdmin> {
  return new ShopifyAdmin(shop.domain, await resolveAccessToken(shop));
}

/** « gid://shopify/OnlineStoreTheme/123 » → « 123 ». */
export const gidNumber = (gid: string) => gid.split("/").pop() ?? gid;
