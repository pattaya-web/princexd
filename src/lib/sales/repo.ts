/**
 * Acces aux donnees du module commercial.
 *
 * Toutes les ecritures passent par ici : c'est le seul endroit qui connait la
 * forme des enregistrements, qui applique les regles d'attribution et qui
 * ecrit le journal d'audit. Les routes API se contentent de valider l'entree
 * et de deleguer.
 *
 * La base est le `db.json` existant, relu et reecrit atomiquement par
 * `lib/db.ts`. Chaque operation groupe donc ses ecritures en un seul
 * `writeDB` : enchainer plusieurs sauvegardes laisserait la base incoherente
 * si le process mourait au milieu.
 */
import { newId, readDB, writeDB } from "../db";
import { buildSchedule, mergePaid } from "./installments";
import type {
  ActivityLog,
  Appointment,
  CallRecap,
  AppointmentEvent,
  AppointmentSource,
  AppointmentStatus,
  CommissionPayment,
  CommissionRule,
  DB,
  FollowUp,
  Lead,
  LostReason,
  PaymentType,
  Sale,
  Session,
  Student,
  TeamMember,
} from "../types";
import { canSee, Forbidden } from "./access";
import { isDead } from "./constants";
import { isCommercial, memberRoles, sessionHas, type CommercialRole } from "./roles";

/* -------------------------------- Audit --------------------------------- */

/** Nombre de lignes de journal conservees. Au-dela, les plus vieilles sautent. */
const LOG_LIMIT = 5000;

function log(
  db: DB,
  session: Session,
  entry: Pick<ActivityLog, "action" | "entity" | "entityId" | "summary">,
) {
  db.activityLogs.unshift({
    id: newId(),
    at: new Date().toISOString(),
    actorId: session.memberId,
    actorName: session.memberName || "Moi",
    ...entry,
  });
  if (db.activityLogs.length > LOG_LIMIT) db.activityLogs.length = LOG_LIMIT;
}

export function listLogs(entity?: string, entityId?: string, limit = 50): ActivityLog[] {
  const db = readDB();
  const rows = entityId
    ? db.activityLogs.filter((l) => l.entity === entity && l.entityId === entityId)
    : db.activityLogs;
  return rows.slice(0, limit);
}

/* -------------------------------- Leads --------------------------------- */

const cleanHandle = (raw: string) => raw.trim().replace(/^@+/, "").toLowerCase();

/**
 * Retrouve un lead par pseudo Instagram, ou le cree.
 *
 * Le pseudo est l'identifiant naturel de l'acquisition : deux rendez-vous pris
 * pour @johnsmith doivent viser le meme lead, faute de quoi l'historique et le
 * chiffre d'affaires se retrouvent eclates sur deux fiches.
 */
export function upsertLead(
  db: DB,
  input: {
    /** Lead deja en base (prospect de la landing page sans Instagram) : on le prend tel quel. */
    leadId?: string;
    igUsername: string;
    name?: string;
    email?: string;
    phone?: string;
    country?: string;
    timezone?: string;
    source?: string;
    setterId?: string;
  },
): Lead {
  const handle = cleanHandle(input.igUsername ?? "");

  const existing =
    (input.leadId ? db.leads.find((l) => l.id === input.leadId) : undefined) ??
    (handle
      ? db.leads.find(
          (l) => cleanHandle(l.igUsername ?? l.handle ?? "") === handle,
        )
      : undefined);

  if (existing) {
    // On complete les trous sans jamais ecraser une donnee deja saisie :
    // le premier setter qui a qualifie le lead en sait souvent plus.
    existing.igUsername = existing.igUsername || handle;
    existing.handle = existing.handle || `@${handle}`;
    existing.name = existing.name || input.name || `@${handle}`;
    existing.email = existing.email || input.email || "";
    existing.phone = existing.phone || input.phone || "";
    existing.country = existing.country || input.country || "";
    existing.timezone = existing.timezone || input.timezone || "";
    if (!existing.setterId && input.setterId) existing.setterId = input.setterId;
    return existing;
  }

  const lead: Lead = {
    id: newId(),
    name: input.name?.trim() || (handle ? `@${handle}` : "Sans nom"),
    handle: handle ? `@${handle}` : "",
    source: input.source || "dm",
    stage: "call-book",
    dealValue: 0,
    callAt: "",
    ownerRole: "setter",
    ownerName: "",
    painPoint: "",
    nextAction: "Préparer le call",
    nextActionAt: "",
    notes: "",
    createdAt: new Date().toISOString(),
    igUsername: handle,
    email: input.email?.trim() || "",
    phone: input.phone?.trim() || "",
    country: input.country?.trim() || "",
    timezone: input.timezone?.trim() || "",
    setterId: input.setterId || "",
  };
  db.leads.unshift(lead);
  return lead;
}

