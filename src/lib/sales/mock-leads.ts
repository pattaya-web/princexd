/**
 * Leads, rendez-vous et ventes de demonstration, generes EN MEMOIRE a partir
 * du compte Meta simule : memes ads, memes jours, memes nombres de leads que
 * les stats du cockpit media buying, plus un peu d'Instagram organique et de
 * parrainage pour comparer les canaux. Rien n'est jamais ecrit dans la base :
 * le CRM reel n'en voit pas la couleur, seuls les dashboards les melangent
 * aux vraies donnees tant qu'un compte simule existe.
 */

import type { Appointment, Lead, Sale } from "../types";
import { dayIn, shiftDay } from "../mediabuying/metrics";
import { mockDailyData, mockStructure } from "../mediabuying/mock";
import type { MetaConnection } from "../mediabuying/types";
import { providerKindFor } from "../mediabuying/provider";

export interface MockBusiness {
  leads: Lead[];
  appointments: Appointment[];
  sales: Sale[];
}

const DAYS = 45;
const OFFER = 2990;
const CURRENCY = "EUR";
const TZ = "Europe/Paris";

const FIRST = ["Monia", "Theo", "Sarah", "Yanis", "Inès", "Lucas", "Lina", "Mehdi", "Chloé", "Adam", "Nour", "Hugo", "Léa", "Rayan", "Manon", "Karim", "Emma", "Sofiane", "Jade", "Bilal", "Camille", "Ilyes", "Zoé", "Nassim", "Alice", "Samy", "Eva", "Noah", "Clara", "Idriss", "Maya", "Enzo", "Louna", "Amine", "Anaïs", "Tom", "Salma", "Gabriel", "Romane", "Walid"];
const LAST = ["B.", "D.", "K.", "M.", "L.", "R.", "S.", "T.", "A.", "C.", "H.", "N.", "Z.", "G.", "F.", "P."];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function rng(seed: string): () => number {
  let a = hash(seed);
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Outcome {
  booked: boolean;
  showed: boolean;
  won: boolean;
  /** Cash encaisse si vente (comptant ou acompte). */
  cash: number;
  qualified: boolean;
  valid: boolean;
}

interface Attribution {
  sourceChannel: Lead["sourceChannel"];
  funnelSource: string;
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
  fbclid?: string;
  placement?: string;
}

function makeLead(seed: string, date: string, i: number, attr: Attribution, o: Outcome, out: MockBusiness) {
  const r = rng(`${seed}:${date}:${i}`);
  const first = FIRST[Math.floor(r() * FIRST.length)];
  const last = LAST[Math.floor(r() * LAST.length)];
  const id = `mock-lead-${hash(`${seed}:${date}:${i}`).toString(36)}`;
  const hour = 8 + Math.floor(r() * 13);
  const createdAt = `${date}T${String(hour).padStart(2, "0")}:${String(Math.floor(r() * 60)).padStart(2, "0")}:00.000Z`;
  const ig = `${first.toLowerCase().normalize("NFD").replace(/[^a-z]/g, "")}${Math.floor(r() * 900 + 100)}`;
  const lead: Lead = {
    id,
    name: `${first} ${last}`,
    handle: attr.sourceChannel === "INSTAGRAM" ? `@${ig}` : "",
    source: attr.sourceChannel === "META_ADS" ? "lp" : attr.sourceChannel === "INSTAGRAM" ? "dm" : "referral",
    stage: o.won ? "closed-won" : o.showed ? (r() < 0.5 ? "call-fait" : "closed-lost") : o.booked ? "call-book" : o.qualified ? "conversation" : o.valid ? "contacte" : "nouveau",
    dealValue: o.won ? OFFER : 0,
    callAt: "",
    ownerRole: "setter",
    ownerName: "",
    painPoint: "",
    nextAction: "",
    nextActionAt: "",
    notes: "",
    createdAt,
    igUsername: attr.sourceChannel === "INSTAGRAM" ? ig : "",
    email: `${first.toLowerCase().normalize("NFD").replace(/[^a-z]/g, "")}.${last[0].toLowerCase()}${Math.floor(r() * 99)}@example.com`,
    phone: o.valid ? `+336${String(Math.floor(r() * 1e8)).padStart(8, "0")}` : "",
    country: "FR",
    timezone: TZ,
    optInAt: createdAt,
    callStatus: !o.valid ? "wrong-number" : o.qualified ? "reached" : undefined,
    sourceChannel: attr.sourceChannel,
    funnelSource: attr.funnelSource,
    campaignId: attr.campaignId ?? "",
    adsetId: attr.adsetId ?? "",
    adId: attr.adId ?? "",
    campaignName: attr.campaignName ?? "",
    adsetName: attr.adsetName ?? "",
    adName: attr.adName ?? "",
    firstTouchSourceChannel: attr.sourceChannel,
    firstTouchFunnelSource: attr.funnelSource,
    firstTouchCampaignId: attr.campaignId ?? "",
    firstTouchAdsetId: attr.adsetId ?? "",
    firstTouchAdId: attr.adId ?? "",
    firstTouchUtmSource: attr.utmSource ?? "",
    firstTouchUtmMedium: attr.utmMedium ?? "",
    firstTouchUtmCampaign: attr.utmCampaign ?? "",
    firstTouchUtmContent: attr.utmContent ?? "",
    firstTouchUtmTerm: "",
    firstTouchPlacement: attr.placement ?? "",
    firstTouchFbclid: attr.fbclid ?? "",
    firstTouchAt: createdAt,
    firstTouchReliable: attr.sourceChannel === "META_ADS",
    // Un lead Meta sur quatre ecrit ensuite en DM : le last touch le dit, le first touch ne bouge pas.
    lastTouchSourceChannel: attr.sourceChannel === "META_ADS" && r() < 0.25 ? "INSTAGRAM" : attr.sourceChannel,
    lastTouchFunnelSource: attr.sourceChannel === "META_ADS" && r() < 0.25 ? "instagram_dm" : attr.funnelSource,
    lastTouchAt: createdAt,
    mock: true,
  };
  out.leads.push(lead);
  if (!o.booked) return;

  const bookingDay = shiftDay(date, 1 + Math.floor(r() * 3));
  const scheduledAt = `${bookingDay}T${String(9 + Math.floor(r() * 9)).padStart(2, "0")}:00:00.000Z`;
  const today = dayIn(TZ);
  const future = bookingDay >= today;
  const status: Appointment["status"] = future ? (r() < 0.6 ? "confirmed" : "booked") : !o.showed ? "no-show" : o.won ? "closed-won" : r() < 0.4 ? "follow-up" : "closed-lost";
  const appt: Appointment = {
    id: `mock-appt-${hash(id).toString(36)}`,
    leadId: id,
    setterId: "",
    closerId: "",
    scheduledAt,
    timezone: TZ,
    source: attr.sourceChannel === "INSTAGRAM" ? "instagram-dm" : "inbound",
    status,
    qualified: o.qualified,
    setterNotes: "",
    closerNotes: "",
    lostReason: "",
    iclosedUrl: "",
    iclosedEventId: `mock-${hash(id) % 100000}`,
    rescheduledFromId: "",
    completedAt: future ? "" : scheduledAt,
    history: [],
    createdBy: "",
    createdAt,
    updatedAt: createdAt,
  };
  out.appointments.push(appt);
  if (!o.won || future) return;
  out.sales.push({
    id: `mock-sale-${hash(id).toString(36)}`,
    leadId: id,
    appointmentId: appt.id,
    setterId: "",
    closerId: "",
    offer: "Masterclass Ecom AI — accompagnement",
    contractValue: OFFER,
    cashCollected: o.cash,
    currency: CURRENCY,
    paymentType: o.cash >= OFFER ? "paid-in-full" : "installments",
    installments: o.cash >= OFFER ? 1 : 3,
    paymentMethod: "stripe",
    soldAt: scheduledAt,
    status: "active",
    refundAmount: 0,
    refundedAt: "",
    notes: "",
    createdBy: "",
    createdAt: scheduledAt,
    updatedAt: scheduledAt,
  });
}

/** Tirage de N leads avec un nombre impose de bookings, shows, ventes. */
function outcomes(n: number, valid: number, qualified: number, bookings: number, shows: number, sales: number, cash: number): Outcome[] {
  const list: Outcome[] = [];
  let cashLeft = cash;
  for (let i = 0; i < n; i++) {
    const won = i < sales;
    let c = 0;
    if (won) {
      // Comptant tant que le cash le permet, acompte sinon (conformement au total genere).
      c = cashLeft >= OFFER ? OFFER : Math.max(0, cashLeft);
      cashLeft -= c;
    }
    list.push({ booked: i < bookings, showed: i < shows, won, cash: c, qualified: i < qualified, valid: i < valid });
  }
  return list;
}

function poisson(mean: number, r: () => number): number {
  const L = Math.exp(-mean);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= r();
  } while (p > L);
  return k - 1;
}

