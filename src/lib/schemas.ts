import type { CollectionName } from "./types";

export type FieldKind =
  | "text"
  | "textarea"
  | "select"
  | "number"
  | "money"
  | "date"
  | "datetime"
  | "bool"
  | "url"
  | "pct";

export interface FieldSpec {
  key: string;
  label: string;
  kind: FieldKind;
  options?: string[];
  /** Masqué dans le tableau, visible dans le formulaire. */
  formOnly?: boolean;
  placeholder?: string;
  default?: unknown;
}

export interface EntitySpec {
  collection: CollectionName;
  singular: string;
  plural: string;
  /** Champ affiché comme titre de la ligne. */
  titleKey: string;
  /** Champ énuméré servant de colonnes de kanban, si pertinent. */
  boardKey?: string;
  fields: FieldSpec[];
  /** Tri par défaut : clé + sens. */
  sort?: { key: string; dir: "asc" | "desc" };
}

const f = (key: string, label: string, kind: FieldKind, extra: Partial<FieldSpec> = {}): FieldSpec => ({
  key,
  label,
  kind,
  ...extra,
});

export const LEADS: EntitySpec = {
  collection: "leads",
  singular: "Lead",
  plural: "Leads",
  titleKey: "name",
  boardKey: "stage",
  sort: { key: "createdAt", dir: "desc" },
  fields: [
    f("name", "Nom", "text"),
    f("handle", "@ Instagram", "text", { placeholder: "@pseudo" }),
    f("stage", "Étape", "select", {
      options: ["nouveau", "contacte", "conversation", "call-book", "call-fait", "closed-won", "closed-lost"],
      default: "nouveau",
    }),
    f("source", "Source", "select", {
      options: ["reel", "story", "dm", "bio-link", "referral", "ads", "autre"],
      default: "reel",
    }),
    f("dealValue", "Valeur (€)", "money", { default: 0 }),
    f("callAt", "Call prévu", "datetime"),
    f("ownerRole", "Traité par", "select", { options: ["moi", "setter", "closer"], default: "moi" }),
    f("ownerName", "Nom du responsable", "text", { formOnly: true }),
    f("painPoint", "Problème principal", "text", { formOnly: true }),
    f("nextAction", "Prochaine action", "text"),
    f("nextActionAt", "Quand", "date"),
    f("notes", "Notes", "textarea", { formOnly: true }),
  ],
};

export const STUDENTS: EntitySpec = {
  collection: "students",
  singular: "Élève",
  plural: "Élèves",
  titleKey: "name",
  boardKey: "status",
  sort: { key: "createdAt", dir: "desc" },
  fields: [
    f("name", "Nom", "text"),
    f("handle", "@ Instagram", "text"),
    f("phone", "Téléphone", "text", { placeholder: "+33 6 12 34 56 78" }),
    // Recopie depuis le lead a l'inscription : sans champ, la donnee existait
    // en base sans jamais etre lisible ni corrigeable.
    f("email", "Email", "text", { formOnly: true }),
    f("program", "Programme", "text", { placeholder: "Accompagnement 3 mois" }),
    f("status", "Statut", "select", { options: ["onboarding", "actif", "pause", "termine"], default: "onboarding" }),
    f("progress", "Avancement", "pct", { default: 0 }),
    f("price", "Prix (€)", "money", { default: 0 }),
    f("paid", "Encaissé (€)", "money", { default: 0 }),
    f("startedAt", "Début", "date"),
    f("nextSessionAt", "Prochaine session", "datetime"),
    f("objective", "Objectif", "text", { formOnly: true }),
    f("result", "Résultat obtenu", "textarea", {
      formOnly: true,
      placeholder: "Le matériau de tes contenus preuve : chiffres, avant/après…",
    }),
    f("notes", "Notes", "textarea", { formOnly: true }),
  ],
};

