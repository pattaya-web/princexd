/**
 * Vue business d'un lead et agregations du Sales Dashboard.
 *
 * Une seule entite Lead ; booking, show, vente et cash vivent dans les
 * rendez-vous et les ventes existants. `leadBusiness()` derive, pour chaque
 * lead, les statuts et montants que lisent les dashboards : aucune donnee
 * business n'est recopiee sur le lead. Les agregations tournent ici, cote
 * serveur, par cohorte d'acquisition (un lead compte dans la periode ou il
 * est arrive ; ses bookings, shows et ventes le suivent).
 */

import type { Appointment, DB, Lead, Sale, SourceChannel } from "../types";
import { leadIsOut } from "../types";
import { dayIn } from "../mediabuying/metrics";
import type { DateRange, MetaSnapshot } from "../mediabuying/types";
import { mockBusinessData } from "./mock-leads";
import { backfillAttribution, ensureFunnelsV2, FUNNELS, funnelLabel, SOURCE_CHANNEL_LABEL } from "./attribution";
import { PIPELINE_STAGES, type BookingStatus, type Cashflow, type DueInstallment, type LeadBusiness, type PipelineStage, type SaleStatusView, type ShowStatus } from "./business-types";

export * from "./business-types";
import { writeDB } from "../db";

/* ------------------------------ Vue par lead -------------------------- */

const SHOWED: Appointment["status"][] = ["completed", "follow-up", "closed-won", "closed-lost"];

/** Le rendez-vous qui compte : le plus recent non annule, sinon le plus recent. */
function mainAppointment(appts: Appointment[]): Appointment | null {
  if (!appts.length) return null;
  const sorted = [...appts].sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt));
  return sorted.find((a) => a.status !== "cancelled") ?? sorted[0];
}

/**
 * LA vente d'un lead, la meme partout (fiche, CRM, dashboards) : celle
 * rattachee a son rendez-vous principal, sinon la plus recemment mise a
 * jour. Une seule source de verite ; les montants viennent de la vente.
 */
