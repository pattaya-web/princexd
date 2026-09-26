import type { StudioCharacter, StudioJob } from "./studio/types";
// Modèle de données du tool. Une seule source de vérité, persistée dans data/db.json.

export type ID = string;

/** Un jour de croissance : gagnes viennent de l'API, perdus sont derives. */
export interface IgDayPoint {
  date: string;   // YYYY-MM-DD
  gained: number; // follower_count renvoye par Meta
  lost: number;   // gained - variation reelle du total (0 si indeterminable)
  net: number;
  reach: number;
  /** false quand on n'a pas deux totaux consecutifs pour deduire les perdus. */
  known: boolean;
}

/** Instantane du profil Instagram, rafraichi automatiquement. */
export interface IgProfileSnapshot {
  username: string;
  name: string;
  profilePictureUrl: string;
  biography: string;
  website: string;
  followers: number;
  follows: number;
  mediaCount: number;
  reach: number;
  profileVisits: number;
  linkClicks: number;
  accountsEngaged: number;
  history: IgDayPoint[];
  fetchedAt: string;
}

/** Une tranche d'audience : cle (genre, tranche d'age, pays, ville) et effectif. */
export interface IgAudienceSlice {
  key: string;
  value: number;
}

/**
 * Repartition des abonnes du compte. Instagram ne la fournit qu'au niveau du
 * compte, jamais par publication.
 */
export interface IgAudience {
  gender: { f: number; m: number; u: number };
  age: IgAudienceSlice[];
  countries: IgAudienceSlice[];
  cities: IgAudienceSlice[];
  fetchedAt: string;
}

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
  /** Token Instagram Graph API. Priorité à IG_ACCESS_TOKEN. */
  igAccessToken: string;
  /** ID du compte Instagram business. Priorité à IG_USER_ID. */
  igUserId: string;
  /** Badge certifie : l'API Instagram n'expose pas is_verified, donc c'est un reglage. */
  igVerified: boolean;
  /** Membres du canal de diffusion : l'API Instagram ne l'expose pas, saisie manuelle. */
  igChannelMembers: number;
  /** Desabonnements reels par date (YYYY-MM-DD), accumules a chaque synchro. */
  igUnfollows: Record<string, number>;
  /** Mots-cles (separes par des virgules) qui identifient un post business. */
  postFilterKeywords: string;
  /** Cle OpenAI pour la transcription audio. Priorite a OPENAI_API_KEY. */
  openaiApiKey: string;
  /** Modele de transcription (gpt-4o-mini-transcribe, whisper-1...). */
  transcribeModel: string;
  /** Cle ElevenLabs pour la transformation de voix du Swap video. Priorite a ELEVENLABS_API_KEY. */
  elevenLabsApiKey?: string;
  /** Cles Higgsfield (Genjutsu). Priorite a HIGGSFIELD_API_KEY_ID / HIGGSFIELD_API_KEY_SECRET. */
  higgsfieldKeyId?: string;
  higgsfieldKeySecret?: string;
  /**
   * Solde Higgsfield saisi a la main (USD) et date de saisie : l'API Higgsfield
   * n'expose aucun solde, on deduit ensuite les rendus Genjutsu lances apres.
   */
  higgsfieldBalanceUsd?: number;
  higgsfieldBalanceAt?: string;
  /** Cache du profil, rempli par la synchro. */
  igProfile: IgProfileSnapshot | null;
  /** Cache de l'audience (24 h), rempli au premier detail de publication. */
  igAudience?: IgAudience | null;
  /** Cookies Instagram (format Netscape) pour yt-dlp : telechargement des reels depuis le serveur. */
  igCookies?: string;
  /** Diagnostic de mon propre compte. */
  myAnalysis?: ContentAnalysis;
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
  /** Plan editorial de la semaine : theme et objectif par jour (0 = dimanche). */
  weekPlan: Record<string, { theme: string; objectif: string }>;
  /** Nombre de reels a sortir par jour ; la barre se remplit toute seule. */
  dailyReelsGoal: number;
  /** Messages a poster chaque jour sur le canal de diffusion. */
  dailyChannelGoal: number;
  /** Publications photo ou carrousel a sortir chaque semaine. */
  weeklyPhotoGoal: number;
  /** Code d'accès du monteur : lui ouvre /monteur et rien d'autre. */
  editorAccessCode: string;
  editorName: string;
  /** Devise du module commercial (ISO 4217). Les offres sont vendues en dollars. */
  salesCurrency: string;
  /**
   * Synchronisation automatique des rendez-vous iClosed.
   *
   * Quand elle est active, ouvrir l'espace commercial va chercher les nouveaux
   * bookings sans rien cliquer. Elle exige un setter par defaut : iClosed ne
   * sait pas qui a chauffe le prospect, et un rendez-vous sans attribution
   * fausserait classements et commissions.
   */
  salesAutoImport: boolean;
  salesDefaultSetterId: string;
  /** Derniere synchro reussie, pour ne pas retaper l'API a chaque navigation. */
  salesLastSyncAt: string;
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

