import type { StudioCharacter, StudioJob } from "./studio/types";
// Modèle de données du tool. Une seule source de vérité, persistée dans data/db.json.

export type ID = string;

import type {
  AdInternalData,
  CampaignDraft,
  CampaignInternalData,
  MediaBuyingAuditLog,
  MediaBuyingSettings,
  MetaConnection,
  MetaSnapshot,
} from "./mediabuying/types";

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

export interface BrandProfile {
  identity: string;
  audience: string;
  offer: string;
  resources: string;
  pillars: string;
  rules: string;
  sops: string;
}

export interface Settings {
  /** Clé API KIE. Priorité à process.env.KIE_API_KEY si définie. */
  kieApiKey: string;
  /** Modèle texte KIE utilisé pour la traduction / l'analyse de scripts. */
  kieTextModel: string;
  /** Prompt du scénariste YouTube (page Vidéos YouTube) ; vide = prompt par défaut. */
  ytScriptPrompt?: string;
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
  /** Cle Gemini (Google AI Studio) : transcription des videos YouTube par leur URL, depuis le VPS que YouTube bloque. Priorite a GEMINI_API_KEY. */
  geminiApiKey?: string;
  /** Cle Anthropic pour l'assistant du chat « Nouvel eleve ». Priorite a ANTHROPIC_API_KEY. */
  anthropicApiKey?: string;
  /** Espace de travail Anthropic (wrkspc_…), requis avec une cle utilisateur sk-ant-usr. Priorite a ANTHROPIC_WORKSPACE_ID. */
  anthropicWorkspaceId?: string;
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
  /** Contexte business injecté dans tous les prompts IA (compilé depuis `brand` quand la fiche est remplie). */
  brandContext: string;
  /** Fiche « Ma marque » : personal brand, avatar, offre, ressources, piliers, règles, SOP. */
  brand?: BrandProfile;
  /** Onboarding des eleves : liens (formulaire, affiliations) et message de bienvenue (lib/onboarding.ts). */
  studentOnboarding?: Partial<StudentOnboardingSettings>;
  /** Plateforme eleves « Scale X » : lien de reservation, WhatsApp, citation. */
  studentPortal?: Partial<StudentPortalSettings>;
  /** Page Créatives de la plateforme eleves : boutique exemple, creatives exemples, prompts. */
  studentCreatives?: Partial<StudentCreativesSettings>;
  /** Pages Recherche produit et Ta boutique de la plateforme eleves (video BrandSearch, consignes, message pour Claude Code). */
  studentMethod?: Partial<StudentMethodSettings>;
  /** Le theme Shopify de Mady depose pour les eleves (zip dans data/formation/). */
  studentTheme?: StudentThemeFile;
  /** Etapes par defaut de la marche a suivre posees une fois. */
  courseStepsSeededAt?: string;
  /** Version du texte des étapes par défaut posée en base (voir formation-steps.ts). */
  courseStepsSeedVersion?: number;
  /** Content OS : habitudes du jour, priorités, routine hebdo, ressources, chantiers. */
  contentOs?: Partial<ContentOsState>;
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
  /** Devise du module commercial (ISO 4217). Euro par defaut : l'equipe vend et raisonne en euros. */
  salesCurrency: string;
  /** Les offres a vendre, dans l'ordre de pitch. Ecrites par l'admin, lues par les closers. */
  salesOffers?: SalesOffer[];
  /**
   * Synchronisation automatique des rendez-vous iClosed.
   *
   * Quand elle est active, ouvrir l'espace commercial va chercher les nouveaux
   * bookings sans rien cliquer. Elle exige un setter par defaut : iClosed ne
   * sait pas qui a chauffe le prospect, et un rendez-vous sans attribution
   * fausserait classements et commissions.
   */
  /** Historique : la synchro n'a plus besoin d'etre activee. Seul `salesAutoImportOff` la coupe. */
  salesAutoImport: boolean;
  /** Vrai = synchro iClosed mise en pause volontairement. Par defaut elle tourne. */
  salesAutoImportOff?: boolean;
  salesDefaultSetterId: string;
  /**
   * Closer qui recoit les calls iClosed quand aucune correspondance hote →
   * closer ne s'applique (un seul siege iClosed, plusieurs closers). Sert
   * aussi de closer propose quand un setter pose un rendez-vous.
   */
  salesDefaultCloserId?: string;
  /**
   * Le compte de l'equipe qui est le proprietaire lui-meme, quand il close
   * aussi : ses calls lui sont proposes par defaut quand il pose un rendez-
   * vous, et l'agenda a un filtre « Moi ».
   */
  salesOwnerMemberId?: string;
  /** Calls iClosed supprimes a la main : la synchro ne les recree pas. */
  salesDeletedIclosedEventIds?: string[];
  /** Lien de reservation iClosed. Chaque setter recoit ce lien signe a son nom (UTM). */
  salesBookingUrl?: string;
  /** Liste de taches quotidiennes des setters (une par ligne), editable par l'admin. */
  salesDailyTasks?: string[];
  /** Bascule unique (2026-10-27) : la task list des setters repart des trois taches par defaut. */
  salesDailyTasksV2At?: string;
  /** Bascule unique en euros (2026-10-06) : date a laquelle une base en USD par defaut est passee en EUR. */
  salesCurrencyEurAt?: string;
  /** Idem pour les enregistrements (ventes, regles, versements) encore libelles en USD. */
  salesEurRecordsAt?: string;
  /** Dernier rattrapage des UTM iClosed sur les rendez-vous (page Sources). */
  salesSourcesSyncAt?: string;
  /**
   * Acces de la VA outreach, quand il n'est pas fourni par l'environnement
   * (VA_USERNAME / VA_PASSWORD, qui l'emportent). Mot de passe hache (scrypt).
   */
  vaUsername?: string;
  vaPasswordHash?: string;
  /**
   * Compte administrateur (moi) sur le site en ligne : identifiant + mot de
   * passe hache, definis dans Reglages. Des qu'il est renseigne, il remplace
   * le mot de passe seul de l'environnement (OWNER_PASSWORD) a la connexion.
   */
  ownerUsername?: string;
  ownerPasswordHash?: string;
  /** Message que la VA copie-colle en DM Instagram. Ecrit par l'admin. */
  outreachMessage?: string;
  /** Objectif de DM envoyes par jour (contacts passes en « Contacted »). 50 par defaut. */
  outreachDailyGoal?: number;
  /** Bloc-notes libre de la to-do flottante, et date de sa derniere sauvegarde. */
  todoNotes?: string;
  todoNotesAt?: string;
  /** Objectif de cash encaisse par mois civil, dans la devise des ventes. 0 ou absent = pas d'objectif. */
  salesMonthlyGoal?: number;
  /** Derniere synchro reussie, pour ne pas retaper l'API a chaque navigation. */
  salesLastSyncAt: string;
  /** Attribution des leads existants derivee une fois (lib/sales/attribution). */
  attributionBackfilledAt?: string;
  /** Funnels declares par l'admin : reconnaissance par URL / tag Systeme.io, canal, script d'appel. */
  salesFunnels?: SalesFunnel[];
  /** Funnels par defaut poses une fois (LP1 Ads / LP organique) et leads reattribues. */
  salesFunnelsV2At?: string;
  /** Ventes en double sur un meme rendez-vous annulees une fois (bug d'avant le 2026-10-05). */
  salesDedupedAt?: string;
  /* --- Systeme.io : leads de la landing page. Priorite a SYSTEMEIO_API_KEY. --- */
  systemeioApiKey?: string;
  /** Secret du webhook, genere ici et transmis a Systeme.io a la creation. */
  systemeioWebhookSecret?: string;
  /** Filtre optionnel : morceaux d'URL de page ou noms de tag, separes par des virgules. Vide = tous les contacts. */
  systemeioSourceFilter?: string;
  /**
   * Reinscription dont Systeme.io ne dit pas la page (webhook API) : cle du
   * funnel a lui donner. Absent = le premier funnel Meta Ads ; "" = ne rien
   * changer. Le webhook d'automatisation Systeme.io (regle « formulaire
   * soumis → envoyer un webhook ») donne la page exacte et rend ce repli inutile.
   */
  systemeioReoptinFunnel?: string;
  /** Categories des templates de messages (libres, modifiables). Absent = liste par defaut. */
  messageTemplateCategories?: string[];
  /** Les templates d'exemple ont ete poses (une seule fois). */
  messageTemplatesSeededAt?: string;
  /** Le template « Confirmation du call » a ete pose (une seule fois, aussi sur une base deja seedee). */
  messageTemplatesConfirmAt?: string;
  /** Contacts Systeme.io supprimes a la main depuis « A appeler » : la synchro ne les recree pas. */
  systemeioIgnoredIds?: string[];
  /** Date du nettoyage unique des pseudos Instagram fabriques par l'import iClosed. */
  igHandlesCleanedAt?: string;
  systemeioLastSyncAt?: string;
  /* --- Fathom (enregistreur des calls de closing, 2026-10-27) : cle API, webhook pose, derniere relecture. --- */
  fathomApiKey?: string;
  fathomWebhookId?: string;
  fathomWebhookUrl?: string;
  fathomWebhookSecret?: string;
  fathomLastSyncAt?: string;
  /* --- Google Agenda (liens Meet, 2026-10-27) : client OAuth de Mady, jeton de rafraichissement, compte connecte. --- */
  googleClientId?: string;
  googleClientSecret?: string;
  googleRefreshToken?: string;
  googleAccountEmail?: string;
  googleConnectedAt?: string;
  /** Derniere synchro automatique des issues iClosed (calls passes). */
  salesLastOutcomeSyncAt?: string;
  /** Rejeu des utm / IDs Meta sur les leads deja en base (une seule fois). */
  metaIdsBackfilledAt?: string;
  /**
   * Closer unique (2026-10-13) : Salim retire de l'equipe, le proprietaire
   * devient le seul closer et le closer par defaut. Applique une seule fois.
   */
  salesSoloCloserAt?: string;
  /** Salim supprime de partout, tout a mon nom (2026-10-25). Applique une seule fois. */
  salesSalimPurgedAt?: string;
  /**
   * Date de depart des chiffres du Sales Dashboard (AAAA-MM-JJ). Tout ce qui
   * est avant est ignore : leads, calls, no-shows, ventes. Pour repartir sur
   * une base propre sans toucher a l'historique.
   */
  salesStatsSince?: string;
  /**
   * Attribution des leads LP. « pool » (le choix par defaut) : personne, les
   * leads sont a tous les setters et le premier qui appelle le prend.
   * « default » : le setter par defaut. « round-robin » : tour de role.
   */
  salesLeadAssignment?: "pool" | "default" | "round-robin";
  /** Date du passage au pool commun (bascule unique du reglage et des leads jamais appeles). */
  salesPoolAppliedAt?: string;
  /** Bascule unique (2026-10-27) : un setter ne garde que les rendez-vous iClosed venus de son lien signe. */
  salesSetterByLinkOnlyAt?: string;
  /** Correctif du meme jour : les calls importes sans utm (aucune preuve) rendus a leur setter. */
  salesSetterByLinkOnlyV2At?: string;
  /** v3 : seul un lien signe par QUELQU'UN D'AUTRE retire un setter ; les calls sans signature lui sont rendus. */
  salesSetterByLinkOnlyV3At?: string;
  /** v4 (règle finale, 2026-10-27 soir) : un setter ne garde que les calls signés de son lien (ou déclarés) ; le reste va au propriétaire. */
  salesSetterByLinkOnlyV4At?: string;
  /**
   * Regle de reprise (2026-10-14) : minutes sans action du setter au bout
   * desquelles un autre setter peut reprendre la conversation. 0 = desactive.
   * Absent = 60.
   */
  salesTakeoverMin?: number;
  /* --- Bot Telegram des rappels setters --- */
  /** Jeton du bot (BotFather). L'environnement TELEGRAM_BOT_TOKEN l'emporte. */
  telegramBotToken?: string;
  /** Nom du bot (@…), relu via getMe quand le jeton est enregistre. */
  telegramBotUsername?: string;
  /** Dernier update_id Telegram traite (liaison des comptes). */
  telegramUpdateOffset?: number;
  /** Reglages des rappels periodiques. */
  telegramReminders?: TelegramReminderSettings;
  /** Dernier rappel periodique envoye. */
  telegramLastReminderAt?: string;
  /** Derniere erreur du bot (jeton faux, reseau), affichee dans Reglages. */
  telegramLastError?: string;
  /** Cadence cible de Reels par semaine et par etape (defaut 15 / 5 / 5). */
  weeklyReelTargets?: WeeklyReelTargets;
  /** Objectifs passes une fois de 15/5/5 a 24/9/2 (2026-10-22). */
  weeklyTargetsV2At?: string;
  /**
   * Generateur de boutiques (2026-10-19) : le theme template (zip Shopify)
   * depose par le proprietaire. `token` protege l'URL publique que Shopify
   * vient lire pour installer le theme.
   */
  shopThemeZip?: ShopThemeZip | null;
  /** Funnels v3 (2026-10-16) : LP organique = /lp-orga (l'ancienne /authenticitemady reste reconnue). Applique une fois. */
  salesFunnelsV3At?: string;
}

