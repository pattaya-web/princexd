import { createHmac, timingSafeEqual } from "crypto";
import fs from "fs";
import path from "path";
import { getSettings, newId, readDB, writeDB } from "@/lib/db";
import { salesMembers } from "@/lib/sales/repo";
import { memberRoles } from "@/lib/sales/roles";
import { leadIsOut, type DB, type Lead, type SalesFunnel, type TeamMember } from "@/lib/types";
import { applyOptInAttribution, applyTouch, ensureFunnelsV2, funnelForUrl, funnelsOf, touchFromUrl, type TouchInput } from "./sales/attribution";

/**
 * Systeme.io : les prospects de la landing page arrivent dans le CRM.
 *
 * Deux voies, complementaires :
 *  - le webhook CONTACT_OPT_IN / CONTACT_CREATED, qui pousse le contact a la
 *    seconde ou il s'inscrit (un setter appelle dans les cinq minutes) ;
 *  - une synchro par l'API publique (contacts les plus recents), lancee a
 *    l'ouverture de l'espace commercial au plus toutes les trois minutes, qui
 *    rattrape tout webhook manque. Elle suffit seule si le webhook n'est pas
 *    configure.
 *
 * Un contact devient un lead « nouveau », source « lp », attribue a un
 * setter, avec son telephone, son email, son pays et l'URL de la page
 * d'origine. Jamais de doublon : on retrouve le lead par identifiant
 * Systeme.io, puis par email, puis par telephone.
 */

const BASE = "https://api.systeme.io/api";
const SYNC_MIN_INTERVAL_MS = 3 * 60_000;
const SYNC_MAX_CONTACTS = 300;
// Premiere synchro : un mois d'inscrits, pour que la liste ne demarre pas vide.
const FIRST_SYNC_DAYS = 30;

export class SystemeioError extends Error {
  code: number;
  constructor(message: string, code = 502) {
    super(message);
    this.code = code;
  }
}

export interface SioField {
  fieldName?: string;
  slug?: string;
  value?: string | null;
}

export interface SioContact {
  id: number | string;
  email?: string;
  registeredAt?: string;
  locale?: string;
  sourceURL?: string;
  unsubscribed?: boolean;
  fields?: SioField[];
  tags?: { id?: number; name?: string }[];
}

/** Cle effective : la variable d'environnement gagne sur les reglages. */
export function getSystemeioKey(): string {
  return process.env.SYSTEMEIO_API_KEY?.trim() || (getSettings().systemeioApiKey ?? "").trim();
}

export function getWebhookSecret(): string {
  return process.env.SYSTEMEIO_WEBHOOK_SECRET?.trim() || (getSettings().systemeioWebhookSecret ?? "").trim();
}

async function sio<T>(path: string, init: RequestInit = {}): Promise<T> {
  const key = getSystemeioKey();
  if (!key) throw new SystemeioError("Clé API Systeme.io manquante (Réglages → Systeme.io ou SYSTEMEIO_API_KEY).", 401);
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { "X-API-Key": key, Accept: "application/json", "Content-Type": "application/json", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    const cause = (e as { cause?: { code?: string; message?: string } }).cause;
    throw new SystemeioError(`Systeme.io injoignable (${cause?.code ?? cause?.message ?? (e as Error).message}).`, 502);
  }
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (!res.ok) {
    const detail = (body as { detail?: string; title?: string } | null)?.detail ?? (body as { title?: string } | null)?.title ?? text.slice(0, 200);
    throw new SystemeioError(`Systeme.io ${res.status} : ${detail || "erreur"}`, res.status === 401 ? 401 : 502);
  }
  return body as T;
}

/** Les contacts les plus recents en premier (limite 10 a 100 par page chez eux). */
export async function listRecentContacts(max = SYNC_MAX_CONTACTS, stopBefore?: string): Promise<SioContact[]> {
  const out: SioContact[] = [];
  let startingAfter: string | number | undefined;
  while (out.length < max) {
    const limit = Math.min(100, Math.max(10, max - out.length));
    const qs = new URLSearchParams({ limit: String(limit), order: "desc" });
    if (startingAfter !== undefined) qs.set("startingAfter", String(startingAfter));
    const page = await sio<{ items: SioContact[]; hasMore: boolean }>(`/contacts?${qs}`);
    const items = page.items ?? [];
    for (const c of items) {
      // Trie decroissant : passe la borne, tout le reste est plus vieux.
      if (stopBefore && c.registeredAt && c.registeredAt < stopBefore) return out;
      out.push(c);
    }
    if (!page.hasMore || !items.length) break;
    startingAfter = items[items.length - 1].id;
  }
  return out;
}