/** Plan de tournage reconstruit a partir d'une publication existante. */
export interface PostScript {
  hook: string;
  angle: string;
  duree: string;
  plans: { n: number; visuel: string; texteEcran: string; voix: string }[];
  cta: string;
  pourquoiCaMarche: string[];
  aRefaire: string[];
  /** true si l'utilisateur a fourni une vraie transcription. */
  fromTranscript: boolean;
  /** true si le modele a vu la premiere image du reel. */
  fromFrame: boolean;
  generatedAt: string;
}

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
  /** Miniature Instagram (URL CDN, expire : rafraichie a chaque synchro). */
  thumbnail?: string;
  /** Legende Instagram complete, utilisee pour filtrer les posts business. */
  caption?: string;
  /** Identifiant du media Instagram, requis pour redemander une URL video fraiche. */
  igMediaId?: string;
  /** Transcription reelle produite par OpenAI. */
  transcript?: string;
  /** Script reconstruit par l'IA, mis en cache pour ne pas repayer a chaque ouverture. */
  blueprint?: PostScript;
  /** Renseigne par la route en mode allege, quand `transcript` est retire. */
  hasTranscript?: boolean;
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
  /* Metriques d'interaction du jour. Meta ne les expose qu'en total_value,
     jamais en historique : elles ne se remplissent qu'a partir du 1er releve. */
  views?: number;
  interactions?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  /* Stories du jour : perdues definitivement si on ne releve pas dans les 24 h. */
  storyCount?: number;
  storyViews?: number;
  storyReach?: number;
  storyReplies?: number;
  storyNavigation?: number;
  storyProfileVisits?: number;
  /** Messages postes sur le canal de diffusion. Saisie manuelle : Meta n'expose
      aucune API pour les canaux (verifie). */
  channelPosts?: number;
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
  /* --- Module commercial. Optionnels : les leads deja en base restent valides. --- */
  /** @<pseudo> Instagram, sans l'arobase. Donnee d'identification principale. */
  igUsername?: string;
  email?: string;
  phone?: string;
  country?: string;
  /** Fuseau du prospect, pour caler le rendez-vous. */
  timezone?: string;
  /** Setter a l'origine du lead. Fige, jamais recalcule. */
  setterId?: ID;
  /** Dernier closer assigne. L'attribution des ventes vit sur la vente. */
  closerId?: ID;
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
  /* --- Rattachement a la vente d'origine. Optionnels : les eleves deja
         saisis a la main restent valides tels quels. --- */
  /**
   * Vente qui a produit cet eleve.
   *
   * C'est ce lien qui permet de remonter d'un eleve jusqu'au setter qui l'a
   * amene et au closer qui l'a signe, des mois plus tard. La vente reste la
   * source de verite pour l'argent ; `price` et `paid` n'en sont qu'une copie
   * au moment de l'inscription.
   */
  saleId?: ID;
  leadId?: ID;
  appointmentId?: ID;
  setterId?: ID;
  closerId?: ID;
  igUsername?: string;
  email?: string;
  phone?: string;
  currency?: string;
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
  role: "setter" | "closer" | "monteur" | "assistant" | "admin";
  status: "actif" | "essai" | "inactif";
  /** Ancien champ, conserve pour ne rien casser. Les vraies regles vivent
   *  desormais dans la collection `commissionRules`. */
  commissionPct: number;
  target: number;
  contact: string;
  notes: string;
  createdAt: string;
  /**
   * Roles commerciaux cumules : un membre peut etre setter ET closer. Absent
   * sur les fiches anciennes, ou `role` fait foi (voir lib/sales/roles.ts).
   */
  roles?: ("setter" | "closer")[];
  /* --- Compte de connexion. Optionnels : l'equipe existante reste valide. --- */
  email?: string;
  /** Identifiant de connexion, defini par l'admin. Unique, insensible a la casse. */
  username?: string;
  /** Mot de passe hache (scrypt, `sel:hash`). Jamais renvoye au navigateur. */
  passwordHash?: string;
  /** Ancien code personnel de connexion, conserve pour les comptes existants. */
  accessCode?: string;
  joinedAt?: string;
  timezone?: string;
  /** Derniere connexion, pour reperer un compte dormant. */
  lastSeenAt?: string;
  /**
   * Identifiant du compte iClosed correspondant.
   *
   * C'est le pont entre les deux outils : iClosed dit quel utilisateur a
   * heberge le call, cette correspondance dit lequel de mes closers c'est.
   * Vide tant que le closer n'existe pas dans iClosed.
   */
  iclosedUserId?: number;
}

