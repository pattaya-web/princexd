import { getApiKey, readDB, writeDB } from "@/lib/db";
import { askText, parseJsonLoose } from "@/lib/kie";
import { SOURCE_CHANNEL_LABEL, setManualAttribution } from "@/lib/sales/attribution";
import { enrollStudentFromSale, quickOutcome, salesMembers, upsertLead } from "@/lib/sales/repo";
import { memberRoles } from "@/lib/sales/roles";
import { waLink } from "@/lib/sales/templates";
import { checkStudentUsername } from "@/lib/formation-server";
import { onboardingSettings, renderOnboarding } from "@/lib/onboarding";
import type { DB, Lead, Sale, Session, Student } from "@/lib/types";
import { completeDraft, describeDraft, fold, parisToday, parseStudentText, sourceOption, SOURCE_OPTIONS, type NewStudentDraft } from "./draft";
import { newId } from "@/lib/db";

/**
 * Chat « Nouvel élève » (côté serveur).
 *
 * Une phrase dictée depuis le téléphone (« Alexandre, closé 2500 en instant
 * aujourd'hui, vient d'Instagram ») devient, après validation :
 *  - un lead (retrouvé dans le CRM ou créé), avec sa source d'acquisition ;
 *  - un call « closé » et sa vente, donc le Sales Dashboard et les
 *    commissions à jour (quickOutcome → recordOutcome) ;
 *  - une fiche élève rattachée à la vente (enrollStudentFromSale) ;
 *  - son accès à la plateforme de formation (identifiant + mot de passe) ;
 *  - le message d'onboarding prêt à coller dans WhatsApp.
 */

const BASE = () => (process.env.PUBLIC_BASE_URL?.trim() || "https://mvdyprince.fr").replace(/\/$/, "");

export interface ChatContext {
  today: string;
  currency: string;
  offers: { name: string; price: number }[];
  setters: { id: string; name: string }[];
  /** Le formulaire d'onboarding est renseigné (sinon le message le dira « à venir »). */
  formConfigured: boolean;
  hasAi: boolean;
  baseUrl: string;
}

export function chatContext(db = readDB()): ChatContext {
  const offers = (db.settings.salesOffers ?? []).map((o) => ({ name: o.name, price: o.price }));
  const setters = salesMembers(db)
    .filter((m) => m.status !== "inactif" && memberRoles(m).includes("setter"))
    .map((m) => ({ id: m.id, name: m.name }));
  return {
    today: parisToday(),
    currency: db.settings.salesCurrency || "EUR",
    offers,
    setters,
    formConfigured: Boolean(onboardingSettings(db.settings).formUrl),
    hasAi: Boolean(getApiKey()),
    baseUrl: BASE(),
  };
}

/* -------------------------------- Lecture -------------------------------- */

interface AiDraft {
  name?: string | null;
  contractValue?: number | null;
  cashCollected?: number | null;
  paymentType?: string | null;
  installments?: number | null;
  soldAt?: string | null;
  source?: string | null;
  offer?: string | null;
  email?: string | null;
  phone?: string | null;
  igUsername?: string | null;
  contractSigned?: boolean | null;
  notes?: string | null;
}

const AI_TIMEOUT_MS = 25_000;