/* ----------------------------- Rendez-vous ------------------------------- */

export interface AppointmentInput {
  /** Rendez-vous pour un lead deja en base (landing page) : le pseudo devient facultatif. */
  leadId?: string;
  igUsername: string;
  name?: string;
  email?: string;
  phone?: string;
  country?: string;
  timezone: string;
  scheduledAt: string;
  setterId: string;
  closerId?: string;
  source: AppointmentSource;
  /** Parametres du lien de reservation (voir lib/sales/sources.ts). */
  utm?: Record<string, string>;
  iclosedUrl?: string;
  iclosedEventId?: string;
  setterNotes?: string;
  qualified?: boolean;
}

export interface CreateResult {
  appointment: Appointment;
  lead: Lead;
}

/**
 * Enregistre un rendez-vous.
 *
 * Le setter est fige ici et nulle part ailleurs : c'est cette valeur qui, des
 * mois plus tard, repondra a « qui a amene ce client ». Elle n'est jamais
 * recalculee depuis l'assignation courante du lead.
 */
export function createAppointment(session: Session, input: AppointmentInput): CreateResult {
  const db = readDB();

  // Un setter enregistre forcement pour lui-meme ; seul l'admin peut poser un
  // rendez-vous au nom d'un autre.
  const setterId = session.isAdmin ? input.setterId : session.memberId;
  if (!setterId) throw new Forbidden("Aucun setter identifié pour ce rendez-vous.");

  const lead = upsertLead(db, { ...input, setterId, source: input.source });

  const now = new Date().toISOString();
  const appointment: Appointment = {
    id: newId(),
    leadId: lead.id,
    setterId,
    closerId: input.closerId || "",
    scheduledAt: input.scheduledAt,
    timezone: input.timezone || "Europe/Paris",
    source: input.source,
    ...(input.utm && Object.keys(input.utm).length ? { utm: input.utm } : {}),
    status: "booked",
    qualified: Boolean(input.qualified),
    setterNotes: input.setterNotes?.trim() || "",
    closerNotes: "",
    lostReason: "",
    iclosedUrl: input.iclosedUrl?.trim() || "",
    iclosedEventId: input.iclosedEventId?.trim() || "",
    rescheduledFromId: "",
    completedAt: "",
    history: [
      {
        at: now,
        actorId: session.memberId,
        actorName: session.memberName || "Moi",
        from: "",
        to: "booked",
        note: "Rendez-vous créé",
      },
    ],
    createdBy: session.memberId,
    createdAt: now,
    updatedAt: now,
  };

  db.appointments.unshift(appointment);

  // Le lead suit le rendez-vous : il repasse en « call booké » et sa date de
  // call se met a jour, pour que le CRM historique reste juste.
  lead.stage = "call-book";
  lead.callAt = input.scheduledAt;
  if (input.closerId) lead.closerId = input.closerId;

  const who = memberName(db, setterId);
  log(db, session, {
    action: "appointment.created",
    entity: "appointment",
    entityId: appointment.id,
    summary: `${who} a créé un rendez-vous pour ${lead.handle || lead.name}`,
  });

  writeDB(db);
  return { appointment, lead };
}

function memberName(db: DB, id: string): string {
  return db.team.find((m) => m.id === id)?.name ?? "Un membre";
}

/** Applique une transition de statut en conservant la trace du passage. */
function pushHistory(
  appt: Appointment,
  session: Session,
  to: AppointmentStatus,
  note = "",
): AppointmentEvent {
  const event: AppointmentEvent = {
    at: new Date().toISOString(),
    actorId: session.memberId,
    actorName: session.memberName || "Moi",
    from: appt.status,
    to,
    note,
  };
  appt.history = [...(appt.history ?? []), event];
  appt.status = to;
  appt.updatedAt = event.at;
  return event;
}

