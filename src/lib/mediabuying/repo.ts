/**
 * Acces aux donnees du module media buying.
 *
 * Toute l'interface passe par ici : connexions, synchro Meta vers le
 * snapshot, vue agregee par periode, actions (statut, budget, duplication,
 * publication d'un brouillon), donnees internes et journal. Les routes API
 * ne font que verifier la session et appeler ces fonctions.
 */

import { newId, readDB, writeDB } from "../db";
import type { DB, Session } from "../types";
import { Forbidden } from "../sales/access";
import { fmtMoney } from "../format";
import { decryptToken, encryptToken, tokenHint } from "./crypto";
import { conversionProviderFor } from "./conversions";
import {
  computeMetrics,
  dayIn,
  healthOf,
  indexByAd,
  leadGoalFor,
  phaseFromName,
  previousRange,
  recommend,
  shiftDay,
  sumIndexed,
  sumIndexedConv,
  uiStatus,
} from "./metrics";
import { MetaApiError, providerFor, providerKindFor, type ConnectionCheck, type DuplicateTarget, type ProviderContext } from "./provider";
import type {
  AdInternalData,
  AuditEntityType,
  BudgetType,
  CampaignDraft,
  CampaignInternalData,
  DailyConversion,
  DailyInsight,
  DateRange,
  EntityLevel,
  EntityRow,
  MediaBuyingAuditLog,
  MediaBuyingSettings,
  MetaAd,
  MetaAdSet,
  MetaBudget,
  MetaCampaign,
  MetaConnection,
  MetaCreative,
  MetaSnapshot,
  MetaStatus,
  Overview,
  Phase,
  PublicConnection,
  WinnerStatus,
} from "./types";

/* ------------------------------ Constantes ---------------------------- */

/** Profondeur d'historique chargee a la premiere synchro. */
const HISTORY_DAYS = 75;
/** Jours relus a chaque synchro suivante (Meta corrige ses chiffres pendant ~72 h). */
const INCREMENTAL_DAYS = 3;
/** Sous ce delai, une synchro non forcee est ignoree : le cache suffit. */
const CACHE_TTL_MS = 60_000;
/** Au-dela, l'ouverture du cockpit relance une synchro en arriere-plan. */
const STALE_MS = 5 * 60_000;
const AUDIT_LIMIT = 2000;

/* ------------------------------ Connexions ---------------------------- */

export function publicConnection(c: MetaConnection): PublicConnection {
  const { encryptedAccessToken: _omit, ...rest } = c;
  void _omit;
  return rest;
}

export function listConnections(): PublicConnection[] {
  return readDB().metaConnections.map(publicConnection);
}

function findConnection(db: DB, id: string): MetaConnection {
  const c = db.metaConnections.find((x) => x.id === id);
  if (!c) throw new Forbidden("Compte Meta introuvable.");
  return c;
}

export function getConnection(id: string): MetaConnection {
  return findConnection(readDB(), id);
}

function ctxFor(c: MetaConnection): ProviderContext {
  return { connection: c, token: providerKindFor(c) === "meta" ? decryptToken(c.encryptedAccessToken) : "" };
}

export interface ConnectionInput {
  name: string;
  businessManagerId: string;
  adAccountId: string;
  accessToken: string;
}

function normalizeAccount(id: string): string {
  const s = id.trim();
  return /^\d{6,}$/.test(s) ? `act_${s}` : s;
}

/** Teste des identifiants sans rien enregistrer. */
export async function testCredentials(input: ConnectionInput, existingId?: string): Promise<ConnectionCheck & { provider: "mock" | "meta" }> {
  const db = readDB();
  const existing = existingId ? findConnection(db, existingId) : null;
  const draft: MetaConnection = {
    ...(existing ?? blankConnection()),
    name: input.name.trim(),
    businessManagerId: input.businessManagerId.trim(),
    adAccountId: normalizeAccount(input.adAccountId),
    encryptedAccessToken: input.accessToken ? encryptToken(input.accessToken) : (existing?.encryptedAccessToken ?? ""),
  };
  const kind = providerKindFor(draft);
  const ctx: ProviderContext = { connection: draft, token: kind === "meta" ? input.accessToken || (existing ? decryptToken(existing.encryptedAccessToken) : "") : "" };
  const check = await providerFor(draft).validateConnection(ctx);
  return { ...check, provider: kind };
}

function blankConnection(): MetaConnection {
  const now = new Date().toISOString();
  return {
    id: newId(),
    name: "",
    businessManagerId: "",
    adAccountId: "",
    encryptedAccessToken: "",
    tokenHint: "",
    provider: "mock",
    status: "disconnected",
    lastError: "",
    lastSyncAt: "",
    lastTestAt: "",
    permissions: [],
    missingPermissions: [],
    accountName: "",
    currency: "EUR",
    timezone: "Europe/Paris",
    tokenExpiresAt: "",
    createdAt: now,
    updatedAt: now,
  };
}

export async function createConnection(session: Session, input: ConnectionInput): Promise<PublicConnection> {
  if (!input.name.trim()) throw new Error("Donne un nom interne au compte.");
  const check = await testCredentials(input);
  if (!check.ok) throw new Error(check.error || "Connexion refusée par Meta.");
  const db = readDB();
  const c: MetaConnection = {
    ...blankConnection(),
    name: input.name.trim(),
    businessManagerId: input.businessManagerId.trim(),
    adAccountId: normalizeAccount(input.adAccountId) || check.account?.id || "",
    encryptedAccessToken: input.accessToken ? encryptToken(input.accessToken) : "",
    tokenHint: tokenHint(input.accessToken),
    provider: check.provider,
    status: "connected",
    lastTestAt: new Date().toISOString(),
    permissions: check.permissions,
    missingPermissions: check.missingPermissions,
    accountName: check.account?.name ?? "",
    currency: check.account?.currency ?? "EUR",
    timezone: check.account?.timezone ?? "Europe/Paris",
    tokenExpiresAt: check.tokenExpiresAt,
  };
  db.metaConnections.unshift(c);
  db.mbSettings.push(defaultSettings(c.id));
  audit(db, session, { connectionId: c.id, entityType: "connection", entityId: c.id, entityName: c.name, action: "connection.create", before: "", after: c.adAccountId, summary: `Compte Meta « ${c.name} » connecté (${check.provider === "mock" ? "simulé" : c.adAccountId})` });
  writeDB(db);
  return publicConnection(c);
}

