/**
 * Source d'acquisition d'un lead : UNE regle, centralisee.
 *
 * Trois choses a ne pas confondre :
 *  - la source d'ACQUISITION (first touch) : d'ou vient le lead la premiere
 *    fois. C'est elle que lisent le Sales Dashboard et le media buying ;
 *  - les INTERACTIONS suivantes (last touch) : un DM Instagram, un message
 *    ManyChat… elles sont notees a part et n'ecrasent jamais la premiere ;
 *  - la source de BOOKING (iClosed) : un outil de reservation, pas une
 *    source d'acquisition.
 *
 * Priorite de resolution (`resolveAcquisitionSource`) :
 *  1. attribution fiable deja enregistree (geree par `applyTouch`) ;
 *  2. funnel_source explicite ;
 *  3. IDs Meta (campaign / adset / ad) ;
 *  4. utm_source ;
 *  5. fbclid ;
 *  6. landing page connue ;
 *  7. source manuelle / indice d'origine ;
 *  8. UNKNOWN.
 */

import type { DB, Lead, SalesFunnel, SourceChannel } from "../types";

/* ------------------------------ Referentiels -------------------------- */

export const SOURCE_CHANNELS: SourceChannel[] = ["META_ADS", "INSTAGRAM", "ORGANIC", "REFERRAL", "AFFILIATE", "OTHER", "UNKNOWN"];

export const SOURCE_CHANNEL_LABEL: Record<SourceChannel, string> = {
  META_ADS: "Meta Ads",
  INSTAGRAM: "Instagram",
  ORGANIC: "Organic",
  REFERRAL: "Referral",
  AFFILIATE: "Affiliate",
  OTHER: "Other",
  UNKNOWN: "Unknown",
};

/** Funnels connus : cle machine -> libelle et canal par defaut. */
export const FUNNELS: { key: string; label: string; channel: SourceChannel }[] = [
  { key: "lp1_ads", label: "LP1 Ads", channel: "META_ADS" },
  { key: "instagram_dm", label: "Instagram DM", channel: "INSTAGRAM" },
  { key: "instagram_bio", label: "Lien bio Instagram", channel: "INSTAGRAM" },
  { key: "organic_masterclass", label: "Masterclass organique", channel: "ORGANIC" },
  { key: "youtube", label: "YouTube", channel: "ORGANIC" },
  { key: "direct_booking", label: "Réservation directe", channel: "OTHER" },
  { key: "referral", label: "Parrainage", channel: "REFERRAL" },
  { key: "affiliate", label: "Affiliation", channel: "AFFILIATE" },
  { key: "unknown", label: "Inconnu", channel: "UNKNOWN" },
];

const FUNNEL_BY_KEY = new Map(FUNNELS.map((f) => [f.key, f]));

export const funnelLabel = (key: string, custom?: SalesFunnel[]) => custom?.find((f) => f.key === key)?.label ?? FUNNEL_BY_KEY.get(key)?.label ?? key ?? "—";

/** Funnels par defaut tant que l'admin n'en a pas declare. */
export const DEFAULT_FUNNELS: SalesFunnel[] = [
  { key: "lp1_ads", label: "LP1 Ads", channel: "META_ADS", match: "royalscalebymady.fr", script: "" },
  { key: "organic_masterclass", label: "Masterclass organique", channel: "ORGANIC", match: "", script: "" },
  { key: "instagram_dm", label: "Instagram DM", channel: "INSTAGRAM", match: "", script: "" },
];

const needles = (match: string) => match.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);

/** Le funnel declare qui reconnait cette URL d'opt-in. */
export function funnelForUrl(url: string, funnels: SalesFunnel[]): SalesFunnel | null {
  const u = url.toLowerCase();
  if (!u) return null;
  return funnels.find((f) => needles(f.match).some((n) => u.includes(n))) ?? null;
}

/**
 * Landing pages connues. Sans utm ni fbclid, un opt-in sur la LP de la
 * masterclass est attribue au funnel Meta, mais marque « peu fiable » : une
 * attribution payante precise arrivee plus tard pourra la completer.
 */