export interface OutcomeInput {
  status: AppointmentStatus;
  closerNotes?: string;
  lostReason?: LostReason | "";
  /** Renseigne uniquement pour un closed-won. */
  sale?: {
    offer: string;
    contractValue: number;
    cashCollected: number;
    currency: string;
    paymentType: PaymentType;
    installments: number;
    paymentMethod: string;
    soldAt: string;
    notes: string;
  };
  /** Renseigne pour un follow-up ou une reprogrammation. */
  followUp?: { dueAt: string; notes: string; closerId?: string };
  /** Nouvelle date, pour une reprogrammation. */
  rescheduledAt?: string;
  /** Recap post-call (closé, pitché, infos, budget, action a venir). */
  recap?: Omit<CallRecap, "filledAt" | "filledBy">;
}

/**
 * Enregistre le resultat d'un call.
 *
 * Point central du module : c'est ici que la chaine
 * lead -> rendez-vous -> setter -> closer -> vente se noue, en une seule
 * ecriture. L'attribution de la vente est copiee depuis le rendez-vous et ne
 * dependra plus jamais de qui est assigne au lead par la suite.
 */
export function recordOutcome(session: Session, id: string, input: OutcomeInput) {
  const db = readDB();
  const appt = db.appointments.find((a) => a.id === id);
  if (!appt) throw new Forbidden("Rendez-vous introuvable.");

  // Le closer assigne et l'admin, personne d'autre.
  if (!session.isAdmin && !(sessionHas(session, "closer") && appt.closerId === session.memberId)) {
    throw new Forbidden("Seul le closer assigné peut enregistrer le résultat de ce call.");
  }

  const lead = db.leads.find((l) => l.id === appt.leadId);
  const now = new Date().toISOString();
  let sale: Sale | null = null;
  let followUp: FollowUp | null = null;

  if (input.closerNotes !== undefined) appt.closerNotes = input.closerNotes;
  appt.lostReason = input.status === "closed-lost" ? (input.lostReason ?? "") : "";
  if (input.recap) appt.recap = { ...input.recap, filledAt: now, filledBy: session.memberId };

  pushHistory(appt, session, input.status, input.closerNotes ?? "");
  if (!appt.completedAt && !isDead(input.status) && input.status !== "rescheduled") {
    appt.completedAt = now;
  }

  /* --- Vente --- */
  if (input.status === "closed-won" && input.sale) {
    const closerId = appt.closerId || session.memberId;
    /*
     * Un rendez-vous = une vente. Re-enregistrer « closé » sur le meme call
     * (pour corriger un montant, par exemple) met a jour la vente existante :
     * avant, chaque passage en creait une nouvelle et le dashboard cumulait
     * 3 000 + 2 500 au lieu d'afficher 2 500 (vu le 2026-10-05).
     */
    const existing = db.sales.find((s) => s.appointmentId === appt.id && s.status !== "cancelled") ?? null;
    const values = {
      offer: input.sale.offer.trim(),
      contractValue: Math.max(0, input.sale.contractValue || 0),
      cashCollected: Math.max(0, input.sale.cashCollected || 0),
      currency: input.sale.currency || "EUR",
      paymentType: input.sale.paymentType,
      installments: Math.max(0, input.sale.installments || 0),
      paymentMethod: input.sale.paymentMethod || "",
      soldAt: input.sale.soldAt || now,
      notes: input.sale.notes || "",
    };
    const schedule = buildSchedule(values.contractValue, values.cashCollected, values.installments, values.soldAt);
    if (existing) {
      const before = `${existing.contractValue} ${existing.currency} (${existing.cashCollected} encaissés)`;
      Object.assign(existing, values, { closerId, updatedAt: now, schedule: mergePaid(schedule, existing.schedule) });
      sale = existing;
      log(db, session, {
        action: "sale.updated",
        entity: "sale",
        entityId: sale.id,
        summary: `Vente corrigée par ${memberName(db, closerId)} : ${before} → ${sale.contractValue} ${sale.currency} (${sale.cashCollected} encaissés)`,
      });
    } else {
      sale = {
        id: newId(),
        leadId: appt.leadId,
        appointmentId: appt.id,
        // Attribution figee : elle vient du rendez-vous, jamais du lead.
        setterId: appt.setterId,
        closerId,
        ...values,
        schedule,
        status: "active",
        refundAmount: 0,
        refundedAt: "",
        createdBy: session.memberId,
        createdAt: now,
        updatedAt: now,
      };
      db.sales.unshift(sale);
      log(db, session, {
        action: "sale.created",
        entity: "sale",
        entityId: sale.id,
        summary: `Vente de ${sale.contractValue} ${sale.currency} enregistrée par ${memberName(db, closerId)} (setter : ${memberName(db, appt.setterId)})`,
      });
    }

    if (lead) {
      lead.stage = "closed-won";
      lead.dealValue = sale.contractValue;
      lead.closerId = closerId;
    }
  }

  /* --- Relance --- */
  if ((input.status === "follow-up" || input.status === "rescheduled") && input.followUp?.dueAt) {
    followUp = {
      id: newId(),
      leadId: appt.leadId,
      appointmentId: appt.id,
      closerId: input.followUp.closerId || appt.closerId || "",
      dueAt: input.followUp.dueAt,
      notes: input.followUp.notes || "",
      status: "pending",
      createdBy: session.memberId,
      createdAt: now,
      completedAt: "",
    };
    db.followUps.unshift(followUp);
    log(db, session, {
      action: "follow-up.created",
      entity: "follow-up",
      entityId: followUp.id,
      summary: `Relance programmée pour ${lead?.handle || lead?.name || "un lead"}`,
    });
  }

  /* --- Reprogrammation --- */
  if (input.status === "rescheduled" && input.rescheduledAt) {
    appt.scheduledAt = input.rescheduledAt;
    if (lead) lead.callAt = input.rescheduledAt;
  }

  if (lead && input.status === "closed-lost") lead.stage = "closed-lost";
  if (lead && (input.status === "completed" || input.status === "no-show")) lead.stage = "call-fait";

  log(db, session, {
    action: "appointment.status",
    entity: "appointment",
    entityId: appt.id,
    summary: `${session.memberName || "Moi"} a passé le rendez-vous en « ${input.status} »`,
  });

  writeDB(db);
  return { appointment: appt, sale, followUp };
}