export async function retestConnection(session: Session, id: string): Promise<ConnectionCheck> {
  const db = readDB();
  const c = findConnection(db, id);
  const check = await providerFor(c).validateConnection(ctxFor(c));
  c.lastTestAt = new Date().toISOString();
  c.status = check.ok ? "connected" : "error";
  c.lastError = check.ok ? "" : check.error;
  c.permissions = check.permissions;
  c.missingPermissions = check.missingPermissions;
  if (check.account) {
    c.accountName = check.account.name;
    c.currency = check.account.currency;
    c.timezone = check.account.timezone;
  }
  if (check.tokenExpiresAt) c.tokenExpiresAt = check.tokenExpiresAt;
  c.updatedAt = c.lastTestAt;
  audit(db, session, { connectionId: c.id, entityType: "connection", entityId: c.id, entityName: c.name, action: "connection.test", before: "", after: check.ok ? "ok" : "erreur", summary: check.ok ? `Connexion « ${c.name} » testée : OK` : `Connexion « ${c.name} » en erreur : ${check.error}` });
  writeDB(db);
  return check;
}

export function updateConnection(session: Session, id: string, patch: Partial<ConnectionInput>): PublicConnection {
  const db = readDB();
  const c = findConnection(db, id);
  if (patch.name !== undefined) c.name = patch.name.trim() || c.name;
  if (patch.businessManagerId !== undefined) c.businessManagerId = patch.businessManagerId.trim();
  if (patch.adAccountId !== undefined) c.adAccountId = normalizeAccount(patch.adAccountId);
  if (patch.accessToken) {
    c.encryptedAccessToken = encryptToken(patch.accessToken);
    c.tokenHint = tokenHint(patch.accessToken);
    c.provider = providerKindFor(c);
    c.status = "connected";
    c.lastError = "";
    audit(db, session, { connectionId: c.id, entityType: "connection", entityId: c.id, entityName: c.name, action: "connection.token", before: "", after: c.tokenHint, summary: `Jeton du compte « ${c.name} » remplacé` });
  }
  c.updatedAt = new Date().toISOString();
  writeDB(db);
  return publicConnection(c);
}

/** « Déconnecter » : le jeton est efface, le reste (phases, notes, journal) reste. */
export function disconnectConnection(session: Session, id: string): PublicConnection {
  const db = readDB();
  const c = findConnection(db, id);
  c.encryptedAccessToken = "";
  c.tokenHint = "";
  c.status = "disconnected";
  c.updatedAt = new Date().toISOString();
  audit(db, session, { connectionId: c.id, entityType: "connection", entityId: c.id, entityName: c.name, action: "connection.disconnect", before: "", after: "", summary: `Compte « ${c.name} » déconnecté (jeton effacé)` });
  writeDB(db);
  return publicConnection(c);
}

export function deleteConnection(session: Session, id: string) {
  const db = readDB();
  const c = findConnection(db, id);
  db.metaConnections = db.metaConnections.filter((x) => x.id !== id);
  db.mbSnapshots = db.mbSnapshots.filter((x) => x.connectionId !== id);
  db.mbSettings = db.mbSettings.filter((x) => x.connectionId !== id);
  db.mbCampaignData = db.mbCampaignData.filter((x) => x.connectionId !== id);
  db.mbAdData = db.mbAdData.filter((x) => x.connectionId !== id);
  db.mbDrafts = db.mbDrafts.filter((x) => x.connectionId !== id);
  audit(db, session, { connectionId: id, entityType: "connection", entityId: id, entityName: c.name, action: "connection.delete", before: c.adAccountId, after: "", summary: `Compte « ${c.name} » supprimé` });
  writeDB(db);
  return { ok: true };
}

/* ------------------------------- Reglages ----------------------------- */

export function defaultSettings(connectionId: string): MediaBuyingSettings {
  return {
    id: newId(),
    connectionId,
    targetCpl: 15,
    targetCpb: 120,
    targetCac: 900,
    minCtr: 1,
    maxCpc: 2,
    maxCostLpv: 3,
    minLpvBeforeKill: 12,
    minLeadsBeforeBookingJudgement: 8,
    maxSpendWithoutLead: 25,
    leadGoalTesting: 20,
    leadGoalScaling: 50,
    leadGoalHyper: 200,
    rankingMetric: "costPerBooking",
    updatedAt: new Date().toISOString(),
  };
}

export function getSettings(connectionId: string): MediaBuyingSettings {
  const db = readDB();
  let s = db.mbSettings.find((x) => x.connectionId === connectionId);
  if (!s) {
    s = defaultSettings(connectionId);
    db.mbSettings.push(s);
    writeDB(db);
  }
  return s;
}

const SETTING_KEYS: (keyof MediaBuyingSettings)[] = [
  "targetCpl",
  "targetCpb",
  "targetCac",
  "minCtr",
  "maxCpc",
  "maxCostLpv",
  "minLpvBeforeKill",
  "minLeadsBeforeBookingJudgement",
  "maxSpendWithoutLead",
  "leadGoalTesting",
  "leadGoalScaling",
  "leadGoalHyper",
];

export function patchSettings(session: Session, connectionId: string, patch: Record<string, unknown>): MediaBuyingSettings {
  const db = readDB();
  findConnection(db, connectionId);
  let s = db.mbSettings.find((x) => x.connectionId === connectionId);
  if (!s) {
    s = defaultSettings(connectionId);
    db.mbSettings.push(s);
  }
  const changes: string[] = [];
  for (const k of SETTING_KEYS) {
    const v = patch[k];
    if (v === undefined) continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw new Error(`Valeur invalide pour ${k}.`);
    if (s[k] !== n) {
      changes.push(`${k} ${String(s[k])} → ${n}`);
      (s as unknown as Record<string, number>)[k] = n;
    }
  }
  if (typeof patch.rankingMetric === "string" && ["cpl", "bookings", "costPerBooking", "sales", "cac", "roas"].includes(patch.rankingMetric)) {
    s.rankingMetric = patch.rankingMetric as MediaBuyingSettings["rankingMetric"];
  }
  s.updatedAt = new Date().toISOString();
  if (changes.length) {
    audit(db, session, { connectionId, entityType: "settings", entityId: s.id, entityName: "Réglages", action: "settings.update", before: "", after: changes.join(", "), summary: `Réglages modifiés : ${changes.join(", ")}` });
  }
  writeDB(db);
  return s;
}

