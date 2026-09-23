import fs from "node:fs";
import path from "node:path";
import type { CollectionName, DB, Settings } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "db.json");

export const DEFAULT_SETTINGS: Settings = {
  kieApiKey: "",
  kieTextModel: "gemini-3-pro",
  creditUsdRate: 0.005,
  usdToEur: 0.92,
  followersGoal: 10000,
  followersStart: 9500,
  igHandle: "",
  igAccessToken: "",
  igUserId: "",
  igVerified: true,
  igChannelMembers: 0,
  igUnfollows: {},
  postFilterKeywords: "commente",
  openaiApiKey: "",
  transcribeModel: "gpt-4o-mini-transcribe",
  igProfile: null,
  timezones: [
    { label: "Paris", tz: "Europe/Paris" },
    { label: "New York", tz: "America/New_York" },
    { label: "Dubaï", tz: "Asia/Dubai" },
  ],
  iclosedApiKey: "",
  iclosedIcsUrl: "",
  brandContext:
    "Je vends du coaching e-commerce (Shopify). Ma cible : des gens qui veulent lancer ou scaler une boutique. " +
    "Mon contenu Instagram sert à générer des appels de vente. Ton : direct, concret, preuve par les chiffres, zéro bullshit.",
  storyPlan: {
    "1": ["value", "daily-life", "cta-call"],
    "2": ["proof-shopify", "lifestyle", "engagement"],
    "3": ["value", "coulisses", "cta-call"],
    "4": ["temoignage", "daily-life", "engagement"],
    "5": ["proof-shopify", "value", "cta-call"],
    "6": ["lifestyle", "daily-life", "engagement"],
    "0": ["coulisses", "value", "cta-call"],
  },
  weekPlan: {
    "1": { theme: "Dashboard Shopify + CTA call", objectif: "Preuve + prise de calls" },
    "2": { theme: "Lifestyle + résultat élève", objectif: "Personal brand + social proof" },
    "3": { theme: "Value e-commerce + dashboard", objectif: "Autorité / expertise" },
    "4": { theme: "Case study élève + CTA coaching", objectif: "Conversion" },
    "5": { theme: "Résultats de la semaine + lifestyle", objectif: "Crédibilité + aspiration" },
    "6": { theme: "Tips créa, Meta Ads, Shopify", objectif: "Éduquer + chauffer l'audience" },
    "0": { theme: "Story perso + bilan + CTA call", objectif: "Connexion + remplir les calls" },
  },
  dailyReelsGoal: 3,
  dailyChannelGoal: 6,
  weeklyPhotoGoal: 4,
  editorAccessCode: "",
  editorName: "Monteur",
  salesCurrency: "USD",
  salesAutoImport: false,
  salesDefaultSetterId: "",
  salesLastSyncAt: "",
};

const EMPTY_DB: DB = {
  settings: DEFAULT_SETTINGS,
  posts: [],
  stories: [],
  followers: [],
  leads: [],
  students: [],
  calls: [],
  resources: [],
  todos: [],
  ads: [],
  team: [],
  swipes: [],
  generations: [],
  edits: [],
  creators: [],
  creatorPosts: [],
  saved: [],
  redo: [],
  appointments: [],
  sales: [],
  followUps: [],
  commissionRules: [],
  commissionPayments: [],
  activityLogs: [],
  shifts: [],
};

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, JSON.stringify(EMPTY_DB, null, 2), "utf8");
}

/*
 * Cache memoire de la base.
 *
 * db.json pese plusieurs Mo : le relire et le re-parser a chaque requete
 * bloquait le serveur 20 a 40 ms par appel. Un tableau de bord qui charge
 * six collections, plus le sondage des generations toutes les 3 s, suffisait
 * a rendre l'interface saccadee. On garde donc la base parsee en memoire,
 * partagee entre tous les modules via globalThis (Next recharge les modules
 * a chaud en dev), et on ne relit le fichier que si quelqu'un d'autre l'a
 * modifie (mtime).
 *
 * Les ecritures sont regroupees : une rafale d'insertions ne produit qu'un
 * seul fichier, ecrit quelques millisecondes plus tard, et de maniere
 * atomique. Le cache est la source de verite entre deux ecritures.
 */
