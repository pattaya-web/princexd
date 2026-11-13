/**
 * Reglages du Sales OS : valeurs par defaut et fusion avec ce que l'admin a
 * modifie (Settings.salesOps). Pur, sans acces base : sert au moteur, aux
 * routes et aux tests.
 */
import type { DB, ObjectionDef, OpsRule, SalesOpsSettings, SalesTaskKind, TaskPriority, TeamMember } from "../../types";

export const TASK_KINDS: SalesTaskKind[] = [
  "first-contact",
  "setting-nudge",
  "planned",
  "callback",
  "confirm-booking",
  "confirm-j1",
  "confirm-h3",
  "outcome-missing",
  "no-show",
  "followup",
  "payment",
  "payment-verify",
  "nurture",
  "admin-task",
];

export const TASK_KIND_LABEL: Record<SalesTaskKind, string> = {
  "first-contact": "Premier contact",
  "setting-nudge": "Relance de conversation",
  planned: "Action planifiée",
  callback: "Rappel demandé",
  "confirm-booking": "Confirmer la réservation",
  "confirm-j1": "Confirmation J-1",
  "confirm-h3": "Contrôle H-3",
  "outcome-missing": "Résultat du call à renseigner",
  "no-show": "Récupérer le no-show",
  followup: "Relance après call",
  payment: "Paiement à suivre",
  "payment-verify": "Paiement à vérifier",
  nurture: "Réactivation",
  "admin-task": "Tâche de l'admin",
};

/** Pourquoi la regle existe : affiche dans les reglages. */
export const TASK_KIND_HINT: Record<SalesTaskKind, string> = {
  "first-contact": "Nouveau lead sans rendez-vous, jamais contacté.",
  "setting-nudge": "Conversation sans réponse depuis le délai réglé.",
  planned: "Prochaine action datée posée sur la fiche.",
  callback: "Rappel ou relance demandés depuis la liste à appeler.",
  "confirm-booking": "Dès la réservation, si le call est dans plus de 26 h.",
  "confirm-j1": "24 h avant le call, tant que le prospect n'a pas confirmé.",
  "confirm-h3": "3 h avant le call, si aucune confirmation explicite.",
  "outcome-missing": "Call passé depuis 1 h sans résultat : pour le closer.",
  "no-show": "Reprise de contact selon la cadence réglée.",
  followup: "Relance programmée à la sortie du call.",
  payment: "Paiement promis, en retard ou échéance proche.",
  "payment-verify": "Le prospect dit avoir payé : à vérifier par l'admin.",
  nurture: "Date de reprise d'un prospect en nurturing.",
  "admin-task": "Relance envoyée à la main par l'admin.",
};

const RULES: Record<SalesTaskKind, OpsRule> = {
  "first-contact": { enabled: true, priority: 0 },
  "setting-nudge": { enabled: true, priority: 2 },
  planned: { enabled: true, priority: 1 },
  callback: { enabled: true, priority: 1 },
  "confirm-booking": { enabled: true, priority: 1 },
  "confirm-j1": { enabled: true, priority: 1 },
  "confirm-h3": { enabled: true, priority: 0 },
  "outcome-missing": { enabled: true, priority: 1 },
  "no-show": { enabled: true, priority: 0 },
  followup: { enabled: true, priority: 1 },
  payment: { enabled: true, priority: 1 },
  "payment-verify": { enabled: true, priority: 0 },
  nurture: { enabled: true, priority: 3 },
  "admin-task": { enabled: true, priority: 1 },
};

/**
 * Bibliotheque d'objections par defaut. La relance proposee est modifiable
 * au moment de statuer le call ; « attend son salaire » demande la date.
 */
export const DEFAULT_OBJECTIONS: ObjectionDef[] = [
  { key: "salary", label: "Attend son salaire", followUpDays: 0, askDate: true, advice: "Relancer le jour du salaire, le matin : rappeler ce qu'il veut construire et proposer de finaliser." },
  { key: "partner", label: "Doit en parler à son conjoint", followUpDays: 2, advice: "Demander comment s'est passée la discussion, proposer un court appel à trois si besoin." },
  { key: "think", label: "Doit réfléchir", followUpDays: 2, advice: "Isoler le vrai frein (prix, temps, confiance) et répondre à celui-là, sans pression." },
  { key: "budget", label: "Budget insuffisant actuellement", followUpDays: 14, advice: "Vérifier si un paiement en plusieurs fois change la donne, sinon fixer une date de reprise." },
  { key: "another-call", label: "Demande un autre appel", followUpDays: 1, advice: "Caler le nouveau créneau avec lui et prévenir Mady." },
  { key: "next-month", label: "Veut démarrer le mois prochain", followUpDays: 0, askDate: true, advice: "Relancer quelques jours avant le début du mois pour réserver sa place." },
  { key: "time", label: "Manque de temps", followUpDays: 7, advice: "Montrer combien d'heures par semaine il faut vraiment, avec un exemple d'élève." },
  { key: "trust", label: "Besoin de preuves", followUpDays: 2, advice: "Envoyer 2 témoignages proches de son profil, puis relancer." },
];