/* -------------------------------- Journal ----------------------------- */

export function audit(db: DB, session: Session, entry: Omit<MediaBuyingAuditLog, "id" | "at" | "userId" | "userName">) {
  db.mbAuditLogs.unshift({
    id: newId(),
    at: new Date().toISOString(),
    userId: session.memberId,
    userName: session.memberName || "Moi",
    ...entry,
  });
  if (db.mbAuditLogs.length > AUDIT_LIMIT) db.mbAuditLogs.length = AUDIT_LIMIT;
}

export function listAudit(connectionId: string | null, limit = 200): MediaBuyingAuditLog[] {
  const rows = readDB().mbAuditLogs;
  return (connectionId ? rows.filter((r) => r.connectionId === connectionId) : rows).slice(0, limit);
}

/** Evenement cote navigateur (copie d'un Post ID) : journalise sans toucher a Meta. */
export function auditClientEvent(session: Session, connectionId: string, entityType: AuditEntityType, entityId: string, entityName: string, action: string, summary: string) {
  const db = readDB();
  audit(db, session, { connectionId, entityType, entityId, entityName, action, before: "", after: "", summary });
  writeDB(db);
}

/* -------------------------------- Snapshot ---------------------------- */

export function getSnapshot(connectionId: string): MetaSnapshot | null {
  return readDB().mbSnapshots.find((s) => s.connectionId === connectionId) ?? null;
}

interface SyncState {
  inflight: Map<string, Promise<SyncResult>>;
}
const g = globalThis as unknown as { __mbSync?: SyncState };
const syncState: SyncState = (g.__mbSync ??= { inflight: new Map() });

export const isSyncing = (connectionId: string) => syncState.inflight.has(connectionId);

export interface SyncResult {
  syncedAt: string;
  syncMs: number;
  skipped: boolean;
  campaigns: number;
  adsets: number;
  ads: number;
  error: string;
}

/**
 * Derive les statuts effectifs des statuts configures et de la chaine
 * parent -> enfant. Meta le fait de son cote ; apres une action locale on
 * refait pareil pour que la table reste coherente sans attendre la synchro.
 */
function recomputeEffective(snap: MetaSnapshot) {
  const sticky = (s: MetaStatus) => s === "PENDING_REVIEW" || s === "DISAPPROVED" || s === "IN_PROCESS" || s === "WITH_ISSUES" || s === "PREAPPROVED";
  const campaigns = new Map(snap.campaigns.map((c) => [c.id, c]));
  const adsets = new Map(snap.adsets.map((a) => [a.id, a]));
  for (const c of snap.campaigns) c.effectiveStatus = sticky(c.effectiveStatus) ? c.effectiveStatus : c.status;
  for (const a of snap.adsets) {
    const c = campaigns.get(a.campaignId);
    a.effectiveStatus = c && c.status !== "ACTIVE" ? "CAMPAIGN_PAUSED" : sticky(a.effectiveStatus) ? a.effectiveStatus : a.status;
  }
  for (const ad of snap.ads) {
    const a = adsets.get(ad.adsetId);
    const c = campaigns.get(ad.campaignId);
    ad.effectiveStatus =
      c && c.status !== "ACTIVE" ? "CAMPAIGN_PAUSED" : a && a.status !== "ACTIVE" ? "ADSET_PAUSED" : sticky(ad.effectiveStatus) ? ad.effectiveStatus : ad.status;
  }
}

/**
 * Synchronise un compte : structure, creatives, stats quotidiennes,
 * conversions. Un seul passage a la fois par compte ; les appels pendant
 * une synchro recoivent la meme promesse.
 */
export function syncConnection(connectionId: string, opts: { force?: boolean } = {}): Promise<SyncResult> {
  const running = syncState.inflight.get(connectionId);
  if (running) return running;
  const p = doSync(connectionId, Boolean(opts.force)).finally(() => syncState.inflight.delete(connectionId));
  syncState.inflight.set(connectionId, p);
  return p;
}

