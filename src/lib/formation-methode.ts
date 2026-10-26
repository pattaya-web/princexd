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

Fais tout toi-même avec Shopify CLI, je ne tape aucune commande :
1. Décompresse le zip dans un dossier « theme » et lis le README.md.
2. Connecte-le à ma boutique et lance l'aperçu (shopify theme dev --store [mon-adresse].myshopify.com). Donne-moi le lien d'aperçu à ouvrir.
3. Remplace UNIQUEMENT le contenu, dans cet ordre, en me montrant chaque étape dans l'aperçu avant de passer à la suivante :
   - Réglages du thème : nom de marque (wordmark), favicon, e-mail support, liens clés (produit principal, collection principale).
   - Hero : ma vidéo 9:16 (ou mon image) du dossier creatives à la place des aplats gris, titre et sous-titre pour mon produit.
   - Sections bénéfices, comment ça marche, avant / après, avis, FAQ, pied de page : réécris tous les textes pour mon produit, en français, même longueur que les textes existants ; mets mes images à la place des placeholders ; propose-moi 6 avis clients crédibles à valider.
   - Page produit : garde un seul template produit, supprime les exemples (jawliner, patch, tape, peptide…), crée mon produit (titre, description, prix, prix barré, images) et les métachamps aesthetic_lab que le README décrit.
   - Dis-moi les images ou vidéos qui manquent, à quel endroit, et dans quel format (3:4, 1:1, 9:16, 16:9) : je les génère dans mon Studio IA.
4. Quand je dis « OK, mets en ligne » : envoie le thème sur ma boutique (shopify theme push --unpublished), publie-le, et vérifie que la page d'accueil et la page produit s'affichent bien sur mobile.

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

Il te faut : VS Code installé, l'extension « Claude Code for VS Code », un abonnement Claude payant (Mady conseille la formule à 90 € par mois, la version à 200 € n'est pas nécessaire), le zip du thème envoyé par Mady, et le Client ID + Client secret de ton app Shopify (ceux que tu as envoyés à Mady). Modèle à choisir dans Claude Code : Fable 5.1 ou Opus 5.5.

