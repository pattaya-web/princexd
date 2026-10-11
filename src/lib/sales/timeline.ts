import { fmtDateTime } from "@/lib/format";
import type { ActivityLog, Appointment, DB, Lead, Sale } from "@/lib/types";
import { funnelLabel, SOURCE_CHANNEL_LABEL } from "./attribution";

/**
 * Timeline d'un lead : tout ce qui lui est arrive, dans l'ordre, lisible.
 *
 * Elle est assemblee depuis le journal existant (`activityLogs`), en y
 * joignant les entrees des rendez-vous, ventes et relances du lead : il n'y a
 * pas de second historique. Chaque entree est reformulee en un titre court
 * (« Call booké », « Show », « Sale ») et un detail (date du rendez-vous,
 * closer, montant), sans rien perdre de la phrase d'origine en repli.
 */
export type TimelineKind = "lead" | "message" | "status" | "booking" | "show" | "no-show" | "sale" | "lost" | "follow-up" | "info";

export interface TimelineItem {
  id: string;
  at: string;
  kind: TimelineKind;
  title: string;
  detail: string;
  /** Qui a fait l'action (membre, iClosed, Systeme.io…). */
  by: string;
}

const money = (n: number, cur: string) => `${Math.round(n).toLocaleString("fr-FR")} ${cur}`;

/** Source lisible pour « Lead créé » : canal, funnel, créative si connue. */
export function sourceDetail(lead: Lead, adName?: string): string {
  const parts: string[] = [];
  if (lead.sourceChannel) parts.push(`Source : ${SOURCE_CHANNEL_LABEL[lead.sourceChannel]}`);
  if (lead.funnelSource && lead.funnelSource !== "unknown") parts.push(funnelLabel(lead.funnelSource));
  const creative = adName || lead.adName || (lead.adId ? `ad ${lead.adId}` : "");
  if (creative) parts.push(`Créative : ${creative}`);
  return parts.join(" · ");
}

const STATUS_TITLE: Record<string, { title: string; kind: TimelineKind }> = {
  completed: { title: "Show", kind: "show" },
  "no-show": { title: "No-show", kind: "no-show" },
  cancelled: { title: "Call annulé", kind: "lost" },
  rescheduled: { title: "Call reprogrammé", kind: "booking" },
  "closed-won": { title: "Sale", kind: "sale" },
  "closed-lost": { title: "Perdu", kind: "lost" },
  "follow-up": { title: "Follow-up", kind: "follow-up" },
  booked: { title: "Call booké", kind: "booking" },
  confirmed: { title: "Call confirmé", kind: "booking" },
};