async function doSync(connectionId: string, force: boolean): Promise<SyncResult> {
  const started = Date.now();
  const db0 = readDB();
  const c = findConnection(db0, connectionId);
  const existing = db0.mbSnapshots.find((s) => s.connectionId === connectionId) ?? null;
  if (!force && existing && Date.now() - Date.parse(existing.syncedAt) < CACHE_TTL_MS) {
    return { syncedAt: existing.syncedAt, syncMs: existing.syncMs, skipped: true, campaigns: existing.campaigns.length, adsets: existing.adsets.length, ads: existing.ads.length, error: "" };
  }
  const provider = providerFor(c);
  const ctx = ctxFor(c);
  const today = dayIn(c.timezone || "Europe/Paris");

  try {
    /*
     * Mock : la structure n'est relue qu'une fois. Ensuite elle vit dans le
     * snapshot (une ad mise en pause depuis l'outil doit le rester), seules
     * les stats des derniers jours sont regenerees.
     */
    let campaigns: MetaCampaign[];
    let adsets: MetaAdSet[];
    let ads: MetaAd[];
    if (provider.kind === "mock" && existing) {
      campaigns = existing.campaigns;
      adsets = existing.adsets;
      ads = existing.ads;
    } else {
      [campaigns, adsets, ads] = await Promise.all([provider.getCampaigns(ctx), provider.getAdSets(ctx), provider.getAds(ctx)]);
    }

    // Creatives : seulement celles qu'on n'a pas encore (elles ne changent pas).
    const known = new Map((existing?.creatives ?? []).map((cr) => [cr.id, cr]));
    const missing = [...new Set(ads.map((a) => a.creativeId).filter((id) => id && !known.has(id)))];
    const fetched = missing.length ? await provider.getCreatives(ctx, missing) : [];
    for (const cr of fetched) known.set(cr.id, cr);
    const creatives: MetaCreative[] = [...known.values()];

    // Stats : tout l'historique la premiere fois, puis les derniers jours fusionnes.
    const range: DateRange = existing ? { from: shiftDay(today, -(INCREMENTAL_DAYS - 1)), to: today } : { from: shiftDay(today, -HISTORY_DAYS), to: today };
    const fresh = await provider.getInsights(ctx, range);
    const conversionProvider = conversionProviderFor(c);
    const freshConv = await conversionProvider.fetch({ connection: c, ads, range });

    const keep = (rows: DailyInsight[]) => rows.filter((r) => r.date < range.from || r.date > range.to);
    const keepConv = (rows: DailyConversion[]) => rows.filter((r) => r.date < range.from || r.date > range.to);
    const insights = existing ? [...keep(existing.insights), ...fresh] : fresh;
    const conversions = freshConv === null ? null : existing?.conversions ? [...keepConv(existing.conversions), ...freshConv] : freshConv;

    const db = readDB();
    const syncedAt = new Date().toISOString();
    const snap: MetaSnapshot = {
      id: existing?.id ?? newId(),
      connectionId,
      syncedAt,
      syncMs: Date.now() - started,
      currency: c.currency || "EUR",
      timezone: c.timezone || "Europe/Paris",
      campaigns,
      adsets,
      ads,
      creatives,
      insights,
      conversions,
      conversionSource: conversionProvider.source,
    };
    recomputeEffective(snap);
    db.mbSnapshots = [...db.mbSnapshots.filter((s) => s.connectionId !== connectionId), snap];
    const conn = findConnection(db, connectionId);
    conn.lastSyncAt = syncedAt;
    conn.status = "connected";
    conn.lastError = "";
    conn.updatedAt = syncedAt;
    writeDB(db);
    return { syncedAt, syncMs: snap.syncMs, skipped: false, campaigns: campaigns.length, adsets: adsets.length, ads: ads.length, error: "" };
  } catch (e) {
    const db = readDB();
    const conn = findConnection(db, connectionId);
    const message = e instanceof Error ? e.message : "Synchronisation impossible.";
    conn.lastError = message;
    if (e instanceof MetaApiError && (e.code === "token-expired" || e.code === "missing-permission" || e.code === "invalid-account")) conn.status = "error";
    conn.updatedAt = new Date().toISOString();
    writeDB(db);
    throw e;
  }
}

/* ------------------------------ Vue agregee --------------------------- */

const budgetOf = (c: { dailyBudget: number | null; lifetimeBudget: number | null }, level: "campaign" | "adset"): MetaBudget | null =>
  c.dailyBudget ? { amount: c.dailyBudget, type: "daily", level } : c.lifetimeBudget ? { amount: c.lifetimeBudget, type: "lifetime", level } : null;

/**
 * Tout ce que le cockpit affiche pour une periode, en une reponse : les
 * trois niveaux avec leurs metriques, la periode precedente, les 24 h, la
 * sante et la recommandation, les donnees internes. Calcule depuis le
 * snapshot, jamais depuis Meta ; si le snapshot date, une synchro repart
 * en arriere-plan et les chiffres affiches sont ceux d'avant.
 */
