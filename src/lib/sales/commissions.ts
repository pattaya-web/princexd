/**
 * Moteur de commissions.
 *
 * Fonctions pures, sans acces base : c'est la seule implementation du calcul
 * dans tout le tool. Le dashboard, la fiche d'un membre et le grand livre
 * l'appellent tous les trois, ce qui garantit qu'ils affichent le meme
 * montant — le probleme numero un des suivis faits dans un tableur.
 *
 * Deux principes tiennent tout :
 *
 *  1. Une commission est attachee a l'evenement qui la declenche (un rendez-vous
 *     ou une vente), jamais a un solde global. Le du se deduit donc toujours de
 *     `somme des lignes gagnees - somme des versements`.
 *
 *  2. La regle appliquee est celle qui etait en vigueur A LA DATE de
 *     l'evenement. Passer un closer de 10 % a 12 % ne reecrit pas ses
 *     commissions de l'an dernier.
 */
import type {
  Appointment,
  CommissionPayment,
  CommissionRule,
  Sale,
  TeamMember,
} from "../types";
import { isAttended, isDead } from "./constants";
import { inRange, type Range } from "./period";
import { memberRoles, type CommercialRole } from "./roles";

/** Une ligne du grand livre : un evenement, un montant, et son explication. */
export interface CommissionEntry {
  memberId: string;
  role: "setter" | "closer";
  kind: "appointment" | "show" | "sale" | "fixed";
  /** Rendez-vous ou vente a l'origine de la ligne ; `fixed-<role>-<AAAA-MM>` pour un fixe mensuel. */
  sourceId: string;
  /** Date d'attribution : c'est elle qui decide de la periode. */
  at: string;
  amount: number;
  currency: string;
  ruleId: string;
  /** Phrase lisible affichee dans le detail, ex. « 10 % de 3 000 encaissés ». */
  detail: string;
}

/* --------------------------- Montants nets ----------------------------- */

/**
 * Valeur de contrat nette.
 *
 * Une vente annulee ne vaut plus rien ; une vente remboursee en partie vaut ce
 * qu'il reste. La ligne d'origine, elle, n'est jamais effacee : les analytics
 * ont besoin de savoir qu'une vente a eu lieu puis a ete annulee.
 */
export function netContract(sale: Sale): number {
  if (sale.status === "cancelled") return 0;
  return Math.max(0, (sale.contractValue || 0) - (sale.refundAmount || 0));
}

/** Cash net reellement encaisse, remboursements deduits. */
export function netCash(sale: Sale): number {
  if (sale.status === "cancelled") return 0;
  return Math.max(0, (sale.cashCollected || 0) - (sale.refundAmount || 0));
}

/* ---------------------------- Regle en vigueur -------------------------- */

/**
 * Regle applicable a un membre pour un evenement date.
 *
 * On retient la regle active la plus recente dont la date d'effet precede
 * l'evenement. Une regle creee aujourd'hui pour un membre qui n'en avait
 * aucune s'applique aussi au passe : sans cela, configurer les commissions
 * apres coup ne produirait jamais rien, ce qui surprend plus que ca n'aide.
 */
export function effectiveRule(
  rules: CommissionRule[],
  memberId: string,
  at: string,
  role?: CommercialRole,
): CommissionRule | null {
  // Un membre setter ET closer a une regle par metier : sans le filtre, la
  // regle closer s'appliquerait a ses rendez-vous poses, et inversement.
  const mine = rules.filter((r) => r.memberId === memberId && r.active && (!role || r.role === role));
  if (!mine.length) return null;

  const day = (at || "").slice(0, 10);
  const applicable = mine.filter((r) => !r.effectiveFrom || r.effectiveFrom <= day);

  if (!applicable.length) {
    // Aucune regle n'avait encore pris effet : on prend la plus ancienne, pour
    // ne pas perdre silencieusement la commission d'un evenement anterieur.
    return [...mine].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))[0];
  }
  return applicable.sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
}

/* ------------------------------- Calcul --------------------------------- */

const pctOf = (value: number, pct: number) => (value * (pct || 0)) / 100;