export function defaultOpsSettings(): SalesOpsSettings {
  return {
    defaultOwnerId: "",
    assignment: "single",
    startedOn: "",
    rules: { ...RULES },
    nudgeAfterHours: 24,
    noShowCadenceMin: [15, 24 * 60, 3 * 24 * 60],
    staleDays: 5,
    anomalyWindowDays: 30,
    objections: DEFAULT_OBJECTIONS,
    // Par defaut, comme un setter : le montant annonce par Mady (Sale.setterAmount), jamais le vrai prix.
    headSeesRealAmounts: false,
  };
}

const clampPriority = (p: unknown, fallback: TaskPriority): TaskPriority => {
  const n = Number(p);
  return n === 0 || n === 1 || n === 2 || n === 3 ? (n as TaskPriority) : fallback;
};

/** Reglages effectifs : les valeurs par defaut, recouvertes par celles de l'admin. */
export function opsSettings(db: Pick<DB, "settings">): SalesOpsSettings {
  const base = defaultOpsSettings();
  const s = db.settings.salesOps ?? {};
  const rules = { ...base.rules };
  for (const k of TASK_KINDS) {
    const r = s.rules?.[k];
    if (r) rules[k] = { enabled: r.enabled !== false, priority: clampPriority(r.priority, base.rules[k].priority) };
  }
  const cadence = Array.isArray(s.noShowCadenceMin) ? s.noShowCadenceMin.map(Number).filter((n) => Number.isFinite(n) && n >= 0).slice(0, 6) : [];
  const objections = Array.isArray(s.objections) && s.objections.length ? s.objections.filter((o) => o && o.key && o.label) : base.objections;
  return {
    defaultOwnerId: typeof s.defaultOwnerId === "string" ? s.defaultOwnerId : "",
    assignment: s.assignment === "round-robin" ? "round-robin" : "single",
    startedOn: typeof s.startedOn === "string" ? s.startedOn : "",
    rules,
    nudgeAfterHours: positive(s.nudgeAfterHours, base.nudgeAfterHours),
    noShowCadenceMin: cadence.length ? cadence : base.noShowCadenceMin,
    staleDays: positive(s.staleDays, base.staleDays),
    anomalyWindowDays: positive(s.anomalyWindowDays, base.anomalyWindowDays),
    objections,
    headSeesRealAmounts: s.headSeesRealAmounts === true,
  };
}

function positive(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const isActive = (m: TeamMember) => m.status !== "inactif";

/** Les Head of Setting actifs. */
export const salesHeads = (db: Pick<DB, "team">) => db.team.filter((m) => m.salesHead && isActive(m));

/**
 * Responsable par defaut d'un lead : le membre choisi dans les reglages s'il
 * est actif, sinon le premier Head of Setting actif. Vide tant que personne
 * n'est nomme : les leads restent alors a l'admin, comme avant.
 */
export function defaultOwnerId(db: Pick<DB, "team" | "settings">, cfg = opsSettings(db)): string {
  const chosen = cfg.defaultOwnerId ? db.team.find((m) => m.id === cfg.defaultOwnerId && isActive(m)) : undefined;
  if (chosen) return chosen.id;
  return salesHeads(db)[0]?.id ?? "";
}

/** Membres qui recoivent des leads en tour de role (le responsable par defaut en fait toujours partie). */
export function leadReceivers(db: Pick<DB, "team" | "settings">, cfg = opsSettings(db)): string[] {
  const head = defaultOwnerId(db, cfg);
  const others = db.team.filter((m) => isActive(m) && m.receivesLeads && m.id !== head).map((m) => m.id);
  return [head, ...others].filter(Boolean);
}

export const PRIORITY_LABEL: Record<TaskPriority, string> = { 0: "P0", 1: "P1", 2: "P2", 3: "P3" };
export const PRIORITY_HINT: Record<TaskPriority, string> = {
  0: "Urgence : appel imminent, nouveau lead chaud, retard critique",
  1: "À faire aujourd'hui",
  2: "Prochainement",
  3: "Nurturing / réactivation",
};