À savoir aussi : en dehors de VS Code, l'application Claude sur ton ordinateur peut prendre le contrôle de ton écran et faire des tâches à ta place (créer ton Pixel Meta, ajouter un produit sur Shopify, changer une description). VS Code + Claude Code, c'est uniquement pour construire la boutique. La fin de la vidéo montre la suite : récupérer la couleur et les images d'un concurrent pour aller vite, puis faire tes propres images produit dans le Studio IA et adapter tout le copywriting à ton produit.`,
  shopVideoSteps: `Crée ton dossier sur le Bureau : sur Mac ou Windows, un dossier nommé « Prénom boutique » (par exemple « Kevin boutique »). Glisse dedans le fichier .zip du thème que Mady t'a envoyé, tel quel, sans l'ouvrir ni le décompresser.
Installe VS Code et ouvre ton dossier : télécharge Visual Studio Code si tu ne l'as pas. Dans VS Code : Fichier (File) en haut à gauche, puis « Open Folder » (Ouvrir un dossier), et choisis « Prénom boutique ». Tu peux fermer l'onglet « Welcome ».
Installe Claude Code : colonne de gauche, l'icône « Extensions » (tout en bas). Tape « Claude Code », prends « Claude Code for VS Code » et clique Installer. Une fois installé, un bouton « Claude Code » apparaît en haut à droite : clique dessus. Connecte-toi avec ton compte Claude (abonnement payant, Mady conseille la formule à 90 € par mois).
Choisis le modèle : dans la fenêtre Claude Code, sélectionne Fable 5.1 ou Opus 5.5. Le réglage « Effort », tu le laisses tel quel.
Écris ton premier message à Claude : « Salut Claude, j'ai besoin de créer une boutique Shopify avec toi. Dans le dossier il y a le thème template de mon coach. J'ai en ma possession le Client ID et le Client secret de mon app Shopify. Je veux connecter Shopify à cette session pour qu'on bosse ensemble et que je voie les modifications du thème en live. » Shift + Entrée pour aller à la ligne, Entrée pour envoyer. (Tu peux aussi coller le message complet de la section 03 ci-dessous.)
Laisse-le vérifier et lis seulement son résumé : il regarde le dossier, vérifie que Node et Shopify CLI sont installés, décompresse le thème et inspecte sa structure. Les lignes techniques qui défilent, tu t'en fiches : tu lis le résumé qu'il écrit à la fin et ce qu'il te demande.
Renomme .env.example en .env : il te dit de ne jamais coller tes secrets dans le chat et de remplir un fichier. Dans la colonne de gauche (Explorateur), repère le fichier « .env.example », clic droit, « Rename », et renomme-le « .env » exactement.
Remplis le fichier .env : ligne SHOPIFY_FLAG_STORE, colle l'adresse de ta boutique qui finit par .myshopify.com (dans Shopify : Paramètres en bas à gauche, l'adresse est écrite juste sous le nom de la boutique). Puis l'option B : colle ton Client ID et ton Client secret (ceux de ton app Shopify, envoyés à Mady sur WhatsApp). Enlève les espaces en trop, puis Ctrl + S (Cmd + S sur Mac) pour enregistrer.
Dis-le à Claude et demande la suite : « C'est bon, j'ai renommé .env.example en .env, j'ai rempli l'adresse .myshopify.com, le Client ID et le Client secret. Dis-moi les prochaines étapes, je veux bosser sur ma boutique en live avec toi. Commence par pousser le thème sur la boutique. »
Si Shopify refuse (« app not installed ») : ton app n'est pas installée sur ta boutique. Dans Shopify : Paramètres, Applications et canaux de vente, « Développer des applications » (Dev Dashboard), ouvre ton app et clique « Installer ». Reviens dans VS Code et dis à Claude : « C'est bon, l'app est installée, on avance. »
Publie le thème : Claude envoie le thème de Mady sur ta boutique sans le publier (ton thème actuel reste intact). Dans Shopify, Boutique en ligne, Thèmes : le thème « Aesthetic » apparaît dans la liste, clique « Publier ». Si Shopify te demande de vérifier les informations de ton entreprise pour enlever le mot de passe, fais-le, puis lance la boutique (elle passe en public, sans mot de passe).
Dis à Claude que la boutique est publiée : « J'ai publié la boutique, il n'y a plus de mot de passe. Je veux que chaque modification se pousse en live sur le thème publié, et que je voie le changement en faisant F5. » S'il te propose à la place un lien de prévisualisation, refuse et répète : tu veux le live sur le thème publié, il relance la synchro.
Organise ton écran : trois onglets dans ton navigateur (le tableau de bord Shopify, l'éditeur de thème « Personnaliser », et ta boutique en ligne), et si ton écran est grand, VS Code à gauche avec Claude, le navigateur à droite. À chaque modification de Claude, F5 sur la boutique.
Maintenant tu parles, il fait : « Enlève la section où il y a écrit Jaw trainer, pimple patch, nose tape. » « Annule ce que tu viens de faire, remets la section. » « Change les menus : enlève Glow up, Our protocol, Track my order, remplace par Accueil, Collection, Contact. » « Je ne suis pas fan de cette police, mets-la plus grasse et plus espacée. » Une demande à la fois, F5, tu vérifies.
Ton logo : fais-le sur Canva en 450 × 150 px, simple. Glisse le fichier dans la fenêtre Claude Code et dis : « Voilà mon logo, mets-le sur ma boutique à la place de l'actuel et publie. »
Tes couleurs, à partir d'un concurrent : installe l'extension de navigateur ColorZilla, prends la couleur principale de la boutique de ton concurrent direct, colle le code couleur à Claude : « Je veux cette couleur comme couleur principale des titres, sur un fond blanc, et trouve-moi une deuxième couleur un peu plus claire qui va avec, deux couleurs qui dominent sur du blanc. »
Les images produit : pour aller vite, les images d'un concurrent se récupèrent avec l'extension CSS Peeper (onglet Assets), mais tes vraies images produit, tu les fais dans le Studio IA (page Créatives). Mets-les dans le sous-dossier « creatives » et dis à Claude où les placer.
Le copywriting à partir du concurrent : colle l'adresse de la boutique du concurrent à Claude : « Analyse cette boutique, c'est mon concurrent direct. Réadapte mon thème actuel avec un copywriting pour mon produit. » Puis tu corriges section par section dans l'aperçu.
L'éditeur de thème Shopify en secours : « Personnaliser » dans Shopify permet de rattraper un détail à la souris, ou de remettre une section (par exemple « Product Bubble »). Ce n'est pas le but, Claude fait tout, mais c'est là si besoin.
Si ça bloque, tu parles : capture d'écran du message rouge, « voilà l'erreur, corrige et continue ». Claude répond à toutes tes questions, même les plus bêtes. Et Mady reste dispo sur WhatsApp.`,
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
    shopVideoSteps: str(raw.shopVideoSteps, 6000),
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