/** Un fichier attaché à un job de montage (rush ou livrable). */
export interface MediaRef {
  name: string;
  url: string;       // /api/media/xxx si uploadé, sinon lien externe (Drive, WeTransfer…)
  size: number;
  /**
   * "reference" : la vidéo dont le monteur doit reproduire le montage.
   * C'est la consigne la plus utile qu'on puisse lui donner — bien plus
   * précise qu'un brief écrit.
   */
  kind: "rush" | "reference" | "livrable";
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
  /**
   * Lien de livraison déposé par le monteur (SwissTransfer, WeTransfer, Drive).
   * Les montages font plusieurs Go : ils ne remontent pas par le formulaire,
   * ils arrivent par lien.
   */
  deliveryUrl: string;
  /** Fil de discussion léger entre moi et le monteur. */
  comments: { author: string; text: string; at: string }[];
  deliveredAt: string;
  postedAt: string;
  createdAt: string;
}

/* ===================================================================== *
 *                          ADS & SCRIPTS (drive)                         *
 * ===================================================================== */

/**
 * Une pub de reference deposee dans un dossier : un mp4 enregistre (ou un
 * lien), sa transcription une fois extraite, et une note libre.
 */
export interface AdInspiration {
  name: string;
  url: string;          // /api/media/xxx si deposee, sinon lien externe
  size: number;
  addedAt: string;
  note: string;
  /** Texte dit dans la pub, extrait par transcription. Vide tant que non lancee. */
  transcript: string;
  transcribedAt: string;
  language: string;
}

export type AdScriptStatus = "a-tourner" | "tournee" | "en-ligne" | "archive";

export interface AdScriptPlan {
  n: number;
  visuel: string;
  texteEcran: string;
  voix: string;
}

/** Un script de pub a tourner, ecrit a la main ou sorti d'une inspiration. */
export interface AdScript {
  id: ID;
  title: string;
  status: AdScriptStatus;
  angle: string;
  hook: string;
  /** Variantes de hook a tester en A/B. */
  hooks: string[];
  duree: string;
  plans: AdScriptPlan[];
  cta: string;
  /** Texte complet a lire face camera : c'est le champ que j'edite au quotidien. */
  text: string;
  pourquoiCaMarche: string[];
  notes: string;
  /** URL de l'inspiration dont le script est sorti, sinon vide. */
  fromInspiration: string;
  createdAt: string;
  updatedAt: string;
}

/** Un dossier du drive Ads : ses inspirations (mp4) et ses scripts. */
export interface AdFolder {
  id: ID;
  title: string;
  description: string;
  inspirations: AdInspiration[];
  scripts: AdScript[];
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
  /** Avancement 0-100 quand KIE le publie ; 0 sinon. */
  progress: number;
  /** Duree reelle de generation en secondes, une fois la tache finie. */
  costTimeSec: number;
  createdAt: string;
  updatedAt: string;
}

