import { cashInRange } from "@/lib/sales/analytics";
import { paymentView } from "@/lib/sales/installments";
import { inRange, resolveRange } from "@/lib/sales/period";
import { leadIsOut, swipeProdStatus, type DB } from "@/lib/types";
import { weekProgress } from "@/lib/swipe-week";

/**
 * Photo du business pour l'assistant du chat : ventes du mois, leads à
 * relancer, rendez-vous à venir, élèves, et la semaine de contenu (sourcé →
 * publié par funnel). Texte compact, recalculé à chaque tour : l'assistant
 * répond « combien j'ai encaissé » ou « combien de reels à tourner » sans
 * aller chercher lui-même dans la base.
 */
export function businessSnapshot(db: DB, now = new Date()): string {
  const cur = db.settings.salesCurrency || "EUR";
  const money = (n: number) => `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(n))} ${cur === "EUR" ? "€" : cur}`;
  const nowIso = now.toISOString();
  const month = resolveRange("month", "", "", now);
  const today = resolveRange("today", "", "", now);
  const lines: string[] = [];

  /* --- Ventes --- */
  const live = db.sales.filter((s) => s.status !== "cancelled");
  const net = (s: (typeof live)[number]) => Math.max(0, s.contractValue - (s.refundAmount || 0));
  const monthSales = live.filter((s) => inRange(s.soldAt, month));
  const remaining = live.reduce((a, s) => a + Math.max(0, net(s) - s.cashCollected), 0);
  const overdue = live.filter((s) => paymentView(s).state === "overdue");
  lines.push(
    `VENTES · ${month.label} : ${monthSales.length} vente(s), ${money(monthSales.reduce((a, s) => a + net(s), 0))} de contrats, ${money(cashInRange(db.sales, month))} encaissés ce mois (aujourd'hui : ${money(cashInRange(db.sales, today))}).` +
      (db.settings.salesMonthlyGoal ? ` Objectif du mois : ${money(db.settings.salesMonthlyGoal)}.` : "") +
      ` Reste à encaisser sur les ventes en cours : ${money(remaining)}${overdue.length ? `, dont ${overdue.length} paiement(s) en retard` : ""}.`,
  );
  const last = live
    .slice()
    .sort((a, b) => b.soldAt.localeCompare(a.soldAt))
    .slice(0, 3)
    .map((s) => `${db.leads.find((l) => l.id === s.leadId)?.name ?? "?"} ${money(s.contractValue)} le ${s.soldAt.slice(0, 10)}`);
  if (last.length) lines.push(`Dernières ventes : ${last.join(" ; ")}.`);

  /* --- Leads et rendez-vous --- */
  const cold = db.leads.filter((l) => (l.source === "lp" || Boolean(l.systemeioId)) && !leadIsOut(l.callStatus) && l.stage !== "closed-won");
  const pool = cold.filter((l) => !l.setterId && !l.callStatus).length;
  const followUpsDue = db.followUps.filter((f) => f.status === "pending" && f.dueAt <= nowIso).length;
  const upcoming = db.appointments
    .filter((a) => a.scheduledAt >= nowIso && !["cancelled", "closed-won", "closed-lost", "no-show", "completed"].includes(a.status))
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const names = new Map(db.team.map((m) => [m.id, m.name]));
  const fmtAt = (iso: string) => new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }).format(new Date(iso));
  lines.push(
    `LEADS : ${pool} nouveau(x) lead(s) dans le pool (personne ne les a encore appelés), ${followUpsDue} relance(s) arrivée(s) à échéance, ${upcoming.length} rendez-vous à venir` +
      (upcoming.length ? ` (prochains : ${upcoming.slice(0, 4).map((a) => `${db.leads.find((l) => l.id === a.leadId)?.name ?? "?"} ${fmtAt(a.scheduledAt)}${a.closerId ? ` avec ${names.get(a.closerId) ?? "?"}` : ""}`).join(" ; ")})` : "") +
      ".",
  );

  /* --- Élèves --- */
  const students = db.students;
  const onboarding = students.filter((s) => s.status === "onboarding").length;
  const noAccess = students.filter((s) => !s.portalAccess).length;
  const pendingTasks = students.reduce((a, s) => a + (s.tasks ?? []).filter((t) => !t.done).length, 0);
  const notSent = students.filter((s) => !s.onboardingSentAt).length;
  lines.push(`ÉLÈVES : ${students.length} élève(s), ${onboarding} en onboarding, ${noAccess} sans accès à la plateforme, ${notSent} sans message d'onboarding envoyé, ${pendingTasks} étape(s) assignée(s) en attente.`);

  /* --- Contenu : la semaine --- */
  const wp = weekProgress(db.swipes, db.settings.weeklyReelTargets);
  const stageLine = wp.stages
    .map((s) => `${s.stage} objectif ${s.target} : ${s.counts.source} sourcé(s), ${s.counts.scripte} scripté(s), ${s.counts.tourne} tourné(s), ${s.counts.monte} monté(s), ${s.counts.publie} publié(s)`)
    .join(" | ");
  const toShoot = db.swipes.filter((s) => ["scripte", "a-tourner"].includes(swipeProdStatus(s))).length;
  const toEdit = db.swipes.filter((s) => swipeProdStatus(s) === "tourne").length;
  const ready = db.swipes.filter((s) => swipeProdStatus(s) === "monte").length;
  const toScript = db.swipes.filter((s) => swipeProdStatus(s) === "source").length;
  lines.push(
    `CONTENU · semaine du ${wp.bounds.monday} (${wp.bounds.daysLeft} jour(s) restants) : ${stageLine}. ` +
      `Pipeline total : ${toScript} reel(s) sourcés à scripter, ${toShoot} à tourner, ${toEdit} tournés à monter, ${ready} montés prêts à publier, ${wp.unclassified} non classés (sans funnel). ` +
      (wp.todayLabel ? `À faire aujourd'hui pour tenir la cadence : ${wp.todayLabel}.` : "Cadence de la semaine tenue."),
  );

  return lines.join("\n");
}