/** Rappels Telegram envoyes aux setters pendant leurs heures de travail. */
export interface TelegramReminderSettings {
  enabled: boolean;
  /** Intervalle entre deux rappels, en minutes (60 par defaut). */
  everyMin: number;
  /** Plage horaire (heure de Paris), bornes incluses pour le debut, exclue pour la fin. */
  fromHour: number;
  toHour: number;
  /** Jours actifs, 0 = dimanche … 6 = samedi. */
  days: number[];
  /** Texte du rappel ; les chiffres du setter sont ajoutes dessous. */
  text: string;
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
  /* --- Landing page (Systeme.io). --- */
  /** Identifiant du contact chez Systeme.io : cle de dedoublonnage. */
  systemeioId?: string;
  /** Contact iClosed (formulaire du calendrier commence sans reservation) : cle de dedoublonnage. */
  iclosedContactId?: string;
  /** Date d'inscription sur la landing page. */
  optInAt?: string;
  /** Page d'origine de l'opt-in. */
  sourceUrl?: string;
  /** Appels passes sans reponse, depuis la liste « A appeler ». */
  callAttempts?: number;
  lastCallAt?: string;
  /** Dernier statut d'appel pose par le setter (liste « A appeler »). */
  callStatus?: LeadCallStatus;
  /** Rappel demande par le prospect : date et heure (ISO). */
  callbackAt?: string;
  /** Relance prevue par le setter apres un message (ISO) : le lead revient dans la liste a cette date. */
  followUpAt?: string;
  /** Declare par un setter (« j'ai envoye le lien du calendrier ») : date du dernier envoi. */
  declaredAt?: string;
  /** Comment le lien a ete envoye (DM Instagram, WhatsApp, SMS…). */
  declaredVia?: LinkChannel;
  /** Pourquoi : ce que le prospect cherche, le contexte de l'envoi. */
  declaredWhy?: string;
  /* --- Regle de reprise (2026-10-14) : une conversation sans action d'un setter
   *     pendant `salesTakeoverMin` minutes peut etre reprise par un autre. --- */
  /** Moment ou le setter actuel a pris le lead (premier appel, ou reprise). */
  claimedAt?: string;
  /** Derniere action du setter proprietaire sur le lead (statut, message, note, contact). */
  lastSetterActionAt?: string;
  /** Avertissement Telegram « reprise possible dans 15 min » deja envoye pour ce cycle d'inactivite. */
  takeoverWarnedAt?: string;
  /* --- Reinscriptions (webhook Systeme.io CONTACT_OPT_IN). ---
     Un contact deja connu de Systeme.io qui se reinscrit (par exemple via la
     page Ads) : `optInAt` passe a la date du jour, la premiere inscription
     reste dans `firstOptInAt`. */
  firstOptInAt?: string;
  /** Date du dernier opt-in recu par webhook. */
  lastOptInAt?: string;
  /** Page du dernier opt-in quand Systeme.io l'a dite ; vide quand on l'ignore (reinscription par le webhook API). */
  lastOptInUrl?: string;
  /** Faux quand la page du dernier opt-in est inconnue : le funnel est alors celui du repli des reglages. */
  lastOptInPageKnown?: boolean;
  optInCount?: number;
  /* --- Attribution d'acquisition (src/lib/sales/attribution.ts). ---
     `sourceChannel`, `funnelSource`, `campaignId`, `adsetId`, `adId` sont
     l'attribution EFFECTIVE : un miroir du first touch, jamais ecrase par
     une interaction ulterieure (un lead venu d'une pub Meta qui ecrit ensuite
     en DM reste META_ADS). Le last touch vit a part, pour l'analyse. */
  sourceChannel?: SourceChannel;
  funnelSource?: string;
  campaignId?: string;
  adsetId?: string;
  adId?: string;
  campaignName?: string;
  adsetName?: string;
  adName?: string;
  firstTouchSourceChannel?: SourceChannel;
  firstTouchFunnelSource?: string;
  firstTouchCampaignId?: string;
  firstTouchAdsetId?: string;
  firstTouchAdId?: string;
  firstTouchUtmSource?: string;
  firstTouchUtmMedium?: string;
  firstTouchUtmCampaign?: string;
  firstTouchUtmContent?: string;
  firstTouchUtmTerm?: string;
  firstTouchPlacement?: string;
  firstTouchFbclid?: string;
  /** Cookies Meta (_fbc / _fbp) transmis par la page ou iClosed. */
  firstTouchFbc?: string;
  firstTouchFbp?: string;
  firstTouchAt?: string;
  /** Vrai quand le first touch est juge fiable (IDs Meta, fbclid, utm payant) : plus rien ne l'ecrase automatiquement. */
  firstTouchReliable?: boolean;
  lastTouchSourceChannel?: SourceChannel;
  lastTouchFunnelSource?: string;
  lastTouchAt?: string;
  /** Attribution corrigee a la main : verrouillee, seule une autre correction manuelle la change. */
  attributionLocked?: boolean;
  attributionOverriddenAt?: string;
  /** Fixture de demonstration generee en memoire : jamais ecrit en base. */
  mock?: boolean;
}