/** Createur suivi en veille. Alimente par l'API Business Discovery de Meta. */
export interface Creator {
  id: ID;
  username: string;
  name: string;
  profilePicture: string;
  biography: string;
  followers: number;
  mediaCount: number;
  lastSync: string;
  createdAt: string;
  /** Rempli a la demande : l'analyse coute un appel IA. */
  analysis?: ContentAnalysis;
}

/** Publication d'un createur suivi. Meta ne donne ni le fichier video ni les vues. */
export interface CreatorPost {
  id: ID;
  creator: string;
  igMediaId: string;
  caption: string;
  permalink: string;
  thumbnail: string;
  mediaType: string;
  isReel: boolean;
  likes: number;
  comments: number;
  timestamp: string;
  createdAt: string;
}

export type ProdFolder = "value" | "lifestyle" | "clipping" | "facecam" | "eleve";

/** Reference sauvegardee pour la production : la mienne ou celle d'un createur suivi. */
export interface SavedItem {
  id: ID;
  source: "creator" | "mine";
  author: string;
  permalink: string;
  thumbnail: string;
  caption: string;
  likes: number;
  comments: number;
  views: number;
  isReel: boolean;
  folder: ProdFolder;
  note: string;
  createdAt: string;
  /** Post interne d'origine, present seulement pour mes propres publications. */
  postId?: string;
  /** Renseigne par la route en mode allege, quand `transcript` est retire. */
  hasTranscript?: boolean;
  /** Script de la video, transcrit ou depose a la main. */
  transcript?: string;
  /** Coche quand la video a servi : la reference sort de la file. */
  done?: boolean;
}

/** Diagnostic IA d'un compte : de quoi parle-t-il vraiment. */
export interface ContentAnalysis {
  resume: string;
  types: { nom: string; part: number; exemple: string }[];
  hooks: string[];
  cta: string[];
  aRetenir: string[];
  posts: number;
  generatedAt: string;
}

/** Reel repere en scrollant, a refaire a ma sauce. */
export interface RedoItem {
  id: ID;
  url: string;
  author: string;
  thumbnail: string;
  caption: string;
  likes: number;
  comments: number;
  transcript?: string;
  note: string;
  done: boolean;
  createdAt: string;
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
  creators: Creator[];
  creatorPosts: CreatorPost[];
  saved: SavedItem[];
  redo: RedoItem[];
  adFolders: AdFolder[];
  /* --- Studio : swap video --- */
  studioJobs: StudioJob[];
  studioCharacters: StudioCharacter[];
  /* --- Module commercial Setter / Closer --- */
  appointments: Appointment[];
  sales: Sale[];
  followUps: FollowUp[];
  commissionRules: CommissionRule[];
  commissionPayments: CommissionPayment[];
  activityLogs: ActivityLog[];
  shifts: Shift[];
}

export type CollectionName = Exclude<keyof DB, "settings">;

/* ===================================================================== *
 *                      MODULE COMMERCIAL — Setter / Closer              *
 * ===================================================================== *
 *
 * Ajoute la gestion d'une equipe de vente au CRM existant, sans dupliquer
 * ce qui est deja la : un Appointment pointe vers un `Lead` de la collection
 * `leads`, et un membre d'equipe reste un `TeamMember` de la collection
 * `team`. Les champs ajoutes a ces deux interfaces sont tous optionnels :
 * les enregistrements deja en base restent valides tels quels.
 */

/** Role fonctionnel dans l'equipe commerciale. */
export type SalesRole = "admin" | "setter" | "closer";

/**
 * Qui agit sur la donnee.
 * `owner` = moi, sans cookie de session : c'est le comportement historique du
 * tool, qu'il ne faut surtout pas casser. `admin` = un membre a qui j'ai donne
 * les pleins pouvoirs. Les deux ont exactement les memes droits.
 */
export type SessionRole = "owner" | "admin" | "setter" | "closer" | "editor" | "anonyme";