async function aiParse(message: string, ctx: ChatContext): Promise<AiDraft | null> {
  if (!ctx.hasAi) return null;
  const system = [
    "Tu es l'assistant du CRM d'un coach e-commerce français. Il te dicte, depuis son téléphone, qu'un prospect vient de signer (« closé »).",
    "Tu extrais les informations en JSON strict, sans commentaire. Si une information n'est pas dite, mets null : n'invente rien.",
    `Aujourd'hui : ${ctx.today} (Europe/Paris). Devise : ${ctx.currency}.`,
    "Champs :",
    '- name : prénom et nom du prospect, tels qu\'écrits (capitalisés).',
    "- contractValue : valeur totale du contrat (nombre). « 2500 », « 2,5k », « 2k5 » = 2500.",
    "- cashCollected : ce qui est encaissé aujourd'hui (nombre). « en instant », « cash », « en une fois », « comptant » = tout le contrat. « en 3 fois » sans autre précision = contrat / 3. « acompte 500 » = 500. « pas encore payé », « contrat envoyé » = 0.",
    '- paymentType : "paid-in-full" | "installments" | "deposit" | "other".',
    "- installments : nombre de fois si paiement en plusieurs fois, sinon 0.",
    "- soldAt : date de la vente AAAA-MM-JJ (« aujourd'hui », « hier », « le 22 octobre »…), null si non dite.",
    `- source : d'où vient le prospect, une clé parmi ${SOURCE_OPTIONS.filter((o) => o.key).map((o) => `"${o.key}" (${o.label})`).join(", ")}, ou null.`,
    `- offer : nom de l'offre si dit${ctx.offers.length ? ` (offres connues : ${ctx.offers.map((o) => o.name).join(", ")})` : ""}, sinon null.`,
    "- email, phone, igUsername (sans @) : si dits.",
    "- contractSigned : true seulement si le contrat est dit signé.",
    "- notes : tout le reste utile (contexte, objectif, situation), en une ou deux phrases, sinon null.",
    'Réponds uniquement avec l\'objet JSON, par exemple {"name":"Alexandre Martin","contractValue":2500,...}.',
  ].join("\n");
  try {
    const raw = await Promise.race([
      askText(message, system, 600),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("IA trop lente")), AI_TIMEOUT_MS)),
    ]);
    return parseJsonLoose<AiDraft>(raw);
  } catch {
    // Sans IA, la lecture par règles suffit la plupart du temps : on ne bloque pas le chat.
    return null;
  }
}

const num = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? Number(v.replace(/[^\d.,]/g, "").replace(",", ".")) : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
};
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

export interface LeadMatch {
  id: string;
  name: string;
  handle: string;
  email: string;
  phone: string;
  setterName: string;
  stage: string;
  sourceLabel: string;
  lastAppointmentAt: string;
  lastAppointmentStatus: string;
  /** Déjà une fiche élève : valider mettrait la vente à jour sans créer de doublon. */
  isStudent: boolean;
  hasSale: boolean;
}

/** Leads du CRM qui ressemblent au brouillon (nom, email, téléphone, pseudo). */
export function findLeadMatches(db: DB, d: Pick<NewStudentDraft, "name" | "email" | "phone" | "igUsername">): LeadMatch[] {
  const tokens = fold(d.name).split(/\s+/).filter((t) => t.length >= 2);
  const email = fold(d.email);
  const digits = d.phone.replace(/\D/g, "").replace(/^33/, "0").replace(/^0+/, "");
  const ig = fold(d.igUsername).replace(/^@/, "");
  const names = new Map(db.team.map((m) => [m.id, m.name]));
  const students = new Set(db.students.map((s) => s.leadId).filter(Boolean));
  const sales = new Set(db.sales.filter((s) => s.status !== "cancelled").map((s) => s.leadId));

  const scored: { lead: Lead; score: number }[] = [];
  for (const l of db.leads) {
    let score = 0;
    if (email && fold(l.email ?? "") === email) score += 10;
    const ld = (l.phone ?? "").replace(/\D/g, "").replace(/^33/, "0").replace(/^0+/, "");
    if (digits.length >= 8 && ld && (ld.endsWith(digits) || digits.endsWith(ld))) score += 10;
    if (ig && fold(l.igUsername ?? l.handle ?? "").replace(/^@/, "") === ig) score += 10;
    if (tokens.length) {
      const hay = fold([l.name, l.handle ?? "", l.igUsername ?? "", l.email ?? ""].join(" "));
      const hits = tokens.filter((t) => hay.includes(t)).length;
      if (hits === tokens.length) score += 5;
      else if (hits && tokens.length > 1) score += 2;
    }
    if (score >= 5) scored.push({ lead: l, score });
  }
  scored.sort((a, b) => b.score - a.score || b.lead.createdAt.localeCompare(a.lead.createdAt));
  return scored.slice(0, 5).map(({ lead: l }) => {
    const appt = db.appointments
      .filter((a) => a.leadId === l.id && a.status !== "cancelled")
      .sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt))[0];
    return {
      id: l.id,
      name: l.name,
      handle: l.handle || (l.igUsername ? `@${l.igUsername}` : ""),
      email: l.email ?? "",
      phone: l.phone ?? "",
      setterName: names.get(l.setterId ?? "") ?? "",
      stage: l.stage,
      sourceLabel: l.sourceChannel && l.sourceChannel !== "UNKNOWN" ? SOURCE_CHANNEL_LABEL[l.sourceChannel] : "",
      lastAppointmentAt: appt?.scheduledAt ?? "",
      lastAppointmentStatus: appt?.status ?? "",
      isStudent: students.has(l.id),
      hasSale: sales.has(l.id),
    };
  });
}

