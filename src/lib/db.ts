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
  editorAccessCode: "",
  editorName: "Monteur",
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
};

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, JSON.stringify(EMPTY_DB, null, 2), "utf8");
}

export function readDB(): DB {
  ensureFile();
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

export function writeDB(db: DB) {
  ensureFile();
  // Écriture atomique : on passe par un fichier temporaire pour éviter
  // de laisser un db.json tronqué si le process meurt en plein write.
  const tmp = `${DB_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), "utf8");
  fs.renameSync(tmp, DB_PATH);
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
  const db = readDB();
  const arr = db[name] as unknown as Record<string, unknown>[];
  const next = arr.filter((r) => r.id !== id);
  (db[name] as unknown) = next;
  writeDB(db);
  return { ok: true };
}

export function saveSettings(patch: Partial<Settings>) {
  const db = readDB();
  db.settings = { ...db.settings, ...patch };
  writeDB(db);
  return db.settings;
}
