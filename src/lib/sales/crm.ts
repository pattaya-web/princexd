/**
 * Lignes du CRM : un lead = une ligne, derivee a la lecture des rendez-vous,
 * ventes, relances et journal deja en base. Les vues rapides (a traiter, a
 * relancer, paiements…) sont des filtres sur ces lignes, calcules ici une
 * fois pour que la page et les compteurs disent la meme chose.
 */

import type { Appointment, DB, FollowUp, Lead, Sale, Session } from "../types";
import { canSee } from "./access";
import { sessionHas } from "./roles";
import { funnelLabel, SOURCE_CHANNEL_LABEL } from "./attribution";
import { activeSale, leadBusiness, utmName } from "./business";
import { PAYMENT_STATE_LABEL, PAYMENT_STATE_TONE, paymentView } from "./installments";
import { isoToParisInput, label as statusLabel, parisDay } from "../format";
import type { CrmFollowUp, CrmOptions, CrmPayload, CrmRow, CrmSale, CrmTodo, FollowUpBucket, QuickView } from "./crm-types";

const PENDING_APPT: Appointment["status"][] = ["booked", "confirmed", "rescheduled"];

function saleView(s: Sale, today: string): CrmSale {
  const v = paymentView(s, today);
  return {
    id: s.id,
    appointmentId: s.appointmentId,
    offer: s.offer,
    contractValue: v.contractValue,
    cashCollected: v.cashCollected,
    remaining: v.remaining,
    paymentState: v.state,
    paymentSummary: v.summary,
    times: v.times,
    paidCount: v.paidCount,
    nextDueAt: v.nextDueAt,
    nextDueAmount: v.nextDueAmount,
    nextDueN: v.nextDueN,
    daysToNext: v.daysToNext,
    overdueAmount: v.overdueAmount,
    soldAt: s.soldAt,
    lastPaidAt: v.lastPaidAt,
    status: s.status,
  };
}

function followUpView(f: FollowUp, today: string): CrmFollowUp {
  const day = isoToParisInput(f.dueAt).slice(0, 10);
  const tomorrow = parisDay(1);
  const bucket: FollowUpBucket = day < today ? "overdue" : day === today ? "today" : day === tomorrow ? "tomorrow" : "later";
  const lastMsg = [...(f.log ?? [])].reverse().find((e) => e.kind === "contact" || e.kind === "note");
  return { id: f.id, dueAt: f.dueAt, notes: f.notes, step: f.step, heat: f.heat, lastContactAt: f.lastContactAt ?? "", lastMessage: lastMsg?.note ?? "", bucket };
}

const money = (n: number, currency: string) => `${Math.round(n).toLocaleString("fr-FR")} ${currency === "EUR" ? "€" : currency}`;

