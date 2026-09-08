// Modèle de données du tool. Une seule source de vérité, persistée dans data/db.json.

export type ID = string;

export interface Settings {
  /** Clé API KIE. Priorité à process.env.KIE_API_KEY si définie. */
  kieApiKey: string;
  /** Modèle texte KIE utilisé pour la traduction / l'analyse de scripts. */
  kieTextModel: string;
  /** Prix d'un crédit KIE en USD (kie.ai facture ~0,005 $/crédit). */
  creditUsdRate: number;
  /** Taux EUR pour l'affichage secondaire. */
  usdToEur: number;
  /** Objectif abonnés Instagram. */
  followersGoal: number;
  followersStart: number;
  igHandle: string;
  /** Fuseaux affichés dans la barre du haut. */
  timezones: { label: string; tz: string }[];
  /** Clé API publique iClosed (préfixe iclosed_). Priorité à ICLOSED_API_KEY. */
  iclosedApiKey: string;
  /** Flux .ics iClosed — repli si l'API n'est pas utilisée. */
  iclosedIcsUrl: string;
  /** Contexte business injecté dans tous les prompts IA. */
  brandContext: string;
  /** Rotation des types de story par jour (0 = dimanche). */
  storyPlan: Record<string, string[]>;
  /** Code d'accès du monteur : lui ouvre /monteur et rien d'autre. */
  editorAccessCode: string;
  editorName: string;
}

export type ContentFormat =
  | "reel-face-cam"
  | "reel-voiceover"
  | "reel-broll"
  | "reel-screen-record"
  | "carrousel"
  | "post-image"
  | "story-serie"
  | "live";

export type ContentAngle =
  | "value"
  | "proof"
  | "lifestyle"
  | "daily-life"
  | "story-perso"
  | "opinion"
  | "tuto"
  | "cta-offre";

export type PostStatus = "idee" | "script" | "tournage" | "montage" | "programme" | "publie";

export interface Post {
  id: ID;
  title: string;
  format: ContentFormat;
  angle: ContentAngle;
  status: PostStatus;
  hook: string;
  script: string;
  cta: string;
  plannedAt: string;   // ISO
  publishedAt: string; // ISO
  url: string;
  swipeId: ID | "";
  // Stats saisies après publication
  views: number;
  likes: number;
  comments: number;
  saves: number;
  shares: number;
  followersGained: number;
  profileVisits: number;
  linkClicks: number;
  callsBooked: number;
  notes: string;
  createdAt: string;
}

export type StoryType =
  | "value"
  | "lifestyle"
  | "daily-life"
  | "proof-shopify"
  | "coulisses"
  | "engagement"
  | "cta-call"
  | "temoignage";

export interface Story {
  id: ID;
  date: string;      // YYYY-MM-DD
  slot: "matin" | "midi" | "aprem" | "soir";
  type: StoryType;
  idea: string;
  script: string;
  done: boolean;
  views: number;
  replies: number;
  stickerTaps: number;
  linkClicks: number;
  callsBooked: number;
  createdAt: string;
}

export interface FollowerPoint {
  id: ID;
  date: string; // YYYY-MM-DD
  followers: number;
  reach: number;
  profileVisits: number;
  linkClicks: number;
  accountsEngaged: number;
  notes: string;
}

export type LeadStage =
  | "nouveau"
  | "contacte"
  | "conversation"
  | "call-book"
  | "call-fait"
  | "closed-won"
  | "closed-lost";

export interface Lead {
  id: ID;
  name: string;
  handle: string;
  source: string;          // reel, story, dm, bio-link, referral, ads
  stage: LeadStage;
  dealValue: number;
  callAt: string;          // ISO
  ownerRole: "moi" | "setter" | "closer";
  ownerName: string;
  painPoint: string;
  nextAction: string;
  nextActionAt: string;
  notes: string;
  createdAt: string;
}

export interface Student {
  id: ID;
  name: string;
  handle: string;
  program: string;
  startedAt: string;
  price: number;
  paid: number;
  status: "onboarding" | "actif" | "pause" | "termine";
  progress: number;   // 0-100
  nextSessionAt: string;
  objective: string;
  result: string;     // résultat obtenu -> matière à contenu preuve
  notes: string;
  createdAt: string;
}

export interface CallEvent {
  id: ID;
  title: string;
  contact: string;
  at: string;          // ISO
  durationMin: number;
  status: "book" | "show" | "no-show" | "closed" | "perdu";
  source: "iclosed" | "manuel";
  outcome: string;
  value: number;
  url: string;
  createdAt: string;
}

