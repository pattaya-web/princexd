import type { Settings, StudentMethodSettings } from "@/lib/types";

/**
 * Pages « Recherche produit » et « Ta boutique » de la plateforme élèves
 * (Scale X) : la vidéo BrandSearch, la consigne des 10 produits à envoyer à
 * Mady sur WhatsApp, et le message que l'élève colle à Claude Code pour
 * poser le thème de Mady sur sa boutique. Valeurs par défaut ici, tout est
 * modifiable par l'admin depuis les pages. Module pur : serveur et navigateur.
 */

export const DEFAULT_PRODUCT_COUNT = 10;

export const DEFAULT_THEME_PROMPT = `Dans mon dossier il y a le fichier [NOM-DU-ZIP].zip : c'est le thème Shopify « Aesthetic Lab » de mon coach Mady (Online Store 2.0, dossiers assets / config / layout / locales / sections / snippets / templates à la racine, avec un README.md à lire en premier). Sa page est parfaite. Tu ne changes ni la structure, ni le design, ni l'ordre des sections, ni les couleurs, ni les polices, ni le CSS.

Ma boutique : [mon-adresse].myshopify.com
Mon produit : [nom, ce que c'est, ce qu'il fait, prix de vente, prix barré]
Ma marque : [nom de marque] · e-mail support : [support@…]
Ma cible : [qui achète et pourquoi]
Mes images et vidéos : dans le sous-dossier « creatives »
Mes accès Shopify (Client ID et Client secret de mon app Dev Dashboard, app déjà installée sur la boutique) : je les mets dans le fichier .env, jamais dans ce chat.

Fais tout toi-même avec Shopify CLI, je ne tape aucune commande :
1. Décompresse le zip dans un dossier « theme » et lis le README.md.
2. Connecte-toi à ma boutique avec le fichier .env (renomme .env.example en .env et dis-moi quoi y coller : SHOPIFY_FLAG_STORE, Client ID, Client secret). Si Shopify répond « app not installed », dis-le moi : j'installe l'app depuis le Dev Dashboard et on continue.
3. Envoie le thème sur ma boutique sans le publier (shopify theme push --unpublished), dis-moi quand je peux le publier dans Shopify > Boutique en ligne > Thèmes.
4. Une fois publié et le mot de passe retiré : travaille en live sur le thème publié. Pas de lien de prévisualisation : je fais F5 sur ma boutique et je vois le changement.
5. Remplace UNIQUEMENT le contenu, dans cet ordre, une section à la fois, et attends mon OK entre chaque :
   - Réglages du thème : nom de marque (wordmark), favicon, e-mail support, liens clés (produit principal, collection principale).
   - Hero : ma vidéo 9:16 (ou mon image) du dossier creatives à la place des aplats gris, titre et sous-titre pour mon produit.
   - Sections bénéfices, comment ça marche, avant / après, avis, FAQ, pied de page : réécris tous les textes pour mon produit, en français, même longueur que les textes existants ; mets mes images à la place des placeholders ; propose-moi 6 avis clients crédibles à valider.
   - Page produit : garde un seul template produit, supprime les exemples (jawliner, patch, tape, peptide…), crée mon produit (titre, description, prix, prix barré, images) et les métachamps aesthetic_lab que le README décrit.
   - Dis-moi les images ou vidéos qui manquent, à quel endroit, et dans quel format (3:4, 1:1, 9:16, 16:9) : je les génère dans mon Studio IA.
6. Vérifie que la page d'accueil et la page produit s'affichent bien sur mobile.

Si une erreur apparaît, corrige-la et continue. Explique-moi chaque étape en une phrase simple, sans jargon.`;


