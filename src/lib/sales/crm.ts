/**
 * Lignes du CRM : un lead = une ligne, derivee a la lecture des rendez-vous,
 * ventes, relances et journal deja en base. Les vues rapides (a traiter, a
 * relancer, paiement en attente…) sont des filtres sur ces lignes, calcules
 * ici une fois pour que la page et les compteurs disent la meme chose.
 */

import type { Appointment, DB, FollowUp, Lead, Sale, Session } from "../types";
import { canSee } from "./access";
import { sessionHas } from "./roles";
import { funnelLabel, SOURCE_CHANNEL_LABEL } from "./attribution";
import { leadBusiness } from "./business";
import { isoToParisInput, parisDay } from "../format";
import type { CrmFollowUp, CrmOptions, CrmPayload, CrmRow, CrmSale, CrmTodo, FollowUpBucket, PaymentStatus, QuickView } from "./crm-types";

const ATTENDED: Appointment["status"][] = ["completed", "follow-up", "closed-won", "closed-lost"];
const PENDING_APPT: Appointment["status"][] = ["booked", "confirmed", "rescheduled"];

function saleView(s: Sale, today: string): CrmSale {
  const refund = s.refundAmount || 0;
  const contract = Math.max(0, s.contractValue - refund);
  const cash = Math.max(0, (s.cashCollected || 0) - refund);
  const remaining = Math.max(0, contract - cash);
  const paymentStatus: PaymentStatus = remaining <= 0.005 ? "paid" : cash > 0 ? "partial" : "pending";
  const unpaid = (s.schedule ?? []).filter((i) => !i.paidAt).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const next = unpaid[0];
  const overdueAmount = unpaid.filter((i) => i.dueAt < today).reduce((n, i) => n + i.amount, 0);
  const lastPaidAt = [...(s.collections ?? []).map((c) => c.at), ...(s.schedule ?? []).filter((i) => i.paidAt).map((i) => i.paidAt)].sort().pop() ?? (cash > 0 ? s.soldAt : "");
  return { id: s.id, appointmentId: s.appointmentId, offer: s.offer, contractValue: contract, cashCollected: cash, remaining, paymentStatus, nextDueAt: next?.dueAt ?? "", nextDueAmount: next?.amount ?? 0, overdueAmount, soldAt: s.soldAt, lastPaidAt };
}

function followUpView(f: FollowUp, today: string): CrmFollowUp {
  const day = isoToParisInput(f.dueAt).slice(0, 10);
  const tomorrow = isoToParisInput(new Date(Date.now() + 86_400_000)).slice(0, 10);
  const bucket: FollowUpBucket = day < today ? "overdue" : day === today ? "today" : day === tomorrow ? "tomorrow" : "later";
  const lastMsg = [...(f.log ?? [])].reverse().find((e) => e.kind === "contact" || e.kind === "note");
  return { id: f.id, dueAt: f.dueAt, notes: f.notes, step: f.step, lastContactAt: f.lastContactAt ?? "", lastMessage: lastMsg?.note ?? "", bucket };
}