export function buildOverview(connectionId: string, range: DateRange): Overview {
  const db = readDB();
  const c = findConnection(db, connectionId);
  const settings = getSettings(connectionId);
  const snap = db.mbSnapshots.find((s) => s.connectionId === connectionId) ?? null;
  const tz = snap?.timezone ?? c.timezone ?? "Europe/Paris";
  const today = dayIn(tz);
  const prevRange = previousRange(range);
  const dayRange: DateRange = { from: today, to: today };
  const currency = snap?.currency ?? c.currency ?? "EUR";

  const empty: Overview = {
    connection: publicConnection(c),
    settings,
    range,
    prevRange,
    syncedAt: snap?.syncedAt ?? "",
    syncMs: snap?.syncMs ?? 0,
    syncing: isSyncing(connectionId),
    currency,
    timezone: tz,
    campaigns: [],
    adsets: [],
    ads: [],
    conversionsConnected: Boolean(snap?.conversions),
    conversionSource: snap?.conversionSource ?? "none",
    totals: computeMetrics({ spend: 0, impressions: 0, reach: 0, linkClicks: 0, lpv: 0, leads: 0 }, null),
    prevTotals: computeMetrics({ spend: 0, impressions: 0, reach: 0, linkClicks: 0, lpv: 0, leads: 0 }, null),
  };
  if (!snap) return empty;

  // Une synchro vieille de plus de cinq minutes repart toute seule, sans bloquer la reponse.
  if (!isSyncing(connectionId) && Date.now() - Date.parse(snap.syncedAt) > STALE_MS) {
    void syncConnection(connectionId).catch(() => undefined);
  }

  const insightIdx = indexByAd(snap.insights);
  const convIdx = snap.conversions ? indexByAd(snap.conversions) : null;
  const connected = Boolean(snap.conversions);
  const creatives = new Map(snap.creatives.map((cr) => [cr.id, cr]));
  const campData = new Map(db.mbCampaignData.filter((d) => d.connectionId === connectionId).map((d) => [d.metaCampaignId, d]));
  const adData = new Map(db.mbAdData.filter((d) => d.connectionId === connectionId).map((d) => [d.metaAdId, d]));
  const adsByAdset = new Map<string, string[]>();
  const adsByCampaign = new Map<string, string[]>();
  for (const ad of snap.ads) {
    adsByAdset.set(ad.adsetId, [...(adsByAdset.get(ad.adsetId) ?? []), ad.id]);
    adsByCampaign.set(ad.campaignId, [...(adsByCampaign.get(ad.campaignId) ?? []), ad.id]);
  }
  const adsetsByCampaign = new Map<string, number>();
  for (const a of snap.adsets) adsetsByCampaign.set(a.campaignId, (adsetsByCampaign.get(a.campaignId) ?? 0) + 1);
  const campaignPhase = new Map<string, Phase>();
  for (const cp of snap.campaigns) campaignPhase.set(cp.id, campData.get(cp.id)?.phase ?? phaseFromName(cp.name));

  const metricsFor = (ids: string[]) => {
    const metrics = computeMetrics(sumIndexed(insightIdx, ids, range), sumIndexedConv(convIdx, ids, range));
    const prev = computeMetrics(sumIndexed(insightIdx, ids, prevRange), sumIndexedConv(convIdx, ids, prevRange));
    const last24h = sumIndexed(insightIdx, ids, dayRange);
    return { metrics, prev, last24h, health: healthOf(metrics, settings, connected), recommendation: recommend(metrics, settings, connected, currency) };
  };

  const campaignBudgets = new Map(snap.campaigns.map((cp) => [cp.id, budgetOf(cp, "campaign")]));

  const ads: EntityRow[] = snap.ads.map((ad) => {
    const d = adData.get(ad.id);
    return {
      level: "ad",
      id: ad.id,
      parentId: ad.adsetId,
      campaignId: ad.campaignId,
      name: ad.name,
      status: uiStatus(ad.effectiveStatus, ad.status),
      configuredStatus: ad.status,
      effectiveStatus: ad.effectiveStatus,
      phase: campaignPhase.get(ad.campaignId) ?? "unclassified",
      budget: null,
      ...metricsFor([ad.id]),
      postId: ad.postId,
      creative: creatives.get(ad.creativeId) ?? null,
      winnerStatus: d?.winnerStatus ?? "",
      notes: d?.notes ?? "",
      leadGoal: null,
      targetingSummary: "",
      objective: "",
      updatedTime: ad.updatedTime,
      children: 0,
    };
  });

  const adsets: EntityRow[] = snap.adsets.map((a) => {
    const ids = adsByAdset.get(a.id) ?? [];
    return {
      level: "adset",
      id: a.id,
      parentId: a.campaignId,
      campaignId: a.campaignId,
      name: a.name,
      status: uiStatus(a.effectiveStatus, a.status),
      configuredStatus: a.status,
      effectiveStatus: a.effectiveStatus,
      phase: campaignPhase.get(a.campaignId) ?? "unclassified",
      budget: budgetOf(a, "adset") ?? campaignBudgets.get(a.campaignId) ?? null,
      ...metricsFor(ids),
      postId: "",
      creative: null,
      winnerStatus: "",
      notes: "",
      leadGoal: null,
      targetingSummary: a.targetingSummary,
      objective: a.optimizationGoal,
      updatedTime: a.updatedTime,
      children: ids.length,
    };
  });

  const campaigns: EntityRow[] = snap.campaigns.map((cp) => {
    const ids = adsByCampaign.get(cp.id) ?? [];
    const d = campData.get(cp.id);
    const phase = campaignPhase.get(cp.id) ?? "unclassified";
    const own = campaignBudgets.get(cp.id) ?? null;
    // ABO : la somme des budgets quotidiens des ad sets actifs, marquee « adset ».
    const aboSum = snap.adsets.filter((a) => a.campaignId === cp.id && a.status === "ACTIVE" && a.dailyBudget).reduce((s, a) => s + (a.dailyBudget ?? 0), 0);
    return {
      level: "campaign",
      id: cp.id,
      parentId: "",
      campaignId: cp.id,
      name: cp.name,
      status: uiStatus(cp.effectiveStatus, cp.status),
      configuredStatus: cp.status,
      effectiveStatus: cp.effectiveStatus,
      phase,
      budget: own ?? (aboSum ? { amount: aboSum, type: "daily", level: "adset" } : null),
      ...metricsFor(ids),
      postId: "",
      creative: null,
      winnerStatus: "",
      notes: d?.internalNotes ?? "",
      leadGoal: d?.leadGoal ?? leadGoalFor(phase, settings),
      targetingSummary: "",
      objective: cp.objective,
      updatedTime: cp.updatedTime,
      children: adsetsByCampaign.get(cp.id) ?? 0,
    };
  });

  const all = snap.ads.map((a) => a.id);
  return {
    ...empty,
    campaigns,
    adsets,
    ads,
    totals: computeMetrics(sumIndexed(insightIdx, all, range), sumIndexedConv(convIdx, all, range)),
    prevTotals: computeMetrics(sumIndexed(insightIdx, all, prevRange), sumIndexedConv(convIdx, all, prevRange)),
  };
}

/* -------------------------------- Actions ----------------------------- */

function snapshotOf(db: DB, connectionId: string): MetaSnapshot {
  const s = db.mbSnapshots.find((x) => x.connectionId === connectionId);
  if (!s) throw new Error("Aucune donnée synchronisée pour ce compte : lance une synchronisation.");
  return s;
}

function entityOf(snap: MetaSnapshot, level: EntityLevel, id: string): MetaCampaign | MetaAdSet | MetaAd {
  const list: { id: string }[] = level === "campaign" ? snap.campaigns : level === "adset" ? snap.adsets : snap.ads;
  const e = list.find((x) => x.id === id);
  if (!e) throw new Forbidden("Entité introuvable dans les données synchronisées.");
  return e as MetaCampaign | MetaAdSet | MetaAd;
}

const LEVEL_LABEL: Record<EntityLevel, string> = { campaign: "Campagne", adset: "Ad set", ad: "Ad" };

export async function setStatus(session: Session, connectionId: string, level: EntityLevel, id: string, next: "ACTIVE" | "PAUSED") {
  const db = readDB();
  const c = findConnection(db, connectionId);
  const snap = snapshotOf(db, connectionId);
  const entity = entityOf(snap, level, id);
  const before = entity.status;
  if (before === next) return { ok: true, status: next };
  await providerFor(c).updateStatus(ctxFor(c), level, id, next);
  // Relecture : la base a pu bouger pendant l'appel reseau.
  const db2 = readDB();
  const snap2 = snapshotOf(db2, connectionId);
  const e2 = entityOf(snap2, level, id);
  e2.status = next;
  e2.updatedTime = new Date().toISOString();
  recomputeEffective(snap2);
  audit(db2, session, {
    connectionId,
    entityType: level,
    entityId: id,
    entityName: e2.name,
    action: next === "PAUSED" ? "status.pause" : "status.activate",
    before,
    after: next,
    summary: `${next === "PAUSED" ? "Mis en pause" : "Réactivé"} : ${LEVEL_LABEL[level].toLowerCase()} ${e2.name}`,
  });
  writeDB(db2);
  return { ok: true, status: next };
}