export const CALLS: EntitySpec = {
  collection: "calls",
  singular: "Call",
  plural: "Calls",
  titleKey: "title",
  boardKey: "status",
  sort: { key: "at", dir: "desc" },
  fields: [
    f("title", "Titre", "text"),
    f("contact", "Contact", "text"),
    f("at", "Date et heure", "datetime"),
    f("durationMin", "Durée (min)", "number", { default: 45 }),
    f("status", "Statut", "select", { options: ["book", "show", "no-show", "closed", "perdu"], default: "book" }),
    f("value", "Montant closé (€)", "money", { default: 0 }),
    f("source", "Source", "select", { options: ["iclosed", "manuel"], default: "manuel" }),
    f("url", "Lien", "url", { formOnly: true }),
    f("outcome", "Issue / notes", "textarea", { formOnly: true }),
  ],
};

export const RESOURCES: EntitySpec = {
  collection: "resources",
  singular: "Ressource",
  plural: "Ressources",
  titleKey: "title",
  boardKey: "type",
  sort: { key: "createdAt", dir: "desc" },
  fields: [
    f("title", "Titre", "text"),
    f("type", "Type", "select", {
      options: ["doc", "video", "template", "outil", "swipe", "formation"],
      default: "doc",
    }),
    f("url", "Lien", "url"),
    f("tags", "Tags", "text", { placeholder: "shopify, ads, closing" }),
    f("notes", "Notes", "textarea", { formOnly: true }),
  ],
};

export const TODOS: EntitySpec = {
  collection: "todos",
  singular: "Tâche",
  plural: "To-do",
  titleKey: "text",
  boardKey: "priority",
  sort: { key: "createdAt", dir: "desc" },
  fields: [
    f("text", "Tâche", "text"),
    f("done", "Fait", "bool", { default: false }),
    f("priority", "Priorité", "select", { options: ["P1", "P2", "P3"], default: "P2" }),
    f("project", "Projet", "select", {
      options: ["contenu", "crm", "eleves", "ads", "produit", "perso"],
      default: "contenu",
    }),
    f("due", "Échéance", "date"),
  ],
};

export const ADS: EntitySpec = {
  collection: "ads",
  singular: "Campagne",
  plural: "Meta Ads",
  titleKey: "name",
  boardKey: "status",
  sort: { key: "createdAt", dir: "desc" },
  fields: [
    f("name", "Campagne", "text"),
    f("status", "Statut", "select", { options: ["brouillon", "actif", "pause", "stoppe"], default: "brouillon" }),
    f("objective", "Objectif", "select", {
      options: ["leads", "trafic", "messages", "conversions", "notoriete"],
      default: "leads",
    }),
    f("angle", "Angle", "text", { placeholder: "Preuve chiffrée / peur de rater / avant-après" }),
    f("creativeRef", "Créa utilisée", "text", { formOnly: true }),
    f("budgetDaily", "Budget / jour (€)", "money", { default: 0 }),
    f("spend", "Dépensé (€)", "money", { default: 0 }),
    f("impressions", "Impressions", "number", { default: 0 }),
    f("clicks", "Clics", "number", { default: 0 }),
    f("leads", "Leads", "number", { default: 0 }),
    f("calls", "Calls", "number", { default: 0 }),
    f("sales", "Ventes", "number", { default: 0 }),
    f("revenue", "CA (€)", "money", { default: 0 }),
    f("startedAt", "Lancée le", "date"),
    f("notes", "Notes", "textarea", { formOnly: true }),
  ],
};

export const TEAM: EntitySpec = {
  collection: "team",
  singular: "Membre",
  plural: "Équipe",
  titleKey: "name",
  boardKey: "role",
  sort: { key: "createdAt", dir: "desc" },
  fields: [
    f("name", "Nom", "text"),
    f("role", "Rôle", "select", {
      options: ["setter", "closer", "admin", "monteur", "assistant"],
      default: "setter",
    }),
    f("status", "Statut", "select", { options: ["essai", "actif", "inactif"], default: "essai" }),
    f("commissionPct", "Commission", "pct", { default: 10 }),
    f("target", "Objectif mensuel (€)", "money", { default: 0 }),
    f("contact", "Contact", "text", { formOnly: true }),
    f("notes", "Notes", "textarea", { formOnly: true }),
  ],
};