export interface Session {
  /** Role principal : sert au routage. Les droits fins passent par `roles`. */
  role: SessionRole;
  /** Roles commerciaux cumules du membre (vide pour owner, admin, monteur). */
  roles: ("setter" | "closer")[];
  memberId: string;
  memberName: string;
  /** Vrai pour `owner` et `admin` : acces total, aucun cloisonnement. */
  isAdmin: boolean;
  /** Proprietaire connecte par mot de passe (site en ligne) : un bouton de sortie a du sens. */
  canLogout?: boolean;
  /** Vrai quand un admin visualise l'espace d'un membre. */
  impersonated?: boolean;
}

/** D'ou vient le rendez-vous. L'acquisition se fait surtout par Instagram. */
export type AppointmentSource =
  | "instagram-dm"
  | "instagram-story"
  | "instagram-reel"
  | "inbound"
  | "outbound"
  | "referral"
  | "other";

/**
 * Cycle de vie d'un rendez-vous.
 *
 * Le statut avance sans jamais ecraser le passe : chaque transition est
 * empilee dans `history`, ce qui permet de savoir des mois plus tard qu'un
 * lead a d'abord ete no-show avant d'etre reprogramme puis close.
 */
export type AppointmentStatus =
  | "booked"
  | "confirmed"
  | "rescheduled"
  | "completed"
  | "no-show"
  | "cancelled"
  | "follow-up"
  | "closed-won"
  | "closed-lost";

/** Raison d'un call perdu. Sert aux analytics d'objections. */
export type LostReason =
  | "too-expensive"
  | "no-money"
  | "need-to-think"
  | "need-partner-approval"
  | "not-qualified"
  | "not-interested"
  | "timing"
  | "competitor"
  | "other";

/** Une transition de statut, horodatee et attribuee. */
export interface AppointmentEvent {
  at: string;
  actorId: string;
  actorName: string;
  from: AppointmentStatus | "";
  to: AppointmentStatus;
  note: string;
}

export interface Appointment {
  id: ID;
  /** Lead de la collection `leads`. Un lead peut avoir plusieurs rendez-vous. */
  leadId: ID;
  /**
   * Setter a l'origine du rendez-vous. Fige a la creation : c'est
   * l'attribution commerciale, elle ne doit jamais etre recalculee depuis
   * l'assignation courante.
   */
  setterId: ID;
  /** Closer assigne. "" tant que personne n'est affecte. */
  closerId: ID | "";
  /** Date et heure du rendez-vous, en ISO UTC. */
  scheduledAt: string;
  /** Fuseau dans lequel le rendez-vous a ete pris (affichage cote closer). */
  timezone: string;
  source: AppointmentSource;
  status: AppointmentStatus;
  /** Rendez-vous juge qualifie par l'admin : sert aux commissions "par rdv qualifie". */
  qualified: boolean;
  /** Contexte laisse par le setter au closer : budget, objectif, objections. */
  setterNotes: string;
  /** Compte-rendu du closer apres le call. */
  closerNotes: string;
  lostReason: LostReason | "";
  /** Lien de visio iClosed, si le rendez-vous vient de la. */
  iclosedUrl: string;
  /** Identifiant iClosed, pour rapprocher plus tard via l'API ou le webhook. */
  iclosedEventId: string;
  /** Rendez-vous d'origine, si celui-ci est une reprogrammation. */
  rescheduledFromId: ID | "";
  completedAt: string;
  history: AppointmentEvent[];
  createdBy: ID;
  createdAt: string;
  updatedAt: string;
}

export type SaleStatus = "active" | "partially-refunded" | "refunded" | "cancelled";

export type PaymentType = "paid-in-full" | "installments" | "deposit" | "other";

/**
 * Une vente.
 *
 * `contractValue` et `cashCollected` sont deux mesures distinctes et toutes
 * les deux necessaires : un coaching a 5 000 $ paye 1 000 $ aujourd'hui vaut
 * 5 000 $ de contrat et 1 000 $ de cash. Les commissions peuvent porter sur
 * l'une ou l'autre.
 *
 * L'attribution (`setterId` / `closerId`) est copiee depuis le rendez-vous au
 * moment de la vente et n'est jamais recalculee ensuite.
 */