export function activeSale(sales: Sale[], appt: Appointment | null): Sale | null {
  const live = sales.filter((s) => s.status !== "cancelled");
  if (appt) {
    const own = live.filter((s) => s.appointmentId === appt.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (own) return own;
  }
  return live.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
}

export function leadBusiness(lead: Lead, appts: Appointment[], sales: Sale[], defaultCurrency: string, tz = "Europe/Paris"): LeadBusiness {
  const appt = mainAppointment(appts);
  const sale = activeSale(sales, appt);

  let bookingStatus: BookingStatus | null = null;
  if (appt) {
    if (appt.status === "cancelled") bookingStatus = "CANCELLED";
    else if (appt.status === "no-show") bookingStatus = "NO_SHOW";
    else if (SHOWED.includes(appt.status)) bookingStatus = "SHOWED";
    else bookingStatus = "SCHEDULED";
  }
  const showStatus: ShowStatus | null = !appt || bookingStatus === "CANCELLED" ? null : bookingStatus === "SHOWED" ? "SHOWED" : bookingStatus === "NO_SHOW" ? "NO_SHOW" : "PENDING";

  let saleStatus: SaleStatusView = "PENDING";
  if (sale) saleStatus = "WON";
  else if (appt?.status === "closed-lost" || lead.stage === "closed-lost") saleStatus = "LOST";
  else if (appt?.status === "follow-up") saleStatus = "FOLLOW_UP";

  const revenue = sale ? Math.max(0, sale.contractValue - (sale.refundAmount || 0)) : 0;
  const cashCollected = sale ? Math.max(0, (sale.cashCollected || 0) - (sale.refundAmount || 0)) : 0;

  const validLead = !leadIsOut(lead.callStatus) && Boolean(lead.phone || lead.email || lead.igUsername);
  const qualifiedLead = Boolean(appts.some((a) => a.qualified) || lead.callStatus === "reached" || ["call-book", "call-fait", "closed-won"].includes(lead.stage) || bookingStatus);

  let pipelineStage: PipelineStage = "NEW_LEAD";
  if (saleStatus === "WON") pipelineStage = "CLOSED_WON";
  else if (saleStatus === "LOST") pipelineStage = "CLOSED_LOST";
  else if (bookingStatus === "SHOWED") pipelineStage = "SHOWED";
  else if (bookingStatus === "SCHEDULED" || bookingStatus === "NO_SHOW") pipelineStage = "BOOKED";
  else if (qualifiedLead) pipelineStage = "QUALIFIED";
  else if (lead.stage === "conversation") pipelineStage = "REPLIED";
  else if (lead.stage === "contacte" || lead.callStatus) pipelineStage = "CONTACTED";

  const acquiredAt = lead.firstTouchAt || lead.optInAt || lead.createdAt;
  return {
    leadId: lead.id,
    name: lead.name,
    handle: lead.handle || (lead.igUsername ? `@${lead.igUsername}` : ""),
    email: lead.email ?? "",
    phone: lead.phone ?? "",
    mock: Boolean(lead.mock),
    crmStage: lead.stage,
    acquiredDay: dayIn(tz, new Date(acquiredAt)),
    acquiredAt,
    sourceChannel: lead.sourceChannel ?? lead.firstTouchSourceChannel ?? "UNKNOWN",
    funnelSource: lead.funnelSource ?? lead.firstTouchFunnelSource ?? "unknown",
    campaignId: lead.campaignId ?? lead.firstTouchCampaignId ?? "",
    adsetId: lead.adsetId ?? lead.firstTouchAdsetId ?? "",
    adId: lead.adId ?? lead.firstTouchAdId ?? "",
    campaignName: lead.campaignName ?? "",
    adsetName: lead.adsetName ?? "",
    adName: lead.adName ?? "",
    lastTouchSourceChannel: lead.lastTouchSourceChannel ?? "",
    validLead,
    qualifiedLead,
    bookingProvider: appt ? (appt.iclosedEventId ? "ICLOSED" : "MANUAL") : "",
    bookingId: appt?.iclosedEventId || appt?.id || "",
    bookingStatus,
    bookingCreatedAt: appt?.createdAt ?? "",
    appointmentAt: appt?.scheduledAt ?? "",
    showStatus,
    saleStatus,
    revenue,
    cashCollected,
    currency: sale?.currency || defaultCurrency,
    pipelineStage,
  };
}

/* ------------------------------ Jeu complet --------------------------- */

export interface BusinessDataset {
  rows: LeadBusiness[];
  currency: string;
  tz: string;
  /** Noms des entites Meta, resolus depuis les snapshots du media buying. */
  names: { campaigns: Map<string, string>; adsets: Map<string, { name: string; campaignId: string }>; ads: Map<string, { name: string; adsetId: string; campaignId: string }> };
  snapshots: MetaSnapshot[];
}

/**
 * Tous les leads (vrais + demonstration tant qu'un compte Meta simule
 * existe), avec leur vue business. Un seul passage sur la base.
 */
export function businessDataset(db: DB): BusinessDataset {
  // Premiere lecture : les leads deja en base recoivent leur attribution, une fois.
  if (!db.settings.attributionBackfilledAt) {
    backfillAttribution(db);
    db.settings.attributionBackfilledAt = new Date().toISOString();
    writeDB(db);
  }
  if (!db.settings.salesFunnelsV2At) {
    ensureFunnelsV2(db);
    writeDB(db);
  }
  const currency = db.settings.salesCurrency || "EUR";
  const tz = "Europe/Paris";
  const mock = mockBusinessData(db.metaConnections);
  const leads = [...db.leads, ...mock.leads];
  const apptsByLead = new Map<string, Appointment[]>();
  for (const a of [...db.appointments, ...mock.appointments]) apptsByLead.set(a.leadId, [...(apptsByLead.get(a.leadId) ?? []), a]);
  const salesByLead = new Map<string, Sale[]>();
  for (const s of [...db.sales, ...mock.sales]) salesByLead.set(s.leadId, [...(salesByLead.get(s.leadId) ?? []), s]);

  const names: BusinessDataset["names"] = { campaigns: new Map(), adsets: new Map(), ads: new Map() };
  for (const snap of db.mbSnapshots) {
    for (const c of snap.campaigns) names.campaigns.set(c.id, c.name);
    for (const a of snap.adsets) names.adsets.set(a.id, { name: a.name, campaignId: a.campaignId });
    for (const ad of snap.ads) names.ads.set(ad.id, { name: ad.name, adsetId: ad.adsetId, campaignId: ad.campaignId });
  }
  const rows = leads.map((l) => {
    const r = leadBusiness(l, apptsByLead.get(l.id) ?? [], salesByLead.get(l.id) ?? [], currency, tz);
    // Les noms du media buying font foi ; ceux portes par le lead sont un repli.
    r.campaignName = names.campaigns.get(r.campaignId) ?? r.campaignName;
    r.adsetName = names.adsets.get(r.adsetId)?.name ?? r.adsetName;
    r.adName = names.ads.get(r.adId)?.name ?? r.adName;
    return r;
  });
  return { rows, currency, tz, names, snapshots: db.mbSnapshots };
}

/* ------------------------------ Agregation ---------------------------- */

export interface BusinessFilters {
  source?: SourceChannel | "";
  funnel?: string;
  campaignId?: string;
  adsetId?: string;
  adId?: string;
  crmStage?: Lead["stage"] | "";
  bookingStatus?: BookingStatus | "";
  saleStatus?: SaleStatusView | "";
}

export type GroupBy = "none" | "source" | "funnel" | "campaign" | "adset" | "ad";

export interface BusinessMetrics {
  leads: number;
  validLeads: number;
  qualifiedLeads: number;
  bookings: number;
  bookingRate: number | null;
  shows: number;
  noShows: number;
  /** Calls encore a venir (planifies, pas encore passes). */
  upcomingCalls: number;
  showRate: number | null;
  sales: number;
  closeRate: number | null;
  revenue: number;
  cashCollected: number;
  /** Null quand la source n'est pas payante : on n'invente pas de spend. */
  spend: number | null;
  cpl: number | null;
  costPerBooking: number | null;
  costPerShow: number | null;
  cac: number | null;
  roas: number | null;
  cashRoas: number | null;
}

export interface BusinessGroupRow {
  key: string;
  label: string;
  sourceChannel: SourceChannel | "";
  funnelSource: string;
  campaignId: string;
  adsetId: string;
  adId: string;
  metrics: BusinessMetrics;
}

export interface BusinessOptions {
  sources: { key: SourceChannel; label: string; n: number }[];
  funnels: { key: string; label: string; channel: SourceChannel; n: number }[];
  campaigns: { id: string; name: string }[];
  adsets: { id: string; name: string; campaignId: string }[];
  ads: { id: string; name: string; adsetId: string; campaignId: string }[];
  crmStages: Lead["stage"][];
}

export interface BusinessReport {
  range: DateRange;
  cashflow: Cashflow;
  currency: string;
  totals: BusinessMetrics;
  rows: BusinessGroupRow[];
  pipeline: { key: PipelineStage; label: string; n: number }[];
  options: BusinessOptions;
  hasMock: boolean;
  metaConnected: boolean;
}

const div = (a: number, b: number) => (b > 0 ? a / b : null);

function metricsOf(rows: LeadBusiness[], spend: number | null): BusinessMetrics {
  let validLeads = 0;
  let qualifiedLeads = 0;
  let bookings = 0;
  let shows = 0;
  let noShows = 0;
  let upcomingCalls = 0;
  let sales = 0;
  let revenue = 0;
  let cashCollected = 0;
  for (const r of rows) {
    if (r.validLead) validLeads++;
    if (r.qualifiedLead) qualifiedLeads++;
    if (r.bookingStatus && r.bookingStatus !== "CANCELLED") bookings++;
    if (r.bookingStatus === "SHOWED") shows++;
    if (r.bookingStatus === "NO_SHOW") noShows++;
    if (r.bookingStatus === "SCHEDULED") upcomingCalls++;
    if (r.saleStatus === "WON") {
      sales++;
      revenue += r.revenue;
      cashCollected += r.cashCollected;
    }
  }
  const leads = rows.length;
  return {
    leads,
    validLeads,
    qualifiedLeads,
    bookings,
    bookingRate: leads > 0 ? (bookings / leads) * 100 : null,
    shows,
    noShows,
    upcomingCalls,
    showRate: shows + noShows > 0 ? (shows / (shows + noShows)) * 100 : null,
    sales,
    closeRate: shows > 0 ? (sales / shows) * 100 : null,
    revenue,
    cashCollected,
    spend,
    cpl: spend === null ? null : div(spend, leads),
    costPerBooking: spend === null ? null : div(spend, bookings),
    costPerShow: spend === null ? null : div(spend, shows),
    cac: spend === null ? null : div(spend, sales),
    roas: spend === null ? null : div(revenue, spend),
    cashRoas: spend === null ? null : div(cashCollected, spend),
  };
}

/** Depense Meta sur la periode, par ad, toutes connexions confondues. */
function spendIndex(snapshots: MetaSnapshot[], range: DateRange): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of snapshots) {
    for (const r of s.insights) {
      if (r.date < range.from || r.date > range.to) continue;
      m.set(r.adId, (m.get(r.adId) ?? 0) + r.spend);
    }
  }
  return m;
}