export interface Resource {
  id: ID;
  title: string;
  url: string;
  type: "doc" | "video" | "template" | "outil" | "swipe" | "formation";
  tags: string;
  notes: string;
  createdAt: string;
}

export interface Todo {
  id: ID;
  text: string;
  done: boolean;
  priority: "P1" | "P2" | "P3";
  project: string;
  due: string;
  createdAt: string;
}

export interface AdCampaign {
  id: ID;
  name: string;
  objective: string;
  angle: string;
  creativeRef: string;
  status: "brouillon" | "actif" | "pause" | "stoppe";
  budgetDaily: number;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  calls: number;
  sales: number;
  revenue: number;
  startedAt: string;
  notes: string;
  createdAt: string;
}

export interface TeamMember {
  id: ID;
  name: string;
  role: "setter" | "closer" | "monteur" | "assistant";
  status: "actif" | "essai" | "inactif";
  commissionPct: number;
  target: number;
  contact: string;
  notes: string;
  createdAt: string;
}

/** Un fichier attaché à un job de montage (rush ou livrable). */
export interface MediaRef {
  name: string;
  url: string;       // /api/media/xxx si uploadé, sinon lien externe (Drive, WeTransfer…)
  size: number;
  kind: "rush" | "livrable";
  addedBy: "moi" | "monteur";
  addedAt: string;
}

export type EditStatus =
  | "rush-a-deposer"
  | "a-monter"
  | "en-cours"
  | "livre"
  | "retouches"
  | "poste";

/** Job de montage : je dépose les rushs + le brief, le monteur rend la vidéo montée. */
export interface EditJob {
  id: ID;
  title: string;
  status: EditStatus;
  /** Style de montage attendu. "rapide" = cuts serrés, rythme TikTok. */
  style: "rapide" | "cinematique" | "talking-head" | "carrousel-video" | "story";
  brief: string;
  /** Consignes précises : sous-titres, musique, format, durée cible. */
  subtitles: boolean;
  music: string;
  aspectRatio: "9:16" | "1:1" | "16:9";
  targetDurationSec: number;
  priority: "P1" | "P2" | "P3";
  dueAt: string;
  assignee: string;
  postId: ID | "";
  media: MediaRef[];
  /** Fil de discussion léger entre moi et le monteur. */
  comments: { author: string; text: string; at: string }[];
  deliveredAt: string;
  postedAt: string;
  createdAt: string;
}

/** Analyse structurée renvoyée par l'IA sur un contenu swipé. */
export interface SwipeAnalysis {
  language: string;
  transcriptOriginal: string;
  transcriptFr: string;
  hook: string;
  hookType: string;
  promise: string;
  body: string;
  proof: string;
  cta: string;
  timeline: { t: string; beat: string; shot: string }[];
  shotList: { plan: string; description: string; pourquoi: string }[];
  whyItWorks: string[];
  onScreenText: string[];
  adaptation: { hook: string; script: string; cta: string; caption: string; hashtags: string[] };
  altHooks: string[];
  imagePrompts: string[];
  videoPrompts: string[];
  formatRecommande: string;
  scoreViralite: number;
}

export interface Swipe {
  id: ID;
  url: string;
  platform: string;
  author: string;
  title: string;
  caption: string;
  thumbnail: string;
  transcriptInput: string;
  tags: string;
  analysis: SwipeAnalysis | null;
  status: "a-analyser" | "analyse" | "a-tourner" | "fait";
  createdAt: string;
}

export interface Generation {
  id: ID;
  taskId: string;
  model: string;
  kind: "image" | "video";
  prompt: string;
  input: Record<string, unknown>;
  state: "waiting" | "queuing" | "generating" | "success" | "fail";
  resultUrls: string[];
  creditsConsumed: number;
  failMsg: string;
  createdAt: string;
  updatedAt: string;
}

export interface DB {
  settings: Settings;
  posts: Post[];
  stories: Story[];
  followers: FollowerPoint[];
  leads: Lead[];
  students: Student[];
  calls: CallEvent[];
  resources: Resource[];
  todos: Todo[];
  ads: AdCampaign[];
  team: TeamMember[];
  swipes: Swipe[];
  generations: Generation[];
  edits: EditJob[];
}

export type CollectionName = Exclude<keyof DB, "settings">;