export const DEFAULT_METHOD: StudentMethodSettings = {
  productVideoUrl: "https://youtu.be/63LKEzcg5Bo",
  productCount: DEFAULT_PRODUCT_COUNT,
  productNote:
    "Regarde la vidéo en entier, puis fais la recherche sur BrandSearch. Remplis le tableau avec tes 10 produits et envoie-le à Mady sur WhatsApp. Il valide ton produit avec toi, puis tu passes aux créatives.",
  themeNote:
    "Aesthetic Lab, c'est ma page qui convertit, livrée vide : les textes et les sections sont là, les médias sont des aplats gris à remplacer. Elle est parfaite : tu ne touches ni à la structure, ni au design. Tu changes seulement les textes, les images, les vidéos et le produit pour que ce soit le tien. C'est Claude Code qui fait le travail avec Shopify CLI, dans VS Code : tu lui donnes le fichier et le message ci-dessous.",
  themePrompt: DEFAULT_THEME_PROMPT,
  shopVideoUrl: "https://youtu.be/gjm9FH_ewho",
  shopVideoSummary: `Dans cette vidéo, Mady crée la boutique de son élève Ahmed de A à Z, en direct, avec Claude Code dans VS Code. Le principe : tu ne tapes aucune commande et tu ne touches à aucun code. Tu donnes à Claude le thème de Mady (le zip), tu le connectes à ta boutique Shopify, et ensuite tu lui parles comme à un pote pour tout modifier : sections, menus, logo, couleurs, textes, images. À chaque demande, tu fais F5 sur ta boutique et le changement est là.

Les 3 règles de Mady : 1) Claude est ton meilleur ami, toutes les questions que tu te poses, tu les lui poses à lui. 2) Tu lui donnes du contexte à chaque message, tu écris proprement (peu de fautes, Shift + Entrée pour aller à la ligne, ou tu dictes au micro) : « il n'y a pas de mauvaises IA, il n'y a que de mauvais prompts ». 3) Tu ne restes jamais bloqué : s'il te propose un détour (un lien de prévisualisation, par exemple) et que tu veux autre chose, tu le lui dis clairement et il le fait.

Il te faut : VS Code installé, l'extension « Claude Code for VS Code », Claude Max (90 €/mois, la version à 200 € n'est pas nécessaire), le zip du thème envoyé par Mady, et le Client ID + Client secret de ton app Shopify (ceux que tu as envoyés à Mady). Modèle à choisir dans Claude Code : Fable 5.1 ou Opus 5.5.

À savoir aussi : en dehors de VS Code, Claude pour Chrome peut prendre le contrôle de ton navigateur et faire des tâches à ta place (créer ton Pixel Meta, ajouter un produit sur Shopify, changer une description). VS Code + Claude Code, c'est uniquement pour construire la boutique. La fin de la vidéo montre la suite : récupérer la couleur et les images d'un concurrent pour aller vite, puis faire tes propres images produit dans le Studio IA et adapter tout le copywriting à ton produit.`,
  shopVideoSteps: `Avant de commencer : Claude et Shopify doivent déjà être connectés (Démarrage, étapes 03 à 06 : accès de ta boutique, dossier avec le zip, premier message, fichier .env, thème publié, live). Si ce n'est pas fait, commence par là.
Organise ton écran : trois onglets (tableau de bord Shopify, éditeur de thème « Personnaliser », ta boutique en ligne) et VS Code avec Claude à gauche. À chaque modification, F5 sur la boutique.
Enlève ce qui n'est pas ton produit : « Enlève la section de la page d'accueil où il y a écrit Jaw trainer, pimple patch, nose tape ». Tu t'es trompé ? « Annule ce que tu viens de faire, remets la section ».
Les menus : « Change les menus : enlève Glow up, Our protocol, Track my order, remplace par Accueil, Collection, Contact ».
La police : « Je ne suis pas fan de cette police, mets-la plus grasse et plus espacée ». Une demande à la fois, F5, tu vérifies.
Ton logo : fais-le sur Canva en 450 × 150 px, simple. Glisse le fichier dans la fenêtre Claude Code : « Voilà mon logo, mets-le sur ma boutique à la place de l'actuel ».
Tes couleurs, à partir d'un concurrent : extension ColorZilla, prends la couleur principale de la boutique de ton concurrent direct, colle le code couleur à Claude : « Je veux cette couleur comme couleur principale des titres, sur un fond blanc, et trouve-moi une deuxième couleur un peu plus claire qui va avec ».
Les images produit : pour aller vite, les images d'un concurrent se récupèrent avec l'extension CSS Peeper (onglet Assets), mais tes vraies images, tu les fais dans le Studio IA (page Créatives). Mets-les dans le sous-dossier « creatives » et dis à Claude où les placer.
Le copywriting : colle l'adresse de la boutique du concurrent à Claude : « Analyse cette boutique, c'est mon concurrent direct. Réadapte mon thème actuel avec un copywriting pour mon produit ». Puis tu corriges section par section.
Ta page produit : « Garde un seul produit, supprime les exemples, crée le mien : titre, description, prix, prix barré, mes images ». Puis commande test depuis ton téléphone.
L'éditeur de thème Shopify en secours : « Personnaliser » permet de remettre une section ou de corriger un détail à la souris. Ce n'est pas le but, Claude fait tout, mais c'est là.
Si ça bloque, tu parles : capture d'écran du message rouge, « voilà l'erreur, corrige et continue ». Claude répond à toutes tes questions. Bloqué ? Claude Code d'abord. Mady sur WhatsApp pour les urgences et les validations.`,
  creativesVideoUrl: "https://youtu.be/cFohD4i16nM",
  creativesVideoSummary: `Dans cette vidéo, Mady fait les créatives du produit d'Ahmed (un coussin cervical orthopédique) en direct dans le Studio IA de la plateforme. Le principe : tu ne dessines rien, tu promptes. Tu prends le micro, tu expliques à Claude ou GPT ce que tu veux (le produit, le marché, le prix, les formats), il te sort les prompts, et tu les copies-colles dans le Studio IA. En moins de dix minutes de vidéo, neuf créatives sont générées, à 0,03 € l'image.

Les 7 familles de la page Créatives (marché US et francophone) : Punchy sales (gros titre, gros prix, badges, étiquettes, flèches, produit et prix entourés : très américain, très efficace), Native ads, Notes iPhone (très bonne : la personne clique direct), Tweet, Avant / après, Badge prix tag, Vidéo 9:16. Chaque élément qui accroche l'œil (post-it, badge, flèche jaune, prix entouré, headline) est un « hook visuel » : il en faut. Trop d'éléments et trop de texte, c'est raté.

Avant les prompts, l'angle : trouve la douleur. Le coussin, c'est les cervicales, le mauvais sommeil, la nuque brisée avant le petit-déjeuner. Tu vends une solution à un problème, plus la validation sociale (la copine au café qui demande où tu as acheté le tien, tout le monde qui regarde dans la rue). Tout produit se vend si tu as trouvé l'angle.

Pour la vidéo (Seedance 2.5) : toujours partir d'une image de référence générée en 9:16 (pas en 3:4, sinon la vidéo sort en 3:4 : Mady a fait l'erreur pour toi), plus deux à quatre photos de ton produit sous différents angles, et un prompt complet avec un hook, des changements de séquence, de la validation sociale et un appel à l'action à 15 secondes. Une vidéo coûte 2 à 3 €. Écris toujours « shot on iPhone 15, native, ultra organic » dans le prompt d'une photo réaliste. Ce que Mady attend : un drive avec 5 à 8 créatives (par exemple 2 vidéos + 3 à 6 images), plus les médias de la boutique (images produit, visuels de la page d'accueil, faux packaging si besoin). La suite, c'est les campagnes Meta : prends de l'avance en demandant à Claude de créer ton Ads Manager et ton Pixel.`,
  creativesVideoSteps: `Prépare le Studio IA : clé API KIE posée (page Studio IA), onglet Image (GPT Image 2) pour les statiques, onglet Création (Seedance 2.5) pour les vidéos. Ta référence : une photo de ton produit sur fond blanc, sans texte ni élément autour.
Trouve ton angle avant de prompter : demande à Claude ou GPT « voici mon produit, trouve-moi des angles marketing en respectant les 7 familles (Punchy sales, Native ads, Notes iPhone, Tweet, Avant / après, Badge prix tag, Vidéo 9:16) : on tape sur la douleur et on vend une solution, avec de la validation sociale ».
Demande les prompts au micro : « fais-moi 5 prompts punchy sales en 3:4 pour le marché US, produit à 59,99 $, avec badges, étiquettes, flèches, produit et prix entourés ; 5 prompts plus sobres avec de l'avant / après ; un format note iPhone ; et 3 images de référence pour des vidéos Seedance (une fille dans son lit qui déballe le produit, un unboxing, une réaction) ». Exige les prompts bruts, un par un. Écris toujours « shot on iPhone 15, native, ultra organic » dans le prompt d'une photo réaliste.
Génère en chaîne : image de référence, prompt collé, format 3:4, Générer. Ctrl + A, Ctrl + V, prompt suivant. Les créatives, c'est du copier-coller : dix créatives en moins de dix minutes, 0,03 € l'image.
Trie le premier batch : garde ce qui a un gros titre, un prix visible, un hook visuel, une mise en situation (elle se touche le cou). Jette ce qui est surchargé. Une erreur (« Designed in France » pour un produit US) ? Recolle le prompt à Claude ou GPT, dis-lui au micro ce qui cloche, il le réécrit.
Les formats pour Meta : statiques en 3:4, 1:1 ou 9:16, vidéos en 9:16.
Image de référence vidéo au format vertical : pour Seedance, génère d'abord l'image de départ en 9:16 (pas en 3:4, sinon la vidéo sort en 3:4).
Crée la vidéo (onglet Création) : image de départ en 9:16, deux à quatre photos de ton produit (face, dos, côté), prompt complet (hook, changement de séquence, validation sociale, appel à l'action à 15 s) ou juste le script si la personne parle face caméra. Réglages : Auto, 16 s (pour une vidéo de 15 s), 720 ou 480. 2 à 3 € la vidéo : surveille ton crédit KIE.
Adapte les prompts de Mady : copie la structure d'un prompt exemple (sous la vidéo) et dis à Claude « mon coach m'a envoyé cette structure pour des vidéos Seedance 2.5, adapte-la à mon produit avec la même structure, voici ma page produit ». Ajoute « la personne dit le prix du produit » si tu veux.
Ta livraison : un drive avec 5 à 8 créatives (par exemple 2 vidéos + 3 à 6 images), plus les médias de la boutique (images produit et visuels de la page d'accueil, faux packaging si tu veux) pour une boutique premium, pas bâclée.
Prends de l'avance : demande à Claude pour Chrome de créer ton compte Ads Manager et ton Pixel et de les connecter à ta boutique. Prochaine vidéo : les campagnes Meta. Claude et GPT sont tes meilleurs amis : micro, captures d'écran, corrections, tout le temps.`,
  metaVideoUrl: "",
  metaVideoSummary: "",
  metaVideoSteps: "",
};