interface MetaScope {
  campaignId?: string;
  adsetId?: string;
  adId?: string;
}

/** Depense des ads Meta qui tombent dans ce perimetre (campagne, ad set, ad). */
function spendFor(ds: BusinessDataset, spendBy: Map<string, number>, scope: MetaScope): number {
  let total = 0;
  for (const [adId, spend] of spendBy) {
    const ad = ds.names.ads.get(adId);
    if (scope.adId && adId !== scope.adId) continue;
    if (scope.adsetId && ad?.adsetId !== scope.adsetId) continue;
    if (scope.campaignId && ad?.campaignId !== scope.campaignId) continue;
    total += spend;
  }
  return total;
}

function matches(r: LeadBusiness, f: BusinessFilters): boolean {
  if (f.source && r.sourceChannel !== f.source) return false;
  if (f.funnel && r.funnelSource !== f.funnel) return false;
  if (f.campaignId && r.campaignId !== f.campaignId) return false;
  if (f.adsetId && r.adsetId !== f.adsetId) return false;
  if (f.adId && r.adId !== f.adId) return false;
  if (f.crmStage && r.crmStage !== f.crmStage) return false;
  if (f.bookingStatus && r.bookingStatus !== f.bookingStatus) return false;
  if (f.saleStatus && r.saleStatus !== f.saleStatus) return false;
  return true;
}

