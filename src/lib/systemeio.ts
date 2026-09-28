import { createHmac, timingSafeEqual } from "node:crypto";
import { getSettings, newId, readDB, writeDB } from "@/lib/db";
import { salesMembers } from "@/lib/sales/repo";
import { memberRoles } from "@/lib/sales/roles";
import type { DB, Lead, TeamMember } from "@/lib/types";

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
 * « default » : le setter par defaut des reglages. « round-robin » : le
 * setter actif qui a le moins de leads LP encore a appeler, pour repartir la
 * charge sans compteur a maintenir.
 */
function pickSetter(db: DB): string {
  const s = db.settings;
  const setters = activeSetters(db);
  if ((s.salesLeadAssignment ?? "default") === "round-robin" && setters.length) {
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
export function importContacts(db: DB, contacts: SioContact[], actorName = "Systeme.io"): ImportReport {
  const report: ImportReport = { examined: contacts.length, created: 0, updated: 0, known: 0, skipped: 0, leads: [] };
  const filter = db.settings.systemeioSourceFilter ?? "";
  const today = new Date().toISOString().slice(0, 10);

  for (const c of contacts) {
    const sioId = String(c.id ?? "");
    const email = (c.email ?? "").trim().toLowerCase();
    const phone = normalizePhone(fieldOf(c, "phone_number"));
    if (!sioId || (!email && !phone)) { report.skipped++; continue; }
    if (!matchesSourceFilter(c, filter)) { report.skipped++; continue; }

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
      notes: c.sourceURL ? `Opt-in landing page : ${c.sourceURL}` : "Opt-in landing page",
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
    db.leads.unshift(lead);
    db.activityLogs.unshift({
      id: newId(),
      at: lead.createdAt,
      actorId: "",
      actorName,
      action: "lead.created",
      entity: "lead",
      entityId: lead.id,
      summary: `Nouveau lead landing page : ${lead.name}${lead.phone ? ` (${lead.phone})` : ""}${lead.ownerName ? ` → ${lead.ownerName}` : ""}`,
    });
    report.created++;
    report.leads.push(lead);
  }
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