export async function setBudget(session: Session, connectionId: string, level: "campaign" | "adset", id: string, amount: number, type: BudgetType) {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Budget invalide.");
  const db = readDB();
  const c = findConnection(db, connectionId);
  const snap = snapshotOf(db, connectionId);
  const entity = entityOf(snap, level, id) as MetaCampaign | MetaAdSet;
  const before = type === "daily" ? entity.dailyBudget : entity.lifetimeBudget;
  if (level === "adset" && before === null) {
    const camp = snap.campaigns.find((x) => x.id === (entity as MetaAdSet).campaignId);
    if (camp && (camp.dailyBudget || camp.lifetimeBudget)) throw new Error("Cette campagne est en CBO : le budget se modifie au niveau de la campagne.");
  }
  await providerFor(c).updateBudget(ctxFor(c), level, id, amount, type);
  const db2 = readDB();
  const snap2 = snapshotOf(db2, connectionId);
  const e2 = entityOf(snap2, level, id) as MetaCampaign | MetaAdSet;
  if (type === "daily") e2.dailyBudget = amount;
  else e2.lifetimeBudget = amount;
  e2.updatedTime = new Date().toISOString();
  const cur = snap2.currency;
  audit(db2, session, {
    connectionId,
    entityType: level,
    entityId: id,
    entityName: e2.name,
    action: "budget.update",
    before: before === null ? "" : String(before),
    after: String(amount),
    summary: `Budget ${type === "daily" ? "quotidien" : "total"} de ${e2.name} : ${before === null ? "—" : fmtMoney(before, cur)} → ${fmtMoney(amount, cur)}`,
  });
  writeDB(db2);
  return { ok: true, amount, type };
}

/** Copie une entite (en pause) ; pour une ad, le Post ID suit. */
export async function duplicate(session: Session, connectionId: string, level: EntityLevel, id: string, target: DuplicateTarget) {
  const db = readDB();
  const c = findConnection(db, connectionId);
  const snap = snapshotOf(db, connectionId);
  const source = entityOf(snap, level, id);
  const res = await providerFor(c).duplicateEntity(ctxFor(c), level, id, target);
  const db2 = readDB();
  const snap2 = snapshotOf(db2, connectionId);
  const now = new Date().toISOString();
  const name = target.name || `${source.name} — copie`;
  const paused = "PAUSED" as const;

  if (level === "campaign") {
    const src = source as MetaCampaign;
    snap2.campaigns.unshift({ ...src, id: res.id, name, status: paused, effectiveStatus: paused, createdTime: now, updatedTime: now, startTime: now });
    // Copie en profondeur : ad sets et ads suivent, en pause.
    for (const a of snap2.adsets.filter((x) => x.campaignId === src.id)) {
      const newAdset = `${res.id}_${a.id}`;
      snap2.adsets.push({ ...a, id: newAdset, campaignId: res.id, status: paused, effectiveStatus: paused, createdTime: now, updatedTime: now });
      for (const ad of snap2.ads.filter((x) => x.adsetId === a.id)) {
        snap2.ads.push({ ...ad, id: `${newAdset}_${ad.id}`, adsetId: newAdset, campaignId: res.id, status: paused, effectiveStatus: paused, createdTime: now, updatedTime: now });
      }
    }
  } else if (level === "adset") {
    const src = source as MetaAdSet;
    const campaignId = target.parentId === "same" ? src.campaignId : target.parentId;
    snap2.adsets.unshift({ ...src, id: res.id, campaignId, name, status: paused, effectiveStatus: paused, createdTime: now, updatedTime: now });
    for (const ad of snap2.ads.filter((x) => x.adsetId === src.id)) {
      snap2.ads.push({ ...ad, id: `${res.id}_${ad.id}`, adsetId: res.id, campaignId, status: paused, effectiveStatus: paused, createdTime: now, updatedTime: now });
    }
  } else {
    const src = source as MetaAd;
    const adsetId = target.parentId === "same" ? src.adsetId : target.parentId;
    const adset = snap2.adsets.find((x) => x.id === adsetId);
    if (!adset) throw new Error("Ad set de destination introuvable.");
    snap2.ads.unshift({ ...src, id: res.id, adsetId, campaignId: adset.campaignId, name, status: paused, effectiveStatus: paused, postId: target.keepPostId ? src.postId : "", createdTime: now, updatedTime: now });
  }
  recomputeEffective(snap2);
  audit(db2, session, {
    connectionId,
    entityType: level,
    entityId: res.id,
    entityName: name,
    action: "entity.duplicate",
    before: source.name,
    after: name,
    summary: `${LEVEL_LABEL[level]} ${source.name} dupliqué${level === "campaign" ? "e" : ""} → ${name} (en pause)`,
  });
  writeDB(db2);
  return { ok: true, id: res.id };
}

/* ---------------------------- Donnees internes ------------------------ */