/** Modifications legeres d'un rendez-vous (assignation, notes, qualification). */
export function patchAppointment(
  session: Session,
  id: string,
  patch: Partial<
    Pick<
      Appointment,
      "closerId" | "setterNotes" | "qualified" | "scheduledAt" | "timezone" | "source" | "iclosedUrl" | "status" | "confirmation"
    >
  > & { setterId?: string },
) {
  const db = readDB();
  const appt = db.appointments.find((a) => a.id === id);
  if (!appt) throw new Forbidden("Rendez-vous introuvable.");
  if (!canSee(session, appt)) throw new Forbidden();

  /*
   * Confirmation du rendez-vous : ouverte a quiconque voit la fiche (le
   * setter, son closer, l'admin). Elle fait avancer le statut : un call
   * « booked » confirme passe en « confirmed », et retirer la confirmation
   * le ramene a « booked ». « Pas de reponse » ne touche pas au statut, il
   * previent juste que le call est a risque.
   */
  const { confirmation, ...rest } = patch;
  patch = rest;
  if (confirmation !== undefined && confirmation !== (appt.confirmation ?? "")) {
    const now = new Date().toISOString();
    appt.confirmation = confirmation;
    appt.confirmationAt = confirmation ? now : "";
    appt.confirmationBy = confirmation ? session.memberId : "";
    if (confirmation === "confirmed" && (appt.status === "booked" || appt.status === "rescheduled")) {
      pushHistory(appt, session, "confirmed", "Rendez-vous confirmé avec le lead");
    } else if (confirmation !== "confirmed" && appt.status === "confirmed") {
      pushHistory(appt, session, "booked", confirmation === "no-answer" ? "Pas de réponse à la confirmation" : "Confirmation retirée");
    }
    const lead = db.leads.find((l) => l.id === appt.leadId);
    log(db, session, {
      action: "appointment.confirmation",
      entity: "appointment",
      entityId: appt.id,
      summary:
        confirmation === "confirmed"
          ? `Rendez-vous de ${lead?.name ?? "un lead"} confirmé`
          : confirmation === "no-answer"
            ? `${lead?.name ?? "Le lead"} ne répond pas à la confirmation`
            : `Confirmation du rendez-vous de ${lead?.name ?? "un lead"} retirée`,
    });
  }

  // Assigner un closer, requalifier ou changer de setter : decisions d'admin.
  const adminOnly = ["closerId", "qualified", "setterId"] as const;
  for (const key of adminOnly) {
    if (patch[key] !== undefined && !session.isAdmin) {
      throw new Forbidden("Seul l'administrateur peut modifier l'assignation.");
    }
  }
  // Le contexte du setter appartient au setter.
  if (patch.setterNotes !== undefined && !session.isAdmin && !sessionHas(session, "setter")) {
    throw new Forbidden("Seul le setter peut modifier ses notes.");
  }

  const before = appt.closerId;
  const beforeSetter = appt.setterId;
  Object.assign(appt, patch);
  appt.updatedAt = new Date().toISOString();

  if (patch.status && patch.status !== appt.status) pushHistory(appt, session, patch.status);

  /*
   * L'attribution suit sur la vente : commissions et classements se lisent
   * sur `sale.setterId` / `sale.closerId`. Corriger le closer d'un call deja
   * close sans corriger la vente laisserait la commission au mauvais membre.
   */
  const sale = db.sales.find((s) => s.appointmentId === appt.id && s.status !== "cancelled");
  if (sale) {
    if (patch.closerId !== undefined && sale.closerId !== patch.closerId) {
      sale.closerId = patch.closerId;
      sale.updatedAt = appt.updatedAt;
    }
    if (patch.setterId !== undefined && sale.setterId !== patch.setterId) {
      sale.setterId = patch.setterId;
      sale.updatedAt = appt.updatedAt;
    }
  }
  if (patch.setterId !== undefined && patch.setterId !== beforeSetter) {
    log(db, session, {
      action: "appointment.assigned",
      entity: "appointment",
      entityId: appt.id,
      summary: `${memberName(db, patch.setterId)} attribué comme setter`,
    });
  }

  if (patch.closerId !== undefined && patch.closerId !== before) {
    const lead = db.leads.find((l) => l.id === appt.leadId);
    if (lead) lead.closerId = patch.closerId;
    log(db, session, {
      action: "appointment.assigned",
      entity: "appointment",
      entityId: appt.id,
      summary: patch.closerId
        ? `${memberName(db, patch.closerId)} assigné comme closer`
        : "Closer retiré du rendez-vous",
    });
  }

  writeDB(db);
  return appt;
}