export interface ParseResult {
  draft: NewStudentDraft;
  matches: LeadMatch[];
  reply: string;
  warnings: string[];
  usedAi: boolean;
}

/** Lit le message et prépare le brouillon à valider. N'écrit rien. */
export async function parseNewStudent(message: string): Promise<ParseResult> {
  const db = readDB();
  const ctx = chatContext(db);
  const { draft: rx, hints } = parseStudentText(message, ctx.today);
  const ai = await aiParse(message, ctx);

  const merged: Partial<NewStudentDraft> = { ...rx };
  if (ai) {
    merged.name = str(ai.name) ?? rx.name;
    merged.source = SOURCE_OPTIONS.some((o) => o.key && o.key === ai.source) ? (ai.source as string) : rx.source;
    merged.offer = str(ai.offer) ?? rx.offer;
    merged.notes = str(ai.notes);
    merged.email = rx.email ?? str(ai.email);
    merged.phone = rx.phone ?? str(ai.phone);
    merged.igUsername = rx.igUsername ?? str(ai.igUsername)?.replace(/^@/, "");
    merged.contractSigned = Boolean(rx.contractSigned || ai.contractSigned);
    if (/^\d{4}-\d{2}-\d{2}$/.test(ai.soldAt ?? "") && ai.soldAt! <= ctx.today) merged.soldAt = ai.soldAt!;
    if (!hints.foundAmount) {
      merged.contractValue = num(ai.contractValue);
      merged.cashCollected = ai.cashCollected === null || ai.cashCollected === undefined ? undefined : Math.max(0, Math.round(Number(ai.cashCollected) || 0));
      merged.paymentType = (str(ai.paymentType) as NewStudentDraft["paymentType"] | undefined) ?? rx.paymentType;
      merged.installments = num(ai.installments) ?? rx.installments;
    } else if (!hints.explicitCash && ai.cashCollected !== null && ai.cashCollected !== undefined && merged.paymentType !== "paid-in-full") {
      // L'IA comprend mieux « il a payé la moitié » que les règles.
      merged.cashCollected = Math.max(0, Math.round(Number(ai.cashCollected) || 0));
    }
  }

  // Offre connue : son prix remplace un montant absent.
  const offerDefault = ctx.offers[0]?.name ?? "Accompagnement e-commerce + IA";
  const known = ctx.offers.find((o) => merged.offer && fold(o.name).includes(fold(merged.offer)));
  if (known) merged.offer = known.name;
  if (!merged.contractValue && known?.price) {
    merged.contractValue = known.price;
    merged.cashCollected = merged.cashCollected ?? (merged.paymentType === "paid-in-full" || !merged.paymentType ? known.price : 0);
  }

  const draft = completeDraft(merged, { offer: offerDefault, today: ctx.today });
  const matches = findLeadMatches(db, draft);
  // Un seul lead qui colle vraiment : on le propose coché.
  if (matches.length === 1) draft.leadId = matches[0].id;

  const warnings: string[] = [];
  if (!draft.name) warnings.push("Je n'ai pas trouvé le nom : écris-le dans la fiche.");
  if (!draft.contractValue) warnings.push("Je n'ai pas trouvé le montant du contrat.");
  if (!draft.source) warnings.push("Source non précisée : choisis-la pour l'attribution (Instagram, YouTube, Ads…).");
  if (!ctx.formConfigured) warnings.push("Le lien du formulaire d'onboarding n'est pas encore renseigné (Élèves → Onboarding) : le message dira « à venir ».");
  if (!ctx.setters.length && !db.settings.salesOwnerMemberId && !db.settings.salesDefaultSetterId) {
    warnings.push("Aucun setter dans l'équipe : la vente sera rattachée à ton compte s'il existe dans Équipe, sinon ajoute un membre.");
  }
  const studentMatch = matches.find((m) => m.id === draft.leadId && m.isStudent);
  if (studentMatch) warnings.push(`${studentMatch.name} a déjà une fiche élève : valider mettra sa vente à jour, sans créer de doublon.`);

  const found = matches.length === 1 ? ` Je l'ai retrouvé dans le CRM : ${matches[0].name}${matches[0].setterName ? ` (setter ${matches[0].setterName})` : ""}.` : matches.length > 1 ? ` ${matches.length} leads ressemblent : choisis le bon, ou « nouveau lead ».` : " Aucun lead ne correspond : je créerai la fiche.";
  const reply = `Voici ce que j'ai compris. ${describeDraft(draft, ctx.currency)}${found} Vérifie, corrige si besoin, puis valide.`;
  return { draft, matches, reply, warnings, usedAi: Boolean(ai) };
}