const isPaid = (channel: SourceChannel | "", funnel: string) => channel === "META_ADS" || FUNNELS.find((f) => f.key === funnel)?.channel === "META_ADS";

/**
 * Tresorerie des ventes REELLES (jamais les ventes de demonstration) : cash
 * encaisse, reste du, echeances en retard et a venir, d'apres les
 * echeanciers et encaissements saisis sur chaque vente.
 */
export function cashflowOf(db: DB, range: DateRange, tz = "Europe/Paris"): Cashflow {
  const today = dayIn(tz);
  const monthStart = `${today.slice(0, 7)}-01`;
  const in30 = (() => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 30);
    return d.toISOString().slice(0, 10);
  })();
  const leadName = new Map(db.leads.map((l) => [l.id, l.name]));
  const out: Cashflow = { cashInRange: 0, cashMonth: 0, remainingTotal: 0, pendingSales: 0, overdue: [], upcoming: [], upcomingTotal: 0, overdueTotal: 0 };
  for (const s of db.sales) {
    if (s.status === "cancelled") continue;
    const refund = s.refundAmount || 0;
    const cash = Math.max(0, (s.cashCollected || 0) - refund);
    const remaining = Math.max(0, s.contractValue - refund - cash);
    out.remainingTotal += remaining;
    if (remaining > 0) out.pendingSales++;
    /*
     * Cash date : les encaissements enregistres font foi ; a defaut, le cash
     * de la vente est date du jour de la vente (comptant ou acompte).
     */
    const dated: { at: string; amount: number }[] = (s.collections ?? []).map((c) => ({ at: c.at.slice(0, 10), amount: c.amount }));
    const datedSum = dated.reduce((n, c) => n + c.amount, 0);
    if (cash - datedSum > 0.005) dated.push({ at: s.soldAt.slice(0, 10), amount: cash - datedSum });
    for (const c of dated) {
      if (c.at >= range.from && c.at <= range.to) out.cashInRange += c.amount;
      if (c.at >= monthStart && c.at <= today) out.cashMonth += c.amount;
    }
    const plan = s.schedule ?? [];
    for (const i of plan) {
      if (i.paidAt || i.amount <= 0) continue;
      const row: DueInstallment = { saleId: s.id, appointmentId: s.appointmentId, leadId: s.leadId, leadName: leadName.get(s.leadId) ?? "Lead", dueAt: i.dueAt, amount: i.amount, n: i.n, of: plan.length, overdue: i.dueAt < today };
      if (row.overdue) out.overdue.push(row);
      else if (i.dueAt <= in30) out.upcoming.push(row);
    }
  }
  out.overdue.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  out.upcoming.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  out.overdueTotal = out.overdue.reduce((n, r) => n + r.amount, 0);
  out.upcomingTotal = out.upcoming.reduce((n, r) => n + r.amount, 0);
  return out;
}