export interface Sale {
  id: ID;
  leadId: ID;
  appointmentId: ID;
  setterId: ID;
  closerId: ID;
  offer: string;
  contractValue: number;
  cashCollected: number;
  currency: string;
  paymentType: PaymentType;
  installments: number;
  paymentMethod: string;
  soldAt: string;
  status: SaleStatus;
  /** Montant rembourse. La vente d'origine n'est jamais effacee. */
  refundAmount: number;
  refundedAt: string;
  notes: string;
  createdBy: ID;
  createdAt: string;
  updatedAt: string;
}

export interface FollowUp {
  id: ID;
  leadId: ID;
  appointmentId: ID;
  /** Closer en charge de la relance. */
  closerId: ID | "";
  dueAt: string;
  notes: string;
  status: "pending" | "done" | "cancelled";
  createdBy: ID;
  createdAt: string;
  completedAt: string;
}

/**
 * Mode de remuneration.
 *
 * `pct-revenue` porte sur la valeur de contrat, `pct-cash` sur le cash
 * reellement encaisse. C'est la distinction qui change tout quand les clients
 * paient en plusieurs fois.
 */
export type CommissionType =
  | "per-appointment"
  | "per-show"
  | "pct-revenue"
  | "pct-cash"
  | "fixed-plus-pct"
  | "custom";

/**
 * Regle de commission d'un membre.
 *
 * Les regles ne sont jamais modifiees en place : on en cree une nouvelle avec
 * une date d'effet. Le moteur applique celle qui etait en vigueur a la date de
 * l'evenement, donc changer un taux ne reecrit pas les commissions passees.
 */
export interface CommissionRule {
  id: ID;
  memberId: ID;
  role: "setter" | "closer";
  type: CommissionType;
  /** Pourcentage (0-100), utilise par les types en pourcentage. */
  pct: number;
  /** Montant fixe : par rendez-vous, par show, ou par vente selon le type. */
  fixed: number;
  /** Assiette du pourcentage pour `fixed-plus-pct` et `custom`. */
  basis: "contract" | "cash";
  /** `per-appointment` : ne compter que les rendez-vous marques qualifies. */
  onlyQualified: boolean;
  currency: string;
  /** Date d'entree en vigueur (YYYY-MM-DD). */
  effectiveFrom: string;
  active: boolean;
  notes: string;
  createdAt: string;
}

/** Versement effectif d'une commission. L'historique n'est jamais ecrase. */
export interface CommissionPayment {
  id: ID;
  memberId: ID;
  amount: number;
  currency: string;
  paidAt: string;
  method: string;
  notes: string;
  /** Periode couverte, purement informative : le du se calcule en cumul. */
  periodFrom: string;
  periodTo: string;
  createdBy: ID;
  createdAt: string;
}

/**
 * Creneau de travail propose a un membre.
 *
 * L'admin propose, le setter accepte ou decline. Un creneau n'est jamais
 * supprime une fois passe : le nombre d'heures reellement tenues face au
 * nombre de rendez-vous poses est la vraie mesure du rendement d'un setter.
 */
export interface Shift {
  id: ID;
  memberId: ID;
  /** Debut et fin du creneau, en ISO. */
  startAt: string;
  endAt: string;
  status: "proposed" | "accepted" | "declined" | "done";
  /** Objectif de rendez-vous a poser sur ce creneau. 0 = non fixe. */
  goal: number;
  note: string;
  createdBy: ID;
  createdAt: string;
  respondedAt: string;
}

/** Trace d'audit : qui a fait quoi, quand. Jamais modifiee ni supprimee. */
export interface ActivityLog {
  id: ID;
  at: string;
  actorId: ID;
  actorName: string;
  /** Verbe machine : "appointment.created", "sale.created", "commission.paid"… */
  action: string;
  entity: "appointment" | "sale" | "follow-up" | "lead" | "member" | "commission";
  entityId: ID;
  /** Phrase lisible affichee telle quelle dans le journal. */
  summary: string;
}