const money = (n: number) => Math.round(n * 100) / 100;

/**
 * Toutes les lignes de commission d'un membre.
 *
 * `appointments` et `sales` doivent etre les collections completes : le filtre
 * de periode s'applique ensuite sur les lignes produites, pas en amont, sinon
 * une vente conclue en octobre sur un rendez-vous de septembre disparaitrait
 * des deux periodes.
 */
export function entriesFor(
  member: TeamMember,
  rules: CommissionRule[],
  appointments: Appointment[],
  sales: Sale[],
): CommissionEntry[] {
  // Un membre qui cumule setter et closer gagne sur les deux tableaux : ses
  // rendez-vous poses d'un cote, ses calls closes de l'autre.
  return memberRoles(member)
    .flatMap((role) => entriesForRole(member, role, rules, appointments, sales))
    .sort((a, b) => b.at.localeCompare(a.at));
}

/** Lignes d'un membre pour UN de ses metiers. */
export function entriesForRole(
  member: TeamMember,
  role: CommercialRole,
  rules: CommissionRule[],
  appointments: Appointment[],
  sales: Sale[],
): CommissionEntry[] {
  const out: CommissionEntry[] = [];

  const mineAppointments = appointments.filter((a) =>
    role === "setter" ? a.setterId === member.id : a.closerId === member.id,
  );
  const mineSales = sales.filter((s) =>
    role === "setter" ? s.setterId === member.id : s.closerId === member.id,
  );

  /* --- Commissions declenchees par un rendez-vous --- */
  for (const appt of mineAppointments) {
    if (isDead(appt.status)) continue;
    const rule = effectiveRule(rules, member.id, appt.scheduledAt, role);
    if (!rule) continue;

    if (rule.type === "per-appointment") {
      if (rule.onlyQualified && !appt.qualified) continue;
      if (!rule.fixed) continue;
      out.push({
        memberId: member.id,
        role,
        kind: "appointment",
        sourceId: appt.id,
        at: appt.scheduledAt,
        amount: money(rule.fixed),
        currency: rule.currency,
        ruleId: rule.id,
        detail: rule.onlyQualified ? "Rendez-vous qualifié" : "Rendez-vous posé",
      });
    }

    if (rule.type === "per-show" && isAttended(appt.status) && rule.fixed) {
      out.push({
        memberId: member.id,
        role,
        kind: "show",
        sourceId: appt.id,
        at: appt.scheduledAt,
        amount: money(rule.fixed),
        currency: rule.currency,
        ruleId: rule.id,
        detail: "Call honoré",
      });
    }
  }

  /* --- Commissions declenchees par une vente --- */
  for (const sale of mineSales) {
    const rule = effectiveRule(rules, member.id, sale.soldAt, role);
    if (!rule) continue;

    const contract = netContract(sale);
    const cash = netCash(sale);
    const push = (amount: number, detail: string, at = sale.soldAt, sourceId = sale.id) => {
      if (!amount) return;
      out.push({ memberId: member.id, role, kind: "sale", sourceId, at, amount: money(amount), currency: rule.currency || sale.currency, ruleId: rule.id, detail });
    };

    /*
     * Commission sur le cash : une ligne par encaissement, datee du jour ou
     * l'argent est arrive. Un client qui paie en trois fois genere trois
     * lignes, sur trois mois, et le grand livre du closer suit la realite.
     */
    const cashParts = () => {
      const cols = (sale.collections ?? []).filter((c) => c.amount > 0);
      if (!cols.length) return [{ amount: cash, at: sale.soldAt, id: sale.id, label: "encaissés" }];
      const later = cols.reduce((a, c) => a + c.amount, 0);
      const first = Math.max(0, cash - later);
      return [
        ...(first > 0 ? [{ amount: first, at: sale.soldAt, id: sale.id, label: "encaissés à la vente" }] : []),
        ...cols.map((c) => ({ amount: c.amount, at: c.at, id: `${sale.id}:${c.id}`, label: "encaissés (échéance)" })),
      ];
    };

    switch (rule.type) {
      case "pct-revenue":
        push(pctOf(contract, rule.pct), `${rule.pct} % de ${Math.round(contract)} de contrat`);
        break;
      case "pct-cash":
        for (const p of cashParts()) push(pctOf(p.amount, rule.pct), `${rule.pct} % de ${Math.round(p.amount)} ${p.label}`, p.at, p.id);
        break;
      case "fixed-plus-pct":
      case "custom": {
        if (rule.basis === "contract") {
          push(
            (rule.fixed || 0) + pctOf(contract, rule.pct),
            [rule.fixed ? `${rule.fixed} fixe` : "", rule.pct ? `${rule.pct} % de ${Math.round(contract)} de contrat` : ""].filter(Boolean).join(" + "),
          );
        } else {
          if (rule.fixed) push(rule.fixed, `${rule.fixed} fixe`);
          for (const p of cashParts()) push(pctOf(p.amount, rule.pct), `${rule.pct} % de ${Math.round(p.amount)} ${p.label}`, p.at, p.id);
        }
        break;
      }
      default:
        // per-appointment et per-show ne se declenchent pas sur une vente.
        continue;
    }
  }

  out.push(...monthlyFixedEntries(member, role, rules));

  return out.sort((a, b) => b.at.localeCompare(a.at));
}