export function buildCrm(db: DB, session: Session): CrmPayload {
  const today = parisDay();
  const nowIso = new Date().toISOString();
  const names = new Map(db.team.map((m) => [m.id, m.name]));
  const currency = db.settings.salesCurrency || "EUR";

  const apptsByLead = new Map<string, Appointment[]>();
  for (const a of db.appointments) apptsByLead.set(a.leadId, [...(apptsByLead.get(a.leadId) ?? []), a]);
  const salesByLead = new Map<string, Sale[]>();
  for (const s of db.sales) if (s.status !== "cancelled") salesByLead.set(s.leadId, [...(salesByLead.get(s.leadId) ?? []), s]);
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
    const sales = salesByLead.get(lead.id) ?? [];
    const fus = fusByLead.get(lead.id) ?? [];
    const biz = leadBusiness(lead, appts, sales, currency);

    const live = appts.filter((a) => a.status !== "cancelled").sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt));
    const appt = live[0] ?? null;
    const sale = sales.sort((a, b) => b.soldAt.localeCompare(a.soldAt))[0] ?? null;
    const pendingFu = fus.filter((f) => f.status === "pending").sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0] ?? null;
    const lastDone = fus.filter((f) => f.status === "done").sort((a, b) => (b.completedAt || b.dueAt).localeCompare(a.completedAt || a.dueAt))[0] ?? null;

    const saleV = sale ? saleView(sale, today) : null;
    const fuV = pendingFu ? followUpView(pendingFu, today) : null;

    // Derniere action : la plus recente parmi le lead, ses rendez-vous, sa vente, ses relances.
    const candidates = [lead.id, ...appts.map((a) => a.id), ...sales.map((s) => s.id), ...fus.map((f) => f.id)].map((id) => lastLog.get(id)).filter(Boolean) as { at: string; summary: string }[];
    for (const a of appts) for (const h of a.history ?? []) candidates.push({ at: h.at, summary: `${h.actorName} → ${h.to}${h.note ? ` — ${h.note}` : ""}` });
    for (const f of fus) if (f.lastContactAt) candidates.push({ at: f.lastContactAt, summary: "Prospect relancé" });
    candidates.sort((a, b) => b.at.localeCompare(a.at));
    const last = candidates[0];

    const apptPast = appt ? appt.scheduledAt < nowIso : false;
    const apptPending = appt ? PENDING_APPT.includes(appt.status) : false;
    const hasLater = appt ? live.some((a) => a.scheduledAt > appt.scheduledAt) : false;

    // ---- À traiter : une seule raison, la plus urgente.
    let todo: CrmTodo | null = null;
    const paymentOverdue = saleV && saleV.remaining > 0 && (saleV.overdueAmount > 0 || (!saleV.nextDueAt && Date.parse(saleV.soldAt) < Date.now() - 7 * 86_400_000));
    if (paymentOverdue) todo = { rank: 1, reason: saleV!.overdueAmount > 0 ? `Échéance en retard : ${Math.round(saleV!.overdueAmount)} ${currency}` : `Reste ${Math.round(saleV!.remaining)} ${currency} à encaisser, sans échéancier` };
    else if (fuV?.bucket === "overdue") todo = { rank: 2, reason: `Relance en retard${fuV.notes ? ` : ${fuV.notes}` : ""}` };
    else if (appt && apptPending && apptPast && !pendingFu) todo = { rank: 3, reason: "Call passé, résultat à saisir (show, no-show, closé…)" };
    else if (appt && appt.status === "no-show" && !pendingFu && !hasLater) todo = { rank: 4, reason: "No-show sans nouveau rendez-vous" };
    else if (appt && appt.status === "no-show" && !pendingFu) todo = { rank: 5, reason: "No-show à relancer" };
    else if (!appt && !lead.callStatus && Date.parse(lead.createdAt) > Date.now() - 48 * 3_600_000) todo = { rank: 6, reason: "Nouveau lead, aucune action" };

    const views: QuickView[] = ["all"];
    if (todo) views.push("todo");
    if (fuV) views.push("followup");
    if (saleV && saleV.remaining > 0) views.push("payment");
    if (saleV) views.push("closed");
    if (biz.showStatus === "SHOWED") views.push("show");
    if (biz.showStatus === "NO_SHOW") views.push("noshow");
    if (appt && appt.status === "no-show" && !pendingFu && !hasLater) views.push("reschedule");
    if (appts.some((a) => a.qualified)) views.push("qualified");
    if (biz.saleStatus === "LOST" || lead.callStatus === "cold" || lead.callStatus === "not-interested") views.push("lost");

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
      views,
    });
  }

  // Ordre : a traiter d'abord (par rang puis anciennete), puis derniere action la plus recente.
  rows.sort((a, b) => {
    if (a.todo && b.todo && a.todo.rank !== b.todo.rank) return a.todo.rank - b.todo.rank;
    if (Boolean(a.todo) !== Boolean(b.todo)) return a.todo ? -1 : 1;
    return b.lastActionAt.localeCompare(a.lastActionAt);
  });

  const counts = Object.fromEntries((["all", "todo", "followup", "payment", "closed", "show", "noshow", "reschedule", "qualified", "lost"] as QuickView[]).map((v) => [v, rows.filter((r) => r.views.includes(v)).length])) as Record<QuickView, number>;

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
  void ATTENDED;
  return { rows, counts, options, currency };
}