function describe(g: ActivityLog, lead: Lead, appts: Map<string, Appointment>, sales: Map<string, Sale>, names: Map<string, string>, adName?: string): TimelineItem {
  const base = { id: g.id, at: g.at, by: g.actorName };
  const appt = g.entity === "appointment" ? appts.get(g.entityId) : undefined;
  const closer = appt?.closerId ? (names.get(appt.closerId) ?? "") : "";
  switch (g.action) {
    case "lead.created":
      return { ...base, kind: "lead", title: "Lead créé", detail: sourceDetail(lead, adName) };
    case "lead.optin":
      return { ...base, kind: "lead", title: "Réinscription", detail: g.summary.replace(/^Réinscription[^:]*:\s*/i, "") };
    case "lead.message": {
      const [first, ...rest] = g.summary.split(" · ");
      return { ...base, kind: "message", title: first || "Message envoyé", detail: rest.join(" · ") };
    }
    case "lead.status":
    case "lead.attempt":
    case "lead.reached":
    case "lead.lost":
    case "lead.reopen":
    case "lead.cold":
      return { ...base, kind: "status", title: "Statut d'appel", detail: g.summary.replace(/^[^:]+:\s*/, "").replace(new RegExp(`^${lead.name}\\s*[—-]\\s*`), "") };
    case "appointment.created":
      return {
        ...base,
        kind: "booking",
        title: "Call booké",
        detail: appt ? `Rendez-vous : ${fmtDateTime(appt.scheduledAt)}${closer ? ` · Closer : ${closer}` : ""}${appt.iclosedEventId ? " · via iClosed" : ""}${appt.calendar ? ` · ${appt.calendar.replace(/_/g, " ").toLowerCase()}` : ""}` : g.summary,
      };
    case "appointment.rescheduled":
      return { ...base, kind: "booking", title: "Call reprogrammé", detail: appt ? `Nouveau rendez-vous : ${fmtDateTime(appt.scheduledAt)}` : g.summary };
    case "appointment.cancelled":
      return { ...base, kind: "lost", title: "Call annulé", detail: appt ? `Rendez-vous du ${fmtDateTime(appt.scheduledAt)}` : g.summary };
    case "appointment.status": {
      const key = g.summary.match(/«\s*([a-z-]+)\s*»/i)?.[1] ?? "";
      const s = STATUS_TITLE[key];
      if (!s) return { ...base, kind: "info", title: g.summary, detail: "" };
      let detail = appt ? `Rendez-vous du ${fmtDateTime(appt.scheduledAt)}${closer ? ` · Closer : ${closer}` : ""}` : "";
      if (key === "rescheduled" && appt) detail = `Nouveau rendez-vous : ${fmtDateTime(appt.scheduledAt)}`;
      if (key === "closed-lost" && appt?.lostReason) detail += ` · ${appt.lostReason}`;
      return { ...base, kind: s.kind, title: s.title, detail };
    }
    case "sale.created":
    case "sale.updated": {
      const sale = sales.get(g.entityId);
      return {
        ...base,
        kind: "sale",
        title: g.action === "sale.updated" ? "Vente corrigée" : "Sale",
        detail: sale ? `Montant contrat : ${money(sale.contractValue, sale.currency)} · Cash encaissé : ${money(sale.cashCollected, sale.currency)}${sale.offer ? ` · ${sale.offer}` : ""}` : g.summary,
      };
    }
    case "follow-up.created":
      return { ...base, kind: "follow-up", title: "Relance programmée", detail: g.summary };
    case "lead.declared":
      return { ...base, kind: "message", title: "Lien du calendrier envoyé", detail: "" };
    case "lead.updated":
    case "lead.import":
    case "lead.attribution":
      return { ...base, kind: "info", title: g.summary, detail: "" };
    default:
      return { ...base, kind: "info", title: g.summary || g.action, detail: "" };
  }
}

export function leadTimeline(db: DB, lead: Lead, names: Map<string, string>, adName?: string, limit = 80): TimelineItem[] {
  const appts = new Map(db.appointments.filter((a) => a.leadId === lead.id).map((a) => [a.id, a]));
  const sales = new Map(db.sales.filter((s) => s.leadId === lead.id).map((s) => [s.id, s]));
  const followUps = new Set(db.followUps.filter((f) => f.leadId === lead.id).map((f) => f.id));
  const logs = db.activityLogs.filter(
    (g) =>
      (g.entity === "lead" && g.entityId === lead.id) ||
      (g.entity === "appointment" && appts.has(g.entityId)) ||
      (g.entity === "sale" && sales.has(g.entityId)) ||
      (g.entity === "follow-up" && followUps.has(g.entityId)),
  );
  const items = logs.map((g) => describe(g, lead, appts, sales, names, adName));
  // Lead sans journal de creation (import ancien) : la date d'inscription fait foi.
  if (!logs.some((g) => g.action === "lead.created")) {
    items.push({ id: "created", at: lead.optInAt || lead.createdAt, kind: "lead", title: "Lead créé", detail: sourceDetail(lead, adName), by: lead.source === "lp" ? "Systeme.io" : "" });
  }
  // Rendez-vous sans journal (import iClosed ancien) : on les fait apparaitre quand meme.
  for (const a of appts.values()) {
    if (!logs.some((g) => g.entity === "appointment" && g.entityId === a.id && g.action === "appointment.created")) {
      items.push({ id: `appt-${a.id}`, at: a.createdAt, kind: "booking", title: "Call booké", detail: `Rendez-vous : ${fmtDateTime(a.scheduledAt)}${a.closerId ? ` · Closer : ${names.get(a.closerId) ?? ""}` : ""}${a.iclosedEventId ? " · via iClosed" : ""}`, by: a.iclosedEventId ? "iClosed" : "" });
    }
  }
  return items.sort((x, y) => y.at.localeCompare(x.at)).slice(0, limit);
}
