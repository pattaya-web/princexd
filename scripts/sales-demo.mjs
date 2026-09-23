/**
 * Bac a sable du module commercial.
 *
 * Remplit le CRM d'une equipe et d'un historique credibles pour pouvoir
 * cliquer partout — dashboard, classements, commissions, relances — et se
 * connecter en tant que setter ou closer, avant de mettre quoi que ce soit en
 * production.
 *
 * Tout ce que ce script cree porte un identifiant prefixe `demo-`. La purge ne
 * supprime QUE ces lignes : elle ne peut pas toucher a une vraie donnee, meme
 * si elle est lancee sur une base deja remplie. C'est la seule garantie qui
 * rende ce script utilisable sans crainte sur ta base reelle.
 *
 *   node scripts/sales-demo.mjs seed     remplit le bac a sable
 *   node scripts/sales-demo.mjs status   dit ce qui est en place
 *   node scripts/sales-demo.mjs purge    efface tout ce qui est `demo-`
 */

import fs from "node:fs";
import path from "node:path";

const DB_PATH = path.join(process.cwd(), "data", "db.json");
const TAG = "demo-";

/* ------------------------------ Utilitaires ------------------------------ */

function readDB() {
  if (!fs.existsSync(DB_PATH)) {
    console.error("data/db.json introuvable. Lance le tool une fois avant.");
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}

function writeDB(db) {
  // Meme ecriture atomique que le tool : un fichier temporaire puis un rename,
  // pour ne jamais laisser un db.json tronque derriere soi.
  const tmp = `${DB_PATH}.demo.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), "utf8");
  fs.renameSync(tmp, DB_PATH);
}

/** Collections que le module utilise. Absentes d'une vieille base : on cree. */
const COLLECTIONS = [
  "team",
  "leads",
  "appointments",
  "sales",
  "followUps",
  "commissionRules",
  "commissionPayments",
  "activityLogs",
  "students",
  "shifts",
];

const ensure = (db) => {
  for (const c of COLLECTIONS) if (!Array.isArray(db[c])) db[c] = [];
  return db;
};

/**
 * Ligne issue du bac a sable.
 *
 * Un eleve inscrit depuis une vente de demo porte un identifiant reel — il est
 * cree par le tool, pas par ce script. On le reconnait donc a la vente dont il
 * decoule, sans quoi il survivrait a la purge.
 */
const startsWithTag = (v) => typeof v === "string" && v.startsWith(TAG);

const isDemo = (row) =>
  startsWithTag(row?.id) ||
  startsWithTag(row?.saleId) ||
  // Rattache a un membre de demo : un rendez-vous saisi a la main pendant les
  // essais doit partir avec le bac a sable, sinon il reste attribue a un
  // setter qui n'existe plus et pollue tous les classements.
  startsWithTag(row?.setterId) ||
  startsWithTag(row?.closerId) ||
  startsWithTag(row?.memberId) ||
  startsWithTag(row?.appointmentId);

/** Date relative a aujourd'hui, en ISO. */
function daysAgo(days, hour = 15, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

const iso = () => new Date().toISOString();

/**
 * Numero francais plausible, derive du rang du scenario.
 *
 * Deterministe pour que deux `seed` successifs produisent la meme base : un
 * numero aleatoire rendrait impossible de comparer deux captures d'ecran.
 */
const phoneFor = (n) => `+336${String(10_000_000 + n * 137_911).slice(0, 8)}`;

/* -------------------------------- L'equipe -------------------------------- */

const TEAM = [
  {
    id: `${TAG}setter-alex`,
    name: "Alex (démo)",
    role: "setter",
    code: "DEMO-SETTER",
    rule: { type: "per-show", fixed: 30, pct: 0, basis: "cash", onlyQualified: false },
  },
  {
    id: `${TAG}setter-sarah`,
    name: "Sarah (démo)",
    role: "setter",
    code: "DEMO-SETTER-2",
    rule: { type: "pct-cash", fixed: 0, pct: 5, basis: "cash", onlyQualified: false },
  },
  {
    id: `${TAG}closer-david`,
    name: "David (démo)",
    role: "closer",
    code: "DEMO-CLOSER",
    rule: { type: "pct-cash", fixed: 0, pct: 10, basis: "cash", onlyQualified: false },
  },
  {
    id: `${TAG}closer-lucas`,
    name: "Lucas (démo)",
    role: "closer",
    code: "DEMO-CLOSER-2",
    rule: { type: "fixed-plus-pct", fixed: 100, pct: 8, basis: "cash", onlyQualified: false },
  },
];

/*
 * Scenarios de rendez-vous.
 *
 * Volontairement varies : sans no-show, sans perte et sans relance, tous les
 * taux affichent 100 % et on ne voit rien de ce que le tool sait faire.
 *
 *   d       jours dans le passe (negatif = a venir)
 *   status  issue du rendez-vous
 *   deal    [valeur de contrat, cash encaisse] pour les ventes
 */
const SCENARIOS = [
  { d: 28, ig: "marclefebvre", name: "Marc Lefebvre", setter: 0, closer: 0, status: "closed-won", deal: [5000, 5000], offer: "Coaching 1:1 e-commerce", src: "instagram-dm" },
  { d: 26, ig: "juliadesign", name: "Julia Moreau", setter: 0, closer: 0, status: "no-show", src: "instagram-story" },
  { d: 25, ig: "thomas_shop", name: "Thomas Bernard", setter: 1, closer: 1, status: "closed-won", deal: [3000, 1000], offer: "Accompagnement 3 mois", src: "instagram-reel", pay: "installments", inst: 3 },
  { d: 22, ig: "leaboutique", name: "Léa Girard", setter: 0, closer: 0, status: "closed-lost", lost: "too-expensive", src: "instagram-dm" },
  { d: 21, ig: "kevindrop", name: "Kévin Roux", setter: 1, closer: 0, status: "closed-won", deal: [8000, 4000], offer: "Programme Scale", src: "referral", pay: "installments", inst: 2 },
  { d: 19, ig: "amelie.store", name: "Amélie Petit", setter: 0, closer: 1, status: "closed-lost", lost: "need-partner-approval", src: "instagram-dm" },
  { d: 18, ig: "nicolas_ecom", name: "Nicolas Fabre", setter: 1, closer: 1, status: "no-show", src: "outbound" },
  { d: 15, ig: "sophieshopify", name: "Sophie Blanc", setter: 0, closer: 0, status: "closed-won", deal: [5000, 3000], offer: "Coaching 1:1 e-commerce", src: "instagram-dm", pay: "deposit" },
  { d: 14, ig: "maxime.brand", name: "Maxime Colin", setter: 1, closer: 0, status: "follow-up", fu: -2, fuNote: "Doit valider le budget avec son associé", src: "instagram-reel" },
  { d: 12, ig: "clara_market", name: "Clara Dumas", setter: 0, closer: 1, status: "closed-lost", lost: "not-qualified", src: "inbound" },
  { d: 11, ig: "hugo.dropship", name: "Hugo Faure", setter: 1, closer: 1, status: "closed-won", deal: [3000, 3000], offer: "Accompagnement 3 mois", src: "instagram-dm" },
  { d: 9, ig: "eloise.shop", name: "Éloïse Marchand", setter: 0, closer: 0, status: "completed", src: "instagram-story" },
  { d: 8, ig: "romain_ecom", name: "Romain Leroy", setter: 0, closer: 0, status: "closed-won", deal: [12000, 6000], offer: "Programme Scale", src: "referral", pay: "installments", inst: 4 },
  { d: 7, ig: "ines.boutique", name: "Inès Rousseau", setter: 1, closer: 1, status: "no-show", src: "outbound" },
  { d: 6, ig: "antoine.store", name: "Antoine Mercier", setter: 1, closer: 1, status: "follow-up", fu: 1, fuNote: "Rappeler après sa clôture mensuelle", src: "instagram-dm" },
  { d: 5, ig: "manon_shop", name: "Manon Chevalier", setter: 0, closer: 0, status: "closed-won", deal: [5000, 2500], offer: "Coaching 1:1 e-commerce", src: "instagram-dm", pay: "installments", inst: 2 },
  { d: 4, ig: "lucas.brand", name: "Lucas Perrin", setter: 1, closer: 0, status: "closed-lost", lost: "timing", src: "instagram-reel" },
  { d: 3, ig: "camille.ecom", name: "Camille Noël", setter: 0, closer: 1, status: "completed", src: "instagram-dm" },
  { d: 2, ig: "yanis_store", name: "Yanis Benali", setter: 1, closer: 1, status: "follow-up", fu: 0, fuNote: "Très chaud, veut démarrer lundi", src: "instagram-dm" },
  { d: 1, ig: "sarah.boutique", name: "Sarah Lemoine", setter: 0, closer: 0, status: "confirmed", src: "instagram-story" },
  // Les rendez-vous a venir : c'est ce qu'un setter et un closer regardent en
  // premier le matin.
  { d: -1, ig: "paul.dropship", name: "Paul Girardot", setter: 0, closer: 0, status: "confirmed", src: "instagram-dm" },
  { d: -2, ig: "nadia_shop", name: "Nadia Cherif", setter: 1, closer: 1, status: "booked", src: "instagram-reel" },
  { d: -3, ig: "victor.store", name: "Victor Aubert", setter: 0, closer: 1, status: "booked", src: "inbound" },
  { d: -5, ig: "laura.ecom", name: "Laura Vidal", setter: 1, closer: 0, status: "booked", src: "instagram-dm" },
];

const NOTES = [
  "Boutique lancée il y a 6 mois, plafonne à 3k/mois. Veut passer à 10k.",
  "Jamais lancé. Budget confirmé en DM, motivé, dispo tout de suite.",
  "Fait 15k/mois en dropshipping, veut construire une vraie marque.",
  "Hésite entre nous et une formation à 500€. À rassurer sur l'accompagnement.",
  "A déjà investi 2k dans une formation qui n'a rien donné. Méfiant.",
  "Recommandé par un élève. Très chaud, connaît déjà les résultats.",
];

/* --------------------------------- Seed ---------------------------------- */

function seed() {
  const db = ensure(readDB());

  if (db.team.some(isDemo)) {
    console.log("Un jeu de démo est déjà en place. Lance d'abord :  node scripts/sales-demo.mjs purge");
    process.exit(1);
  }

  const currency = db.settings?.salesCurrency || "USD";
  const setters = TEAM.filter((m) => m.role === "setter");
  const closers = TEAM.filter((m) => m.role === "closer");

  /* --- Comptes et regles de commission --- */
  for (const m of TEAM) {
    db.team.unshift({
      id: m.id,
      name: m.name,
      role: m.role,
      status: "actif",
      commissionPct: 0,
      target: 0,
      contact: "",
      notes: "Compte de démonstration.",
      createdAt: daysAgo(60),
      email: "",
      accessCode: m.code,
      joinedAt: daysAgo(60).slice(0, 10),
      timezone: "Europe/Paris",
    });
    db.commissionRules.unshift({
      id: `${TAG}rule-${m.id}`,
      memberId: m.id,
      role: m.role,
      ...m.rule,
      currency,
      // Anterieure a tout l'historique, sinon aucune commission ne se
      // declencherait sur les rendez-vous les plus anciens.
      effectiveFrom: daysAgo(90).slice(0, 10),
      active: true,
      notes: "Règle de démonstration.",
      createdAt: daysAgo(60),
    });
  }

  /* --- Leads, rendez-vous, ventes, relances --- */
  let n = 0;
  for (const s of SCENARIOS) {
    n += 1;
    const setter = setters[s.setter];
    const closer = closers[s.closer];
    const at = daysAgo(s.d, 10 + (n % 8), (n % 4) * 15);
    const leadId = `${TAG}lead-${n}`;
    const apptId = `${TAG}appt-${n}`;

    db.leads.unshift({
      id: leadId,
      name: s.name,
      handle: `@${s.ig}`,
      source: "dm",
      stage:
        s.status === "closed-won" ? "closed-won" : s.status === "closed-lost" ? "closed-lost" : "call-book",
      dealValue: s.deal ? s.deal[0] : 0,
      callAt: at,
      ownerRole: "setter",
      ownerName: setter.name,
      painPoint: "",
      nextAction: "",
      nextActionAt: "",
      notes: "",
      createdAt: daysAgo(s.d + 2),
      igUsername: s.ig,
      email: `${s.ig}@example.com`,
      phone: phoneFor(n),
      country: "France",
      timezone: "Europe/Paris",
      setterId: setter.id,
      closerId: closer.id,
    });

    // L'historique rejoue la vie du rendez-vous : cree, puis tranche. C'est ce
    // qui rend la fiche credible quand on l'ouvre.
    const history = [
      { at: daysAgo(s.d + 2), actorId: setter.id, actorName: setter.name, from: "", to: "booked", note: "Rendez-vous créé" },
    ];
    if (s.status !== "booked") {
      history.push({
        at,
        actorId: closer.id,
        actorName: closer.name,
        from: "booked",
        to: s.status,
        note: "",
      });
    }

    db.appointments.unshift({
      id: apptId,
      leadId,
      setterId: setter.id,
      closerId: closer.id,
      scheduledAt: at,
      timezone: "Europe/Paris",
      source: s.src,
      status: s.status,
      qualified: n % 3 !== 0,
      setterNotes: NOTES[n % NOTES.length],
      closerNotes: s.status === "closed-lost" ? "Pas le bon moment, à recontacter dans 3 mois." : "",
      lostReason: s.lost ?? "",
      iclosedUrl: "",
      iclosedEventId: "",
      rescheduledFromId: "",
      completedAt: ["closed-won", "closed-lost", "completed", "follow-up"].includes(s.status) ? at : "",
      history,
      createdBy: setter.id,
      createdAt: daysAgo(s.d + 2),
      updatedAt: at,
    });

    if (s.deal) {
      db.sales.unshift({
        id: `${TAG}sale-${n}`,
        leadId,
        appointmentId: apptId,
        // Attribution figee, copiee du rendez-vous : c'est tout l'interet.
        setterId: setter.id,
        closerId: closer.id,
        offer: s.offer,
        contractValue: s.deal[0],
        cashCollected: s.deal[1],
        currency,
        paymentType: s.pay ?? "paid-in-full",
        installments: s.inst ?? 0,
        paymentMethod: "Stripe",
        soldAt: at,
        status: "active",
        refundAmount: 0,
        refundedAt: "",
        notes: "",
        createdBy: closer.id,
        createdAt: at,
        updatedAt: at,
      });
    }

    if (s.fu !== undefined) {
      db.followUps.unshift({
        id: `${TAG}fu-${n}`,
        leadId,
        appointmentId: apptId,
        closerId: closer.id,
        dueAt: daysAgo(s.fu, 11, 0),
        notes: s.fuNote ?? "",
        status: "pending",
        createdBy: closer.id,
        createdAt: at,
        completedAt: "",
      });
    }
  }

  /* --- Un versement deja effectue, pour que le solde du ne parte pas de zero --- */
  db.commissionPayments.unshift({
    id: `${TAG}pay-1`,
    memberId: `${TAG}closer-david`,
    amount: 500,
    currency,
    paidAt: daysAgo(10),
    method: "Virement",
    notes: "Acompte sur commissions de démonstration",
    periodFrom: "",
    periodTo: "",
    createdBy: "",
    createdAt: daysAgo(10),
  });

  db.activityLogs.unshift({
    id: `${TAG}log-1`,
    at: iso(),
    actorId: "",
    actorName: "Moi",
    action: "demo.seed",
    entity: "member",
    entityId: `${TAG}seed`,
    summary: "Jeu de démonstration installé",
  });

  writeDB(db);

  console.log("Jeu de démonstration installé.\n");
  console.log(`  ${TEAM.length} comptes · ${SCENARIOS.length} rendez-vous · ${SCENARIOS.filter((s) => s.deal).length} ventes\n`);
  console.log("  Codes de connexion sur /login :");
  for (const m of TEAM) console.log(`    ${m.code.padEnd(15)} ${m.name} (${m.role})`);
  console.log("\n  Pour tout effacer :  node scripts/sales-demo.mjs purge");
}

/* --------------------------------- Purge ---------------------------------- */

function purge() {
  const db = ensure(readDB());
  let removed = 0;

  for (const c of COLLECTIONS) {
    const before = db[c].length;
    db[c] = db[c].filter((row) => !isDemo(row));
    removed += before - db[c].length;
  }

  writeDB(db);
  console.log(`${removed} enregistrement(s) de démonstration supprimé(s). Rien d'autre n'a été touché.`);
}

/* -------------------------------- Status ---------------------------------- */

function status() {
  const db = ensure(readDB());
  console.log("Contenu de la base :\n");
  console.log("  collection            démo     réel");
  for (const c of COLLECTIONS) {
    const demo = db[c].filter(isDemo).length;
    console.log(`  ${c.padEnd(20)} ${String(demo).padStart(5)}  ${String(db[c].length - demo).padStart(7)}`);
  }
  if (db.team.some(isDemo)) {
    console.log("\n  Codes de connexion :");
    for (const m of TEAM) console.log(`    ${m.code.padEnd(15)} ${m.name}`);
  }
}

/* --------------------------------- Entrée --------------------------------- */

const cmd = process.argv[2];
if (cmd === "seed") seed();
else if (cmd === "purge") purge();
else if (cmd === "status") status();
else {
  console.log("Usage :");
  console.log("  node scripts/sales-demo.mjs seed     remplit le bac à sable");
  console.log("  node scripts/sales-demo.mjs status   dit ce qui est en place");
  console.log("  node scripts/sales-demo.mjs purge    efface tout ce qui est de démo");
}