export function methodSettings(settings: Pick<Settings, "studentMethod">): StudentMethodSettings {
  const s = settings.studentMethod ?? {};
  const count = Number(s.productCount);
  return {
    productVideoUrl: (s.productVideoUrl ?? "").trim() || DEFAULT_METHOD.productVideoUrl,
    productCount: Number.isFinite(count) && count >= 1 && count <= 30 ? Math.round(count) : DEFAULT_PRODUCT_COUNT,
    productNote: (s.productNote ?? "").trim() || DEFAULT_METHOD.productNote,
    themeNote: (s.themeNote ?? "").trim() || DEFAULT_METHOD.themeNote,
    themePrompt: (s.themePrompt ?? "").trim() || DEFAULT_THEME_PROMPT,
    // Vide enregistre = pas de video : l'admin peut la retirer sans que la valeur par defaut revienne.
    shopVideoUrl: s.shopVideoUrl === undefined ? DEFAULT_METHOD.shopVideoUrl : s.shopVideoUrl.trim(),
    shopVideoSummary: (s.shopVideoSummary ?? "").trim() || DEFAULT_METHOD.shopVideoSummary,
    shopVideoSteps: (s.shopVideoSteps ?? "").trim() || DEFAULT_METHOD.shopVideoSteps,
    creativesVideoUrl: (s.creativesVideoUrl ?? "").trim() || DEFAULT_METHOD.creativesVideoUrl,
    creativesVideoSummary: (s.creativesVideoSummary ?? "").trim() || DEFAULT_METHOD.creativesVideoSummary,
    creativesVideoSteps: (s.creativesVideoSteps ?? "").trim() || DEFAULT_METHOD.creativesVideoSteps,
    metaVideoUrl: (s.metaVideoUrl ?? "").trim(),
    metaVideoSummary: (s.metaVideoSummary ?? "").trim(),
    metaVideoSteps: (s.metaVideoSteps ?? "").trim(),
  };
}

