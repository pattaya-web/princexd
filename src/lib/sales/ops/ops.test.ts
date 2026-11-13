/**
 * Scenarios metier du Sales OS (node:test). Lancer : `node scripts/test-sales-os.mjs`.
 * Le moteur est pur : chaque test monte une petite base en memoire et un
 * « maintenant » fixe.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Appointment, CommissionRule, DB, FollowUp, Lead, Sale, Session, TeamMember } from "../../types";
import { reconcileTasks, effectivePriority } from "./engine";
import { buildWorkspace, computeAnomalies } from "./views";
import { managerEntries, entriesFor, effectiveRule } from "../commissions";
import { atParis, dayOf } from "./time";
import { canSee, requireAdmin, requireSalesManager, Forbidden } from "../access";
import { isSetterSession } from "../setter-view";

const NOW = Date.parse("2026-11-13T09:00:00.000Z");
const H = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

const member = (id: string, name: string, extra: Partial<TeamMember> = {}): TeamMember => ({
  id,
  name,
  role: "setter",
  roles: ["setter"],
  status: "actif",
  commissionPct: 0,
  target: 0,
  contact: "",
  notes: "",
  createdAt: "2026-01-01T00:00:00.000Z",
  ...extra,
});

function baseDb(): DB {
  return {
    settings: { salesCurrency: "EUR", salesOwnerMemberId: "mady", salesOps: { startedOn: "2026-11-01" }, salesOffers: [{ id: "o", name: "Accompagnement", price: 3000, description: "" }] },
    leads: [],
    appointments: [],
    sales: [],
    followUps: [],
    commissionRules: [],
    commissionPayments: [],
    commissionAdjustments: [],
    activityLogs: [],
    setterTasks: [],
    salesTasks: [],
    salesReports: [],
    mbSnapshots: [],
    team: [member("mady", "Mady (moi)", { roles: ["setter", "closer"] }), member("jorah", "Jorah", { salesHead: true })],
  } as unknown as DB;
}

const lead = (id: string, extra: Partial<Lead> = {}): Lead => ({
  id,
  name: id,
  handle: "",
  source: "dm",
  stage: "nouveau",
  dealValue: 0,
  callAt: "",
  ownerRole: "setter",
  ownerName: "",
  painPoint: "",
  nextAction: "",
  nextActionAt: "",
  notes: "",
  createdAt: iso(NOW - 2 * H),
  ...extra,
});

const appt = (id: string, leadId: string, scheduledAt: string, extra: Partial<Appointment> = {}): Appointment => ({
  id,
  leadId,
  setterId: "mady",
  closerId: "mady",
  scheduledAt,
  timezone: "Europe/Paris",
  source: "inbound",
  status: "booked",
  qualified: false,
  setterNotes: "",
  closerNotes: "",
  lostReason: "",
  iclosedUrl: "",
  iclosedEventId: "",
  rescheduledFromId: "",
  completedAt: "",
  history: [],
  createdBy: "",
  createdAt: iso(NOW - H),
  updatedAt: iso(NOW - H),
  ...extra,
});

const sale = (id: string, leadId: string, extra: Partial<Sale> = {}): Sale => ({
  id,
  leadId,
  appointmentId: "",
  setterId: "mady",
  closerId: "mady",
  offer: "Accompagnement",
  contractValue: 3000,
  cashCollected: 3000,
  currency: "EUR",
  paymentType: "paid-in-full",
  installments: 1,
  paymentMethod: "",
  soldAt: "2026-11-10T10:00:00.000Z",
  status: "active",
  refundAmount: 0,
  refundedAt: "",
  notes: "",
  createdBy: "",
  createdAt: "2026-11-10T10:00:00.000Z",
  updatedAt: "2026-11-10T10:00:00.000Z",
  ...extra,
});

const rule = (memberId: string, role: CommissionRule["role"], pct: number, from = "2026-11-01", extra: Partial<CommissionRule> = {}): CommissionRule => ({
  id: `${memberId}-${role}-${pct}-${from}`,
  memberId,
  role,
  type: "pct-cash",
  pct,
  fixed: 0,
  basis: "cash",
  onlyQualified: false,
  currency: "EUR",
  effectiveFrom: from,
  active: true,
  notes: "",
  createdAt: "2026-11-01T00:00:00.000Z",
  ...extra,
});

const open = (db: DB) => db.salesTasks.filter((t) => t.status === "open");
const headSession: Session = { role: "setter", roles: ["setter"], memberId: "jorah", memberName: "Jorah", isAdmin: false, salesHead: true };
const setterSession: Session = { role: "setter", roles: ["setter"], memberId: "noa", memberName: "Noa", isAdmin: false };

test("1. Un nouveau lead Instagram arrive chez Jorah avec une tâche de contact", () => {
  const db = baseDb();
  db.leads.push(lead("ig1", { sourceChannel: "INSTAGRAM", igUsername: "sarah" }));
  const r = reconcileTasks(db, NOW);
  assert.equal(db.leads[0].ownerId, "jorah");
  assert.equal(r.assigned.length, 1);
  const t = open(db);
  assert.equal(t.length, 1);
  assert.equal(t[0].kind, "first-contact");
  assert.equal(t[0].ownerId, "jorah");
  assert.equal(t[0].priority, 0);
  assert.match(t[0].context, /Instagram/);
});

test("2. Réservation directe via la pub : Jorah responsable, confirmation, pas de premier contact", () => {
  const db = baseDb();
  db.leads.push(lead("ads1", { sourceChannel: "META_ADS", setterId: "mady", stage: "call-book" }));
  db.appointments.push(appt("a1", "ads1", iso(NOW + 48 * H)));
  reconcileTasks(db, NOW);
  assert.equal(db.leads[0].ownerId, "jorah");
  assert.equal(db.leads[0].setterId, "mady", "le setter d'origine ne bouge pas");
  const kinds = open(db).map((t) => t.kind).sort();
  assert.deepEqual(kinds, ["confirm-booking", "confirm-h3", "confirm-j1"]);
  assert.ok(open(db).every((t) => t.ownerId === "jorah"));
});

test("3. Call demain : confirmations aux bons horaires", () => {
  const db = baseDb();
  const at = NOW + 26 * H;
  db.leads.push(lead("l3"));
  db.appointments.push(appt("a3", "l3", iso(at), { createdAt: iso(NOW - 10 * H) }));
  reconcileTasks(db, NOW);
  const j1 = open(db).find((t) => t.kind === "confirm-j1")!;
  const h3 = open(db).find((t) => t.kind === "confirm-h3")!;
  assert.equal(j1.dueAt, iso(at - 24 * H));
  assert.equal(h3.dueAt, iso(at - 3 * H));
  assert.equal(effectivePriority(h3, NOW), 2, "une tâche à venir n'est pas urgente aujourd'hui");
});

test("4. Annulation : les rappels inutiles sont neutralisés", () => {
  const db = baseDb();
  db.leads.push(lead("l4"));
  db.appointments.push(appt("a4", "l4", iso(NOW + 30 * H)));
  reconcileTasks(db, NOW);
  assert.ok(open(db).length >= 2);
  db.appointments[0].status = "cancelled";
  const r = reconcileTasks(db, NOW + 60_000);
  assert.equal(open(db).filter((t) => t.appointmentId === "a4").length, 0);
  assert.ok(r.closed >= 2);
  assert.ok(db.salesTasks.filter((t) => t.appointmentId === "a4").every((t) => t.status === "obsolete" && t.closedReason === "Rendez-vous annulé"));
});

test("5. No-show : visible dans les no-shows avec une prochaine action urgente", () => {
  const db = baseDb();
  const at = NOW - 2 * H;
  db.leads.push(lead("l5", { stage: "call-fait" }));
  db.appointments.push(appt("a5", "l5", iso(at), { status: "no-show", history: [{ at: iso(at + 10 * 60_000), actorId: "", actorName: "", from: "booked", to: "no-show", note: "" }] }));
  reconcileTasks(db, NOW);
  const t = open(db).find((x) => x.kind === "no-show")!;
  assert.ok(t);
  assert.equal(t.dueAt, iso(at + 25 * 60_000), "15 min après le constat d'absence");
  assert.equal(t.priority, 0);
  const ws = buildWorkspace(db, headSession, NOW);
  assert.equal(ws.poles.noShows.length, 1);
  assert.equal(ws.poles.noShows[0].next?.title, t.title);
});

test("6. No-show reprogrammé : statut et tâches à jour, sans doublon", () => {
  const db = baseDb();
  const at = NOW - 26 * H;
  db.leads.push(lead("l6", { stage: "call-fait" }));
  db.appointments.push(appt("a6", "l6", iso(at), { status: "no-show" }));
  reconcileTasks(db, NOW);
  assert.equal(open(db).filter((t) => t.kind === "no-show").length, 1);
  db.appointments.push(appt("a6b", "l6", iso(NOW + 50 * H), { createdAt: iso(NOW) }));
  reconcileTasks(db, NOW + 60_000);
  reconcileTasks(db, NOW + 120_000);
  assert.equal(open(db).filter((t) => t.kind === "no-show").length, 0);
  assert.equal(db.salesTasks.find((t) => t.kind === "no-show")!.closedReason, "Reprogrammé");
  const keys = db.salesTasks.map((t) => t.key);
  assert.equal(new Set(keys).size, keys.length, "aucune clé en double");
  const ws = buildWorkspace(db, headSession, NOW + 120_000);
  assert.equal(ws.poles.noShows[0].state, "rescheduled");
  assert.equal(ws.poles.noShowStats.recovered, 1);
});

test("7. « Attend son salaire » : relance à la bonne date, avec le contexte, pour Jorah", () => {
  const db = baseDb();
  db.leads.push(lead("l7", { stage: "call-fait", ownerId: "jorah" }));
  db.appointments.push(appt("a7", "l7", iso(NOW - 3 * H), { status: "follow-up" }));
  const fu: FollowUp = { id: "f7", leadId: "l7", appointmentId: "a7", closerId: "mady", dueAt: "2026-11-28T09:00:00.000Z", notes: "Salaire le 28", status: "pending", createdBy: "", createdAt: iso(NOW), completedAt: "", objection: "salary", heat: "hot" };
  db.followUps.push(fu);
  reconcileTasks(db, NOW);
  const t = open(db).find((x) => x.kind === "followup")!;
  assert.equal(t.dueAt, fu.dueAt);
  assert.equal(t.ownerId, "jorah");
  assert.match(t.context, /Attend son salaire/);
  assert.match(t.context, /Salaire le 28/);
});

test("8. Vente Meta Ads closée par Mady : 5 % management pour Jorah après encaissement", () => {
  const db = baseDb();
  db.commissionRules.push(rule("jorah", "manager", 5), rule("jorah", "setter", 7.5));
  const s = sale("s8", "x", { setterId: "mady" });
  const jorah = db.team.find((m) => m.id === "jorah")!;
  const e = entriesFor(jorah, db.commissionRules, [], [s]);
  assert.equal(e.length, 1);
  assert.equal(e[0].role, "manager");
  assert.equal(e[0].amount, 150);
  // Rien d'encaissé : rien de dû.
  const unpaid = sale("s8b", "x", { cashCollected: 0, paymentExpectedAt: "2026-11-20" });
  assert.equal(entriesFor(jorah, db.commissionRules, [], [unpaid]).length, 0);
});

test("9. Rendez-vous posé par Jorah, closé par Mady : 7,5 % + 5 % = 12,5 %", () => {
  const db = baseDb();
  db.commissionRules.push(rule("jorah", "manager", 5), rule("jorah", "setter", 7.5));
  const jorah = db.team.find((m) => m.id === "jorah")!;
  const e = entriesFor(jorah, db.commissionRules, [], [sale("s9", "x", { setterId: "jorah" })]);
  const total = e.reduce((a, x) => a + x.amount, 0);
  assert.equal(total, 375);
  assert.deepEqual(e.map((x) => x.role).sort(), ["manager", "setter"]);
});

test("10. Paiement en deux fois : une commission par encaissement, sans double comptage", () => {
  const db = baseDb();
  db.commissionRules.push(rule("jorah", "manager", 5));
  const s = sale("s10", "x", { cashCollected: 3000, collections: [{ id: "c2", amount: 1500, at: "2026-12-10T10:00:00.000Z", method: "", note: "", by: "", createdAt: "" }] });
  const jorah = db.team.find((m) => m.id === "jorah")!;
  const e = managerEntries(jorah, db.commissionRules, [s]);
  assert.equal(e.length, 2);
  assert.deepEqual(e.map((x) => x.amount), [75, 75]);
  assert.equal(new Set(e.map((x) => x.sourceId)).size, 2);
  assert.equal(managerEntries(jorah, db.commissionRules, [s]).length, 2, "recalcul identique");
});

test("11. Remboursement : montants et commissions ajustés de façon traçable", () => {
  const db = baseDb();
  db.commissionRules.push(rule("jorah", "manager", 5));
  const s = sale("s11", "x", { refundAmount: 3000, refundedAt: "2026-11-20T10:00:00.000Z", status: "refunded" });
  const jorah = db.team.find((m) => m.id === "jorah")!;
  const e = managerEntries(jorah, db.commissionRules, [s]);
  assert.equal(e.length, 2, "la ligne acquise reste, le remboursement s'ajoute en négatif");
  assert.equal(e.reduce((a, x) => a + x.amount, 0), 0);
  assert.equal(e.find((x) => x.amount < 0)!.at, "2026-11-20T10:00:00.000Z");
});

test("12. Même événement reçu plusieurs fois : aucun doublon", () => {
  const db = baseDb();
  db.leads.push(lead("l12"), lead("l12b", { sourceChannel: "META_ADS" }));
  db.appointments.push(appt("a12", "l12b", iso(NOW + 40 * H)));
  reconcileTasks(db, NOW);
  const n = db.salesTasks.length;
  const r2 = reconcileTasks(db, NOW);
  const r3 = reconcileTasks(db, NOW);
  assert.equal(db.salesTasks.length, n);
  assert.deepEqual([r2.created, r2.updated, r2.closed, r3.created, r3.updated, r3.closed], [0, 0, 0, 0, 0, 0]);
});

test("13. Toutes les tâches du jour faites : file vide, prochaines échéances visibles", () => {
  const db = baseDb();
  db.leads.push(lead("l13"));
  db.appointments.push(appt("a13", "l13", iso(NOW + 60 * H)));
  reconcileTasks(db, NOW);
  for (const t of db.salesTasks) if (Date.parse(t.dueAt) < Date.parse(atParis(dayOf(NOW + 24 * H), "00:00"))) Object.assign(t, { status: "done", doneBy: "jorah", doneAt: iso(NOW) });
  db.leads[0].lastContactAt = iso(NOW);
  db.appointments[0].confirmation = "awaiting";
  reconcileTasks(db, NOW);
  const ws = buildWorkspace(db, headSession, NOW);
  assert.equal(ws.tasks.length, 0);
  assert.ok(ws.upcoming.length >= 1);
});

test("14. Lead actif sans prochaine action : anomalie", () => {
  const db = baseDb();
  db.leads.push(lead("l14", { ownerId: "jorah", settingStatus: "conversation", lastContactAt: iso(NOW - 3 * H) }));
  reconcileTasks(db, NOW);
  const a = computeAnomalies(db, NOW);
  assert.equal(a.length, 1);
  assert.equal(a[0].reason, "Aucune prochaine action");
});

test("15. Paris / Dubaï et changement d'heure : rappels justes", () => {
  // Passage à l'heure d'été à Paris le 29 mars 2026 ; Dubaï n'en a pas.
  assert.equal(atParis("2026-03-28", "09:00"), "2026-03-28T08:00:00.000Z");
  assert.equal(atParis("2026-03-29", "09:00"), "2026-03-29T07:00:00.000Z");
  const db = baseDb();
  db.settings.salesOps = { startedOn: "2026-03-01" };
  const now = Date.parse("2026-03-26T09:00:00.000Z");
  db.leads.push(lead("l15", { createdAt: "2026-03-26T08:00:00.000Z" }));
  // Call à 10 h Paris (12 h Dubaï) le 29 mars, après le changement d'heure.
  const at = "2026-03-29T08:00:00.000Z";
  db.appointments.push(appt("a15", "l15", at, { createdAt: "2026-03-26T08:00:00.000Z", timezone: "Asia/Dubai" }));
  reconcileTasks(db, now);
  assert.equal(open(db).find((t) => t.kind === "confirm-j1")!.dueAt, "2026-03-28T08:00:00.000Z");
  // Reprogrammé : les anciennes confirmations tombent, les nouvelles suivent la nouvelle heure.
  db.appointments[0].scheduledAt = "2026-03-30T13:00:00.000Z";
  reconcileTasks(db, now + 60_000);
  const j1 = open(db).filter((t) => t.kind === "confirm-j1");
  assert.equal(j1.length, 1);
  assert.equal(j1[0].dueAt, "2026-03-29T13:00:00.000Z");
  assert.equal(dayOf("2026-03-29T22:30:00.000Z"), "2026-03-30", "minuit passé à Paris");
});

test("16. Accès refusé côté serveur aux données sensibles", () => {
  assert.throws(() => requireAdmin(headSession), Forbidden, "le Head of Setting ne règle pas les commissions");
  assert.throws(() => requireSalesManager(setterSession), Forbidden);
  assert.equal(canSee(headSession, { setterId: "mady" }), true);
  assert.equal(canSee(setterSession, { setterId: "mady" }), false);
  assert.equal(isSetterSession(headSession), false, "le Head voit les vrais montants");
  assert.equal(isSetterSession({ ...headSession, maskedAmounts: true }), true);
  // Un setter ne voit que sa file.
  const db = baseDb();
  db.leads.push(lead("l16", { ownerId: "jorah" }));
  reconcileTasks(db, NOW);
  assert.equal(buildWorkspace(db, setterSession, NOW, "all").tasks.length, 0);
  assert.equal(buildWorkspace(db, headSession, NOW).tasks.length, 1);
});

test("Changement de taux : les commissions acquises gardent l'ancien taux", () => {
  const rules = [rule("jorah", "manager", 5, "2026-11-01", { effectiveTo: "2026-11-30" }), rule("jorah", "manager", 6, "2026-12-01")];
  assert.equal(effectiveRule(rules, "jorah", "2026-11-15T10:00:00Z", "manager")!.pct, 5);
  assert.equal(effectiveRule(rules, "jorah", "2026-12-15T10:00:00Z", "manager")!.pct, 6);
  // Fin de contrat : plus rien après.
  const ended = [rule("jorah", "manager", 5, "2026-11-01", { effectiveTo: "2026-11-30" })];
  assert.equal(effectiveRule(ended, "jorah", "2026-12-02T10:00:00Z", "manager"), null);
  // Avant le début du contrat de management : rien.
  assert.equal(effectiveRule(ended, "jorah", "2026-10-15T10:00:00Z", "manager"), null);
});

test("Paiement en attente : tâche de suivi, et un « j'ai payé » n'encaisse rien", () => {
  const db = baseDb();
  db.leads.push(lead("l17", { stage: "closed-won", ownerId: "jorah" }));
  db.sales.push(sale("s17", "l17", { cashCollected: 0, paymentExpectedAt: "2026-11-12", schedule: [] }));
  reconcileTasks(db, NOW);
  const t = open(db).find((x) => x.kind === "payment")!;
  assert.ok(t);
  assert.equal(t.ownerId, "jorah");
  assert.equal(t.priority, 0, "en retard");
  db.sales[0].paymentFollow = { state: "awaiting-verification", note: "virement fait", at: iso(NOW), by: "jorah" };
  reconcileTasks(db, NOW + 60_000);
  const v = open(db).find((x) => x.kind === "payment-verify")!;
  assert.equal(v.ownerId, "mady", "la vérification revient au closer / admin");
  assert.equal(db.sales[0].cashCollected, 0);
});