const KNOWN_LANDING_PAGES: { test: RegExp; funnelSource: string; channel: SourceChannel }[] = [
  { test: /royalscalebymady\.fr/i, funnelSource: "lp1_ads", channel: "META_ADS" },
];

/* ------------------------------- Resolution --------------------------- */

/** Indice d'origine quand il n'y a rien de plus precis. */
export type TouchHint = "instagram-dm" | "instagram-story" | "instagram-reel" | "manychat" | "outreach" | "iclosed" | "systemeio" | "referral" | "manual" | "";

export interface TouchInput {
  funnelSource?: string;
  campaignId?: string;
  adsetId?: string;
  adId?: string;
  campaignName?: string;
  adsetName?: string;
  adName?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  placement?: string;
  fbclid?: string;
  landingUrl?: string;
  /** Source saisie a la main (CRM) : reel, story, dm, bio-link, referral, ads, lp… */
  manualSource?: string;
  hint?: TouchHint;
}

export interface ResolvedSource {
  sourceChannel: SourceChannel;
  funnelSource: string;
  /** Fiable = payant et identifie (IDs Meta, fbclid, utm payant) : ne sera plus ecrase automatiquement. */
  reliable: boolean;
  /** Quelle regle a tranche, pour le debug et le journal. */
  via: string;
}

const PAID_UTM_SOURCES = new Set(["fb", "facebook", "meta", "meta_ads", "metaads", "fbads", "instagram_ads", "ig_ads"]);
const PAID_UTM_MEDIUMS = new Set(["paid", "cpc", "ppc", "ads", "paid_social", "paidsocial", "social_paid", "cpm"]);

const clean = (v?: string) => (v ?? "").trim();
const lower = (v?: string) => clean(v).toLowerCase();

