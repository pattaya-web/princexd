"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client";
import { Card, Empty, ErrorNote, Field, InfoNote, Modal, PageHeader, Spinner, Toggle, useToast } from "@/components/ui";
import type { ScrapedProduct, ShopBuild, ShopBuildBrief } from "@/lib/types";
import { ShopifyAffiliate } from "@/components/ShopifyAffiliate";
import { StudentMediaMessage } from "@/components/boutiques/StudentMediaMessage";

/* ------------------------------- Types -------------------------------- */

interface ShopRow {
  id: string;
  name: string;
  domain: string;
  notes: string;
  hasToken: boolean;
  tokenMask: string;
  authMode: "dashboard" | "legacy" | "none";
  clientId?: string;
  shopName?: string;
  currency?: string;
  lastTestAt?: string;
  createdAt: string;
  updatedAt: string;
}

interface ThemeZip {
  name: string;
  size: number;
  uploadedAt: string;
  url: string | null;
}

const SCOPES = [
  "read_products",
  "write_products",
  "read_themes",
  "write_themes",
  "read_content",
  "write_content",
  "read_publications",
  "write_publications",
];

const EMPTY_BRIEF: ShopBuildBrief = {
  brandName: "",
  language: "fr",
  notes: "",
  primaryColor: "",
  secondaryColor: "",
  installTheme: true,
  publishTheme: true,
  priceFactor: 1,
};