/** Les etapes de la video, une par ligne ; « Titre : detail » ou « Titre — detail » se decoupe en titre + texte. */
export function parseVideoSteps(text: string): { title: string; text: string }[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:\d+[.)]|[-•*])\s*/, "").trim())
    .filter(Boolean)
    .map((l) => {
      const m = l.match(/^(.{3,80}?)\s*(?::|—|–| - )\s*(.+)$/);
      return m ? { title: m[1].trim(), text: m[2].trim() } : { title: l, text: "" };
    });
}

/** Lecture des réglages envoyés par l'admin : champs propres, bornés. */
export function readMethodSettings(raw: Partial<StudentMethodSettings>): StudentMethodSettings {
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const count = Number(raw.productCount);
  return {
    productVideoUrl: str(raw.productVideoUrl, 500),
    productCount: Number.isFinite(count) && count >= 1 && count <= 30 ? Math.round(count) : DEFAULT_PRODUCT_COUNT,
    productNote: str(raw.productNote, 2000),
    themeNote: str(raw.themeNote, 2000),
    themePrompt: str(raw.themePrompt, 8000),
    shopVideoUrl: str(raw.shopVideoUrl, 500),
    shopVideoSummary: str(raw.shopVideoSummary, 6000),
    shopVideoSteps: str(raw.shopVideoSteps, 8000),
    creativesVideoUrl: str(raw.creativesVideoUrl, 500),
    creativesVideoSummary: str(raw.creativesVideoSummary, 6000),
    creativesVideoSteps: str(raw.creativesVideoSteps, 8000),
    metaVideoUrl: str(raw.metaVideoUrl, 500),
    metaVideoSummary: str(raw.metaVideoSummary, 6000),
    metaVideoSteps: str(raw.metaVideoSteps, 8000),
  };
}