/** Mois suivant d'un `AAAA-MM`. */
function nextMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

const MONTH_LABEL = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });

/**
 * Fixe mensuel.
 *
 * Une ligne par mois civil, du mois d'entree en vigueur de la premiere regle
 * qui en prevoit un jusqu'au mois courant inclus : le fixe du mois est du des
 * le premier jour, il n'attend pas la fin du mois. La regle retenue pour un
 * mois est celle en vigueur a sa fin, donc un fixe qui change le 15 vaut pour
 * le mois entier a partir de ce mois-la.
 *
 * Aucune date de sortie n'est connue : pour arreter le fixe d'un membre
 * parti, on lui enregistre un tarif sans fixe mensuel (ou on desactive sa
 * regle).
 */
export function monthlyFixedEntries(
  member: TeamMember,
  role: CommercialRole,
  rules: CommissionRule[],
): CommissionEntry[] {
  const withMonthly = rules.filter(
    (r) => r.memberId === member.id && r.role === role && r.active && (r.monthlyFixed || 0) > 0,
  );
  if (!withMonthly.length) return [];

  const first = withMonthly.map((r) => r.effectiveFrom || "").filter(Boolean).sort()[0];
  if (!first) return [];
  const current = new Date().toISOString().slice(0, 7);
  const out: CommissionEntry[] = [];

  for (let ym = first.slice(0, 7); ym <= current; ym = nextMonth(ym)) {
    // « -31 » couvre tous les jours du mois en comparaison de chaines.
    const rule = effectiveRule(rules, member.id, `${ym}-31`, role);
    const amount = rule?.monthlyFixed || 0;
    if (!rule || amount <= 0) continue;
    out.push({
      memberId: member.id,
      role,
      kind: "fixed",
      sourceId: `fixed-${role}-${ym}`,
      at: `${ym}-01T12:00:00.000Z`,
      amount: money(amount),
      currency: rule.currency,
      ruleId: rule.id,
      detail: `Fixe mensuel — ${MONTH_LABEL.format(new Date(`${ym}-01T12:00:00.000Z`))}`,
    });
  }
  return out;
}

/* ------------------------------ Grand livre ------------------------------ */

export interface LedgerRow {
  memberId: string;
  name: string;
  role: "setter" | "closer";
  status: TeamMember["status"];
  /** Regle en vigueur aujourd'hui, pour l'afficher dans le tableau. */
  rule: CommissionRule | null;
  appointments: number;
  shows: number;
  sales: number;
  revenue: number;
  cashCollected: number;
  /** Gagne sur la periode affichee. */
  earnedInPeriod: number;
  /** Gagne depuis toujours : c'est la base du solde. */
  earnedTotal: number;
  paidTotal: number;
  /** Reste du = tout ce qui a ete gagne moins tout ce qui a ete verse. */
  due: number;
  currency: string;
  entries: CommissionEntry[];
}