export function aggregateBusiness(db: DB, opts: { range: DateRange; filters: BusinessFilters; groupBy: GroupBy }): BusinessReport {
  const ds = businessDataset(db);
  const { range, filters, groupBy } = opts;
  const inRange = ds.rows.filter((r) => r.acquiredDay >= range.from && r.acquiredDay <= range.to);
  const rows = inRange.filter((r) => matches(r, filters));
  const spendBy = spendIndex(ds.snapshots, range);
  const scope: MetaScope = { campaignId: filters.campaignId, adsetId: filters.adsetId, adId: filters.adId };

  // Spend global : seulement si la vue inclut du payant.
  const paidView = !filters.source || isPaid(filters.source, filters.funnel ?? "");
  const totals = metricsOf(rows, paidView ? spendFor(ds, spendBy, scope) : null);

  const groups = new Map<string, LeadBusiness[]>();
  const keyOf = (r: LeadBusiness): string => {
    switch (groupBy) {
      case "source":
        return r.sourceChannel;
      case "funnel":
        return r.funnelSource;
      case "campaign":
        return r.campaignId || "—";
      case "adset":
        return r.adsetId || "—";
      case "ad":
        return r.adId || "—";
      default:
        return "all";
    }
  };
  for (const r of rows) groups.set(keyOf(r), [...(groups.get(keyOf(r)) ?? []), r]);

  const groupRows: BusinessGroupRow[] = [...groups.entries()].map(([key, list]) => {
    const first = list[0];
    let label = "Tous";
    let spend: number | null = null;
    let sourceChannel: SourceChannel | "" = "";
    let funnelSource = "";
    let campaignId = "";
    let adsetId = "";
    let adId = "";
    switch (groupBy) {
      case "source":
        sourceChannel = first.sourceChannel;
        label = SOURCE_CHANNEL_LABEL[first.sourceChannel];
        spend = first.sourceChannel === "META_ADS" ? spendFor(ds, spendBy, scope) : null;
        break;
      case "funnel":
        funnelSource = first.funnelSource;
        label = funnelLabel(first.funnelSource, db.settings.salesFunnels);
        spend = isPaid("", first.funnelSource) ? spendFor(ds, spendBy, scope) : null;
        break;
      case "campaign":
        campaignId = first.campaignId;
        label = first.campaignId ? first.campaignName || first.campaignId : "Sans campagne";
        spend = first.campaignId ? spendFor(ds, spendBy, { ...scope, campaignId: first.campaignId }) : null;
        break;
      case "adset":
        adsetId = first.adsetId;
        label = first.adsetId ? first.adsetName || first.adsetId : "Sans ad set";
        spend = first.adsetId ? spendFor(ds, spendBy, { ...scope, adsetId: first.adsetId }) : null;
        break;
      case "ad":
        adId = first.adId;
        label = first.adId ? first.adName || first.adId : "Sans créative";
        spend = first.adId ? spendFor(ds, spendBy, { ...scope, adId: first.adId }) : null;
        break;
      default:
        spend = totals.spend;
    }
    return { key, label, sourceChannel, funnelSource, campaignId, adsetId, adId, metrics: metricsOf(list, spend) };
  });
  // Priorite business : ventes, puis shows, puis bookings, puis leads.
  groupRows.sort((a, b) => b.metrics.sales - a.metrics.sales || b.metrics.shows - a.metrics.shows || b.metrics.bookings - a.metrics.bookings || b.metrics.leads - a.metrics.leads);

  const pipelineCounts = new Map<PipelineStage, number>();
  for (const r of rows) pipelineCounts.set(r.pipelineStage, (pipelineCounts.get(r.pipelineStage) ?? 0) + 1);

  // Options de filtres : ce qui existe dans la periode, pour les menus en cascade.
  const srcCount = new Map<SourceChannel, number>();
  const funnelCount = new Map<string, number>();
  for (const r of inRange) {
    srcCount.set(r.sourceChannel, (srcCount.get(r.sourceChannel) ?? 0) + 1);
    funnelCount.set(r.funnelSource, (funnelCount.get(r.funnelSource) ?? 0) + 1);
  }
  const campaigns = [...ds.names.campaigns].map(([id, name]) => ({ id, name }));
  const seenCampaigns = new Set(campaigns.map((c) => c.id));
  for (const r of inRange) if (r.campaignId && !seenCampaigns.has(r.campaignId)) { seenCampaigns.add(r.campaignId); campaigns.push({ id: r.campaignId, name: r.campaignName || r.campaignId }); }
  const adsets = [...ds.names.adsets].map(([id, a]) => ({ id, name: a.name, campaignId: a.campaignId }));
  const seenAdsets = new Set(adsets.map((a) => a.id));
  for (const r of inRange) if (r.adsetId && !seenAdsets.has(r.adsetId)) { seenAdsets.add(r.adsetId); adsets.push({ id: r.adsetId, name: r.adsetName || r.adsetId, campaignId: r.campaignId }); }
  const ads = [...ds.names.ads].map(([id, a]) => ({ id, name: a.name, adsetId: a.adsetId, campaignId: a.campaignId }));
  const seenAds = new Set(ads.map((a) => a.id));
  for (const r of inRange) if (r.adId && !seenAds.has(r.adId)) { seenAds.add(r.adId); ads.push({ id: r.adId, name: r.adName || r.adId, adsetId: r.adsetId, campaignId: r.campaignId }); }

  return {
    range,
    cashflow: cashflowOf(db, range, ds.tz),
    currency: ds.currency,
    totals,
    rows: groupRows,
    pipeline: PIPELINE_STAGES.map((p) => ({ ...p, n: pipelineCounts.get(p.key) ?? 0 })),
    options: {
      sources: [...srcCount].map(([key, n]) => ({ key, label: SOURCE_CHANNEL_LABEL[key], n })).sort((a, b) => b.n - a.n),
      funnels: [...funnelCount].map(([key, n]) => ({ key, label: funnelLabel(key, db.settings.salesFunnels), channel: db.settings.salesFunnels?.find((f) => f.key === key)?.channel ?? FUNNELS.find((f) => f.key === key)?.channel ?? "UNKNOWN", n })).sort((a, b) => b.n - a.n),
      campaigns: campaigns.sort((a, b) => a.name.localeCompare(b.name)),
      adsets: adsets.sort((a, b) => a.name.localeCompare(b.name)),
      ads: ads.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
      crmStages: ["nouveau", "contacte", "conversation", "call-book", "call-fait", "closed-won", "closed-lost"],
    },
    hasMock: ds.rows.some((r) => r.mock),
    metaConnected: db.metaConnections.length > 0,
  };
}

/** Les leads derriere une ligne du tableau (ou derriere les totaux). */
export function leadsForGroup(db: DB, opts: { range: DateRange; filters: BusinessFilters; groupBy: GroupBy; key: string }): LeadBusiness[] {
  const ds = businessDataset(db);
  const { range, filters, groupBy, key } = opts;
  return ds.rows
    .filter((r) => r.acquiredDay >= range.from && r.acquiredDay <= range.to && matches(r, filters))
    .filter((r) => {
      if (groupBy === "none" || key === "all") return true;
      if (groupBy === "source") return r.sourceChannel === key;
      if (groupBy === "funnel") return r.funnelSource === key;
      if (groupBy === "campaign") return (r.campaignId || "—") === key;
      if (groupBy === "adset") return (r.adsetId || "—") === key;
      return (r.adId || "—") === key;
    })
    .sort((a, b) => b.acquiredAt.localeCompare(a.acquiredAt))
    .slice(0, 500);
}