export async function getContact(id: string | number): Promise<SioContact> {
  return sio<SioContact>(`/contacts/${encodeURIComponent(String(id))}`);
}

export interface SioWebhook {
  id: string;
  name: string;
  url: string;
  active: boolean;
  subscriptions: { id: string; event: string; disabledAt: string | null }[];
}

export async function listWebhooks(): Promise<SioWebhook[]> {
  const page = await sio<{ items: SioWebhook[] }>(`/webhooks?limit=10`);
  return page.items ?? [];
}

export async function createWebhook(url: string, secret: string): Promise<SioWebhook> {
  return sio<SioWebhook>(`/webhooks`, {
    method: "POST",
    body: JSON.stringify({
      name: "MPGate CRM",
      url,
      secret,
      active: true,
      subscriptions: [
        { event: "CONTACT_OPT_IN", schemaVersion: 1 },
        { event: "CONTACT_CREATED", schemaVersion: 1 },
      ],
    }),
  });
}

/* ------------------------------ Signature ------------------------------- */

/**
 * Verifie X-Webhook-Signature (HMAC-SHA256 du corps brut avec le secret).
 * Systeme.io signe une forme « normalisee » du JSON : on accepte le corps
 * brut, sa version compacte et sa version avec slashes echappes, qui sont
 * les trois representations qu'on a vues. Sans secret configure, on ne
 * verifie rien ici : le webhook re-lit alors le contact par l'API, ce qui
 * authentifie la donnee de toute facon.
 */