/** Tout le jeu de demonstration d'un compte simule. */
function buildFor(connection: MetaConnection): MockBusiness {
  const seed = connection.adAccountId || connection.id;
  const out: MockBusiness = { leads: [], appointments: [], sales: [] };
  const today = dayIn(TZ);
  const range = { from: shiftDay(today, -DAYS), to: today };
  const s = mockStructure(seed);
  const campaigns = new Map(s.campaigns.map((c) => [c.id, c]));
  const adsets = new Map(s.adsets.map((a) => [a.id, a]));
  const ads = new Map(s.ads.map((a) => [a.id, a]));
  const { insights, conversions } = mockDailyData(seed, range);
  const convByKey = new Map(conversions.map((c) => [`${c.adId}:${c.date}`, c]));

  for (const ins of insights) {
    if (!ins.leads) continue;
    const conv = convByKey.get(`${ins.adId}:${ins.date}`);
    const ad = ads.get(ins.adId);
    if (!conv || !ad) continue;
    const adset = adsets.get(ad.adsetId);
    const campaign = campaigns.get(ad.campaignId);
    const attr: Attribution = {
      sourceChannel: "META_ADS",
      funnelSource: "lp1_ads",
      campaignId: ad.campaignId,
      adsetId: ad.adsetId,
      adId: ad.id,
      campaignName: campaign?.name ?? "",
      adsetName: adset?.name ?? "",
      adName: ad.name,
      utmSource: "fb",
      utmMedium: "paid",
      utmCampaign: campaign?.name ?? "",
      utmContent: ad.name,
      fbclid: `IwAR${hash(`${ins.adId}:${ins.date}`).toString(36)}`,
      placement: hash(ins.date) % 2 ? "instagram_reels" : "facebook_feed",
    };
    const list = outcomes(ins.leads, conv.validLeads, conv.qualifiedLeads, conv.bookings, conv.shows, conv.sales, conv.cashCollected);
    list.forEach((o, i) => makeLead(`${seed}:${ins.adId}`, ins.date, i, attr, o, out));
  }

  // Instagram organique et parrainage : pas de spend, mais des calls et des ventes.
  for (let d = 0; d <= DAYS; d++) {
    const date = shiftDay(range.from, d);
    const r = rng(`${seed}:organic:${date}`);
    const ig = poisson(1.3, r);
    const igBook = Math.round(ig * 0.3);
    const igShow = Math.round(igBook * 0.7);
    const igSales = Math.round(igShow * 0.3);
    outcomes(ig, ig, Math.round(ig * 0.6), igBook, igShow, igSales, igSales * OFFER).forEach((o, i) =>
      makeLead(`${seed}:ig`, date, i, { sourceChannel: "INSTAGRAM", funnelSource: "instagram_dm" }, o, out),
    );
    const ref = r() < 0.18 ? 1 : 0;
    if (ref) {
      const booked = r() < 0.6;
      const showed = booked && r() < 0.9;
      const won = showed && r() < 0.5;
      makeLead(`${seed}:ref`, date, 0, { sourceChannel: "REFERRAL", funnelSource: "referral" }, { booked, showed, won, cash: won ? OFFER : 0, qualified: true, valid: true }, out);
    }
    const yt = r() < 0.3 ? 1 : 0;
    if (yt) {
      const booked = r() < 0.25;
      const showed = booked && r() < 0.7;
      const won = showed && r() < 0.3;
      makeLead(`${seed}:yt`, date, 0, { sourceChannel: "ORGANIC", funnelSource: "youtube", utmSource: "youtube" }, { booked, showed, won, cash: won ? 1000 : 0, qualified: r() < 0.5, valid: true }, out);
    }
  }
  return out;
}

const CACHE = new Map<string, { day: string; data: MockBusiness }>();

/** Jeu de demonstration de tous les comptes simules, regenere chaque jour. */
export function mockBusinessData(connections: MetaConnection[]): MockBusiness {
  const out: MockBusiness = { leads: [], appointments: [], sales: [] };
  const today = dayIn(TZ);
  for (const c of connections) {
    if (providerKindFor(c) !== "mock") continue;
    const key = c.adAccountId || c.id;
    let hit = CACHE.get(key);
    if (!hit || hit.day !== today) {
      hit = { day: today, data: buildFor(c) };
      CACHE.set(key, hit);
    }
    out.leads.push(...hit.data.leads);
    out.appointments.push(...hit.data.appointments);
    out.sales.push(...hit.data.sales);
  }
  return out;
}