interface Cache {
  db: DB | null;
  mtimeMs: number;
  flush: ReturnType<typeof setTimeout> | null;
  dirty: boolean;
  hooked: boolean;
}
const g = globalThis as unknown as { __princexdDb?: Cache };
const cache: Cache = (g.__princexdDb ??= { db: null, mtimeMs: 0, flush: null, dirty: false, hooked: false });

function parseFile(): DB {
  let parsed: Partial<DB> = {};
  try {
    parsed = JSON.parse(fs.readFileSync(DB_PATH, "utf8")) as Partial<DB>;
  } catch {
    // Fichier corrompu : on repart d'une base vide plutôt que de crasher le tool.
    parsed = {};
  }
  // Merge avec la structure par défaut pour que l'ajout d'une collection
  // ne casse pas une base existante.
  return {
    ...EMPTY_DB,
    ...parsed,
    settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
  };
}

export function readDB(): DB {
  ensureFile();
  // Tant qu'une ecriture est en attente, la memoire fait foi : le fichier
  // est en retard sur elle, pas l'inverse.
  if (cache.db && cache.dirty) return cache.db;
  const mtimeMs = fs.statSync(DB_PATH).mtimeMs;
  if (!cache.db || mtimeMs !== cache.mtimeMs) {
    cache.db = parseFile();
    cache.mtimeMs = mtimeMs;
  }
  return cache.db;
}

function flushNow() {
  if (cache.flush) {
    clearTimeout(cache.flush);
    cache.flush = null;
  }
  if (!cache.dirty || !cache.db) return;
  ensureFile();
  // Écriture atomique : on passe par un fichier temporaire pour éviter
  // de laisser un db.json tronqué si le process meurt en plein write.
  const tmp = `${DB_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cache.db, null, 2), "utf8");
  fs.renameSync(tmp, DB_PATH);
  cache.dirty = false;
  cache.mtimeMs = fs.statSync(DB_PATH).mtimeMs;
}

export function writeDB(db: DB) {
  cache.db = db;
  cache.dirty = true;
  if (!cache.flush) cache.flush = setTimeout(flushNow, 40);
}

// Rien ne doit rester en memoire si le process s'arrete entre deux flushs.
if (!cache.hooked) {
  cache.hooked = true;
  process.on("exit", flushNow);
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      flushNow();
      process.exit(0);
    });
  }
}

export function getSettings(): Settings {
  return readDB().settings;
}

/** Clé effective : la variable d'env gagne sur celle saisie dans l'UI. */
export function getApiKey(): string {
  return process.env.KIE_API_KEY?.trim() || getSettings().kieApiKey.trim();
}

export function newId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function list<K extends CollectionName>(name: K): DB[K] {
  return readDB()[name];
}

export function insert<K extends CollectionName>(name: K, item: Record<string, unknown>) {
  const db = readDB();
  const row = { ...item, id: newId(), createdAt: new Date().toISOString() };
  (db[name] as unknown[]).unshift(row);
  writeDB(db);
  return row;
}

export function update<K extends CollectionName>(name: K, id: string, patch: Record<string, unknown>) {
  const db = readDB();
  const arr = db[name] as unknown as Record<string, unknown>[];
  const i = arr.findIndex((r) => r.id === id);
  if (i === -1) return null;
  arr[i] = { ...arr[i], ...patch, id };
  writeDB(db);
  return arr[i];
}

export function remove<K extends CollectionName>(name: K, id: string) {
  return removeMany(name, [id]);
}

/**
 * Suppression groupee, en une seule ecriture.
 *
 * Enchainer N suppressions unitaires relit et reecrit la base N fois : une
 * interruption au milieu laisse des enregistrements orphelins. C'est deja
 * arrive sur les createurs.
 */
export function removeMany<K extends CollectionName>(name: K, ids: string[]) {
  const doomed = new Set(ids);
  if (!doomed.size) return { ok: true, removed: 0 };

  const db = readDB();
  const arr = db[name] as unknown as Record<string, unknown>[];
  const next = arr.filter((r) => !doomed.has(String(r.id)));
  const removed = arr.length - next.length;
  (db[name] as unknown) = next;
  writeDB(db);
  return { ok: true, removed };
}

export function saveSettings(patch: Partial<Settings>) {
  const db = readDB();
  db.settings = { ...db.settings, ...patch };
  writeDB(db);
  return db.settings;
}