/** Colonnes du tableau de produits que l'élève remplit et envoie à Mady. */
export const PRODUCT_COLUMNS = [
  { key: "name", label: "Produit", placeholder: "ex. Masseur cervical" },
  { key: "link", label: "Lien (pub ou boutique qui le vend)", placeholder: "https://…" },
  { key: "price", label: "Prix de vente", placeholder: "ex. 39,90 €" },
  { key: "why", label: "Pourquoi il marche", placeholder: "ex. 40 pubs actives depuis 2 mois" },
] as const;

export type ProductRow = Record<(typeof PRODUCT_COLUMNS)[number]["key"], string>;

export const emptyProductRows = (n: number): ProductRow[] => Array.from({ length: n }, () => ({ name: "", link: "", price: "", why: "" }));

/** Le tableau en texte, prêt pour WhatsApp (une ligne par produit, colonnes séparées par « | »). */
export function productsAsText(rows: ProductRow[], firstName: string): string {
  const filled = rows.filter((r) => r.name.trim() || r.link.trim());
  const lines = filled.map((r, i) => `${i + 1}. ${r.name.trim() || "?"} | ${r.link.trim() || "pas de lien"} | ${r.price.trim() || "prix ?"} | ${r.why.trim() || ""}`.trim());
  return [`Salut Mady, c'est ${firstName}. Voici mes ${filled.length} produits (Produit | Lien | Prix de vente | Pourquoi) :`, "", ...lines, "", "Lequel on valide ?"].join("\n");
}

/** Taille lisible d'un fichier (Mo, Ko). */
export function fmtBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1).replace(".", ",")} Mo`;
  if (n >= 1024) return `${Math.round(n / 1024)} Ko`;
  return `${n} o`;
}