/* ----------------------------- Liens UTM ------------------------------ */

/**
 * Un lien traque, fabrique dans Sales → Liens UTM : une page de destination
 * et ses parametres utm. Les leads dont le first touch porte exactement
 * ces parametres (ou un rendez-vous iClosed reserve avec) lui sont
 * rattaches : on sait quelle video, quel post, quelle story a amene qui.
 */
export interface UtmLink {
  id: ID;
  /** Nom lisible : « YouTube · Comment lancer sa boutique (oct. 2026) ». */
  label: string;
  /** Page de destination sans parametres (https://royalscalebymady.fr/lp-orga). */
  baseUrl: string;
  source: string;
  medium: string;
  campaign: string;
  content: string;
  term: string;
  /** URL complete, telle que copiee. */
  url: string;
  /** Ou le lien est pose (description YouTube, bio, story…) : memo libre. */
  placement: string;
  notes: string;
  createdAt: string;
  createdBy: string;
}

/** Un funnel d'acquisition declare par l'admin (landing page, lien, tag). */
export interface SalesFunnel {
  /** Cle machine stable : lp1_ads, organic_masterclass… */
  key: string;
  label: string;
  channel: SourceChannel;
  /** Morceaux d'URL ou tags Systeme.io, separes par des virgules, qui reconnaissent ce funnel. */
  match: string;
  /** Script d'appel / message WhatsApp a copier pour les leads de ce funnel. */
  script: string;
}

/** Canal d'acquisition standardise. */
export type SourceChannel = "META_ADS" | "INSTAGRAM" | "ORGANIC" | "REFERRAL" | "AFFILIATE" | "OTHER" | "UNKNOWN";

/**
 * Statut d'appel d'un prospect de la landing page.
 *  - no-answer      : ne repond pas ;
 *  - message-sent   : message laisse (SMS, WhatsApp, vocal) ;
 *  - callback       : demande a etre rappele, a la date `callbackAt` ;
 *  - reached        : appele et joint, rendez-vous a fixer ;
 *  - not-interested : pas interesse, sort de la liste ;
 *  - wrong-number   : faux numero, sort de la liste ;
 *  - no-whatsapp    : pas de WhatsApp (les setters n'appellent que par la), sort de la liste.
 * « Rendez-vous pris » n'est pas un statut : c'est un rendez-vous cree.
 */
export type LeadCallStatus = "no-answer" | "message-sent" | "callback" | "reached" | "not-interested" | "wrong-number" | "no-whatsapp" | "cold";

/** Statuts qui sortent le lead de la liste a appeler (il reste visible 30 jours en rouge, et peut etre remis). */
/** « cold » : lead froid, sans reponse apres la sequence de relances (J+1, J+3) ; garde pour le tri, plus relance. */
export const LEAD_OUT_STATUSES: readonly LeadCallStatus[] = ["not-interested", "wrong-number", "no-whatsapp", "cold"];
export const leadIsOut = (s?: LeadCallStatus) => Boolean(s) && LEAD_OUT_STATUSES.includes(s as LeadCallStatus);

/* ------------------------- Templates de messages ------------------------ */

export type TemplateChannel = "whatsapp" | "sms" | "instagram" | "email" | "other";

/**
 * Message pret a copier ou a ouvrir dans WhatsApp depuis la liste des leads.
 * Generique : categorie libre (la liste vit dans les reglages), favoris en
 * tete du menu, et un template peut s'ouvrir tout seul pour une action
 * (« appel sans reponse »). Jamais d'envoi automatique : le setter copie ou
 * ouvre WhatsApp, puis « marque comme envoye » pour la timeline du lead.
 */