/* ------------------------------- Écriture -------------------------------- */

export interface ConfirmResult {
  student: Pick<Student, "id" | "name" | "program" | "price" | "paid" | "username" | "portalAccess" | "phone" | "email">;
  sale: Pick<Sale, "id" | "contractValue" | "cashCollected" | "currency" | "soldAt" | "paymentType" | "installments">;
  lead: { id: string; name: string; created: boolean; setterName: string; sourceLabel: string };
  credentials: { username: string; password: string } | null;
  message: string;
  whatsapp: string;
  notes: string[];
  studentCreated: boolean;
  appointmentCreated: boolean;
}

/** « Alexandre Martin » → alexandre.martin ; « Alexandre » → alexandre. */
export function usernameFromName(name: string): string {
  const words = fold(name)
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  return words.join(".");
}

/** Identifiant libre : prénom.nom, puis prénom.nom2, prénom.nom3… */
function pickUsername(s: Student): string {
  let base = usernameFromName(s.name) || "eleve";
  if (base.length < 3) base = `${base}.eleve`;
  for (let i = 1; i < 100; i++) {
    const candidate = i === 1 ? base : `${base}${i}`;
    try {
      return checkStudentUsername(candidate, s.id);
    } catch {
      // pris ou invalide : on essaie le suivant.
    }
  }
  return checkStudentUsername(`eleve.${Date.now().toString(36)}`, s.id);
}

/** Fiche élève seule (pas de montant) : lead si besoin, élève, identifiant, message. Pas de doublon sur le nom. */
function addStudentWithoutSale(session: Session, d: NewStudentDraft, ctx: ChatContext): ConfirmResult {
  const db = readDB();
  const names = new Map(db.team.map((m) => [m.id, m.name]));
  const src = sourceOption(d.source);
  const notes: string[] = [];
  const now = new Date().toISOString();

  const existing = db.students.find((s) => fold(s.name) === fold(d.name));
  let lead = d.leadId ? db.leads.find((l) => l.id === d.leadId) : undefined;
  const leadCreated = !lead && !existing;
  if (!lead && !existing) {
    lead = upsertLead(db, { igUsername: d.igUsername, name: d.name, email: d.email, phone: d.phone, source: src.leadSource });
    if (src.channel) setManualAttribution(lead, { sourceChannel: src.channel, funnelSource: src.funnel }, now);
    lead.stage = "closed-won";
  }

  let s = existing;
  if (s) {
    notes.push(`${s.name} était déjà dans Élèves : je n'ai pas créé de doublon.`);
  } else {
    s = {
      id: newId(),
      name: d.name,
      handle: lead?.handle || (d.igUsername ? `@${d.igUsername}` : ""),
      program: d.offer,
      startedAt: d.soldAt,
      price: 0,
      paid: 0,
      status: "onboarding",
      progress: 0,
      nextSessionAt: "",
      objective: "",
      result: "",
      notes: d.notes,
      createdAt: now,
      leadId: lead?.id,
      setterId: lead?.setterId || d.setterId || "",
      igUsername: d.igUsername || lead?.igUsername || "",
      email: d.email || lead?.email || "",
      phone: d.phone || lead?.phone || "",
      currency: ctx.currency,
    };
    db.students.unshift(s);
    db.activityLogs.unshift({
      id: newId(),
      at: now,
      actorId: session.memberId,
      actorName: session.memberName || "Moi",
      action: "student.enrolled",
      entity: "lead",
      entityId: s.id,
      summary: `${s.name} ajouté dans Élèves depuis l'assistant (sans vente)`,
    });
  }
  s.email = s.email || d.email;
  s.phone = s.phone || d.phone;
  if (d.contractSigned) {
    s.contractSigned = true;
    s.contractAt = s.contractAt || d.soldAt;
  }
  let credentials: ConfirmResult["credentials"] = null;
  if (d.createAccess) {
    if (!s.username) s.username = pickUsername(s);
    s.portalAccess = true;
    credentials = { username: s.username, password: "" };
  }
  writeDB(db);

  const cfg = onboardingSettings(db.settings);
  const message = renderOnboarding(cfg, { name: s.name, username: s.username, password: "", baseUrl: ctx.baseUrl });
  return {
    student: { id: s.id, name: s.name, program: s.program, price: s.price, paid: s.paid, username: s.username, portalAccess: s.portalAccess, phone: s.phone, email: s.email },
    sale: { id: "", contractValue: 0, cashCollected: 0, currency: ctx.currency, soldAt: "", paymentType: "other", installments: 0 },
    lead: {
      id: lead?.id ?? s.leadId ?? "",
      name: lead?.name ?? s.name,
      created: leadCreated,
      setterName: names.get(lead?.setterId ?? s.setterId ?? "") ?? "",
      sourceLabel: lead?.sourceChannel ? SOURCE_CHANNEL_LABEL[lead.sourceChannel] : "Inconnue",
    },
    credentials,
    message,
    whatsapp: s.phone ? waLink(s.phone, message) : "",
    notes,
    studentCreated: !existing,
    appointmentCreated: false,
  };
}