export function setCampaignData(session: Session, connectionId: string, metaCampaignId: string, patch: { phase?: Phase; leadGoal?: number | null; internalNotes?: string }): CampaignInternalData {
  const db = readDB();
  findConnection(db, connectionId);
  const snap = db.mbSnapshots.find((s) => s.connectionId === connectionId);
  const campaign = snap?.campaigns.find((c) => c.id === metaCampaignId);
  let d = db.mbCampaignData.find((x) => x.connectionId === connectionId && x.metaCampaignId === metaCampaignId);
  if (!d) {
    d = { id: newId(), connectionId, metaCampaignId, phase: campaign ? phaseFromName(campaign.name) : "unclassified", leadGoal: null, internalNotes: "", updatedAt: "" };
    db.mbCampaignData.push(d);
  }
  if (patch.phase !== undefined && patch.phase !== d.phase) {
    audit(db, session, { connectionId, entityType: "campaign", entityId: metaCampaignId, entityName: campaign?.name ?? metaCampaignId, action: "phase.set", before: d.phase, after: patch.phase, summary: `${campaign?.name ?? "Campagne"} classée en ${patch.phase} (interne)` });
    d.phase = patch.phase;
  }
  if (patch.leadGoal !== undefined) {
    const n = patch.leadGoal === null ? null : Math.max(0, Math.round(Number(patch.leadGoal) || 0));
    if (n !== d.leadGoal) {
      audit(db, session, { connectionId, entityType: "campaign", entityId: metaCampaignId, entityName: campaign?.name ?? metaCampaignId, action: "leadGoal.set", before: String(d.leadGoal ?? ""), after: String(n ?? ""), summary: `Objectif leads de ${campaign?.name ?? "la campagne"} : ${n ?? "défaut de la phase"}` });
      d.leadGoal = n;
    }
  }
  if (patch.internalNotes !== undefined) d.internalNotes = patch.internalNotes.slice(0, 2000);
  d.updatedAt = new Date().toISOString();
  writeDB(db);
  return d;
}

export function setAdData(session: Session, connectionId: string, metaAdId: string, patch: { winnerStatus?: WinnerStatus; notes?: string }): AdInternalData {
  const db = readDB();
  findConnection(db, connectionId);
  const snap = db.mbSnapshots.find((s) => s.connectionId === connectionId);
  const ad = snap?.ads.find((a) => a.id === metaAdId);
  let d = db.mbAdData.find((x) => x.connectionId === connectionId && x.metaAdId === metaAdId);
  if (!d) {
    d = { id: newId(), connectionId, metaAdId, winnerStatus: "", notes: "", updatedAt: "" };
    db.mbAdData.push(d);
  }
  if (patch.winnerStatus !== undefined && patch.winnerStatus !== d.winnerStatus) {
    audit(db, session, { connectionId, entityType: "ad", entityId: metaAdId, entityName: ad?.name ?? metaAdId, action: "winner.set", before: d.winnerStatus, after: patch.winnerStatus, summary: `${ad?.name ?? "Ad"} marquée « ${patch.winnerStatus || "—"} »` });
    d.winnerStatus = patch.winnerStatus;
  }
  if (patch.notes !== undefined) d.notes = patch.notes.slice(0, 1000);
  d.updatedAt = new Date().toISOString();
  writeDB(db);
  return d;
}

/* -------------------------------- Builder ----------------------------- */

export function listDrafts(connectionId: string): CampaignDraft[] {
  return readDB().mbDrafts.filter((d) => d.connectionId === connectionId);
}

export function saveDraft(session: Session, connectionId: string, input: Partial<CampaignDraft> & { id?: string }): CampaignDraft {
  const db = readDB();
  findConnection(db, connectionId);
  const now = new Date().toISOString();
  let d = input.id ? db.mbDrafts.find((x) => x.id === input.id && x.connectionId === connectionId) : undefined;
  const created = !d;
  if (!d) {
    d = {
      id: newId(),
      connectionId,
      phase: "testing",
      name: "",
      objective: "OUTCOME_LEADS",
      country: "FR",
      budgetType: "daily",
      budgetLevel: "adset",
      budget: 0,
      adsets: [],
      status: "draft",
      publishedCampaignId: "",
      error: "",
      createdAt: now,
      updatedAt: now,
    };
    db.mbDrafts.unshift(d);
  }
  if (d.status === "published") throw new Error("Ce brouillon a déjà été publié : duplique-le plutôt.");
  if (input.phase) d.phase = input.phase;
  if (typeof input.name === "string") d.name = input.name.trim().slice(0, 200);
  if (typeof input.objective === "string") d.objective = input.objective;
  if (typeof input.country === "string") d.country = input.country.trim().toUpperCase().slice(0, 2) || "FR";
  if (input.budgetType === "daily" || input.budgetType === "lifetime") d.budgetType = input.budgetType;
  if (input.budgetLevel === "campaign" || input.budgetLevel === "adset") d.budgetLevel = input.budgetLevel;
  if (input.budget !== undefined) d.budget = Math.max(0, Number(input.budget) || 0);
  if (Array.isArray(input.adsets)) {
    d.adsets = input.adsets.slice(0, 20).map((a) => ({
      name: String(a.name ?? "").trim().slice(0, 200),
      budget: Math.max(0, Number(a.budget) || 0),
      ads: (Array.isArray(a.ads) ? a.ads : []).slice(0, 50).map((ad) => ({
        name: String(ad.name ?? "").trim().slice(0, 100),
        postId: String(ad.postId ?? "").trim(),
        sourceAdId: String(ad.sourceAdId ?? "").trim(),
      })),
    }));
  }
  d.updatedAt = now;
  if (created) {
    audit(db, session, { connectionId, entityType: "draft", entityId: d.id, entityName: d.name || "Brouillon", action: "draft.create", before: "", after: d.phase, summary: `Brouillon ${d.phase} créé : ${d.name || "(sans nom)"}` });
  }
  writeDB(db);
  return d;
}

export function deleteDraft(session: Session, connectionId: string, id: string) {
  const db = readDB();
  const d = db.mbDrafts.find((x) => x.id === id && x.connectionId === connectionId);
  if (!d) throw new Forbidden("Brouillon introuvable.");
  db.mbDrafts = db.mbDrafts.filter((x) => x.id !== id);
  audit(db, session, { connectionId, entityType: "draft", entityId: id, entityName: d.name, action: "draft.delete", before: "", after: "", summary: `Brouillon supprimé : ${d.name || "(sans nom)"}` });
  writeDB(db);
  return { ok: true };
}

/**
 * Cree chez Meta la campagne, ses ad sets et ses ads, TOUT en pause. Le
 * brouillon devient « publié » et la campagne apparait dans le snapshot,
 * classee dans sa phase. Rien ne diffuse tant que le media buyer n'active
 * pas lui-meme.
 */