export interface MessageTemplate {
  id: ID;
  name: string;
  /** Categorie libre : LEAD ADS, RELANCE, R2, CONTRAT… */
  category: string;
  content: string;
  channel: TemplateChannel;
  isFavorite: boolean;
  isActive: boolean;
  sortOrder: number;
  /** Actions pour lesquelles ce template s'ouvre par defaut : "no-answer" (appel sans reponse). */
  defaultFor?: string[];
  /** Setter qui a cree ce script (2026-10-27) : lui seul (et l'admin) le modifie. Vide = script de l'admin. */
  ownerId?: string;
  /** Ce que le setter note sur ce script : dans quel contexte, ce que ca a donne, combien de RDV poses. */
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Un exemple de setting qui a marche : les captures de la conversation et
 * son transcript (compte de Mady + compte du prospect), pour en tirer un
 * script complet ensuite. Cree par le setter ou l'admin.
 */
export interface SettingExample {
  id: ID;
  ownerId: string;
  ownerName: string;
  title: string;
  /** Contexte : d'ou venait le prospect, quelle approche. */
  context: string;
  outcome: "booked" | "no-booking" | "";
  transcript: string;
  /** Captures d'ecran (URL /api/media/…). */
  screenshots: string[];
  notes: string;
  createdAt: string;
  updatedAt: string;
}

/** Un lien Google Meet genere depuis le tool, et l'evenement Google Agenda qui va avec. */
export interface MeetLink {
  id: ID;
  kind: "sale" | "student" | "other";
  title: string;
  guestName: string;
  guestEmail: string;
  /** Debut en ISO UTC ; `timeZone` est celui choisi a la creation (Asia/Dubai ou Europe/Paris). */
  startAt: string;
  timeZone: string;
  durationMin: number;
  meetUrl: string;
  eventUrl: string;
  eventId: string;
  note: string;
  createdAt: string;
}

/**
 * Relance envoyee par l'admin a un setter depuis son espace : « cette
 * personne, a rappeler / a qui ecrire tel jour, voila le contexte ». Atterrit
 * sur l'accueil du setter, qui la marque faite.
 */
export interface SetterTask {
  id: ID;
  setterId: ID;
  /** Lead du CRM, quand la relance part d'une fiche. */
  leadId: string;
  name: string;
  phone: string;
  igUsername: string;
  kind: "call" | "message";
  /** Jour ou c'est a faire (YYYY-MM-DD). */
  dueOn: string;
  note: string;
  status: "open" | "done";
  createdBy: string;
  createdAt: string;
  doneAt: string;
}

/** Reglages du message de bienvenue des eleves (Eleves → Onboarding). */
export interface StudentOnboardingSettings {
  /** Formulaire d'onboarding (pourquoi il m'a choisi, situation, objectif). */
  formUrl: string;
  shopifyUrl: string;
  claudeUrl: string;
  brainsearchUrl: string;
  /** Texte du message, avec les balises {{prenom}}, {{formulaire}}, {{shopify}}, {{claude}}, {{brainsearch}}, {{plateforme}}, {{identifiant}}, {{motdepasse}}. */
  message: string;
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
  /** Contrat signe avec l'eleve a l'onboarding, et sa date. */
  contractSigned?: boolean;
  contractAt?: string;
  /* --- Acces a la plateforme de formation (/formation). ---
     Identifiant + mot de passe haches, definis par l'admin dans « Accès
     élèves ». `portalAccess` coupe l'acces sans effacer les identifiants. */
  username?: string;
  passwordHash?: string;
  portalAccess?: boolean;
  portalLastSeenAt?: string;
  /** Modules video marques « terminé » par l'eleve, dans l'ordre ou il les a coches. */
  completedModules?: ID[];
  /** Date a laquelle le message d'onboarding lui a ete envoye (marque a la main). */
  onboardingSentAt?: string;
  /* --- Parcours (Scale X) : etapes de la marche a suivre cochees, et etapes
         assignees par le coach a cet eleve seulement. --- */
  completedSteps?: ID[];
  tasks?: StudentTask[];
  /** Notes du coach sur cet eleve (visibles de l'admin seulement). */
  coachNotes?: string;
  /** Demande de generation de boutique faite depuis la page Demarrage. */
  shopRequest?: ShopRequest;
  /* --- Studio IA de l'eleve : ouvert par l'admin apres l'etape creatives,
         il y travaille avec sa propre cle KIE, sur ses credits, et ne voit
         que ses generations. --- */
  studioAccess?: boolean;
  /** Cle API KIE de l'eleve (kie.ai). Jamais renvoyee en clair au navigateur. */
  kieApiKey?: string;
  /** Etapes du guide Demarrage cochees (cles section:os:index). */
  guideDone?: string[];
  /** Guides PDF (Education) marques terminés : ids du manifeste src/lib/formation-education.ts. */
  completedLessons?: string[];
  /* --- Verrou du parcours (src/lib/formation-gate.ts) : l'eleve dit avoir rempli
         le formulaire d'onboarding, Mady valide, puis chaque onglet s'ouvre quand
         le precedent est marque fait. --- */
  accessRequestedAt?: string;
  accessApprovedAt?: string;
  tabsDone?: string[];
}

/** « Demande ta boutique à Mady » : l'eleve donne son adresse Shopify, Mady genere avec le generateur. */
export interface ShopRequest {
  requestedAt: string;
  /** Adresse xxx.myshopify.com. */
  storeUrl: string;
  /** Produit choisi, liens concurrents, remarques. */
  note: string;
  status: "demandee" | "livree";
  doneAt?: string;
}

/* ------------------------- Plateforme de formation ------------------------ */

/** Une objection qui revient souvent, et la reponse a y apporter. */
export interface CourseObjection {
  id: ID;
  question: string;
  answer: string;
}

/**
 * Annexe PDF de la formation (Formation → Ressources formation).
 *
 * Le fichier vit sur le disque (`data/formation/<stored>`), jamais dans la
 * base ; `fileName` est le nom d'origine, restitue au telechargement.
 */
export interface CourseResource {
  id: ID;
  /** Titre affiche, modifiable ; par defaut le nom du fichier sans extension. */
  title: string;
  fileName: string;
  /** Nom de stockage genere (identifiant + .pdf). */
  stored: string;
  size: number;
  createdAt: string;
  updatedAt: string;
  /** Visible par les eleves dans leur espace Ressources. Absent = visible. */
  studentVisible?: boolean;
}

/**
 * Un module video de la formation e-commerce.
 *
 * La video est hebergee sur YouTube (non repertoriee) : on ne stocke que le
 * lien. En dessous, une annexe en texte libre (notes, liens, etapes) et la
 * liste des objections frequentes. `order` donne l'ordre de visionnage ;
 * un module non publie n'est visible que par l'admin.
 */
export interface CourseModule {
  id: ID;
  title: string;
  /** Une ou deux phrases sous le titre : de quoi parle le module. */
  summary: string;
  youtubeUrl: string;
  /** Annexe affichee sous la video. Texte libre, mise en forme legere (titres, listes, liens). */
  annex: string;
  objections: CourseObjection[];
  order: number;
  published: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Une etape de la marche a suivre (plateforme eleves « Scale X »).
 *
 * La meme liste pour tous les eleves, dans l'ordre : formulaire, outils,
 * produit, boutique, creatives, premiere campagne… L'eleve coche chaque
 * etape quand elle est faite ; le coach voit ou il en est. `link` peut porter
 * une balise d'onboarding ({{formulaire}}, {{shopify}}…) remplacee a l'affichage.
 */
export interface CourseStep {
  id: ID;
  title: string;
  /** Consignes detaillees (mise en forme legere, comme l'annexe d'un module). */
  detail: string;
  /** Lien a ouvrir pour faire l'etape (outil, formulaire, module…). */
  link: string;
  /** Module video a regarder pour cette etape, s'il y en a un. */
  moduleId?: ID;
  order: number;
  published: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Etape assignee par le coach a un seul eleve (« Prochaines etapes »). */
export interface StudentTask {
  id: ID;
  title: string;
  detail: string;
  link: string;
  done: boolean;
  doneAt: string;
  createdAt: string;
}

/** Une creative exemple montree aux eleves (image ou video, hebergee ou lien externe). */
export interface CreativeExample {
  id: ID;
  title: string;
  kind: "image" | "video";
  url: string;
  /** Pourquoi elle marche, en une phrase. */
  note: string;
  /** Ratio de l'image (3:4, 1:1, 9:16). */
  ratio?: string;
  /** Le prompt qui permet de la reproduire dans le Studio IA (avec la photo de référence). */
  prompt?: string;
  /** Famille de créatives (CREATIVE_FOLDERS : punchy, native, notes…) ; vide = exemples de Mady avec leur prompt. */
  folder?: string;
}

/** Un prompt que l'eleve copie dans Claude ou GPT pour produire ses creatives. */
export interface CreativePrompt {
  id: ID;
  kind: "image" | "video" | "strategie";
  title: string;
  /** Ou le coller (« Claude ou GPT », puis l'outil de generation). */
  target: string;
  text: string;
}

/** Reglages de la page Creatives (Scale X), modifiables par l'admin depuis la page. */
export interface StudentCreativesSettings {
  /** Boutique exemple de Mady. */
  exampleShopUrl: string;
  exampleShopNote: string;
  /** La methode en quelques lignes (mise en forme legere). */
  method: string;
  examples: CreativeExample[];
  prompts: CreativePrompt[];
}

/** Reglages des pages Recherche produit et Ta boutique (Scale X), modifiables par l'admin depuis les pages. */
export interface StudentMethodSettings {
  /** Video de recherche produit avec BrandSearch (lien YouTube). */
  productVideoUrl: string;
  /** Nombre de produits que l'eleve envoie a Mady pour validation. */
  productCount: number;
  /** Consigne au-dessus du tableau des produits. */
  productNote: string;
  /** Ce que l'eleve doit savoir du theme (« la page est parfaite, change seulement les textes et les medias »). */
  themeNote: string;
  /** Message a coller a Claude Code dans VS Code pour poser le theme et remplacer le contenu. */
  themePrompt: string;
  /** Video « Ta boutique » : Mady cree la boutique avec Claude Code (lien YouTube). */
  shopVideoUrl: string;
  /** Resume de la video, sous le lecteur (texte libre, paragraphes). */
  shopVideoSummary: string;
  /** Les etapes a suivre telles que dites dans la video : une etape par ligne, « Titre : detail » accepte. */
  shopVideoSteps: string;
  /** Video « Créatives » (lien YouTube), son resume, ses etapes. Vides tant que Mady ne l'a pas tournee. */
  creativesVideoUrl: string;
  creativesVideoSummary: string;
  creativesVideoSteps: string;
  /** Video « Campagnes Meta » (lien YouTube), son resume, ses etapes. */
  metaVideoUrl: string;
  metaVideoSummary: string;
  metaVideoSteps: string;
}

/** Le theme Shopify de Mady, depose par l'admin et telechargeable par les eleves. */
export interface StudentThemeFile {
  /** Nom du fichier sur le disque (data/formation/theme-<id>.zip). */
  stored: string;
  /** Nom d'origine, rendu au telechargement. */
  fileName: string;
  size: number;
  uploadedAt: string;
}

/** Reglages de la plateforme eleves (Formation → Parcours). */
export interface StudentPortalSettings {
  /** Lien de reservation d'un appel avec le coach (iClosed par defaut). */
  bookingUrl: string;
  /** Numero WhatsApp du coach pour l'aide (international, ex. +33 6…). Vide = pas de bouton. */
  whatsapp: string;
  /** Phrase sous « Accompagnement ». */
  helpText: string;
  /** Citation du pied de page et sa signature. */
  quote: string;
  quoteAuthor: string;
  /** Video d'accompagnement en haut de Demarrage : lien YouTube, ou fichier depose (/api/media/…). Vide = pas de video. */
  welcomeVideoUrl: string;
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

/**
 * Une tache de la to-do flottante (bouton en haut de chaque page).
 *
 * `text` est le titre. Les champs optionnels sont arrives avec le panneau
 * flottant d'octobre 2026 : description courte, notes longues, couleur,
 * photos de rappel, ordre manuel. Les taches plus anciennes n'en ont pas.
 */
export interface Todo {
  id: ID;
  text: string;
  done: boolean;
  priority: "P1" | "P2" | "P3";
  project: string;
  due: string;
  createdAt: string;
  description?: string;
  notes?: string;
  /** Cle de couleur ("" = neutre, "yellow", "green", "blue", "pink", "orange", "red"). */
  color?: string;
  /** Images de rappel, stockees dans data/media. */
  photos?: { url: string; name: string }[];
  /** Ordre manuel croissant. Absent = tri par date de creation. */
  order?: number;
  doneAt?: string;
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
  /**
   * Etiquette Instagram du setter : le mot qu'il pose sur chaque conversation
   * qu'il gere dans la boite de reception partagee (« Commandé », « Prospect »),
   * pour que deux setters ne se marchent pas dessus.
   */
  igLabel?: string;
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
  /* --- Rappels Telegram (2026-10-14) --- */
  /** Identifiant de la conversation Telegram du membre avec le bot, pose quand il envoie son code. */
  telegramChatId?: string;
  /** Code a envoyer au bot (/start CODE) pour relier le compte. */
  telegramLinkCode?: string;
  telegramLinkedAt?: string;
}

/** Un fichier attaché à un job de montage (rush ou livrable). */
export interface MediaRef {
  name: string;
  url: string;       // /api/media/xxx si uploadé, sinon lien externe (Drive, WeTransfer…)
  size: number;
  /**
   * "rush" : les vidéos tournées, la matière du montage.
   * "photo" : les images à intégrer (produits, captures, visuels) — rangées
   * à part pour que le monteur ne les cherche pas au milieu des vidéos.
   * "reference" : la vidéo dont le monteur doit reproduire le montage.
   * C'est la consigne la plus utile qu'on puisse lui donner — bien plus
   * précise qu'un brief écrit.
   */
  kind: "rush" | "photo" | "reference" | "livrable";
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
  /** Swipe d'origine (script court, assets IA), quand le dossier vient de la swipe file. */
  swipeId?: string;
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
/** Etape du funnel servie par un Reel (classement des swipes, 2026-10-15). */
export type SwipeStage = "TOFU" | "MOFU" | "BOFU";
export const SWIPE_STAGES: SwipeStage[] = ["TOFU", "MOFU", "BOFU"];
/** Formats reconnus par le classement, un seul par Reel. */
export const SWIPE_FORMATS = [
  "tier_list",
  "choix_binaire",
  "hot_take",
  "reaction",
  "anecdote_parcours",
  "chiffre_choc",
  "lifestyle_punchline",
  "tuto_ecran",
  "reponse_commentaire",
  "decryptage",
  "erreur_correction",
  "a_ta_place",
  "coulisses",
  "resultat_eleve",
  "objection",
  "pour_qui",
  "comment_ca_se_passe",
  "garantie",
  "urgence",
] as const;
export type SwipeFormat = (typeof SWIPE_FORMATS)[number];
/** En dessous, le classement automatique est marque « a verifier ». */
export const SWIPE_CONFIDENCE_MIN = 70;

/*
 * Chaine de production d'un Reel (2026-10-15) : chaque swipe avance de
 * « source » a « publie », avec la date de chaque passage. C'est cette chaine
 * qui alimente le bloc « Semaine en cours » partout dans le tool.
 */
export type SwipeProdStatus = "source" | "scripte" | "a-tourner" | "tourne" | "monte" | "validation" | "programme" | "publie";
export const SWIPE_PROD_STATUSES: SwipeProdStatus[] = ["source", "scripte", "a-tourner", "tourne", "monte", "validation", "programme", "publie"];
/** Pipeline (2026-10-22) : Swipe file → Script prêt → Prêt à tourner → Tourné → Monté → Validation → Programmé → Publié. */
export const SWIPE_PROD_LABEL: Record<SwipeProdStatus, string> = {
  source: "Swipe file",
  scripte: "Script prêt",
  "a-tourner": "Prêt à tourner",
  tourne: "Tourné",
  monte: "Monté",
  validation: "Validation",
  programme: "Programmé",
  publie: "Publié",
};

/** Resultats d'un Reel publie (saisis a la main, jamais inventes). */
export interface SwipeMetrics {
  views: number;
  reach: number;
  followers: number;
  comments: number;
  dms: number;
  leads: number;
  calls: number;
  sales: number;
}

/** Ce qu'il me faut pour tourner MA version : seul face cam, a deux (question-reponse, podcast), ou filme par quelqu'un (cadreur, lieu). */
export type SwipeNeed = "solo" | "duo" | "crew";

/** D'ou vient la transcription : auto (audio recupere), fichier importe, collee a la main. */
export type SwipeTranscriptSource = "auto" | "file" | "manual" | "";

/** Une personne face camera, ou deux personnes qui se parlent. */
export type SwipeSpeakers = "solo" | "dialogue";

/**
 * Le script a tourner : celui de la video d'origine, mis en forme (hook mot
 * pour mot, corps ligne par ligne, CTA). Rien n'est reecrit : le user
 * reprend le contenu des autres tel quel, c'est le hook qui a marche.
 */
export interface SwipeScript {
  hook: string;
  /** Une ligne par bullet, chacune avec son chiffre ou sa raison. */
  bullets: string[];
  cta: string;
  /** Script Scale X (2026-10-22) : le message central en une phrase. */
  message?: string;
  /** Indications de B-roll et de preuves a afficher, une par ligne. */
  broll?: string[];
  /** « adapt » : script personnel qui garde la mecanique ; « verbatim » : le texte de la video, mis en forme (video a moi). */
  mode?: "adapt" | "verbatim";
  /** Textes a incruster, courts. */
  screenText: string[];
  /** Duree cible en secondes. */
  durationSec: number;
  /** Une personne, ou deux personnes qui se parlent (lignes prefixees A : / B :). */
  speakers?: SwipeSpeakers;
  /** Genere par l'IA le… (vide si ecrit a la main). */
  generatedAt: string;
  updatedAt: string;
}

/** Objectif de Reels par semaine et par etape du funnel. */
export interface WeeklyReelTargets {
  TOFU: number;
  MOFU: number;
  BOFU: number;
}
/** 5 Reels par jour = 35 par semaine : 24 TOFU / 9 MOFU / 2 BOFU (le reste du BOFU se fait en stories). */
export const DEFAULT_WEEKLY_TARGETS: WeeklyReelTargets = { TOFU: 24, MOFU: 9, BOFU: 2 };

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
  /* --- Classement funnel (2026-10-15) --- */
  /** TOFU / MOFU / BOFU, decide par le modele. */
  etape?: SwipeStage;
  /** Format parmi SWIPE_FORMATS, vide si le modele n'a rien reconnu. */
  format?: SwipeFormat | "";
  /** Confiance du classement, 0 a 100. */
  confiance?: number;
  /** Une personne face camera, ou deux personnes qui se parlent. */
  speakers?: SwipeSpeakers;
  /* --- Classement selon les principes de Hans (2026-10-22) --- */
  /** Pourquoi cette etape, en une ou deux phrases. */
  justification?: string;
  /** Emotion dominante (TOFU) ou objection traitee (MOFU / BOFU). */
  emotion?: string;
  /** Structure narrative en quelques mots (ex. « hook → anecdote → lecon → question »). */
  structure?: string;
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
  /** Texte incruste a l'ecran, saisi a la main (optionnel), donne au classement. */
  screenTextInput?: string;
  /** Script d'origine (ex. anglais) garde quand `transcriptInput` a ete traduit en francais. */
  transcriptSourceInput?: string;
  /** Langue detectee du script d'origine a la traduction (ex. « en »). */
  transcriptLang?: string;
  tags: string;
  analysis: SwipeAnalysis | null;
  status: "a-analyser" | "analyse" | "a-tourner" | "fait";
  /** Etape corrigee a la main : prime toujours sur `analysis.etape`. */
  etapeManuelle?: SwipeStage | "";
  /* --- Chaine de production (2026-10-15) --- */
  /** Absent = « source ». */
  prodStatus?: SwipeProdStatus;
  /** Date du passage a chaque statut (ISO). */
  prodDates?: Partial<Record<SwipeProdStatus, string>>;
  /** Le script court a tourner (onglet « Mon script »). */
  script?: SwipeScript | null;
  /** Dossier de montage rattache (rushs du monteur). */
  editJobId?: string;
  /* --- Fiche de production (2026-10-22) --- */
  /** Mes notes personnelles sur ce Reel. */
  notes?: string;
  /** Besoin de tournage pour ma version (voir SwipeNeed). Absent = pas encore choisi. */
  need?: SwipeNeed;
  transcriptSource?: SwipeTranscriptSource;
  /** Vrai quand la transcription automatique a echoue : il faut importer un fichier ou coller le texte. */
  transcriptNeeded?: boolean;
  /** Date de tournage prevue (AAAA-MM-JJ). */
  shootAt?: string;
  /** Date de publication prevue (AAAA-MM-JJ). */
  publishAt?: string;
  /** Qui tourne / monte (nom libre). */
  assignee?: string;
  /** Notes de tournage (lieu, tenue, accessoires, plans). */
  shootNotes?: string;
  /** Lien de ma video publiee. */
  publishedUrl?: string;
  metrics?: Partial<SwipeMetrics>;
  createdAt: string;
}

export function swipeProdStatus(s: Pick<Swipe, "prodStatus">): SwipeProdStatus {
  return s.prodStatus ?? "source";
}

/** Etape retenue pour un swipe : la correction manuelle d'abord, sinon l'auto. */
export function swipeStage(s: Pick<Swipe, "etapeManuelle" | "analysis">): SwipeStage | "" {
  return s.etapeManuelle || s.analysis?.etape || "";
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
  /** Generation lancee depuis un swipe (prompts IA inline) : le swipe et le prompt d'origine. */
  swipeId?: string;
  /** « image:0 », « video:2 » : l'index du prompt dans l'analyse. */
  swipeSlot?: string;
  /** Eleve proprietaire (Studio IA par eleve). Absent = generation de l'admin / du monteur. */
  ownerId?: string;
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
  outreachLists: OutreachList[];
  outreachContacts: OutreachContact[];
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
  /** Bonus / malus poses par le proprietaire. */
  commissionAdjustments: CommissionAdjustment[];
  activityLogs: ActivityLog[];
  shifts: Shift[];
  /** Pointage reel : sessions de travail demarrees et terminees par les membres. */
  workSessions: WorkSession[];
  /** Temoignages clients (captures, videos, audios) deposes en vrac pour les retrouver. */
  testimonials: Testimonial[];
  /** Investissements business du proprietaire (accompagnements, contenu, outils). */
  investments: BusinessInvestment[];
  /** Cases cochees de la liste de taches quotidienne, par membre et par jour. */
  taskChecks: TaskCheck[];
  /** Bibliotheque de B-roll partagee avec le monteur, hors dossiers de montage. */
  broll: BrollItem[];
  /** Modules video de la plateforme de formation des eleves. */
  courseModules: CourseModule[];
  /** Annexes PDF de la formation, a piocher pour les envoyer aux eleves. */
  courseResources: CourseResource[];
  courseSteps: CourseStep[];
  /** Tableaux de strategie creative (facon Miro) de la section Ads. */
  adBoards: AdBoard[];
  /* --- Generateur de boutiques Shopify (src/lib/boutique) --- */
  /** Boutiques clientes connectees (jeton d'app personnalisee). */
  shops: ClientShop[];
  /** Historique des generations, une ligne par boutique construite. */
  shopBuilds: ShopBuild[];
  /** Vidéos YouTube US à adapter : transcript et script. */
  ytVideos: YtVideo[];
  /** Content OS : les contenus du pipeline de production. */
  contentItems: ContentItem[];
  /* --- Media buying Meta Ads (src/lib/mediabuying) --- */
  /** Comptes publicitaires Meta connectes (jeton chiffre). */
  metaConnections: MetaConnection[];
  /** Photo des campagnes / ad sets / ads / stats par compte, relue par l'interface. */
  mbSnapshots: MetaSnapshot[];
  /** Cibles (CPL, CTR…) et objectifs de leads par compte. */
  mbSettings: MediaBuyingSettings[];
  /** Phase, objectif et notes internes par campagne Meta. */
  mbCampaignData: CampaignInternalData[];
  /** Winner / loser et notes internes par ad Meta. */
  mbAdData: AdInternalData[];
  /** Journal de toutes les actions faites depuis l'outil. */
  mbAuditLogs: MediaBuyingAuditLog[];
  /** Campagnes preparees dans le builder, publiees ou non. */
  mbDrafts: CampaignDraft[];
  /** Templates de messages (liste des leads, CRM). */
  messageTemplates: MessageTemplate[];
  /** Liens traques (Sales → Liens UTM). */
  utmLinks: UtmLink[];
  /** Exemples de setting (Messages → Exemples). */
  settingExamples: SettingExample[];
  /** Relances envoyees par l'admin aux setters. */
  setterTasks: SetterTask[];
  /** Liens Google Meet generes (Outils → Lien Meet). */
  meetLinks: MeetLink[];
}

/* ===================================================================== *
 *                      ADS : tableau de strategie                        *
 * ===================================================================== */

/** "text" : du texte libre sans fond, pour les titres et les grandes idees. */
export type BoardCardKind = "note" | "text" | "image" | "link" | "zone";

/**
 * Une carte posee sur le tableau. Coordonnees et tailles en pixels « monde »,
 * independantes du zoom.
 */
export interface BoardCard {
  id: string;
  kind: BoardCardKind;
  x: number;
  y: number;
  w: number;
  h: number;
  /** note : le texte ; zone et lien : le titre ; image : la legende. */
  text: string;
  /** image : /api/media/… ; lien : l'adresse. */
  url: string;
  /** Cle de couleur ("" = neutre, "yellow", "green", "blue", "pink", "orange"). */
  color: string;
  /** Origine d'un hook repris : "swipe:<id>" ou "script:<id>". Vide sinon. */
  source: string;
  /** Ordre d'empilement ; les zones sont toujours derriere. */
  z: number;
  /** Taille de police en px (notes et textes). Absent = 13 pour une note, 24 pour un texte. */
  fontSize?: number;
}

/** Une fleche d'une carte a une autre (zone comprise), avec un libelle facultatif. */
export interface BoardArrow {
  id: string;
  from: string;
  to: string;
  /** Meme cle de couleur que les cartes ("" = neutre). */
  color: string;
  label: string;
}

/** Un tableau par dossier Ads, plus un tableau global (`folderId` vide). */
export interface AdBoard {
  id: ID;
  /** Dossier Ads lie (source des hooks a importer). "" = aucun. */
  folderId: ID | "";
  title: string;
  cards: BoardCard[];
  arrows?: BoardArrow[];
  /** Cle du fond : "dots" (defaut), "grid", "plain", "white", "paper", "dark", "mint". */
  background?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Un B-roll : un plan de coupe (video ou image) mis a disposition du monteur
 * sans etre rattache a un dossier. Il pioche dedans pour les reels comme pour
 * les pubs. `addedAt` sert au badge « nouveau » de son cote.
 */
export interface BrollItem {
  id: ID;
  /** Nom du fichier d'origine. */
  name: string;
  /** /api/media/<fichier> */
  url: string;
  size: number;
  kind: "video" | "image";
  /** Ce que montre le plan, ou l'utiliser. */
  note: string;
  /** Etiquettes libres : lifestyle, ecran, produit, drone… */
  tags: string[];
  addedAt: string;
}

/** Une tache quotidienne cochee par un membre, un jour donne (heure de Paris). */
export interface TaskCheck {
  id: ID;
  memberId: ID;
  /** AAAA-MM-JJ a Paris. */
  day: string;
  /** Libelle de la tache au moment ou elle a ete cochee. */
  task: string;
  doneAt: string;
}

/**
 * Un temoignage : un fichier depose (capture d'ecran d'un DM, video, vocal)
 * avec une note libre pour se souvenir de qui et de quoi il s'agit.
 */
/**
 * Investissement business (2026-10-16) : accompagnement, creation de
 * contenu, outils… Ce que le proprietaire met dans le business, a part des
 * pubs (Meta Ads). Liste datee, total sur le Pilotage.
 */
export interface BusinessInvestment {
  id: ID;
  label: string;
  amount: number;
  currency: string;
  category: "accompagnement" | "contenu" | "outils" | "equipe" | "pub" | "autre";
  /** « AAAA-MM-JJ ». */
  at: string;
  notes: string;
  createdAt: string;
}

export interface Testimonial {
  id: ID;
  /** Nom du fichier d'origine. */
  name: string;
  /** /api/media/<fichier> */
  url: string;
  size: number;
  kind: "image" | "video" | "audio" | "file";
  /** Qui, quel resultat, ou l'utiliser… */
  note: string;
  /** Etiquettes libres, ex. « avant/après », « vocal », « story ». */
  tags: string[];
  addedAt: string;
}

/* ----------------------- Generateur de boutiques ------------------------ */

/** Zip du theme template, servi a Shopify par une URL publique a jeton. */
export interface ShopThemeZip {
  /** Nom du fichier sur le disque (data/boutiques/). */
  file: string;
  /** Nom d'origine, affiche. */
  name: string;
  size: number;
  uploadedAt: string;
  /** Segment aleatoire de l'URL publique. */
  token: string;
}

/**
 * Une boutique Shopify cliente (2026-10-19). Le proprietaire cree une app
 * personnalisee dans l'admin du client et colle ici son jeton Admin API.
 * Le jeton ne ressort jamais en clair vers le navigateur.
 */
export interface ClientShop {
  id: ID;
  /** Nom du client ou de la marque, pour s'y retrouver. */
  name: string;
  /** « maboutique.myshopify.com ». */
  domain: string;
  /**
   * Jeton Admin API (shpat_…) d'une app personnalisee « legacy » creee dans
   * l'admin avant le 2026-01-01. Vide quand on passe par le Dev Dashboard.
   */
  accessToken: string;
  /**
   * App creee dans le Dev Dashboard de l'organisation du client (depuis
   * 2026) : le jeton s'obtient avec ces identifiants (client credentials),
   * il vaut 24 h et se renouvelle tout seul.
   */
  clientId?: string;
  clientSecret?: string;
  /** Dernier jeton echange, avec sa date d'expiration (ISO). */
  tokenCache?: { token: string; expiresAt: string } | null;
  notes: string;
  /** Rempli par « Tester la connexion ». */
  shopName?: string;
  currency?: string;
  lastTestAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** Produit relu sur un site concurrent, tel qu'il sera recree. */
export interface ScrapedProduct {
  sourceUrl: string;
  handle: string;
  title: string;
  descriptionHtml: string;
  vendor: string;
  productType: string;
  tags: string[];
  options: { name: string; values: string[] }[];
  variants: {
    title: string;
    price: string;
    compareAtPrice: string;
    sku: string;
    optionValues: string[];
  }[];
  images: { src: string; alt: string }[];
}

/** Ce que le proprietaire demande pour une generation. */
export interface ShopBuildBrief {
  /** Nom de marque impose ; vide = l'IA le propose. */
  brandName: string;
  /** Langue du copywriting (fr par defaut). */
  language: string;
  /** Positionnement, cible, ton… libre. */
  notes: string;
  /** Couleurs imposees ; vides = l'IA choisit. */
  primaryColor: string;
  secondaryColor: string;
  /** Installer le theme template et le publier. */
  installTheme: boolean;
  publishTheme: boolean;
  /** Recopier les prix des concurrents tels quels, ou appliquer un coefficient. */
  priceFactor: number;
}

export type ShopBuildStatus = "running" | "done" | "error";

/** Une generation de boutique, de l'analyse des concurrents a la publication. */
export interface ShopBuild {
  id: ID;
  shopId: ID;
  status: ShopBuildStatus;
  /** Etape en cours, affichee telle quelle. */
  step: string;
  /** Journal lisible, une ligne par action. */
  log: string[];
  competitorUrls: string[];
  brief: ShopBuildBrief;
  result?: {
    brandName: string;
    tagline: string;
    palette: { primary: string; secondary: string };
    products: { title: string; handle: string; adminUrl: string }[];
    collectionHandle: string;
    themeId: string;
    themeName: string;
    previewUrl: string;
    storeUrl: string;
    adminUrl: string;
    /** Zip du template recoloré et réécrit (data/boutiques/), à importer à la main. */
    readyZipFile?: string;
  };
  error?: string;
  createdAt: string;
  finishedAt?: string;
}

/** Une vidéo YouTube de référence : vignette, transcript, puis le script adapté. */
export interface YtVideo {
  id: ID;
  videoId: string;
  url: string;
  title: string;
  author: string;
  thumbnail: string;
  durationSec: number;
  transcript: string;
  /** Langue des sous-titres, vide tant que rien n'est récupéré. */
  transcriptLang: string;
  /** « captions » (sous-titres YouTube), « gemini » (video lue par Gemini), « whisper » (audio transcrit), « manual », vide sinon. */
  transcriptSource: "captions" | "gemini" | "whisper" | "manual" | "";
  /** Analyse + script produits par le modèle avec le prompt du scénariste. */
  script: string;
  scriptAt: string;
  notes: string;
  /** Mon plan : le déroulé de MA vidéo (collé à la main), onglet « Mon plan » de la fiche. */
  plan?: string;
  /** Vidéo tournée : les rushs sont à envoyer au monteur (date ISO), vide sinon. */
  filmedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------ Content OS ------------------------------ */

export interface CosHabit {
  id: ID;
  label: string;
  order: number;
}

export interface CosResource {
  id: ID;
  label: string;
  url: string;
  notes: string;
}

export interface CosProject {
  id: ID;
  title: string;
  status: "done" | "doing" | "todo";
  order: number;
}

export interface ContentOsState {
  habits: CosHabit[];
  /** AAAA-MM-JJ (date locale du user) → ids des habitudes cochées ce jour-là. */
  habitLog: Record<string, string[]>;
  /** AAAA-MM-JJ → la priorité du jour. */
  priorities: Record<string, string>;
  routineItems: CosHabit[];
  /** Lundi de la semaine (AAAA-MM-JJ) → ids cochés. */
  routineLog: Record<string, string[]>;
  resources: CosResource[];
  projects: CosProject[];
}

export type ContentStatus = "idea" | "script" | "ready" | "shot" | "editing" | "review" | "scheduled" | "published";

/** Un contenu dans le pipeline de production. */
export interface ContentItem {
  id: ID;
  title: string;
  platform: "youtube" | "instagram";
  format: "vlog" | "value" | "reel" | "testimonial" | "challenge";
  funnel: "TOFU" | "MOFU" | "BOFU";
  hook: string;
  plan: string;
  owner: string;
  /** AAAA-MM-JJ. */
  dueAt: string;
  rushesUrl: string;
  editUrl: string;
  status: ContentStatus;
  views: number;
  comments: number;
  dms: number;
  leads: number;
  postNotes: string;
  /** Contenu gagnant à reproduire. */
  winner: boolean;
  winnerNotes: string;
  variations: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export type CollectionName = Exclude<keyof DB, "settings">;

/* ----------------------------- Outreach VA ------------------------------ */

/** Avancement d'un contact Instagram a prospecter. Quatre etats, pas plus. */
export type OutreachStatus = "to-contact" | "contacted" | "replied" | "issue";

/**
 * Liste de prospection : un import CSV = une liste. Les listes ne se
 * melangent jamais, et chacune garde son avancement pour etre reprise plus
 * tard exactement ou elle en etait.
 */
export interface OutreachList {
  id: ID;
  name: string;
  /** Nom du fichier importe, pour s'y retrouver. */
  fileName: string;
  createdAt: string;
  createdBy: string;
}

export interface OutreachContact {
  id: ID;
  listId: ID;
  /** Pseudo Instagram, sans arobase, en minuscules. La donnee principale. */
  username: string;
  name: string;
  /** Autres colonnes du CSV, conservees telles quelles sans etre affichees. */
  extra: Record<string, string>;
  status: OutreachStatus;
  statusAt: string;
  /**
   * Premier passage hors de « To Contact » (DM envoye). Ne bouge plus
   * ensuite : c'est ce qui compte dans l'objectif du jour, meme si le
   * contact repond plus tard et change de statut.
   */
  contactedAt?: string;
  /** Position dans le fichier d'origine. */
  order: number;
  createdAt: string;
}

/**
 * Session de travail pointee par un membre (« Démarrer » / « Terminer »).
 *
 * Distincte des creneaux (`Shift`), qui sont le planning propose par l'admin :
 * ici c'est le temps reellement passe, base des heures travaillees.
 */
export interface WorkSession {
  id: ID;
  memberId: ID;
  startedAt: string;
  /** Vide tant que la session est en cours. */
  endedAt: string;
  note: string;
  /** Qui l'a terminee : le membre, ou l'admin s'il a oublie. */
  endedBy: ID;
  createdAt: string;
}

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
export type SessionRole = "owner" | "admin" | "setter" | "closer" | "editor" | "va" | "student" | "anonyme";

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

/**
 * Confirmation du rendez-vous par le setter, la veille ou le jour meme.
 *
 * Demande des closers (octobre 2026) : trop de no-shows. Un call non confirme
 * est un call a risque ; « pas de reponse » dit au closer de ne pas compter
 * dessus et au setter de relancer. Distinct du statut, qui suit la vie du
 * rendez-vous : confirmer un call « booked » le passe en « confirmed ».
 *
 * « awaiting » est l'etape intermediaire : le message de confirmation est
 * parti, on attend la reponse du lead. Elle finit en « confirmed » ou en
 * « no-answer ».
 */
export type AppointmentConfirmation = "" | "awaiting" | "confirmed" | "no-answer";

/** Une offre du catalogue : ce que le closer vend, a quel prix, avec quels arguments. */
export interface SalesOffer {
  id: string;
  name: string;
  /** Prix affiche, dans la devise des ventes (salesCurrency). 0 = non precise. */
  price: number;
  description: string;
}

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

/** Action a venir choisie par le closer quand le call n'a pas close. */
export type RecapNextAction = "" | "call" | "new-appointment" | "none";

/**
 * Objectif e-commerce du lead, tel que determine pendant le call (retour des
 * closers : pas de montant, ce qui compte c'est ce qu'il vise).
 */
export type EcomObjective = "side-income" | "replace-salary" | "build-brand" | "optimize-sales" | "other";
export const ECOM_OBJECTIVES: EcomObjective[] = ["side-income", "replace-salary", "build-brand", "optimize-sales", "other"];
export const ECOM_OBJECTIVE_LABEL: Record<EcomObjective, string> = {
  "side-income": "Faire un complément de revenu",
  "replace-salary": "Remplacer son salaire",
  "build-brand": "Construire une vraie marque",
  "optimize-sales": "Optimiser ses ventes",
  other: "Autre",
};

/**
 * Recap du call, rempli par le closer juste apres (demande des closers,
 * octobre 2026). Le statut du rendez-vous en decoule : close -> closed-won,
 * sinon selon l'action a venir (rappeler -> follow-up, nouveau rendez-vous
 * -> rescheduled, rien -> closed-lost).
 */
export interface CallRecap {
  closed: boolean;
  /** Si pas close : la raison (cle LostReason) et le detail libre. */
  notClosedReason: LostReason | "";
  notClosedDetail: string;
  pitched: boolean;
  notPitchedReason: string;
  /** Ce qu'on a appris sur le lead : situation, projet, objections. */
  leadInfo: string;
  /** Objectif e-commerce du lead, et sa precision si « Autre ». */
  objective: EcomObjective | "";
  objectiveOther: string;
  /** Ancien champ (montant) : plus propose, garde pour les recaps deja saisis. */
  budget?: string;
  nextAction: RecapNextAction;
  /** Date de l'action a venir (ISO), si rappel ou nouveau rendez-vous. */
  nextActionAt: string;
  filledAt: string;
  filledBy: string;
}

export interface Appointment {
  id: ID;
  /** Recap post-call du closer. Absent tant que le call n'a pas ete debriefe. */
  recap?: CallRecap;
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
  /**
   * Parametres du lien de reservation (utm_source, utm_medium, utm_campaign,
   * utm_content, referent, identifiant Meta), tels que lus chez iClosed.
   * Voir lib/sales/sources.ts. Absent sur les rendez-vous saisis a la main.
   */
  utm?: Record<string, string>;
  status: AppointmentStatus;
  /** Rendez-vous juge qualifie par l'admin : sert aux commissions "par rdv qualifie". */
  qualified: boolean;
  /** Confirmation par le setter. Absent ou "" : pas encore confirme. */
  confirmation?: AppointmentConfirmation;
  confirmationAt?: string;
  confirmationBy?: ID;
  /* --- Double confirmation WhatsApp (2026-10-27) : le setter ecrit au lead
     24 h avant le call, puis 1 h avant. Date de chaque envoi, vide sinon. --- */
  reminder24At?: string;
  reminder1At?: string;
  /** Contexte laisse par le setter au closer : budget, objectif, objections. */
  setterNotes: string;
  /** Compte-rendu du closer apres le call. */
  closerNotes: string;
  lostReason: LostReason | "";
  /** Lien de visio iClosed, si le rendez-vous vient de la. */
  iclosedUrl: string;
  /** Identifiant iClosed, pour rapprocher plus tard via l'API ou le webhook. */
  iclosedEventId: string;
  /* --- Fathom : l'enregistrement du call et son resume (src/lib/fathom.ts). --- */
  fathomRecordingId?: string;
  fathomUrl?: string;
  fathomSummary?: string;
  fathomAt?: string;
  /** Calendrier / type d'evenement iClosed (callType) sur lequel le prospect a reserve. */
  calendar?: string;
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
  /**
   * Encaissements recus apres la vente (client qui paie en plusieurs fois).
   * `cashCollected` reste le total ; chaque encaissement est date pour que
   * la commission sur le cash tombe au mois ou l'argent arrive vraiment.
   */
  collections?: SaleCollection[];
  /**
   * Plan de paiement en plusieurs fois : les echeances a venir, calculees a
   * la vente (un mois d'ecart, reste reparti) et modifiables ensuite. La
   * premiere echeance (cash du jour) n'y figure pas.
   */
  schedule?: SaleInstallment[];
  /**
   * Contrat envoye, rien encaisse : date (AAAA-MM-JJ) a laquelle le premier
   * paiement est attendu. Passee sans encaissement, la vente remonte en
   * « paiement non reçu » : relancer, ou annuler la vente si le client ne
   * paie pas (le chiffre d'affaires redescend alors d'autant).
   */
  paymentExpectedAt?: string;
  /**
   * Vente remontee par iClosed (deal « win ») : le montant est connu, pas la
   * facon de payer (une fois, en plusieurs fois, contrat envoye). Le contrat
   * compte dans le chiffre d'affaires tout de suite ; le cash attend que le
   * closer precise. Repasse a faux des que le paiement est renseigne.
   */
  paymentUnspecified?: boolean;
}

/** Une echeance de paiement. `paidAt` vide tant qu'elle n'est pas encaissee. */
export interface SaleInstallment {
  /** Numero dans le plan, premiere echeance (cash du jour) = 1. */
  n: number;
  /** AAAA-MM-JJ. */
  dueAt: string;
  amount: number;
  paidAt: string;
}

export interface SaleCollection {
  id: ID;
  amount: number;
  /** Date de reception (ISO). */
  at: string;
  method: string;
  note: string;
  /** Qui l'a enregistre. */
  by: ID;
  createdAt: string;
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
  /** Journal de la relance : « message envoyé », reports, cloture. */
  log?: FollowUpLog[];
  /** Dernier contact effectif avec le prospect (message, appel). */
  lastContactAt?: string;
  /** Sequence : 1 = premiere relance (J+1), 2 = derniere relance (J+3). Sans valeur : relance libre. */
  step?: 1 | 2;
  /** Temperature du prospect a la sortie du call : chaud, tiede, froid. */
  heat?: FollowUpHeat;
}

/** Canal par lequel un setter a envoye le lien du calendrier. */
export type LinkChannel = "instagram" | "whatsapp" | "sms" | "email" | "phone" | "other";
export const LINK_CHANNELS: LinkChannel[] = ["instagram", "whatsapp", "sms", "email", "phone", "other"];
export const LINK_CHANNEL_LABEL: Record<LinkChannel, string> = {
  instagram: "DM Instagram",
  whatsapp: "WhatsApp",
  sms: "SMS",
  email: "Email",
  phone: "Au téléphone",
  other: "Autre",
};

/** Chaleur d'un prospect en attente : ce qu'on note en statuant le call. */
export type FollowUpHeat = "hot" | "warm" | "cold";
export const FOLLOWUP_HEATS: FollowUpHeat[] = ["hot", "warm", "cold"];
export const FOLLOWUP_HEAT_LABEL: Record<FollowUpHeat, string> = { hot: "Chaud", warm: "Tiède", cold: "Froid" };
export const FOLLOWUP_HEAT_ICON: Record<FollowUpHeat, string> = { hot: "🔥", warm: "🌤", cold: "❄️" };

export interface FollowUpLog {
  at: string;
  actorName: string;
  /** « contact » : j'ai relancé ; « reschedule » : report ; « note » : commentaire ; « status » : cloture. */
  kind: "contact" | "reschedule" | "note" | "status";
  note: string;
}

/**
 * Mode de remuneration.
 *
 * `pct-revenue` porte sur la valeur de contrat, `pct-cash` sur le cash
 * reellement encaisse. C'est la distinction qui change tout quand les clients
 * paient en plusieurs fois.
 */
export type CommissionType =
  | "monthly-fixed"
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
  /**
   * Fixe mensuel, verse chaque mois quel que soit le resultat. Seul montant
   * du type `monthly-fixed` ; optionnel en complement des autres types
   * (fixe + variable). Absent sur les regles anterieures = 0.
   */
  monthlyFixed?: number;
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
  /**
   * « bonus » : prime, onboarding, geste commercial. Verse et trace comme un
   * versement, mais hors commissions : il ne vient pas en deduction du du.
   * Absent = versement de commission ordinaire.
   */
  kind?: "commission" | "bonus";
  createdBy: ID;
  createdAt: string;
}

/**
 * Bonus ou malus pose a la main par le proprietaire (2026-10-14).
 *
 * Il entre dans le gagne du membre comme n'importe quelle commission : un
 * bonus augmente le reste du, un malus le diminue. En montant fixe, ou en
 * pourcentage de ce que le membre a gagne sur le mois de la date choisie.
 * Jamais modifie : on le supprime et on en recree un.
 */
export interface CommissionAdjustment {
  id: ID;
  memberId: ID;
  role: "setter" | "closer";
  kind: "bonus" | "malus";
  /** « amount » : montant en devise ; « pct » : pourcentage du gagne du mois (hors ajustements). */
  mode: "amount" | "pct";
  value: number;
  reason: string;
  /** Date d'attribution (ISO) : decide la periode, et le mois de reference en mode pct. */
  at: string;
  currency: string;
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
  entity: "appointment" | "sale" | "follow-up" | "lead" | "member" | "commission" | "outreach";
  entityId: ID;
  /** Phrase lisible affichee telle quelle dans le journal. */
  summary: string;
  /** Autre entite concernee : pour « lead.takeover », le setter qui a perdu la conversation. */
  relatedId?: ID;
}