const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "");
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} Mo`;

/* -------------------------------- Page -------------------------------- */

export default function BoutiquesPage() {
  const toast = useToast();
  const [shops, setShops] = useState<ShopRow[]>([]);
  const [theme, setTheme] = useState<ThemeZip | null>(null);
  const [loading, setLoading] = useState(true);

  type Editing = Partial<ShopRow> & { accessToken?: string; clientId?: string; clientSecret?: string; mode?: "dashboard" | "legacy" };
  const [editing, setEditing] = useState<Editing | null>(null);
  const blank: Editing = { name: "", domain: "", notes: "", accessToken: "", clientId: "", clientSecret: "", mode: "dashboard" };
  const [testing, setTesting] = useState<string>("");

  // Formulaire de generation.
  const [shopId, setShopId] = useState("");
  const [urlsText, setUrlsText] = useState("");
  const [brief, setBrief] = useState<ShopBuildBrief>(EMPTY_BRIEF);
  const [preview, setPreview] = useState<ScrapedProduct[] | null>(null);
  const [previewErrors, setPreviewErrors] = useState<string[]>([]);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [scraping, setScraping] = useState(false);
  const [formError, setFormError] = useState("");

  // Generation en cours / historique.
  const [build, setBuild] = useState<ShopBuild | null>(null);
  const [history, setHistory] = useState<ShopBuild[]>([]);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(async () => {
    try {
      const [s, t, h] = await Promise.all([
        api<ShopRow[]>("/api/boutiques/shops"),
        api<ThemeZip | null>("/api/boutiques/theme"),
        api<ShopBuild[]>("/api/boutiques/build"),
      ]);
      setShops(s);
      setTheme(t);
      setHistory(h);
      setShopId((cur) => cur || s[0]?.id || "");
      const running = h.find((b) => b.status === "running");
      if (running) setBuild(running);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Suivi d'une generation : relecture toutes les 3 s tant qu'elle tourne.
  useEffect(() => {
    if (!build || build.status !== "running") return;
    pollRef.current = setTimeout(async () => {
      try {
        const b = await api<ShopBuild>(`/api/boutiques/build?id=${build.id}`);
        setBuild(b);
        if (b.status !== "running") {
          setHistory((h) => [b, ...h.filter((x) => x.id !== b.id)]);
          toast(b.status === "done" ? `Boutique « ${b.result?.brandName ?? ""} » générée.` : `Génération en échec : ${b.error ?? ""}`);
        }
      } catch {
        // Reseau : on reessaie au prochain tour.
      }
    }, 3000);
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [build, toast]);

  const urls = useMemo(() => urlsText.split(/\s+/).map((u) => u.trim()).filter((u) => /^https?:\/\//i.test(u)), [urlsText]);
  const selectedShop = shops.find((s) => s.id === shopId);
  const kept = useMemo(() => (preview ?? []).filter((_, i) => !excluded.has(i)), [preview, excluded]);

  /* ----------------------------- Boutiques ----------------------------- */

  async function saveShop() {
    if (!editing) return;
    try {
      if (editing.id) {
        const r = await api<ShopRow>("/api/boutiques/shops", { method: "PATCH", body: JSON.stringify(editing) });
        setShops((s) => s.map((x) => (x.id === r.id ? r : x)));
      } else {
        const r = await api<ShopRow>("/api/boutiques/shops", { method: "POST", body: JSON.stringify(editing) });
        setShops((s) => [r, ...s]);
        setShopId(r.id);
      }
      setEditing(null);
      toast("Boutique enregistrée.");
    } catch (e) {
      toast((e as Error).message, "err");
    }
  }

  async function deleteShop(s: ShopRow) {
    if (!window.confirm(`Retirer la boutique « ${s.name} » de la liste ? (Rien n'est touché côté Shopify.)`)) return;
    await api(`/api/boutiques/shops?id=${s.id}`, { method: "DELETE" });
    setShops((rows) => rows.filter((x) => x.id !== s.id));
    if (shopId === s.id) setShopId("");
  }

  async function testShop(s: ShopRow) {
    setTesting(s.id);
    try {
      const r = await api<{ info: { name: string; currency: string; plan: string }; theme: string; themeError: string }>("/api/boutiques/shops/test", {
        method: "POST",
        body: JSON.stringify({ id: s.id }),
        timeoutMs: 60_000,
      });
      setShops((rows) => rows.map((x) => (x.id === s.id ? { ...x, shopName: r.info.name, currency: r.info.currency, lastTestAt: new Date().toISOString() } : x)));
      toast(`Connecté : ${r.info.name} (${r.info.currency})${r.theme ? ` · thème actif : ${r.theme}` : ""}${r.themeError ? ` · thèmes : ${r.themeError}` : ""}`);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setTesting("");
    }
  }

  /* ------------------------------- Thème ------------------------------- */

  async function uploadTheme(file: File) {
    try {
      const res = await fetch("/api/boutiques/theme", {
        method: "POST",
        headers: { "x-file-name": encodeURIComponent(file.name), "Content-Type": "application/zip" },
        body: file,
      });
      const body = (await res.json()) as ThemeZip & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `Erreur ${res.status}`);
      setTheme({ ...body, uploadedAt: new Date().toISOString() });
      toast("Thème template déposé.");
    } catch (e) {
      toast((e as Error).message, "err");
    }
  }

  async function removeTheme() {
    if (!window.confirm("Retirer le zip du thème template ?")) return;
    await api("/api/boutiques/theme", { method: "DELETE" });
    setTheme(null);
  }

  /* ----------------------------- Génération ---------------------------- */

  async function analyse() {
    setFormError("");
    if (!urls.length) {
      setFormError("Colle au moins un lien concurrent complet (https://…).");
      return;
    }
    setScraping(true);
    setPreview(null);
    setExcluded(new Set());
    try {
      const r = await api<{ products: ScrapedProduct[]; errors: string[] }>("/api/boutiques/scrape", {
        method: "POST",
        body: JSON.stringify({ urls }),
        timeoutMs: 120_000,
      });
      setPreview(r.products);
      setPreviewErrors(r.errors);
      if (!r.products.length) setFormError(r.errors[0] ?? "Aucun produit lisible.");
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setScraping(false);
    }
  }

  async function generate() {
    setFormError("");
    if (!selectedShop) {
      setFormError("Choisis la boutique cliente (ou ajoute-la à gauche).");
      return;
    }
    if (!kept.length) {
      setFormError("Analyse d'abord les liens concurrents et garde au moins un produit.");
      return;
    }
    try {
      const b = await api<ShopBuild>("/api/boutiques/build", {
        method: "POST",
        body: JSON.stringify({ shopId: selectedShop.id, urls, brief, products: kept }),
      });
      setBuild(b);
      setHistory((h) => [b, ...h]);
    } catch (e) {
      setFormError((e as Error).message);
    }
  }

  const running = build?.status === "running";

  return (
    <>
      <PageHeader
        title="Générateur boutique client"
        subtitle="Colle 2 ou 3 liens concurrents, choisis la boutique Shopify du client : les produits sont recréés (prix, variantes, images), le copywriting et les couleurs sont refaits par l'IA sur ton thème template."
        actions={
          <button className="btn btn-primary" onClick={() => setEditing(blank)}>
            + Boutique cliente
          </button>
        }
      />

      <div className="mb-5">
        <ShopifyAffiliate />
      </div>

      <Prerequis />

      <div className="mt-5">
        <StudentMediaMessage brandName={build?.result?.brandName || brief.brandName} hasTheme={Boolean(theme)} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[340px_1fr] mt-5">
        {/* --------------------------- Colonne gauche --------------------------- */}
        <div className="grid gap-5 content-start">
          <Card title="Boutiques clientes" subtitle="Une app personnalisée par boutique, son jeton reste côté serveur.">
            {loading ? (
              <Spinner label="Chargement…" />
            ) : shops.length === 0 ? (
              <Empty action={<button className="btn btn-sm" onClick={() => setEditing(blank)}>Ajouter la première</button>}>
                Aucune boutique reliée pour l&apos;instant.
              </Empty>
            ) : (
              <ul className="grid gap-2">
                {shops.map((s) => (
                  <li
                    key={s.id}
                    className="rounded-xl p-3"
                    style={{
                      border: `1px solid ${s.id === shopId ? "var(--accent-ring)" : "var(--border)"}`,
                      background: s.id === shopId ? "var(--accent-soft)" : "var(--surface-2)",
                    }}
                  >
                    <button className="text-left w-full" onClick={() => setShopId(s.id)}>
                      <div className="font-semibold text-[14px] truncate">{s.name}</div>
                      <div className="mono dim text-[11.5px] truncate">{s.domain}</div>
                      <div className="dim text-[11.5px] mt-1">
                        {s.authMode === "dashboard" ? "App Dev Dashboard" : s.authMode === "legacy" ? "Jeton legacy" : "Aucun accès"}
                        {s.lastTestAt ? ` · ✓ ${s.shopName ?? ""} · ${s.currency ?? ""} · testé le ${fmtDate(s.lastTestAt)}` : " · jamais testée"}
                      </div>
                    </button>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      <button className="btn btn-sm" disabled={testing === s.id} onClick={() => testShop(s)}>
                        {testing === s.id ? "Test…" : "Tester la connexion"}
                      </button>
                      <button className="btn btn-sm btn-ghost" onClick={() => setEditing({ ...s, accessToken: "", clientId: s.authMode === "dashboard" ? s.clientId : "", clientSecret: "", mode: s.authMode === "legacy" ? "legacy" : "dashboard" })}>
                        Modifier
                      </button>
                      <button className="btn btn-sm btn-ghost" onClick={() => deleteShop(s)}>
                        Retirer
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Thème template" subtitle="Le zip exporté depuis Shopify (Thèmes → ⋯ → Télécharger le fichier du thème).">
            {theme ? (
              <div className="text-[13px]">
                <div className="font-medium truncate">{theme.name}</div>
                <div className="dim text-[12px]">
                  {mb(theme.size)} · déposé le {fmtDate(theme.uploadedAt)}
                </div>
                <div className="flex gap-1.5 mt-2.5">
                  <label className="btn btn-sm cursor-pointer">
                    Remplacer
                    <input type="file" accept=".zip" className="hidden" onChange={(e) => e.target.files?.[0] && uploadTheme(e.target.files[0])} />
                  </label>
                  <button className="btn btn-sm btn-ghost" onClick={removeTheme}>
                    Retirer
                  </button>
                </div>
              </div>
            ) : (
              <Empty
                action={
                  <label className="btn btn-sm btn-primary cursor-pointer">
                    Déposer le zip du thème
                    <input type="file" accept=".zip" className="hidden" onChange={(e) => e.target.files?.[0] && uploadTheme(e.target.files[0])} />
                  </label>
                }
              >
                Sans zip, la génération recolore et réécrit le thème déjà actif chez le client.
              </Empty>
            )}
          </Card>

        </div>

        {/* --------------------------- Colonne droite --------------------------- */}
        <div className="grid gap-5 content-start">
          <Card title="Générer une boutique" subtitle={selectedShop ? `Cible : ${selectedShop.name} (${selectedShop.domain})` : "Choisis d'abord une boutique cliente à gauche."}>
            <div className="grid gap-4">
              <Field label="Liens concurrents" hint="Un lien par ligne : fiche produit, collection ou page d'accueil d'une boutique Shopify. 12 produits max par lien.">
                <textarea
                  className="textarea mono min-h-[96px]"
                  placeholder={"https://concurrent.com/products/mon-produit\nhttps://autre-concurrent.com/collections/all"}
                  value={urlsText}
                  onChange={(e) => setUrlsText(e.target.value)}
                  disabled={running}
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Nom de marque" hint="Vide : l'IA en propose un.">
                  <input className="input" value={brief.brandName} onChange={(e) => setBrief({ ...brief, brandName: e.target.value })} placeholder="Ex. Lumea" disabled={running} />
                </Field>
                <Field label="Langue du site (copywriting)" hint="Shop FR ou shop US : titres, descriptions, pages et textes d'accueil sont écrits dans cette langue.">
                  <select className="select" value={brief.language} onChange={(e) => setBrief({ ...brief, language: e.target.value })} disabled={running}>
                    <option value="fr">Français (shop FR)</option>
                    <option value="en">Anglais (shop US / international)</option>
                    <option value="es">Espagnol</option>
                    <option value="de">Allemand</option>
                    <option value="it">Italien</option>
                    <option value="nl">Néerlandais</option>
                    <option value="pt">Portugais</option>
                  </select>
                </Field>
              </div>

              <Field label="Positionnement, cible, ton (optionnel)" hint="Ce que tu dirais au copywriter. Vide : premium accessible, preuve, livraison rapide.">
                <textarea className="textarea min-h-[64px]" value={brief.notes} onChange={(e) => setBrief({ ...brief, notes: e.target.value })} placeholder="Ex. jeunes mamans, ton chaleureux, insister sur la sécurité et la garantie 30 jours" disabled={running} />
              </Field>

              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Couleur principale" hint="Vide : l'IA choisit.">
                  <div className="flex gap-2 items-center">
                    <input type="color" value={brief.primaryColor || "#1f3a5f"} onChange={(e) => setBrief({ ...brief, primaryColor: e.target.value })} disabled={running} className="h-9 w-10 rounded cursor-pointer" />
                    <input className="input mono" value={brief.primaryColor} onChange={(e) => setBrief({ ...brief, primaryColor: e.target.value })} placeholder="#1f3a5f" disabled={running} />
                  </div>
                </Field>
                <Field label="Couleur secondaire">
                  <div className="flex gap-2 items-center">
                    <input type="color" value={brief.secondaryColor || "#e8b86d"} onChange={(e) => setBrief({ ...brief, secondaryColor: e.target.value })} disabled={running} className="h-9 w-10 rounded cursor-pointer" />
                    <input className="input mono" value={brief.secondaryColor} onChange={(e) => setBrief({ ...brief, secondaryColor: e.target.value })} placeholder="#e8b86d" disabled={running} />
                  </div>
                </Field>
                <Field label="Coefficient prix" hint="1 = mêmes prix que le concurrent. 1,1 = +10 %.">
                  <input className="input num" type="number" step="0.05" min="0.1" value={brief.priceFactor} onChange={(e) => setBrief({ ...brief, priceFactor: Number(e.target.value) || 1 })} disabled={running} />
                </Field>
              </div>

              <div className="flex flex-wrap gap-x-6 gap-y-2">
                <Toggle checked={brief.installTheme} onChange={(v) => setBrief({ ...brief, installTheme: v })} label={theme ? "Installer le thème template" : "Installer le thème template (aucun zip déposé)"} />
                <Toggle checked={brief.publishTheme} onChange={(v) => setBrief({ ...brief, publishTheme: v })} label="Le publier comme thème actif" />
              </div>

              <ErrorNote>{formError}</ErrorNote>

              <div className="flex flex-wrap gap-2 items-center">
                <button className="btn" onClick={analyse} disabled={scraping || running || !urls.length}>
                  {scraping ? "Analyse…" : preview ? "Ré-analyser les liens" : "1. Analyser les concurrents"}
                </button>
                <button className="btn btn-primary" onClick={generate} disabled={running || !kept.length || !selectedShop}>
                  {running ? "Génération en cours…" : `2. Générer la boutique${kept.length ? ` (${kept.length} produit${kept.length > 1 ? "s" : ""})` : ""}`}
                </button>
                {scraping && <Spinner label="Lecture des sites concurrents…" />}
              </div>
            </div>
          </Card>

          {preview && (
            <Card title={`Produits trouvés : ${preview.length}`} subtitle="Décoche ce que tu ne veux pas recréer. Prix, variantes et images sont repris tels quels ; titres et descriptions seront réécrits.">
              {previewErrors.length > 0 && (
                <div className="mb-3">
                  <ErrorNote>{previewErrors.join(" · ")}</ErrorNote>
                </div>
              )}
              <ul className="grid gap-2">
                {preview.map((p, i) => {
                  const off = excluded.has(i);
                  return (
                    <li key={`${p.sourceUrl}-${i}`} className="flex gap-3 items-center rounded-xl p-2.5" style={{ border: "1px solid var(--border)", background: off ? "var(--surface-3)" : "var(--surface-2)", opacity: off ? 0.55 : 1 }}>
                      <input
                        type="checkbox"
                        checked={!off}
                        onChange={() =>
                          setExcluded((s) => {
                            const n = new Set(s);
                            if (n.has(i)) n.delete(i);
                            else n.add(i);
                            return n;
                          })
                        }
                        disabled={running}
                      />
                      {p.images[0] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.images[0].src} alt="" className="w-12 h-12 rounded-lg object-cover shrink-0" style={{ background: "var(--surface-3)" }} />
                      ) : (
                        <div className="w-12 h-12 rounded-lg shrink-0" style={{ background: "var(--surface-3)" }} />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-[13.5px] truncate">{p.title}</div>
                        <div className="dim text-[11.5px] truncate">
                          {p.variants[0]?.price ? `${p.variants[0].price}` : "prix inconnu"}
                          {p.variants[0]?.compareAtPrice ? ` (barré ${p.variants[0].compareAtPrice})` : ""} · {p.variants.length} variante{p.variants.length > 1 ? "s" : ""} · {p.images.length} image{p.images.length > 1 ? "s" : ""}
                          {p.options.length ? ` · ${p.options.map((o) => o.name).join(", ")}` : ""}
                        </div>
                        <a href={p.sourceUrl} target="_blank" rel="noreferrer" className="mono dim text-[11px] truncate block hover:underline">
                          {p.sourceUrl}
                        </a>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}

          {build && <BuildCard build={build} onDismiss={() => setBuild(null)} />}

          <Card title="Historique" subtitle="Les dernières générations, toutes boutiques confondues.">
            {history.length === 0 ? (
              <Empty>Aucune génération pour l&apos;instant.</Empty>
            ) : (
              <ul className="grid gap-1.5">
                {history.map((b) => {
                  const shop = shops.find((s) => s.id === b.shopId);
                  return (
                    <li key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] rounded-lg px-3 py-2" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                      <span className="badge" style={{ color: b.status === "done" ? "var(--good)" : b.status === "error" ? "var(--critical)" : "var(--warning)" }}>
                        {b.status === "done" ? "OK" : b.status === "error" ? "Échec" : "En cours"}
                      </span>
                      <span className="font-medium">{b.result?.brandName || b.brief.brandName || "—"}</span>
                      <span className="dim">{shop?.name ?? "boutique retirée"}</span>
                      <span className="dim">{fmtDate(b.createdAt)}</span>
                      {b.result && <span className="dim">{b.result.products.length} produit{b.result.products.length > 1 ? "s" : ""}</span>}
                      <span className="flex-1" />
                      <button className="btn btn-sm btn-ghost" onClick={() => setBuild(b)}>
                        Détails
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {/* --------------------------- Modale boutique --------------------------- */}
      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing?.id ? "Modifier la boutique" : "Relier une boutique cliente"}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setEditing(null)}>
              Annuler
            </button>
            <button
              className="btn btn-primary"
              onClick={saveShop}
              disabled={
                !editing?.domain?.trim() ||
                (!editing?.id &&
                  (editing?.mode === "legacy" ? !editing?.accessToken?.trim() : !editing?.clientId?.trim() || !editing?.clientSecret?.trim()))
              }
            >
              Enregistrer
            </button>
          </>
        }
      >
        {editing && (
          <div className="grid gap-4">
            <Field label="Nom du client / de la marque">
              <input className="input" value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Ex. Boutique de Karim" />
            </Field>
            <Field label="Domaine Shopify" hint="Le .myshopify.com (visible dans l'URL de l'admin), pas le nom de domaine public.">
              <input className="input mono" value={editing.domain ?? ""} onChange={(e) => setEditing({ ...editing, domain: e.target.value })} placeholder="maboutique.myshopify.com" />
            </Field>
            <Field label="Type d'accès">
              <select className="select" value={editing.mode ?? "dashboard"} onChange={(e) => setEditing({ ...editing, mode: e.target.value as "dashboard" | "legacy" })}>
                <option value="dashboard">App Dev Dashboard (Client ID + Client secret) — le cas normal depuis 2026</option>
                <option value="legacy">App personnalisée legacy (jeton shpat_, créée avant 2026)</option>
              </select>
            </Field>
            {(editing.mode ?? "dashboard") === "dashboard" ? (
              <>
                <Field label="Client ID" hint="Dev Dashboard du client → l'app → App settings → Credentials.">
                  <input className="input mono" value={editing.clientId ?? ""} onChange={(e) => setEditing({ ...editing, clientId: e.target.value })} placeholder={editing.id && editing.authMode === "dashboard" ? editing.tokenMask || "Client ID" : "Client ID"} />
                </Field>
                <Field label={editing.id ? "Client secret (laisser vide pour garder l'actuel)" : "Client secret"} hint="Le jeton de 24 h est demandé à Shopify automatiquement à chaque génération.">
                  <input className="input mono" type="password" value={editing.clientSecret ?? ""} onChange={(e) => setEditing({ ...editing, clientSecret: e.target.value })} placeholder="Client secret" />
                </Field>
              </>
            ) : (
              <Field label={editing.id ? "Nouveau jeton Admin API (laisser vide pour garder l'actuel)" : "Jeton Admin API"} hint="Commence par shpat_. Shopify ne le montre qu'une seule fois, à l'installation de l'app.">
                <input className="input mono" value={editing.accessToken ?? ""} onChange={(e) => setEditing({ ...editing, accessToken: e.target.value })} placeholder={editing.id ? editing.tokenMask || "shpat_…" : "shpat_…"} />
              </Field>
            )}
            <Field label="Notes">
              <textarea className="textarea min-h-[56px]" value={editing.notes ?? ""} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} placeholder="Niche, produit, contact du client…" />
            </Field>
          </div>
        )}
      </Modal>
    </>
  );
}

/* ----------------------------- Génération ------------------------------ */

function BuildCard({ build, onDismiss }: { build: ShopBuild; onDismiss: () => void }) {
  const r = build.result;
  const running = build.status === "running";
  return (
    <Card
      title={running ? "Génération en cours" : build.status === "done" ? `Boutique générée : ${r?.brandName ?? ""}` : "Génération en échec"}
      subtitle={running ? build.step : `Lancée le ${fmtDate(build.createdAt)}${build.finishedAt ? `, terminée le ${fmtDate(build.finishedAt)}` : ""}`}
      actions={!running && <button className="btn btn-sm btn-ghost" onClick={onDismiss}>Fermer</button>}
    >
      {running && (
        <div className="mb-3">
          <Spinner label={build.step} />
        </div>
      )}
      {build.error && (
        <div className="mb-3">
          <ErrorNote>{build.error}</ErrorNote>
        </div>
      )}
      {r && (
        <div className="grid gap-3 mb-4">
          <div className="flex flex-wrap gap-2 items-center text-[13px]">
            <span className="inline-block w-5 h-5 rounded-full" style={{ background: r.palette.primary, border: "1px solid var(--border)" }} title={r.palette.primary} />
            <span className="inline-block w-5 h-5 rounded-full" style={{ background: r.palette.secondary, border: "1px solid var(--border)" }} title={r.palette.secondary} />
            {r.tagline && <span className="muted italic">« {r.tagline} »</span>}
          </div>
          <div className="flex flex-wrap gap-2">
            <a className="btn btn-primary btn-sm" href={r.previewUrl} target="_blank" rel="noreferrer">
              Voir la boutique
            </a>
            <a className="btn btn-sm" href={r.adminUrl} target="_blank" rel="noreferrer">
              Ouvrir l&apos;admin Shopify
            </a>
            {r.readyZipFile && (
              <a className={`btn btn-sm ${r.themeId ? "" : "btn-primary"}`} href={`/api/boutiques/build/zip?id=${build.id}`}>
                Télécharger le thème prêt (zip)
              </a>
            )}
            {r.products.slice(0, 6).map((p) => (
              <a key={p.handle} className="btn btn-sm btn-ghost" href={p.adminUrl} target="_blank" rel="noreferrer" title={p.title}>
                {p.title.length > 28 ? `${p.title.slice(0, 27)}…` : p.title}
              </a>
            ))}
          </div>
          {r.readyZipFile && !r.themeId && (
            <InfoNote>
              Shopify n&apos;a pas laissé l&apos;app installer le thème : le thème actif du client n&apos;a pas été touché. Importe le zip prêt à la main : admin → Boutique en ligne → Thèmes → Ajouter un thème → Importer un fichier zip, puis ⋯ → Publier. C&apos;est exactement ton template, recoloré et avec les textes d&apos;accueil réécrits. Les médias, c'est l'élève : envoie-lui le message « Médias » en haut de la page.
            </InfoNote>
          )}
        </div>
      )}
      <details open={running || build.status === "error"}>
        <summary className="label-xs cursor-pointer">Journal ({build.log.length})</summary>
        <ol className="mono text-[11.5px] leading-relaxed mt-2 grid gap-0.5" style={{ color: "var(--text-2)" }}>
          {build.log.map((l, i) => (
            <li key={i}>· {l}</li>
          ))}
        </ol>
      </details>
    </Card>
  );
}

/* ------------------------------ Prérequis ------------------------------ */

function Prerequis() {
  return (
    <details className="card p-4 sm:p-5">
      <summary className="cursor-pointer font-semibold text-[15px]">Prérequis : relier la boutique d&apos;un client (5 minutes, à faire une fois par boutique)</summary>
      <div className="grid gap-3 mt-3 text-[13.5px] leading-relaxed">
        <p className="muted">
          Depuis le 1er janvier 2026, Shopify ne permet plus de créer une « app personnalisée » directement dans l&apos;admin : on passe par le <b>Dev Dashboard</b> de l&apos;organisation du client. Connecté à l&apos;admin du client :
        </p>
        <ol className="list-decimal pl-5 grid gap-1.5">
          <li>
            <b>Paramètres → Applications et canaux de vente → Développer des applications → Créer des apps dans le Dev Dashboard</b>. Dans le Dev Dashboard : <b>Apps → Create app → Start from Dev Dashboard</b>, nom libre (ex. « Générateur »), <b>Create</b>.
          </li>
          <li>
            Page <b>Versions → Create version</b> : App URL par défaut, dernière version d&apos;API, et dans <b>Scopes</b> cocher les accès ci-dessous. <b>Release</b>.
          </li>
          <li>
            Sur la page de l&apos;app, carte <b>Installs → Install app</b> : choisir la boutique du client, <b>Install</b>.
          </li>
          <li>
            <b>App settings → Credentials</b> : copier le <b>Client ID</b> et le <b>Client secret</b>.
          </li>
          <li>
            Ici : <b>+ Boutique cliente</b>, coller le domaine .myshopify.com, le Client ID et le Client secret, puis <b>Tester la connexion</b>. Le jeton de 24 h est demandé à Shopify tout seul, et renouvelé à chaque génération.
          </li>
        </ol>
        <p className="muted">
          L&apos;app doit être créée dans l&apos;organisation <b>du client</b> (depuis son admin), pas dans la tienne : Shopify refuse sinon la connexion (« shop_not_permitted »). Une app créée dans l&apos;admin avant 2026 marche toujours avec son jeton shpat_ (type d&apos;accès « legacy »).
        </p>
        <InfoNote>
          Accès à cocher :{" "}
          {SCOPES.map((s) => (
            <code key={s} className="mono mr-1.5">
              {s}
            </code>
          ))}
        </InfoNote>
        <InfoNote>
          Thème : dépose une fois le zip de ton template (colonne de gauche). À chaque génération il est installé sur la boutique du client, recoloré avec la palette de la marque, ses textes d&apos;accueil sont réécrits, puis il est publié. Si Shopify refuse l&apos;écriture du thème à l&apos;app (« exemption » write_themes, cas rencontré sur certaines apps), la génération continue sans : produits, collection et pages sont créés, et le journal indique quoi faire à la main (Boutique en ligne → Thèmes → Ajouter un thème → Importer le zip). Il te reste à régler chez le client : paiements, livraison, domaine et mentions légales.
        </InfoNote>
        <InfoNote>
          Les images et prix viennent des sites concurrents : vérifie que ton client a le droit d&apos;utiliser ces visuels (images fournisseur AliExpress en général), ou régénère-les ensuite dans le Studio IA.
        </InfoNote>
      </div>
    </details>
  );
}