export function resolveAcquisitionSource(t: TouchInput, funnels: SalesFunnel[] = []): ResolvedSource {
  const hasMetaIds = Boolean(clean(t.campaignId) || clean(t.adsetId) || clean(t.adId));
  const utmSource = lower(t.utmSource);
  const utmMedium = lower(t.utmMedium);
  const paidUtm = PAID_UTM_SOURCES.has(utmSource) || (utmSource === "ig" && (PAID_UTM_MEDIUMS.has(utmMedium) || hasMetaIds || Boolean(clean(t.fbclid))));

  // 2. funnel_source explicite
  const funnel = lower(t.funnelSource);
  const custom = funnel ? funnels.find((f) => f.key.toLowerCase() === funnel) : undefined;
  if (custom) {
    return { sourceChannel: custom.channel, funnelSource: custom.key, reliable: custom.channel !== "META_ADS" || hasMetaIds || paidUtm || Boolean(clean(t.fbclid)), via: "funnel_source" };
  }
  if (funnel && FUNNEL_BY_KEY.has(funnel)) {
    const f = FUNNEL_BY_KEY.get(funnel)!;
    return { sourceChannel: f.channel, funnelSource: f.key, reliable: f.channel === "META_ADS" && (hasMetaIds || paidUtm || Boolean(clean(t.fbclid))) ? true : f.channel !== "META_ADS", via: "funnel_source" };
  }
  // 3. IDs Meta
  if (hasMetaIds) return { sourceChannel: "META_ADS", funnelSource: funnel || "lp1_ads", reliable: true, via: "meta_ids" };
  // 4. utm_source
  if (paidUtm) return { sourceChannel: "META_ADS", funnelSource: funnel || "lp1_ads", reliable: true, via: "utm_source" };
  if (utmSource === "ig" || utmSource === "instagram") return { sourceChannel: "INSTAGRAM", funnelSource: funnel || "instagram_bio", reliable: true, via: "utm_source" };
  if (utmSource === "youtube" || utmSource === "yt") return { sourceChannel: "ORGANIC", funnelSource: funnel || "youtube", reliable: true, via: "utm_source" };
  // 5. fbclid
  if (clean(t.fbclid)) return { sourceChannel: "META_ADS", funnelSource: funnel || "lp1_ads", reliable: true, via: "fbclid" };
  // 6. landing page connue
  const url = clean(t.landingUrl);
  if (url) {
    const declared = funnelForUrl(url, funnels);
    if (declared) return { sourceChannel: declared.channel, funnelSource: declared.key, reliable: declared.channel !== "META_ADS", via: "landing_page" };
    const hit = KNOWN_LANDING_PAGES.find((p) => p.test.test(url));
    if (hit) return { sourceChannel: hit.channel, funnelSource: hit.funnelSource, reliable: false, via: "landing_page" };
  }
  // 7. source manuelle ou indice d'origine
  const manual = lower(t.manualSource);
  if (manual) {
    if (["ads", "meta", "meta-ads", "facebook", "fb"].includes(manual)) return { sourceChannel: "META_ADS", funnelSource: "lp1_ads", reliable: false, via: "manual_source" };
    if (["dm", "instagram-dm", "reel", "story", "instagram-story", "instagram-reel", "bio-link", "instagram", "ig", "outbound", "inbound"].includes(manual)) {
      return { sourceChannel: "INSTAGRAM", funnelSource: manual === "bio-link" ? "instagram_bio" : "instagram_dm", reliable: false, via: "manual_source" };
    }
    if (manual === "referral" || manual === "parrainage") return { sourceChannel: "REFERRAL", funnelSource: "referral", reliable: false, via: "manual_source" };
    if (manual === "affiliate" || manual === "affiliation") return { sourceChannel: "AFFILIATE", funnelSource: "affiliate", reliable: false, via: "manual_source" };
    if (manual === "youtube") return { sourceChannel: "ORGANIC", funnelSource: "youtube", reliable: false, via: "manual_source" };
    if (manual === "lp" || manual === "landing") return { sourceChannel: "OTHER", funnelSource: "unknown", reliable: false, via: "manual_source" };
    if (manual === "iclosed") return { sourceChannel: "OTHER", funnelSource: "direct_booking", reliable: false, via: "manual_source" };
  }
  switch (t.hint) {
    case "instagram-dm":
    case "instagram-story":
    case "instagram-reel":
    case "outreach":
      return { sourceChannel: "INSTAGRAM", funnelSource: "instagram_dm", reliable: false, via: "hint" };
    // ManyChat transporte : sans attribution payante, c'est un contact Instagram.
    case "manychat":
      return { sourceChannel: "INSTAGRAM", funnelSource: "instagram_dm", reliable: false, via: "hint" };
    case "referral":
      return { sourceChannel: "REFERRAL", funnelSource: "referral", reliable: false, via: "hint" };
    case "iclosed":
      return { sourceChannel: "OTHER", funnelSource: "direct_booking", reliable: false, via: "hint" };
    default:
      break;
  }
  // 8. inconnu
  return { sourceChannel: "UNKNOWN", funnelSource: "unknown", reliable: false, via: "unknown" };
}

/* ------------------------------ Application --------------------------- */

/**
 * Le first touch est-il remplacable par cette nouvelle resolution ?
 *  - rien ou UNKNOWN en place : oui ;
 *  - en place non fiable, nouveau fiable (payant identifie) : oui ;
 *  - tout le reste : non. En particulier Instagram, ManyChat, direct ou
 *    vide ne remplacent jamais un META_ADS.
 */
function canReplaceFirst(lead: Lead, next: ResolvedSource): boolean {
  if (lead.attributionLocked) return false;
  const current = lead.firstTouchSourceChannel;
  if (!current || current === "UNKNOWN") return next.sourceChannel !== "UNKNOWN";
  if (!lead.firstTouchReliable && next.reliable) return true;
  return false;
}

function mirrorFirstTouch(lead: Lead) {
  lead.sourceChannel = lead.firstTouchSourceChannel;
  lead.funnelSource = lead.firstTouchFunnelSource;
  lead.campaignId = lead.firstTouchCampaignId;
  lead.adsetId = lead.firstTouchAdsetId;
  lead.adId = lead.firstTouchAdId;
}

/**
 * Enregistre un contact (touch) sur le lead. Le last touch est toujours mis
 * a jour ; le first touch seulement quand `canReplaceFirst` l'autorise.
 * Renvoie vrai si l'attribution effective a change.
 */