export function buildCrm(db: DB, session: Session): CrmPayload {
  const today = parisDay();
  const tomorrow = parisDay(1);
  const nowIso = new Date().toISOString();
  const names = new Map(db.team.map((m) => [m.id, m.name]));
  const currency = db.settings.salesCurrency || "EUR";

  const apptsByLead = new Map<string, Appointment[]>();
  for (const a of db.appointments) apptsByLead.set(a.leadId, [...(apptsByLead.get(a.leadId) ?? []), a]);
  const salesByLead = new Map<string, Sale[]>();
  for (const s of db.sales) salesByLead.set(s.leadId, [...(salesByLead.get(s.leadId) ?? []), s]);
  const fusByLead = new Map<string, FollowUp[]>();
  for (const f of db.followUps) fusByLead.set(f.leadId, [...(fusByLead.get(f.leadId) ?? []), f]);

  // Derniere action par entite, en un passage sur le journal (deja trie du plus recent au plus ancien).
  const lastLog = new Map<string, { at: string; summary: string }>();
  for (const l of db.activityLogs) if (!lastLog.has(l.entityId)) lastLog.set(l.entityId, { at: l.at, summary: l.summary });

  const metaNames = { campaigns: new Map<string, string>(), adsets: new Map<string, { name: string; campaignId: string }>(), ads: new Map<string, { name: string; adsetId: string }>() };
  for (const snap of db.mbSnapshots) {
    for (const c of snap.campaigns) metaNames.campaigns.set(c.id, c.name);
    for (const a of snap.adsets) metaNames.adsets.set(a.id, { name: a.name, campaignId: a.campaignId });
    for (const ad of snap.ads) metaNames.ads.set(ad.id, { name: ad.name, adsetId: ad.adsetId });
  }

  /** Perimetre : l'admin voit tout ; un membre, ses leads et ses rendez-vous. */
  const visible = (lead: Lead, appts: Appointment[]) => {
    if (session.isAdmin) return true;
    if (lead.setterId && canSee(session, { setterId: lead.setterId })) return true;
    if (!lead.setterId && sessionHas(session, "setter")) return true;
    return appts.some((a) => canSee(session, a));
  };

  const rows: CrmRow[] = [];
  for (const lead of db.leads) {
    const appts = apptsByLead.get(lead.id) ?? [];
    if (!visible(lead, appts)) continue;
    const allSales = salesByLead.get(lead.id) ?? [];
    const sales = allSales.filter((s) => s.status !== "cancelled");
    const cancelledSale = !sales.length && allSales.some((s) => s.status === "cancelled");
    const fus = fusByLead.get(lead.id) ?? [];
    const biz = leadBusiness(lead, appts, sales, currency);

    const live = appts.filter((a) => a.status !== "cancelled").sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt));
    // Le rendez-vous principal : celui de la vente s'il y en a une, sinon le plus recent.
    const withSale = live.find((a) => sales.some((s) => s.appointmentId === a.id));
    const appt = withSale ?? live[0] ?? null;
    // Meme vente que la fiche detaillee : une seule source de verite.
    const sale = activeSale(sales, appt);
    const pendingFu = fus.filter((f) => f.status === "pending").sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0] ?? null;
    const lastDone = fus.filter((f) => f.status === "done").sort((a, b) => (b.completedAt || b.dueAt).localeCompare(a.completedAt || a.dueAt))[0] ?? null;

    const saleV = sale ? saleView(sale, today) : null;
    const fuV = pendingFu ? followUpView(pendingFu, today) : null;

    // Derniere action : la plus recente parmi le lead, ses rendez-vous, sa vente, ses relances.
    const candidates = [lead.id, ...appts.map((a) => a.id), ...allSales.map((s) => s.id), ...fus.map((f) => f.id)].map((id) => lastLog.get(id)).filter(Boolean) as { at: string; summary: string }[];
    for (const a of appts) for (const h of a.history ?? []) candidates.push({ at: h.at, summary: `${h.actorName} → ${statusLabel(h.to)}${h.note ? ` — ${h.note}` : ""}` });
    for (const f of fus) if (f.lastContactAt) candidates.push({ at: f.lastContactAt, summary: "Prospect relancé" });
    candidates.sort((a, b) => b.at.localeCompare(a.at));
    const last = candidates[0];

    const apptPast = appt ? appt.scheduledAt < nowIso : false;
    const apptPending = appt ? PENDING_APPT.includes(appt.status) : false;
    const apptDay = appt ? isoToParisInput(appt.scheduledAt).slice(0, 10) : "";
    const hasLater = appt ? live.some((a) => a.scheduledAt > appt.scheduledAt) : false;
    const isLost = biz.saleStatus === "LOST" || lead.callStatus === "cold" || lead.callStatus === "not-interested" || (cancelledSale && !saleV);

    // ---- À traiter : une seule raison, la plus urgente.
    let todo: CrmTodo | null = null;
    if (saleV && saleV.paymentState === "overdue") {
      todo = { kind: "payment-overdue", rank: 1, reason: saleV.paymentSummary };
    } else if (fuV?.bucket === "overdue") {
      todo = { kind: "followup-overdue", rank: 2, reason: `Relance prévue le ${isoToParisInput(fuV.dueAt).slice(0, 10).split("-").reverse().slice(0, 2).join("/")}${fuV.notes ? ` : ${fuV.notes}` : ""}` };
    } else if (appt && apptPending && apptPast && !pendingFu) {
      todo = { kind: "outcome", rank: 3, reason: "Le call est passé : show, no-show, closé, en attente, perdu ?" };
    } else if (saleV && saleV.paymentState === "due") {
      todo = { kind: "payment-due", rank: 4, reason: saleV.paymentSummary };
    } else if (saleV && saleV.paymentState === "unspecified") {
      todo = { kind: "payment-unspecified", rank: 5, reason: saleV.paymentSummary };
    } else if (appt && appt.status === "no-show" && !pendingFu && !hasLater) {
      todo = { kind: "noshow", rank: 6, reason: "No-show sans relance ni nouveau rendez-vous" };
    } else if (appt && apptPending && !apptPast && apptDay <= tomorrow && appt.confirmation !== "confirmed") {
      todo = { kind: "unconfirmed", rank: 7, reason: apptDay === today ? "Call aujourd'hui, présence pas confirmée" : "Call demain, présence pas confirmée" };
    }
    // Les nouveaux leads sans action vivent dans « Leads à appeler » : ici, seuls les calls et l'argent.

    // ---- Statut lisible : ce que la ligne dit en premier.
    let headline = "";
    let tone: CrmRow["tone"] = "muted";
    if (saleV) {
      headline = saleV.paymentState === "paid" ? `Closé · ${money(saleV.contractValue, currency)} soldé` : `Closé · ${PAYMENT_STATE_LABEL[saleV.paymentState].toLowerCase()}`;
      tone = PAYMENT_STATE_TONE[saleV.paymentState];
    } else if (cancelledSale) {
      headline = "Vente annulée · non payée";
      tone = "bad";
    } else if (biz.saleStatus === "LOST") {
      headline = "Perdu";
      tone = "muted";
    } else if (fuV) {
      headline = `En attente · relance ${FOLLOWUP_LABEL[fuV.bucket]}`;
      tone = fuV.bucket === "overdue" ? "bad" : fuV.bucket === "today" ? "warn" : "info";
    } else if (appt && appt.status === "no-show") {
      headline = "No-show";
      tone = "bad";
    } else if (appt && apptPending && !apptPast) {
      headline = `Call ${apptDay === today ? "aujourd'hui" : apptDay === tomorrow ? "demain" : `le ${apptDay.split("-").reverse().slice(0, 2).join("/")}`}${appt.confirmation === "confirmed" ? " · confirmé" : " · à confirmer"}`;
      tone = appt.confirmation === "confirmed" ? "accent" : "warn";
    } else if (appt && apptPending && apptPast) {
      headline = "Call passé · à statuer";
      tone = "warn";
    } else if (appt && (appt.status === "completed" || appt.status === "follow-up")) {
      headline = appt.status === "completed" ? "Pitché · pas de décision" : "En attente";
      tone = "info";
    } else if (lead.callStatus === "cold") {
      headline = "Lead froid";
      tone = "muted";
    } else if (lead.callStatus) {
      headline = CALL_STATUS_LABEL[lead.callStatus] ?? lead.callStatus;
      tone = lead.callStatus === "callback" || lead.callStatus === "reached" ? "accent" : "muted";
    } else {
      headline = "Nouveau lead";
      tone = "muted";
    }

    const views: QuickView[] = ["all"];
    if (todo) views.push("todo");
    if (appt && apptPending && !apptPast) views.push("upcoming");
    if (fuV) views.push("followup");
    if (saleV && saleV.paymentState !== "paid") views.push("payment");
    if (saleV) views.push("closed");
    if (biz.showStatus === "NO_SHOW" && !saleV) views.push("noshow");
    if (isLost) views.push("lost");

    rows.push({
      leadId: lead.id,
      name: lead.name || (lead.igUsername ? `@${lead.igUsername}` : "Sans nom"),
      handle: biz.handle,
      email: lead.email ?? "",
      phone: lead.phone ?? "",
      country: lead.country ?? "",
      sourceChannel: biz.sourceChannel,
      funnelSource: biz.funnelSource,
      campaignId: biz.campaignId,
      adsetId: biz.adsetId,
      adId: biz.adId,
      campaignName: metaNames.campaigns.get(biz.campaignId) ?? biz.campaignName,
      adsetName: metaNames.adsets.get(biz.adsetId)?.name ?? biz.adsetName,
      adName: metaNames.ads.get(biz.adId)?.name ?? biz.adName,
      utm: [utmName(lead.firstTouchUtmCampaign), utmName(lead.firstTouchUtmContent), utmName(lead.firstTouchUtmTerm)].filter((x, i, arr) => x && arr.indexOf(x) === i).join(" · "),
      setterId: appt?.setterId || lead.setterId || "",
      setterName: names.get(appt?.setterId || lead.setterId || "") ?? "",
      closerId: appt?.closerId || "",
      closerName: names.get(appt?.closerId || "") ?? "",
      stage: lead.stage,
      callStatus: lead.callStatus ?? "",
      appointmentId: appt?.id ?? "",
      appointmentAt: appt?.scheduledAt ?? "",
      appointmentStatus: appt?.status ?? "",
      confirmation: appt?.confirmation ?? "",
      qualified: appts.some((a) => a.qualified),
      showStatus: biz.showStatus ?? "",
      saleStatus: biz.saleStatus,
      sale: saleV,
      followUp: fuV,
      lastFollowUpAt: lastDone?.completedAt || lastDone?.dueAt || "",
      lastActionAt: last?.at ?? lead.createdAt,
      lastActionSummary: last?.summary ?? "Lead créé",
      createdAt: lead.firstTouchAt || lead.optInAt || lead.createdAt,
      todo,
      headline,
      tone,
      views,
    });
  }

  // Ordre : a traiter d'abord (par rang puis anciennete), puis derniere action la plus recente.
  rows.sort((a, b) => {
    if (a.todo && b.todo && a.todo.rank !== b.todo.rank) return a.todo.rank - b.todo.rank;
    if (Boolean(a.todo) !== Boolean(b.todo)) return a.todo ? -1 : 1;
    return b.lastActionAt.localeCompare(a.lastActionAt);
  });

  const ALL: QuickView[] = ["todo", "upcoming", "followup", "payment", "closed", "noshow", "lost", "all"];
  const counts = Object.fromEntries(ALL.map((v) => [v, rows.filter((r) => r.views.includes(v)).length])) as Record<QuickView, number>;

  const uniq = <T extends { id: string }>(list: T[]) => [...new Map(list.map((x) => [x.id, x])).values()];
  const options: CrmOptions = {
    sources: [...new Set(rows.map((r) => r.sourceChannel))].map((k) => ({ key: k, label: SOURCE_CHANNEL_LABEL[k] })),
    funnels: [...new Set(rows.map((r) => r.funnelSource).filter(Boolean))].map((k) => ({ key: k, label: funnelLabel(k, db.settings.salesFunnels) })),
    campaigns: uniq(rows.filter((r) => r.campaignId).map((r) => ({ id: r.campaignId, name: r.campaignName || r.campaignId }))),
    adsets: uniq(rows.filter((r) => r.adsetId).map((r) => ({ id: r.adsetId, name: r.adsetName || r.adsetId, campaignId: r.campaignId }))),
    ads: uniq(rows.filter((r) => r.adId).map((r) => ({ id: r.adId, name: r.adName || r.adId, adsetId: r.adsetId }))),
    closers: uniq(rows.filter((r) => r.closerId).map((r) => ({ id: r.closerId, name: r.closerName }))),
    setters: uniq(rows.filter((r) => r.setterId).map((r) => ({ id: r.setterId, name: r.setterName }))),
  };
  return { rows, counts, options, currency, today };
}

const FOLLOWUP_LABEL: Record<FollowUpBucket, string> = { overdue: "en retard", today: "aujourd'hui", tomorrow: "demain", later: "à venir" };

const CALL_STATUS_LABEL: Record<string, string> = {
  "no-answer": "Ne répond pas",
  "message-sent": "Message envoyé",
  callback: "À rappeler",
  reached: "Joint · call à poser",
  "not-interested": "Pas intéressé",
  "wrong-number": "Faux numéro",
  "no-whatsapp": "Pas de WhatsApp",
  cold: "Lead froid",
};