/* -------------------------------- Ventes -------------------------------- */

/**
 * Corrige une vente : encaissement complementaire, remboursement, annulation.
 *
 * Les donnees d'origine ne sont jamais detruites — un remboursement s'ajoute,
 * il n'efface pas le montant du contrat. Les commissions se recalculent alors
 * toutes seules sur le net.
 */
export function patchSale(
  session: Session,
  id: string,
  patch: Partial<Pick<Sale, "cashCollected" | "contractValue" | "status" | "refundAmount" | "notes" | "offer" | "paymentType" | "installments" | "paymentMethod" | "schedule" | "soldAt">>,
) {
  const db = readDB();
  const sale = db.sales.find((s) => s.id === id);
  if (!sale) throw new Forbidden("Vente introuvable.");
  if (!session.isAdmin && sale.closerId !== session.memberId) {
    throw new Forbidden("Seul le closer de cette vente ou l'administrateur peut la modifier.");
  }
  // Annuler ou rembourser touche a l'argent : reserve a l'admin.
  if ((patch.status || patch.refundAmount !== undefined) && !session.isAdmin) {
    throw new Forbidden("Remboursements et annulations sont réservés à l'administrateur.");
  }

  if (patch.cashCollected !== undefined && patch.cashCollected > (patch.contractValue ?? sale.contractValue) + 0.005) {
    throw new Error("Le cash encaissé ne peut pas dépasser la valeur du contrat.");
  }
  // Corriger la date de vente est une correction d'admin : elle deplace la vente d'un mois a l'autre.
  if (patch.soldAt !== undefined && !session.isAdmin) throw new Forbidden("Seul l'administrateur peut changer la date de vente.");

  const moneyChanged = ["contractValue", "cashCollected", "installments", "soldAt"].some((k) => patch[k as keyof typeof patch] !== undefined);
  Object.assign(sale, patch);
  /*
   * Montants ou nombre d'echeances corriges sans plan explicite : le plan
   * de paiement est recalcule, en gardant les echeances deja encaissees.
   * Sans cela une vente passee de 3 000 a 2 500 garderait une echeance de
   * 1 500 a venir qui ne correspond plus a rien.
   */
  if (moneyChanged && patch.schedule === undefined) {
    sale.schedule = mergePaid(buildSchedule(sale.contractValue, sale.cashCollected, sale.installments, sale.soldAt), sale.schedule);
  }
  if (patch.refundAmount !== undefined && patch.refundAmount > 0) {
    sale.refundedAt = new Date().toISOString();
    if (!patch.status) {
      sale.status = patch.refundAmount >= sale.contractValue ? "refunded" : "partially-refunded";
    }
  }
  sale.updatedAt = new Date().toISOString();

  log(db, session, {
    action: "sale.updated",
    entity: "sale",
    entityId: sale.id,
    summary: `Vente mise à jour : ${sale.contractValue} ${sale.currency} de contrat, ${sale.cashCollected} encaissés${sale.refundAmount ? `, ${sale.refundAmount} remboursés` : ""}`,
  });

  writeDB(db);
  return sale;
}