/** Écrit tout, dans l'ordre : lead → call closé + vente → élève → accès → message. */
export function confirmNewStudent(session: Session, input: NewStudentDraft, rawMessage: string): ConfirmResult {
  const ctx = chatContext();
  const d = completeDraft(input, { offer: ctx.offers[0]?.name ?? "Accompagnement e-commerce + IA", today: ctx.today });
  if (!d.name) throw new Error("Le nom de l'élève est obligatoire.");
  if (d.soldAt > ctx.today) throw new Error("La date ne peut pas être dans le futur.");
  // Sans montant : une fiche élève, pas de vente (élève déjà client, ou vente enregistrée ailleurs).
  if (!(d.contractValue > 0)) return addStudentWithoutSale(session, d, ctx);

  const notes: string[] = [];
  const db = readDB();
  const names = new Map(db.team.map((m) => [m.id, m.name]));
  const src = sourceOption(d.source);

  /* --- Lead --- */
  let lead = d.leadId ? db.leads.find((l) => l.id === d.leadId) : undefined;
  if (d.leadId && !lead) throw new Error("Le lead choisi n'existe plus : relance la lecture du message.");
  const leadCreated = !lead;
  if (!lead) {
    const before = db.leads.length;
    lead = upsertLead(db, { igUsername: d.igUsername, name: d.name, email: d.email, phone: d.phone, source: src.leadSource });
    if (db.leads.length === before) notes.push(`Le pseudo @${d.igUsername} existait déjà : j'ai repris cette fiche (${lead.name}).`);
  } else {
    lead.email = lead.email || d.email;
    lead.phone = lead.phone || d.phone;
    if (!lead.igUsername && d.igUsername) {
      lead.igUsername = d.igUsername;
      lead.handle = lead.handle || `@${d.igUsername}`;
    }
  }
  if (d.notes) lead.notes = [lead.notes, d.notes].filter(Boolean).join("\n");

  /* --- Source d'acquisition : le first touch connu l'emporte sur ce qui est dicté. --- */
  if (src.channel) {
    const known = lead.sourceChannel && lead.sourceChannel !== "UNKNOWN";
    if (leadCreated || !known) setManualAttribution(lead, { sourceChannel: src.channel, funnelSource: src.funnel }, `${d.soldAt}T10:00:00.000Z`);
    else if (lead.sourceChannel !== src.channel) {
      notes.push(`Source conservée : ${SOURCE_CHANNEL_LABEL[lead.sourceChannel!]} (déjà attribuée par ses liens), tu m'as dit ${src.label}.`);
    }
  }

  /* --- Setter : celui du lead, sinon celui choisi, sinon moi (pas de commission
         versée par erreur sur un prospect que personne n'a chauffé), sinon le
         setter par défaut des réglages. --- */
  if (!lead.setterId) {
    lead.setterId = d.setterId || db.settings.salesOwnerMemberId || db.settings.salesDefaultSetterId || "";
  } else if (d.setterId && d.setterId !== lead.setterId) {
    notes.push(`Setter conservé : ${names.get(lead.setterId) ?? "inconnu"} (il avait déjà amené ce lead).`);
  }
  writeDB(db);

  /* --- Call closé + vente --- */
  const soldAtIso = d.soldAt === ctx.today ? new Date().toISOString() : `${d.soldAt}T10:00:00.000Z`;
  const expected = d.cashCollected > 0 ? "" : new Date(new Date(soldAtIso).getTime() + 3 * 86_400_000).toISOString().slice(0, 10);
  const outcome = quickOutcome(session, lead.id, {
    status: "closed-won",
    note: `Ajouté depuis le chat Nouvel élève : « ${rawMessage.trim().slice(0, 300)} »`,
    sale: {
      offer: d.offer,
      contractValue: d.contractValue,
      cashCollected: d.cashCollected,
      currency: ctx.currency,
      paymentType: d.paymentType,
      installments: d.installments,
      paymentMethod: "",
      soldAt: soldAtIso,
      notes: d.notes,
      paymentExpectedAt: expected,
    },
  });
  if (!outcome.sale) throw new Error("La vente n'a pas pu être enregistrée.");

  /* --- Élève --- */
  const enrolled = enrollStudentFromSale(session, outcome.sale.id, {
    program: d.offer,
    startedAt: d.soldAt,
    status: "onboarding",
    notes: d.notes,
  });

  /* --- Accès plateforme + contrat --- */
  const db2 = readDB();
  const s = db2.students.find((x) => x.id === enrolled.student.id);
  if (!s) throw new Error("Fiche élève introuvable après création.");
  if (d.name && (!s.name || s.name.startsWith("@") || s.name === "Élève")) s.name = d.name;
  s.email = s.email || d.email;
  s.phone = s.phone || d.phone;
  if (d.contractSigned) {
    s.contractSigned = true;
    s.contractAt = s.contractAt || d.soldAt;
  }
  let credentials: ConfirmResult["credentials"] = null;
  if (d.createAccess && !s.username) {
    s.username = pickUsername(s);
    s.portalAccess = true;
    credentials = { username: s.username, password: "" };
  } else if (d.createAccess && s.username) {
    s.portalAccess = true;
    credentials = { username: s.username, password: "" };
  }
  writeDB(db2);

  const cfg = onboardingSettings(db2.settings);
  const message = renderOnboarding(cfg, { name: s.name, username: s.username, password: credentials?.password, baseUrl: ctx.baseUrl });
  const freshLead = db2.leads.find((l) => l.id === lead!.id) ?? lead;

  return {
    student: { id: s.id, name: s.name, program: s.program, price: s.price, paid: s.paid, username: s.username, portalAccess: s.portalAccess, phone: s.phone, email: s.email },
    sale: {
      id: outcome.sale.id,
      contractValue: outcome.sale.contractValue,
      cashCollected: outcome.sale.cashCollected,
      currency: outcome.sale.currency,
      soldAt: outcome.sale.soldAt,
      paymentType: outcome.sale.paymentType,
      installments: outcome.sale.installments,
    },
    lead: {
      id: freshLead.id,
      name: freshLead.name,
      created: leadCreated,
      setterName: names.get(freshLead.setterId ?? "") ?? "",
      sourceLabel: freshLead.sourceChannel ? SOURCE_CHANNEL_LABEL[freshLead.sourceChannel] : "Inconnue",
    },
    credentials,
    message,
    whatsapp: s.phone ? waLink(s.phone, message) : "",
    notes,
    studentCreated: enrolled.created,
    appointmentCreated: outcome.created,
  };
}