export async function publishDraft(session: Session, connectionId: string, id: string) {
  const db = readDB();
  const c = findConnection(db, connectionId);
  const d = db.mbDrafts.find((x) => x.id === id && x.connectionId === connectionId);
  if (!d) throw new Forbidden("Brouillon introuvable.");
  if (d.status === "published") throw new Error("Déjà publié.");
  if (!d.name.trim()) throw new Error("Donne un nom à la campagne.");
  if (!d.adsets.length) throw new Error("Ajoute au moins un ad set.");
  for (const a of d.adsets) {
    if (!a.name.trim()) throw new Error("Chaque ad set doit avoir un nom.");
    if (!a.ads.length) throw new Error(`L'ad set ${a.name} n'a aucune ad.`);
    if (d.budgetLevel === "adset" && !(a.budget > 0)) throw new Error(`Budget manquant sur l'ad set ${a.name}.`);
  }
  if (d.budgetLevel === "campaign" && !(d.budget > 0)) throw new Error("Budget de campagne manquant (CBO).");

  const provider = providerFor(c);
  const ctx = ctxFor(c);
  const now = new Date().toISOString();
  const paused = "PAUSED" as const;
  const snapBefore = db.mbSnapshots.find((s) => s.connectionId === connectionId);
  const knownAds = new Map((snapBefore?.ads ?? []).map((a) => [a.id, a]));
  const knownCreatives = new Map((snapBefore?.creatives ?? []).map((cr) => [cr.id, cr]));

  try {
    const camp = await provider.createCampaign(ctx, {
      name: d.name,
      objective: d.objective,
      dailyBudget: d.budgetLevel === "campaign" && d.budgetType === "daily" ? d.budget : null,
      lifetimeBudget: d.budgetLevel === "campaign" && d.budgetType === "lifetime" ? d.budget : null,
      status: paused,
    });
    const newCampaign: MetaCampaign = {
      id: camp.id,
      name: d.name,
      status: paused,
      effectiveStatus: paused,
      objective: d.objective,
      buyingType: "AUCTION",
      dailyBudget: d.budgetLevel === "campaign" && d.budgetType === "daily" ? d.budget : null,
      lifetimeBudget: d.budgetLevel === "campaign" && d.budgetType === "lifetime" ? d.budget : null,
      createdTime: now,
      updatedTime: now,
      startTime: now,
    };
    const newAdsets: MetaAdSet[] = [];
    const newAds: MetaAd[] = [];
    const newCreatives: MetaCreative[] = [];
    for (const a of d.adsets) {
      const as = await provider.createAdSet(ctx, {
        campaignId: camp.id,
        name: a.name,
        dailyBudget: d.budgetLevel === "adset" && d.budgetType === "daily" ? a.budget : null,
        lifetimeBudget: d.budgetLevel === "adset" && d.budgetType === "lifetime" ? a.budget : null,
        country: d.country,
        optimizationGoal: "LEAD_GENERATION",
        status: paused,
      });
      newAdsets.push({
        id: as.id,
        campaignId: camp.id,
        name: a.name,
        status: paused,
        effectiveStatus: paused,
        dailyBudget: d.budgetLevel === "adset" && d.budgetType === "daily" ? a.budget : null,
        lifetimeBudget: d.budgetLevel === "adset" && d.budgetType === "lifetime" ? a.budget : null,
        optimizationGoal: "LEAD_GENERATION",
        targetingSummary: `Broad · ${d.country}`,
        createdTime: now,
        updatedTime: now,
      });
      for (const ad of a.ads) {
        const source = ad.sourceAdId ? knownAds.get(ad.sourceAdId) : undefined;
        const created = await provider.createAd(ctx, { adsetId: as.id, name: ad.name, postId: ad.postId || source?.postId || "", creativeId: source?.creativeId ?? "", status: paused });
        newAds.push({
          id: created.id,
          adsetId: as.id,
          campaignId: camp.id,
          name: ad.name,
          status: paused,
          effectiveStatus: paused,
          creativeId: created.creativeId,
          postId: created.postId,
          createdTime: now,
          updatedTime: now,
        });
        const sourceCreative = source ? knownCreatives.get(source.creativeId) : undefined;
        if (created.creativeId && !knownCreatives.has(created.creativeId)) {
          newCreatives.push(
            sourceCreative
              ? { ...sourceCreative, id: created.creativeId, name: `${ad.name} — ${sourceCreative.name}` }
              : { id: created.creativeId, name: ad.name, kind: "unknown", thumbnailUrl: "", imageUrl: "", videoUrl: "", primaryText: "", headline: "", description: "", cta: "", pageId: "" },
          );
        }
      }
    }

    const db2 = readDB();
    const d2 = db2.mbDrafts.find((x) => x.id === id);
    if (d2) {
      d2.status = "published";
      d2.publishedCampaignId = camp.id;
      d2.error = "";
      d2.updatedAt = new Date().toISOString();
    }
    const snap = db2.mbSnapshots.find((s) => s.connectionId === connectionId);
    if (snap) {
      snap.campaigns.unshift(newCampaign);
      snap.adsets.push(...newAdsets);
      snap.ads.push(...newAds);
      snap.creatives.push(...newCreatives);
      recomputeEffective(snap);
    }
    db2.mbCampaignData.push({ id: newId(), connectionId, metaCampaignId: camp.id, phase: d.phase, leadGoal: null, internalNotes: "", updatedAt: now });
    audit(db2, session, {
      connectionId,
      entityType: "campaign",
      entityId: camp.id,
      entityName: d.name,
      action: "campaign.create",
      before: "",
      after: "PAUSED",
      summary: `Campagne créée en pause : ${d.name} (${newAdsets.length} ad set${newAdsets.length > 1 ? "s" : ""}, ${newAds.length} ad${newAds.length > 1 ? "s" : ""})`,
    });
    writeDB(db2);
    return { ok: true, campaignId: camp.id };
  } catch (e) {
    const db2 = readDB();
    const d2 = db2.mbDrafts.find((x) => x.id === id);
    if (d2) {
      d2.status = "failed";
      d2.error = e instanceof Error ? e.message : "Publication impossible.";
      d2.updatedAt = new Date().toISOString();
    }
    writeDB(db2);
    throw e;
  }
}