/* ------------------------------- Relances -------------------------------- */

export function completeFollowUp(session: Session, id: string, status: FollowUp["status"]) {
  const db = readDB();
  const fu = db.followUps.find((f) => f.id === id);
  if (!fu) throw new Forbidden("Relance introuvable.");
  if (!session.isAdmin && fu.closerId !== session.memberId) throw new Forbidden();

  fu.status = status;
  fu.completedAt = new Date().toISOString();
  log(db, session, {
    action: "follow-up.closed",
    entity: "follow-up",
    entityId: fu.id,
    summary: status === "done" ? "Relance effectuée" : "Relance annulée",
  });
  writeDB(db);
  return fu;
}

/* ------------------------------ Commissions ------------------------------ */

/**
 * Enregistre une regle de commission.
 *
 * On n'ecrase jamais la precedente : une nouvelle regle est ajoutee avec sa
 * date d'effet, et l'ancienne est desactivee. Les commissions deja gagnees
 * gardent ainsi le taux qui s'appliquait a l'epoque.
 */
export function setCommissionRule(
  session: Session,
  input: Omit<CommissionRule, "id" | "createdAt">,
): CommissionRule {
  const db = readDB();
  const rule: CommissionRule = { ...input, id: newId(), createdAt: new Date().toISOString() };

  // Seules les regles du MEME metier sont remplacees : enregistrer le tarif
  // closer d'un setter-closer ne doit pas eteindre son tarif setter.
  for (const old of db.commissionRules) {
    if (old.memberId === rule.memberId && old.role === rule.role && old.active) old.active = false;
  }
  db.commissionRules.unshift(rule);

  log(db, session, {
    action: "commission.rule",
    entity: "commission",
    entityId: rule.id,
    summary: `Règle de commission mise à jour pour ${memberName(db, rule.memberId)}`,
  });

  writeDB(db);
  return rule;
}

/** Verse une commission. Le solde du se recalcule, il n'est jamais ecrase. */
export function payCommission(
  session: Session,
  input: Omit<CommissionPayment, "id" | "createdAt" | "createdBy">,
): CommissionPayment {
  const db = readDB();
  const payment: CommissionPayment = {
    ...input,
    id: newId(),
    createdBy: session.memberId,
    createdAt: new Date().toISOString(),
  };
  db.commissionPayments.unshift(payment);

  log(db, session, {
    action: "commission.paid",
    entity: "commission",
    entityId: payment.id,
    summary: `${payment.amount} ${payment.currency} versés à ${memberName(db, payment.memberId)}`,
  });

  writeDB(db);
  return payment;
}

/* --------------------------------- Equipe -------------------------------- */