/**
 * Grand livre complet.
 *
 * Le solde du est volontairement calcule en cumul depuis l'origine, jamais sur
 * la periode affichee : un versement de septembre doit continuer a solder une
 * commission d'aout, meme quand on regarde octobre.
 */
export function buildLedger(
  members: TeamMember[],
  rules: CommissionRule[],
  appointments: Appointment[],
  sales: Sale[],
  payments: CommissionPayment[],
  range: Range,
  defaultCurrency: string,
): LedgerRow[] {
  // Une ligne par metier : un membre setter ET closer apparait deux fois, avec
  // des chiffres distincts. Les versements, eux, sont rattaches au membre et
  // non au metier : on les impute integralement a sa premiere ligne pour ne
  // pas compter deux fois le meme virement.
  const pairs = members.flatMap((member) => memberRoles(member).map((role) => ({ member, role })));

  return pairs
    .map(({ member, role }, idx) => {
      const allEntries = entriesForRole(member, role, rules, appointments, sales);
      const periodEntries = allEntries.filter((e) => inRange(e.at, range));
      const firstRowOfMember = pairs.findIndex((p) => p.member.id === member.id) === idx;

      const mineAppointments = appointments.filter(
        (a) =>
          !isDead(a.status) &&
          (role === "setter" ? a.setterId === member.id : a.closerId === member.id) &&
          inRange(a.scheduledAt, range),
      );
      const mineSales = sales.filter(
        (s) =>
          (role === "setter" ? s.setterId === member.id : s.closerId === member.id) &&
          inRange(s.soldAt, range),
      );

      const paidTotal = firstRowOfMember
        ? payments.filter((p) => p.memberId === member.id).reduce((a, p) => a + (p.amount || 0), 0)
        : 0;

      const earnedTotal = allEntries.reduce((a, e) => a + e.amount, 0);

      return {
        memberId: member.id,
        name: member.name,
        role,
        status: member.status,
        rule: effectiveRule(rules, member.id, new Date().toISOString(), role),
        appointments: mineAppointments.length,
        shows: mineAppointments.filter((a) => isAttended(a.status)).length,
        sales: mineSales.length,
        revenue: money(mineSales.reduce((a, s) => a + netContract(s), 0)),
        cashCollected: money(mineSales.reduce((a, s) => a + netCash(s), 0)),
        earnedInPeriod: money(periodEntries.reduce((a, e) => a + e.amount, 0)),
        earnedTotal: money(earnedTotal),
        paidTotal: money(paidTotal),
        due: money(earnedTotal - paidTotal),
        currency: periodEntries[0]?.currency || allEntries[0]?.currency || defaultCurrency,
        entries: periodEntries,
      };
    })
    .sort((a, b) => b.due - a.due);
}

/** Libelle lisible d'une regle, pour l'afficher sans repeter la logique. */
export function describeRule(rule: CommissionRule | null, currency: string): string {
  if (!rule) return "Aucune règle";
  const c = rule.currency || currency;
  const monthly = rule.monthlyFixed || 0;
  const withMonthly = (s: string) => (monthly > 0 ? `${monthly} ${c} / mois + ${s}` : s);
  switch (rule.type) {
    case "monthly-fixed":
      return monthly > 0 ? `${monthly} ${c} / mois` : "Fixe mensuel (montant à définir)";
    case "per-appointment":
      return withMonthly(`${rule.fixed} ${c} / rendez-vous${rule.onlyQualified ? " qualifié" : ""}`);
    case "per-show":
      return withMonthly(`${rule.fixed} ${c} / call honoré`);
    case "pct-revenue":
      return withMonthly(`${rule.pct} % de la valeur de contrat`);
    case "pct-cash":
      return withMonthly(`${rule.pct} % du cash encaissé`);
    case "fixed-plus-pct":
    case "custom":
      return withMonthly(`${rule.fixed} ${c} + ${rule.pct} % ${rule.basis === "contract" ? "du contrat" : "du cash"}`);
    default:
      return "Règle personnalisée";
  }
}