export function applyTouch(lead: Lead, touch: TouchInput, at: string = new Date().toISOString(), funnels: SalesFunnel[] = []): boolean {
  const r = resolveAcquisitionSource(touch, funnels);
  lead.lastTouchSourceChannel = r.sourceChannel;
  lead.lastTouchFunnelSource = r.funnelSource;
  lead.lastTouchAt = at;
  if (!canReplaceFirst(lead, r)) {
    // Les IDs Meta completent un first touch Meta deja la, sans le changer.
    if (lead.firstTouchSourceChannel === "META_ADS" && r.sourceChannel === "META_ADS" && !lead.attributionLocked) {
      let changed = false;
      if (!lead.firstTouchCampaignId && clean(touch.campaignId)) { lead.firstTouchCampaignId = clean(touch.campaignId); changed = true; }
      if (!lead.firstTouchAdsetId && clean(touch.adsetId)) { lead.firstTouchAdsetId = clean(touch.adsetId); changed = true; }
      if (!lead.firstTouchAdId && clean(touch.adId)) { lead.firstTouchAdId = clean(touch.adId); changed = true; }
      if (!lead.campaignName && clean(touch.campaignName)) lead.campaignName = clean(touch.campaignName);
      if (!lead.adsetName && clean(touch.adsetName)) lead.adsetName = clean(touch.adsetName);
      if (!lead.adName && clean(touch.adName)) lead.adName = clean(touch.adName);
      if (changed) {
        lead.firstTouchReliable = true;
        mirrorFirstTouch(lead);
      }
      return changed;
    }
    return false;
  }
  lead.firstTouchSourceChannel = r.sourceChannel;
  lead.firstTouchFunnelSource = r.funnelSource;
  lead.firstTouchCampaignId = clean(touch.campaignId);
  lead.firstTouchAdsetId = clean(touch.adsetId);
  lead.firstTouchAdId = clean(touch.adId);
  lead.firstTouchUtmSource = clean(touch.utmSource);
  lead.firstTouchUtmMedium = clean(touch.utmMedium);
  lead.firstTouchUtmCampaign = clean(touch.utmCampaign);
  lead.firstTouchUtmContent = clean(touch.utmContent);
  lead.firstTouchUtmTerm = clean(touch.utmTerm);
  lead.firstTouchPlacement = clean(touch.placement);
  lead.firstTouchFbclid = clean(touch.fbclid);
  lead.firstTouchAt = lead.firstTouchAt || at;
  lead.firstTouchReliable = r.reliable;
  if (clean(touch.campaignName)) lead.campaignName = clean(touch.campaignName);
  if (clean(touch.adsetName)) lead.adsetName = clean(touch.adsetName);
  if (clean(touch.adName)) lead.adName = clean(touch.adName);
  mirrorFirstTouch(lead);
  return true;
}

/** Correction manuelle : verrouille l'attribution, seule une autre correction la changera. */
export function setManualAttribution(lead: Lead, input: { sourceChannel: SourceChannel; funnelSource: string; campaignId?: string; adsetId?: string; adId?: string; campaignName?: string; adsetName?: string; adName?: string }, at: string = new Date().toISOString()) {
  lead.firstTouchSourceChannel = input.sourceChannel;
  lead.firstTouchFunnelSource = clean(input.funnelSource) || (FUNNELS.find((f) => f.channel === input.sourceChannel)?.key ?? "unknown");
  lead.firstTouchCampaignId = clean(input.campaignId);
  lead.firstTouchAdsetId = clean(input.adsetId);
  lead.firstTouchAdId = clean(input.adId);
  lead.campaignName = clean(input.campaignName);
  lead.adsetName = clean(input.adsetName);
  lead.adName = clean(input.adName);
  lead.firstTouchAt = lead.firstTouchAt || lead.optInAt || lead.createdAt || at;
  lead.firstTouchReliable = true;
  lead.attributionLocked = true;
  lead.attributionOverriddenAt = at;
  mirrorFirstTouch(lead);
}