/** Vue publique d'un membre : jamais le mot de passe ni le code d'acces. */
export interface PublicMember {
  id: string;
  name: string;
  role: TeamMember["role"];
  /** Roles commerciaux cumules ; vide pour admin, monteur, assistant. */
  roles: CommercialRole[];
  status: TeamMember["status"];
  email: string;
  username: string;
  joinedAt: string;
  hasAccessCode: boolean;
  hasPassword: boolean;
  /** Le membre dispose-t-il d'un moyen de se connecter ? */
  canLogin: boolean;
  /** Etiquette Instagram du setter (voir TeamMember.igLabel). */
  igLabel: string;
}

export function publicMember(m: TeamMember): PublicMember {
  const hasAccessCode = Boolean(m.accessCode?.trim());
  const hasPassword = Boolean(m.username?.trim() && m.passwordHash);
  return {
    id: m.id,
    name: m.name,
    role: m.role,
    roles: memberRoles(m),
    status: m.status,
    email: m.email ?? "",
    username: m.username ?? "",
    joinedAt: m.joinedAt ?? m.createdAt,
    hasAccessCode,
    hasPassword,
    canLogin: hasAccessCode || hasPassword,
    igLabel: m.igLabel ?? "",
  };
}

/** Membres visibles dans les listes deroulantes d'assignation. */
export function salesMembers(db = readDB()): TeamMember[] {
  return db.team.filter((m) => isCommercial(m) || m.role === "admin");
}

/* --------------------------------- Eleves -------------------------------- */

/**
 * Inscrit l'eleve issu d'une vente.
 *
 * Declenche a la main par l'admin apres un close, jamais automatiquement : une
 * vente signee n'est pas encore un eleve onboarde, et creer la fiche trop tot
 * remplirait le suivi de coachings qui n'ont pas commence.
 *
 * L'eleve garde le lien vers sa vente, donc vers son setter et son closer. La
 * vente reste la source de verite pour l'argent ; `price` et `paid` n'en sont
 * qu'une photo au moment de l'inscription, que l'admin peut ensuite corriger
 * dans la page Eleves sans toucher aux commissions.
 */
export function enrollStudentFromSale(
  session: Session,
  saleId: string,
  input: {
    program?: string;
    startedAt?: string;
    objective?: string;
    nextSessionAt?: string;
    notes?: string;
    status?: Student["status"];
  },
) {
  const db = readDB();
  const sale = db.sales.find((s) => s.id === saleId);
  if (!sale) throw new Forbidden("Vente introuvable.");

  // Un eleve par vente : sans ce garde-fou, cliquer deux fois sur le bouton
  // cree deux coachings pour la meme personne et fausse le suivi.
  const already = db.students.find((s) => s.saleId === saleId);
  if (already) return { student: already, created: false };

  const lead = db.leads.find((l) => l.id === sale.leadId);
  const now = new Date().toISOString();

  const student: Student = {
    id: newId(),
    name: lead?.name || "Élève",
    handle: lead?.handle || (lead?.igUsername ? `@${lead.igUsername}` : ""),
    program: input.program?.trim() || sale.offer,
    startedAt: input.startedAt || sale.soldAt.slice(0, 10),
    price: sale.contractValue,
    paid: sale.cashCollected,
    status: input.status ?? "onboarding",
    progress: 0,
    nextSessionAt: input.nextSessionAt || "",
    objective: input.objective?.trim() || "",
    result: "",
    notes: input.notes?.trim() || "",
    createdAt: now,
    saleId: sale.id,
    leadId: sale.leadId,
    appointmentId: sale.appointmentId,
    setterId: sale.setterId,
    closerId: sale.closerId,
    igUsername: lead?.igUsername || "",
    email: lead?.email || "",
    phone: lead?.phone || "",
    currency: sale.currency,
  };

  db.students.unshift(student);

  log(db, session, {
    action: "student.enrolled",
    entity: "lead",
    entityId: student.id,
    summary: `${student.name} inscrit en coaching « ${student.program} » (setter ${memberName(db, sale.setterId)}, closer ${memberName(db, sale.closerId)})`,
  });

  writeDB(db);
  return { student, created: true };
}

/** Eleve deja inscrit pour cette vente, s'il existe. */
export function studentForSale(db: DB, saleId: string) {
  return db.students.find((s) => s.saleId === saleId);
}