export const FOLLOWERS: EntitySpec = {
  collection: "followers",
  singular: "Relevé",
  plural: "Relevés",
  titleKey: "date",
  sort: { key: "date", dir: "desc" },
  fields: [
    f("date", "Date", "date"),
    f("followers", "Abonnés", "number", { default: 0 }),
    f("reach", "Comptes touchés", "number", { default: 0 }),
    f("profileVisits", "Visites de profil", "number", { default: 0 }),
    f("linkClicks", "Clics sur le lien", "number", { default: 0 }),
    f("accountsEngaged", "Comptes engagés", "number", { default: 0 }),
    f("notes", "Notes", "text", { formOnly: true }),
  ],
};

export const POSTS: EntitySpec = {
  collection: "posts",
  singular: "Post",
  plural: "Contenus",
  titleKey: "title",
  boardKey: "status",
  sort: { key: "createdAt", dir: "desc" },
  fields: [
    f("title", "Titre", "text", { placeholder: "De quoi parle ce contenu" }),
    f("status", "Statut", "select", {
      options: ["idee", "script", "tournage", "montage", "programme", "publie"],
      default: "idee",
    }),
    f("format", "Format", "select", {
      options: [
        "reel-face-cam",
        "reel-voiceover",
        "reel-broll",
        "reel-screen-record",
        "carrousel",
        "post-image",
        "story-serie",
        "live",
      ],
      default: "reel-face-cam",
    }),
    f("angle", "Angle", "select", {
      options: ["value", "proof", "lifestyle", "daily-life", "story-perso", "opinion", "tuto", "cta-offre"],
      default: "value",
    }),
    f("plannedAt", "Prévu le", "datetime"),
    f("publishedAt", "Publié le", "datetime"),
    f("views", "Vues", "number", { default: 0 }),
    f("followersGained", "Abonnés gagnés", "number", { default: 0 }),
    f("callsBooked", "Calls générés", "number", { default: 0 }),
    // Le reste alimente les scores d'Insights sans encombrer le tableau.
    f("hook", "Hook (3 premières secondes)", "textarea", { formOnly: true }),
    f("script", "Script", "textarea", { formOnly: true }),
    f("cta", "CTA", "text", { formOnly: true }),
    f("url", "Lien du post publié", "url", { formOnly: true }),
    f("likes", "Likes", "number", { formOnly: true, default: 0 }),
    f("comments", "Commentaires", "number", { formOnly: true, default: 0 }),
    f("saves", "Enregistrements", "number", { formOnly: true, default: 0 }),
    f("shares", "Partages", "number", { formOnly: true, default: 0 }),
    f("profileVisits", "Visites de profil", "number", { formOnly: true, default: 0 }),
    f("linkClicks", "Clics sur le lien", "number", { formOnly: true, default: 0 }),
    f("notes", "Notes", "textarea", { formOnly: true }),
  ],
};

export const SPECS: Record<string, EntitySpec> = {
  posts: POSTS,
  leads: LEADS,
  students: STUDENTS,
  calls: CALLS,
  resources: RESOURCES,
  todos: TODOS,
  ads: ADS,
  team: TEAM,
  followers: FOLLOWERS,
};

/** Valeurs initiales d'un nouvel enregistrement, dérivées du schéma. */
export function blankRecord(spec: EntitySpec): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const field of spec.fields) {
    if (field.default !== undefined) row[field.key] = field.default;
    else if (field.kind === "number" || field.kind === "money" || field.kind === "pct") row[field.key] = 0;
    else if (field.kind === "bool") row[field.key] = false;
    else row[field.key] = "";
  }
  return row;
}