export function verifySignature(raw: string, signature: string | null, secret: string): boolean {
  if (!secret || !signature) return false;
  const candidates = [raw];
  try {
    const parsed = JSON.parse(raw);
    candidates.push(JSON.stringify(parsed));
    candidates.push(JSON.stringify(parsed).replace(/\//g, "\\/"));
  } catch {
    // corps non JSON : seule la forme brute est testee
  }
  const given = Buffer.from(signature.trim().replace(/^sha256=/i, ""), "utf8");
  for (const c of candidates) {
    const mac = Buffer.from(createHmac("sha256", secret).update(c).digest("hex"), "utf8");
    if (mac.length === given.length && timingSafeEqual(mac, given)) return true;
  }
  return false;
}

/* -------------------------------- Import -------------------------------- */

const fieldOf = (c: SioContact, slug: string) =>
  (c.fields ?? []).find((f) => f.slug === slug)?.value?.toString().trim() ?? "";

const digits = (v: string) => v.replace(/\D/g, "");

function normalizePhone(raw: string): string {
  const d = digits(raw);
  if (!d) return "";
  // Numeros francais saisis sans indicatif ou avec le 0 : on unifie en +33.
  if (d.length === 10 && d.startsWith("0")) return `+33${d.slice(1)}`;
  if (d.startsWith("33") && d.length === 11) return `+${d}`;
  return `+${d}`;
}

/** Le contact vient-il bien de la landing page ? (filtre optionnel sur l'URL d'origine) */
export function matchesSourceFilter(c: SioContact, filter: string): boolean {
  const f = filter.trim().toLowerCase();
  if (!f) return true;
  const url = (c.sourceURL ?? "").toLowerCase();
  const tags = (c.tags ?? []).map((t) => (t.name ?? "").toLowerCase());
  return f.split(",").map((s) => s.trim()).filter(Boolean).some((needle) => url.includes(needle) || tags.includes(needle));
}

function activeSetters(db: DB): TeamMember[] {
  return salesMembers(db).filter((m) => m.status !== "inactif" && memberRoles(m).includes("setter"));
}

/**
 * Attribution d'un lead frais.
 * « pool » (par defaut) : personne. Le lead est visible de tous les setters
 * et le premier qui l'appelle le prend (voir la route des leads).
 * « default » : le setter par defaut des reglages. « round-robin » : le
 * setter actif qui a le moins de leads LP encore a appeler, pour repartir la
 * charge sans compteur a maintenir.
 */
function pickSetter(db: DB): string {
  const s = db.settings;
  const mode = s.salesLeadAssignment ?? "pool";
  if (mode === "pool") return "";
  const setters = activeSetters(db);
  if (mode === "round-robin" && setters.length) {
    const load = new Map(setters.map((m) => [m.id, 0]));
    for (const l of db.leads) {
      if (l.source === "lp" && (l.stage === "nouveau" || l.stage === "contacte") && l.setterId && load.has(l.setterId)) {
        load.set(l.setterId, (load.get(l.setterId) ?? 0) + 1);
      }
    }
    return [...load.entries()].sort((a, b) => a[1] - b[1])[0][0];
  }
  if (s.salesDefaultSetterId && db.team.some((m) => m.id === s.salesDefaultSetterId)) return s.salesDefaultSetterId;
  return setters[0]?.id ?? "";
}

export interface ImportReport {
  /** Contacts lus chez Systeme.io. */
  examined: number;
  created: number;
  updated: number;
  /** Deja en base et rien a completer. */
  known: number;
  skipped: number;
  leads: Lead[];
}

/** Integre des contacts dans la base (sans ecrire : l'appelant fait le writeDB). */
export function importContacts(db: DB, contacts: SioContact[], actorName = "Systeme.io", opts: { coldBefore?: string } = {}): ImportReport {
  const report: ImportReport = { examined: contacts.length, created: 0, updated: 0, known: 0, skipped: 0, leads: [] };
  ensureFunnelsV2(db);
  const filter = db.settings.systemeioSourceFilter ?? "";
  const ignored = new Set(db.settings.systemeioIgnoredIds ?? []);
  const today = new Date().toISOString().slice(0, 10);

  for (const c of contacts) {
    const sioId = String(c.id ?? "");
    const email = (c.email ?? "").trim().toLowerCase();
    const phone = normalizePhone(fieldOf(c, "phone_number"));
    if (!sioId || (!email && !phone)) { report.skipped++; continue; }
    // Le filtre des reglages, plus les URL / tags des funnels declares : un funnel organique remonte aussi.
    if (!matchesSourceFilter(c, [filter, ...funnelsOf(db).map((f) => f.match)].filter(Boolean).join(","))) { report.skipped++; continue; }
    // Supprime a la main par l'admin : on ne le fait pas revenir.
    if (ignored.has(sioId)) { report.skipped++; continue; }

    const first = fieldOf(c, "first_name");
    const last = fieldOf(c, "surname");
    const name = [first, last].filter(Boolean).join(" ").trim() || email.split("@")[0] || phone;
    const country = fieldOf(c, "country");

    const existing =
      db.leads.find((l) => l.systemeioId === sioId) ??
      (email ? db.leads.find((l) => (l.email ?? "").toLowerCase() === email) : undefined) ??
      (phone ? db.leads.find((l) => l.phone && digits(l.phone) === digits(phone)) : undefined);

    if (existing) {
      // On complete les trous, jamais on n'ecrase ce qu'un setter a saisi.
      let changed = false;
      const fill = <K extends keyof Lead>(k: K, v: Lead[K]) => {
        if (v && !existing[k]) { existing[k] = v; changed = true; }
      };
      fill("systemeioId", sioId);
      fill("email", email);
      fill("phone", phone);
      fill("country", country);
      fill("optInAt", c.registeredAt ?? "");
      fill("sourceUrl", c.sourceURL ?? "");
      if ((existing.name === "Sans nom" || !existing.name) && name) { existing.name = name; changed = true; }
      if (changed) report.updated++;
      else report.known++;
      continue;
    }

    const setterId = pickSetter(db);
    const lead: Lead = {
      id: newId(),
      name,
      handle: "",
      source: "lp",
      stage: "nouveau",
      dealValue: 0,
      callAt: "",
      ownerRole: "setter",
      ownerName: db.team.find((m) => m.id === setterId)?.name ?? "",
      painPoint: "",
      nextAction: "Appeler le prospect",
      nextActionAt: today,
      // Pas de note automatique : la note est celle du setter. La page d'origine vit dans `sourceUrl`.
      notes: "",
      createdAt: new Date().toISOString(),
      igUsername: "",
      email,
      phone,
      country,
      timezone: country && country !== "FR" ? "" : "Europe/Paris",
      setterId,
      systemeioId: sioId,
      optInAt: c.registeredAt ?? new Date().toISOString(),
      sourceUrl: c.sourceURL ?? "",
      callAttempts: 0,
      lastCallAt: "",
    };
    // La page d'opt-in dit le funnel ; ses utm / fbclid / IDs Meta (query string) rendent l'attribution Ads fiable.
    applyTouch(lead, touchFromUrl(lead.sourceUrl ?? "", { hint: "systemeio" }), lead.optInAt || lead.createdAt, funnelsOf(db));
    // Historique : un inscrit d'il y a des mois est un lead froid, pas un lead a appeler.
    if (opts.coldBefore && lead.optInAt && lead.optInAt < opts.coldBefore) {
      lead.callStatus = "cold";
      lead.lastCallAt = lead.optInAt;
      lead.nextAction = "";
      lead.nextActionAt = "";
    }
    db.leads.unshift(lead);
    db.activityLogs.unshift({
      id: newId(),
      at: lead.createdAt,
      actorId: "",
      actorName,
      action: "lead.created",
      entity: "lead",
      entityId: lead.id,
      summary: `Nouveau lead landing page : ${lead.name}${lead.phone ? ` (${lead.phone})` : ""} → ${lead.ownerName || "tous les setters"}`,
    });
    report.created++;
    report.leads.push(lead);
  }
  return report;
}

/**
 * Import de TOUT l'historique Systeme.io (toutes les pages de l'API), pour
 * que chaque contact des funnels declares existe dans le CRM. Les inscrits
 * de plus de `coldDays` jours arrivent en « lead froid » : ils comptent dans
 * les chiffres et se retrouvent dans le CRM, sans encombrer la liste a
 * appeler. Les contacts deja en base sont completes, jamais dupliques.
 */
export async function backfillSystemeio(coldDays = 30, actorName = "Import complet Systeme.io"): Promise<ImportReport> {
  if (!getSystemeioKey()) throw new SystemeioError("Aucune clé API Systeme.io.");
  const contacts = await listRecentContacts(20_000);
  const db = readDB();
  const coldBefore = new Date(Date.now() - coldDays * 86_400_000).toISOString();
  const report = importContacts(db, contacts, actorName, { coldBefore });
  db.settings.systemeioLastSyncAt = new Date().toISOString();
  db.activityLogs.unshift({
    id: newId(),
    at: new Date().toISOString(),
    actorId: "",
    actorName,
    action: "lead.import",
    entity: "lead",
    entityId: "",
    summary: `Import complet Systeme.io : ${contacts.length} contacts lus, ${report.created} créés (${report.created ? "anciens inscrits en lead froid" : "rien de nouveau"}), ${report.updated} complétés, ${report.skipped} hors funnels`,
  });
  writeDB(db);
  return report;
}

/* -------------------------------- Synchro ------------------------------- */

let syncing: Promise<ImportReport | null> | null = null;

/**
 * Synchro par l'API, au plus toutes les trois minutes sauf `force`.
 * Renvoie null quand rien n'a ete tente (pas de cle, trop tot).
 */
export async function syncSystemeio(opts: { force?: boolean } = {}): Promise<ImportReport | null> {
  if (syncing) {
    // Une synchro tourne deja : on la laisse finir. Forcee, on en relance une
    // derriere plutot que d'heriter d'un « trop tot » qui ne nous concerne pas.
    const inflight = await syncing.catch(() => null);
    if (!opts.force) return inflight;
  }
  syncing = (async () => {
    try {
      if (!getSystemeioKey()) return null;
      const settings = getSettings();
      const last = settings.systemeioLastSyncAt ?? "";
      if (!opts.force && last && Date.now() - new Date(last).getTime() < SYNC_MIN_INTERVAL_MS) return null;
      // Marge de 24 h sur la borne : les horloges et les webhooks en retard ne font perdre personne.
      // Premiere synchro : le dernier mois. Un setter appelle les inscrits
      // recents, pas des annees d'historique d'un coup.
      const stopBefore = last
        ? new Date(new Date(last).getTime() - 24 * 3600_000).toISOString()
        : new Date(Date.now() - FIRST_SYNC_DAYS * 24 * 3600_000).toISOString();
      const contacts = await listRecentContacts(SYNC_MAX_CONTACTS, stopBefore);
      const db = readDB();
      const report = importContacts(db, contacts, "Synchro Systeme.io");
      db.settings.systemeioLastSyncAt = new Date().toISOString();
      writeDB(db);
      return report;
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

/* ------------------------------ Opt-in (webhook) ------------------------- */

/** Au-dela, un CONTACT_OPT_IN sur un contact deja inscrit est une reinscription. */
const REOPTIN_AFTER_MS = 60 * 60_000;
/** Deux webhooks pour le meme opt-in (CONTACT_CREATED + CONTACT_OPT_IN, API + automatisation) arrivent dans cette fenetre. */
const SAME_OPTIN_WINDOW_MS = 15 * 60_000;

export interface SioFunnelStep {
  id: number;
  name?: string;
  type?: string;
  url?: string;
}

const stepsCache = new Map<string, { at: number; steps: SioFunnelStep[] }>();

/** Les etapes d'un funnel Systeme.io (avec l'URL de chaque page), en cache une heure. */
export async function listFunnelSteps(funnelId: string | number): Promise<SioFunnelStep[]> {
  const key = String(funnelId);
  const hit = stepsCache.get(key);
  if (hit && Date.now() - hit.at < 3600_000) return hit.steps;
  const page = await sio<{ items: SioFunnelStep[] }>(`/funnels/${encodeURIComponent(key)}/steps?limit=100`);
  const steps = page.items ?? [];
  stepsCache.set(key, { at: Date.now(), steps });
  return steps;
}

/** L'URL de la page d'une etape de funnel, "" si on ne la retrouve pas. */
export async function funnelStepUrl(funnelId: string | number | undefined, stepId: string | number | undefined): Promise<string> {
  if (funnelId === undefined || stepId === undefined) return "";
  try {
    const steps = await listFunnelSteps(funnelId);
    return steps.find((s) => String(s.id) === String(stepId))?.url ?? "";
  } catch {
    return "";
  }
}

/** Ce que le webhook sait de l'opt-in, en plus du contact. */
export interface OptInEvent {
  /** Date de l'opt-in (ISO). */
  at: string;
  /** Page sur laquelle le contact vient de s'inscrire, quand Systeme.io la dit (webhook d'automatisation). */
  pageUrl?: string;
  /** Noms du funnel et de l'etape (webhook d'automatisation), pour reconnaitre un funnel par son nom. */
  funnelName?: string;
  stepName?: string;
}

export interface OptInReport extends ImportReport {
  lead: Lead | null;
  /** Le contact etait deja inscrit chez Systeme.io avant cet opt-in. */
  reoptin: boolean;
  /** La page de l'opt-in est connue (message, premier opt-in ou tag) ; sinon c'est le repli des reglages. */
  pageKnown: boolean;
  funnelKey: string;
  /** Lead deja en base remis « a appeler ». */
  revived: boolean;
}

const needlesOf = (f: SalesFunnel) => f.match.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);

/** Le funnel qu'un tag du contact ou le nom du funnel / de l'etape Systeme.io designe. */
function funnelForNames(names: string[], funnels: SalesFunnel[]): SalesFunnel | null {
  const hay = names.map((n) => n.trim().toLowerCase()).filter(Boolean);
  if (!hay.length) return null;
  let best: { f: SalesFunnel; len: number } | null = null;
  for (const f of funnels) {
    for (const n of needlesOf(f)) {
      if (hay.some((h) => h === n || h.includes(n)) && (!best || n.length > best.len)) best = { f, len: n.length };
    }
  }
  return best?.f ?? null;
}

/** Le funnel de repli pour une reinscription sans page connue (reglage, sinon le premier funnel Meta Ads). */
export function reoptinFallbackFunnel(db: DB): SalesFunnel | null {
  const funnels = funnelsOf(db);
  const key = db.settings.systemeioReoptinFunnel;
  if (key === "") return null;
  if (key) return funnels.find((f) => f.key === key) ?? null;
  return funnels.find((f) => f.channel === "META_ADS") ?? null;
}

function findLead(db: DB, c: SioContact): Lead | undefined {
  const sioId = String(c.id ?? "");
  const email = (c.email ?? "").trim().toLowerCase();
  const phone = normalizePhone(fieldOf(c, "phone_number"));
  return (
    (sioId ? db.leads.find((l) => l.systemeioId === sioId) : undefined) ??
    (email ? db.leads.find((l) => (l.email ?? "").toLowerCase() === email) : undefined) ??
    (phone ? db.leads.find((l) => l.phone && digits(l.phone) === digits(phone)) : undefined)
  );
}

/**
 * Un OPT-IN recu par webhook. Regle demandee : un contact qui s'inscrit
 * depuis la page Ads remonte en lead Ads, meme s'il etait deja chez
 * Systeme.io depuis des mois via une autre page. L'API de Systeme.io ne
 * renvoie que l'URL de la PREMIERE inscription (`sourceURL`), donc :
 *  - la page du message (webhook d'automatisation « formulaire soumis »)
 *    fait foi quand elle est la ;
 *  - premier opt-in (contact cree a l'instant) : `sourceURL` est la bonne page ;
 *  - reinscription sans page : un tag du contact qui designe un funnel,
 *    sinon le funnel de repli des reglages (Meta Ads par defaut), note comme
 *    « page inconnue » pour qu'on sache que c'est une deduction.
 * Un lead deja en base est remis a appeler (statut sorti efface, perdu ->
 * nouveau), jamais un client signe.
 */
export function importOptIn(db: DB, contact: SioContact, ev: OptInEvent, actorName = "Webhook Systeme.io"): OptInReport {
  ensureFunnelsV2(db);
  const funnels = funnelsOf(db);
  const at = ev.at || new Date().toISOString();
  const atMs = Date.parse(at) || Date.now();
  const registeredMs = contact.registeredAt ? Date.parse(contact.registeredAt) : NaN;
  const reoptin = Number.isFinite(registeredMs) && atMs - registeredMs > REOPTIN_AFTER_MS;

  // 1. La page (ou le funnel) de cet opt-in.
  let pageUrl = (ev.pageUrl ?? "").trim();
  let touch: TouchInput | null = null;
  let pageKnown = false;
  let via = "";
  if (pageUrl) {
    touch = touchFromUrl(pageUrl, { hint: "systemeio" });
    pageKnown = true;
    via = "page du message";
  } else if (!reoptin && (contact.sourceURL ?? "").trim()) {
    pageUrl = (contact.sourceURL ?? "").trim();
    touch = touchFromUrl(pageUrl, { hint: "systemeio" });
    pageKnown = true;
    via = "premiere inscription";
  } else {
    const named = funnelForNames([...(contact.tags ?? []).map((t) => t.name ?? ""), ev.funnelName ?? "", ev.stepName ?? ""], funnels);
    if (named) {
      touch = { funnelSource: named.key, hint: "systemeio" };
      pageKnown = true;
      via = "tag / nom du funnel";
    } else {
      const fallback = reoptinFallbackFunnel(db);
      if (fallback) {
        touch = { funnelSource: fallback.key, hint: "systemeio" };
        via = "page inconnue, funnel de repli";
      }
    }
  }
  const funnelKey = touch ? touch.funnelSource || funnelForUrl(pageUrl, funnels)?.key || "" : "";
  const funnelLabel = funnels.find((f) => f.key === funnelKey)?.label ?? funnelKey;

  // 2. Le lead : deja en base, ou cree a partir d'un contact dont l'URL source est la page du jour.
  let lead = findLead(db, contact);
  let report: ImportReport;
  let created = false;
  if (!lead) {
    const copy: SioContact = {
      ...contact,
      sourceURL: pageKnown && pageUrl ? pageUrl : contact.sourceURL,
      registeredAt: reoptin ? at : contact.registeredAt,
    };
    report = importContacts(db, [copy], actorName);
    lead = report.leads[0];
    created = Boolean(lead);
    if (lead) {
      if (reoptin) lead.firstOptInAt = contact.registeredAt ?? "";
      if (touch && !(pageKnown && pageUrl)) applyOptInAttribution(lead, touch, at, funnels);
    }
  } else {
    report = importContacts(db, [contact], actorName);
  }
  if (!lead) return { ...report, lead: null, reoptin, pageKnown, funnelKey, revived: false };

  // 3. Un seul opt-in par fenetre : les doublons de webhook ne comptent pas deux fois.
  const lastMs = Date.parse(lead.lastOptInAt || lead.optInAt || lead.createdAt) || 0;
  const duplicate = !created && Math.abs(atMs - lastMs) < SAME_OPTIN_WINDOW_MS;
  if (duplicate) {
    if (touch && pageKnown && !lead.lastOptInPageKnown) {
      // Le second message apporte la page exacte : elle corrige la deduction du premier.
      lead.lastOptInUrl = pageUrl;
      lead.lastOptInPageKnown = true;
      if (pageUrl) lead.sourceUrl = pageUrl;
      if (applyOptInAttribution(lead, touch, at, funnels)) logLead(db, lead, actorName, `Page d'opt-in precisee : ${lead.name} -> ${funnelLabel}`);
    }
    return { ...report, lead, reoptin, pageKnown, funnelKey, revived: false };
  }

  // 4. Enregistre l'opt-in, l'attribution, et remet le lead a appeler.
  lead.optInCount = (lead.optInCount ?? 1) + (created ? 0 : 1);
  lead.lastOptInAt = at;
  lead.lastOptInUrl = pageKnown ? pageUrl : "";
  lead.lastOptInPageKnown = pageKnown;
  let revived = false;
  if (!created) {
    lead.firstOptInAt = lead.firstOptInAt || lead.optInAt || "";
    lead.optInAt = at;
    if (pageKnown && pageUrl) lead.sourceUrl = pageUrl;
    if (touch) applyOptInAttribution(lead, touch, at, funnels);
    if (lead.stage !== "closed-won") {
      if (leadIsOut(lead.callStatus)) {
        lead.callStatus = undefined;
        revived = true;
      }
      if (lead.stage === "closed-lost") {
        lead.stage = "nouveau";
        revived = true;
      }
      if (!lead.nextAction) {
        lead.nextAction = "Appeler le prospect";
        lead.nextActionAt = new Date().toISOString().slice(0, 10);
        revived = true;
      }
    }
    logLead(db, lead, actorName, `Reinscription landing page : ${lead.name} -> ${funnelLabel || "funnel inchange"} (${via})${revived ? " - remis a appeler" : ""}`);
  } else if (reoptin) {
    logLead(db, lead, actorName, `Reinscription d'un ancien contact Systeme.io (${(contact.registeredAt ?? "").slice(0, 10)}) : ${lead.name} -> ${funnelLabel} (${via})`);
  }
  return { ...report, lead, reoptin, pageKnown, funnelKey, revived };
}

function logLead(db: DB, lead: Lead, actorName: string, summary: string) {
  db.activityLogs.unshift({
    id: newId(),
    at: new Date().toISOString(),
    actorId: "",
    actorName,
    action: "lead.optin",
    entity: "lead",
    entityId: lead.id,
    summary,
  });
}

/* ------------------------------ Journal brut ----------------------------- */

const WEBHOOK_LOG = path.join(process.cwd(), "data", "webhooks", "systemeio.jsonl");
const WEBHOOK_LOG_MAX = 1_000_000;

/** Garde les derniers messages recus tels quels (diagnostic). Jamais bloquant. */
export function logWebhook(entry: Record<string, unknown>) {
  try {
    fs.mkdirSync(path.dirname(WEBHOOK_LOG), { recursive: true });
    const line = JSON.stringify({ at: new Date().toISOString(), ...entry }).slice(0, 8000) + "\n";
    fs.appendFileSync(WEBHOOK_LOG, line);
    if (fs.statSync(WEBHOOK_LOG).size > WEBHOOK_LOG_MAX) {
      const lines = fs.readFileSync(WEBHOOK_LOG, "utf8").split("\n");
      fs.writeFileSync(WEBHOOK_LOG, lines.slice(-200).join("\n"));
    }
  } catch {
    // le journal n'est qu'une aide au diagnostic
  }
}