/** Parametres utm d'un rendez-vous iClosed (`utm_source=ig`…) vers un touch. */
export function touchFromUtm(utm: Record<string, string> | undefined, extra: TouchInput = {}): TouchInput {
  const u = utm ?? {};
  const get = (...keys: string[]) => {
    for (const k of keys) {
      const v = u[k] ?? u[k.toLowerCase()];
      if (v) return String(v);
    }
    return "";
  };
  return {
    ...extra,
    utmSource: extra.utmSource || get("utm_source", "utmSource"),
    utmMedium: extra.utmMedium || get("utm_medium", "utmMedium"),
    utmCampaign: extra.utmCampaign || get("utm_campaign", "utmCampaign"),
    utmContent: extra.utmContent || get("utm_content", "utmContent"),
    utmTerm: extra.utmTerm || get("utm_term", "utmTerm"),
    campaignId: extra.campaignId || get("campaign_id", "campaignId", "utm_campaign_id"),
    adsetId: extra.adsetId || get("adset_id", "adsetId", "utm_adset_id"),
    adId: extra.adId || get("ad_id", "adId", "utm_ad_id"),
    placement: extra.placement || get("placement", "utm_placement"),
    fbclid: extra.fbclid || get("fbclid"),
    funnelSource: extra.funnelSource || get("funnel_source", "funnelSource", "funnel"),
  };
}

/* -------------------------------- Backfill ---------------------------- */

/**
 * Attribution des leads deja en base, une seule fois : derivee de la source
 * CRM, de la page d'opt-in Systeme.io et des utm des rendez-vous iClosed.
 * Idempotent : un lead deja attribue n'est pas touche.
 */
export function backfillAttribution(db: DB): number {
  let n = 0;
  const apptsByLead = new Map<string, { utm?: Record<string, string>; source: string; createdAt: string }[]>();
  for (const a of db.appointments) apptsByLead.set(a.leadId, [...(apptsByLead.get(a.leadId) ?? []), a]);
  for (const lead of db.leads) {
    if (lead.firstTouchSourceChannel) continue;
    const at = lead.optInAt || lead.createdAt || new Date().toISOString();
    const appts = (apptsByLead.get(lead.id) ?? []).sort((x, y) => x.createdAt.localeCompare(y.createdAt));
    // Les utm d'un rendez-vous iClosed sont l'indice le plus precis dont on dispose.
    const withUtm = appts.find((a) => a.utm && Object.keys(a.utm).length);
    const touch: TouchInput = withUtm
      ? touchFromUtm(withUtm.utm, { landingUrl: lead.sourceUrl, manualSource: lead.source })
      : { landingUrl: lead.sourceUrl, manualSource: lead.source, hint: appts[0]?.source === "referral" ? "referral" : appts[0]?.source?.startsWith("instagram") ? "instagram-dm" : lead.source === "iclosed" ? "iclosed" : "" };
    if (applyTouch(lead, touch, at)) n++;
    else {
      // Meme inconnu, on note la date : le lead est date pour les cohortes.
      lead.firstTouchSourceChannel = "UNKNOWN";
      lead.firstTouchFunnelSource = "unknown";
      lead.firstTouchAt = at;
      lead.firstTouchReliable = false;
      mirrorFirstTouch(lead);
    }
  }
  return n;
}

/**
 * Recalcule l'attribution des leads non verrouilles et non fiables (opt-in
 * sans utm) quand les funnels declares changent. Les attributions payantes
 * fiables et les corrections manuelles ne bougent pas.
 */
export function reattributeFromFunnels(db: DB, funnels: SalesFunnel[]): number {
  let n = 0;
  for (const lead of db.leads) {
    if (lead.attributionLocked || lead.firstTouchReliable || !lead.sourceUrl) continue;
    const hit = funnelForUrl(lead.sourceUrl, funnels);
    if (!hit || (lead.firstTouchFunnelSource === hit.key && lead.firstTouchSourceChannel === hit.channel)) continue;
    lead.firstTouchSourceChannel = hit.channel;
    lead.firstTouchFunnelSource = hit.key;
    lead.firstTouchReliable = false;
    lead.sourceChannel = hit.channel;
    lead.funnelSource = hit.key;
    n++;
  }
  return n;
}
