/**
 * Guide Démarrage de la plateforme élèves (Scale X).
 *
 * Écrit pour un débutant complet, d'après la vidéo de Mady « Création de
 * boutique Shopify avec Claude » (2026-10-26) : VS Code, Claude Code, les
 * accès Shopify (adresse, app Dev Dashboard installée, Client ID + secret),
 * le dossier avec le zip du thème, le premier message, le fichier .env, la
 * publication, le live, puis les modifications en parlant. Pas de commande
 * à taper. Module pur, utilisable serveur et navigateur.
 */

export const GUIDE_PDF_URL = "/formation/guide-installation-claude-code-shopify.pdf";

export type NoteKind = "info" | "ok" | "warn" | "danger";

export interface GuideNote {
  kind: NoteKind;
  title: string;
  text: string;
}

export interface GuideStep {
  title: string;
  /** Texte libre (mise en forme légère : lignes, « - » pour une liste). */
  text: string;
  /** Messages à copier-coller tels quels (à Claude), un par bloc. */
  cmds?: string[];
  /** Lien à ouvrir. */
  link?: { label: string; href: string };
  note?: GuideNote;
}

export interface GuideSection {
  id: string;
  n: string;
  title: string;
  intro?: string;
  /** Pour la section d'installation : deux variantes, Windows et Mac. */
  os?: { windows: GuideStep[]; mac: GuideStep[] };
  steps?: GuideStep[];
  notes?: GuideNote[];
  /** Définitions (plus utilisées : gardé pour la page). */
  defs?: { term: string; text: string }[];
  /** Dépannage. */
  fixes?: { problem: string; fix: string }[];
}

const MSG_START = `Salut Claude, j'ai besoin de créer une boutique Shopify avec toi.
Dans ce dossier il y a le thème template de mon coach (le fichier .zip).
J'ai en ma possession le Client ID et le Client secret de mon app Shopify, et l'adresse de ma boutique.
Je veux connecter Shopify à cette session pour qu'on bosse ensemble et que je voie les modifications du thème en live sur ma boutique.
Dis-moi ce que tu as besoin que je fasse, étape par étape, comme à un débutant complet.`;

const MSG_ENV_DONE = `C'est bon : j'ai renommé .env.example en .env, j'ai rempli l'adresse .myshopify.com, le Client ID et le Client secret.
Dis-moi les prochaines étapes. Je veux bosser sur ma boutique en live avec toi et que tu fasses les modifications.
Commence par pousser le thème sur la boutique.`;

const MSG_APP_OK = `C'est bon, l'app est installée sur ma boutique. On avance.`;

const MSG_LIVE = `J'ai publié le thème et il n'y a plus de mot de passe sur la boutique.
Je ne veux pas de lien de prévisualisation : je veux que chaque modification se pousse en live sur le thème publié, et que je voie le changement en faisant F5 sur ma boutique.`;

const MSG_EDIT = `Enlève la section de la page d'accueil où il y a écrit « [le texte de la section] ».`;

const MSG_UNDO = `Annule ce que tu viens de faire et remets la section que tu as enlevée.`;

export const GUIDE_SECTIONS: GuideSection[] = [
  {
    id: "vscode",
    n: "01",
    title: "Installe VS Code (5 min)",
    intro: "VS Code, c'est le logiciel dans lequel tu vas parler à Claude. Gratuit, Windows et Mac.",
    steps: [
      {
        title: "Télécharge VS Code",
        text: "Clique sur le bouton, télécharge la version pour ton ordinateur (Windows ou Mac), ouvre le fichier, puis Suivant / Suivant / Installer. Laisse tout par défaut.",
        link: { label: "Télécharger VS Code", href: "https://code.visualstudio.com/download" },
      },
      {
        title: "Ouvre VS Code",
        text: "Une fenêtre sombre avec une barre d'icônes à gauche. C'est tout ce dont tu as besoin pour l'instant.",
      },
    ],
  },
  {
    id: "claude",
    n: "02",
    title: "Mets Claude Code dans VS Code (5 min)",
    intro: "Claude Code, c'est lui qui fait le travail. Tu lui parles en français, il fait.",
    steps: [
      {
        title: "Ouvre les extensions",
        text: "Dans la barre de gauche de VS Code, tout en bas, clique sur Extensions (l'icône faite de 4 petits carrés). Une barre de recherche apparaît.",
      },
      {
        title: "Tape « Claude Code » et installe",
        text: "Prends « Claude Code for VS Code » (éditeur : Anthropic) et clique sur Installer. Une fois installé, ferme l'onglet : en haut à droite, un bouton « Claude Code » est apparu.",
        link: { label: "Voir l'extension Claude Code", href: "https://marketplace.visualstudio.com/items?itemName=anthropic.claude-code" },
      },
      {
        title: "Connecte ton compte Claude",
        text: "Clique sur Claude Code, puis Se connecter : ton navigateur s'ouvre, tu te connectes, tu reviens dans VS Code. Il te faut un abonnement payant : Mady conseille la formule à 90 € par mois (la 200 € n'est pas nécessaire).",
        link: { label: "Prendre l'abonnement Claude", href: "https://claude.ai/upgrade" },
      },
      {
        title: "Choisis le modèle",
        text: "En bas de la fenêtre Claude Code, choisis le modèle Fable 5.1 ou Opus 5.5. Le réglage « Effort », tu le laisses tel quel.",
        note: { kind: "info", title: "Plein écran", text: "Tu peux ouvrir Claude Code en grand avec l'icône en haut à droite de son panneau : plus confortable pour travailler." },
      },
    ],
  },
  {
    id: "acces",
    n: "03",
    title: "Récupère les accès de ta boutique Shopify (10 min)",
    intro: "Trois choses à avoir sous la main avant de parler à Claude : l'adresse de ta boutique, le Client ID et le Client secret de ton app. Et l'app doit être installée.",
    steps: [
      {
        title: "Ton adresse .myshopify.com",
        text: "Dans Shopify, en bas à gauche : Paramètres. Tout en haut, sous le nom de ta boutique, il y a l'adresse qui finit par .myshopify.com (par exemple ma-boutique.myshopify.com). Copie-la quelque part.",
        link: { label: "Ouvrir mes paramètres Shopify", href: "https://admin.shopify.com/settings" },
      },
      {
        title: "Crée ton app dans le Dev Dashboard",
        text: "Paramètres > Applications et canaux de vente > Développer des applications > Créer des apps dans le Dev Dashboard. Dans le Dev Dashboard : Apps > Create app > Start from Dev Dashboard, un nom (par exemple « Ma boutique »), Create.",
        link: { label: "Ouvrir Applications et canaux de vente", href: "https://admin.shopify.com/settings/apps/development" },
      },
      {
        title: "Donne-lui les accès et publie une version",
        text: "Dans l'app : Versions > Create version. Dans Scopes, coche les accès aux thèmes et aux produits (read_themes, write_themes, read_products, write_products, write_content). Release.",
        note: { kind: "info", title: "Si Claude réclame un accès de plus", text: "Tu reviens ici, tu coches l'accès, Release, puis tu réinstalles l'app (étape suivante). Rien de cassé." },
      },
      {
        title: "Installe l'app sur ta boutique",
        text: "Sur la page de l'app, carte Installs > Install app : choisis ta boutique, Install. C'est l'étape que les élèves oublient : sans elle, Shopify répond « app not installed » et Claude est bloqué.",
        note: { kind: "danger", title: "Obligatoire", text: "Une app créée mais pas installée ne sert à rien. Vérifie que ta boutique apparaît dans Installs." },
      },
      {
        title: "Copie le Client ID et le Client secret",
        text: "App settings > Credentials : copie le Client ID et le Client secret (bouton Afficher). Garde-les dans un fichier texte, tu vas les coller dans une minute. Ne les colle jamais dans le chat de Claude.",
      },
    ],
  },
  {
    id: "dossier",
    n: "04",
    title: "Crée ton dossier avec le thème de Mady (2 min)",
    steps: [
      {
        title: "Un dossier sur le Bureau",
        text: "Sur Mac ou Windows, crée un dossier sur ton Bureau : « Prénom boutique » (par exemple « Kevin boutique »).",
      },
      {
        title: "Glisse le thème dedans",
        text: "Télécharge le thème Aesthetic Lab de Mady (page Création de la boutique, ou le zip qu'il t'a envoyé sur WhatsApp). Glisse le fichier .zip dans ton dossier, tel quel : tu ne l'ouvres pas, tu ne le décompresses pas.",
        link: { label: "Télécharger le thème", href: "/formation/boutique" },
      },
      {
        title: "Ouvre le dossier dans VS Code",
        text: "Dans VS Code : File (Fichier) en haut à gauche > Open Folder (Ouvrir un dossier) > choisis « Prénom boutique ». Clique « Oui, je fais confiance ». Le nom du dossier apparaît en haut à gauche. Tu peux fermer l'onglet Welcome.",
      },
    ],
  },
  {
    id: "premier-message",
    n: "05",
    title: "Parle à Claude : il connecte ta boutique (15 min)",
    intro: "Pas de recette magique : tu lui parles comme à un pote. Shift + Entrée pour aller à la ligne, Entrée pour envoyer. Peu de fautes, du contexte à chaque message.",
    steps: [
      {
        title: "Ton premier message",
        text: "Ouvre Claude Code (bouton en haut à droite), colle ce message, Entrée.",
        cmds: [MSG_START],
        note: { kind: "info", title: "Ce qui défile, tu t'en fiches", text: "Claude vérifie le dossier, Node, Shopify CLI, décompresse le thème. Toi tu lis seulement son résumé à la fin, et ce qu'il te demande." },
      },
      {
        title: "Renomme .env.example en .env",
        text: "Claude te dit de ne pas coller tes secrets dans le chat et de remplir un fichier. Dans la colonne de gauche (Explorateur), repère le fichier « .env.example », clic droit > Rename, et renomme-le « .env » (exactement, avec le point).",
      },
      {
        title: "Remplis le fichier .env",
        text: "Ouvre .env. Ligne SHOPIFY_FLAG_STORE : colle ton adresse .myshopify.com. Puis l'option B : colle ton Client ID et ton Client secret (ceux de l'étape 03). Enlève les espaces en trop. Ctrl + S (Cmd + S sur Mac) pour enregistrer.",
        note: { kind: "warn", title: "Jamais dans le chat", text: "Le Client secret va dans le fichier .env, pas dans un message à Claude." },
      },
      {
        title: "Dis-le à Claude",
        text: "Retour dans le chat (tu peux le dicter au micro) :",
        cmds: [MSG_ENV_DONE],
      },
      {
        title: "Si Shopify répond « app not installed »",
        text: "Ton app n'est pas installée sur ta boutique. Dans Shopify : Paramètres > Applications et canaux de vente > Développer des applications > ouvre ton app > Installs > Install app. Puis dis-le à Claude :",
        cmds: [MSG_APP_OK],
        note: { kind: "ok", title: "C'est bon quand", text: "Claude dit qu'il envoie le thème sur la boutique, non publié (ton thème actuel reste intact), et que c'est fait." },
      },
    ],
  },
  {
    id: "publier",
    n: "06",
    title: "Publie le thème et passe en live (5 min)",
    steps: [
      {
        title: "Publie le thème dans Shopify",
        text: "Shopify > Boutique en ligne > Thèmes : le thème « Aesthetic » de Mady est apparu dans la liste (Claude vient de l'envoyer). Clique sur les trois points > Publier.",
        link: { label: "Ouvrir mes thèmes", href: "https://admin.shopify.com/themes" },
      },
      {
        title: "Enlève le mot de passe",
        text: "Boutique en ligne > Préférences > enlève le mot de passe. Si Shopify te demande d'abord de vérifier les informations de ton entreprise, fais-le, puis lance la boutique : elle devient publique.",
      },
      {
        title: "Dis à Claude que c'est en ligne, et exige le live",
        text: "Il va parfois te proposer un lien de prévisualisation : refuse, tu veux le live sur le thème publié. S'il insiste, répète-le, il relance la synchro.",
        cmds: [MSG_LIVE],
        note: { kind: "ok", title: "Claude et Shopify sont connectés", text: "À partir de là, tout se fait en parlant. Chaque modification arrive sur ta boutique : F5 et c'est là." },
      },
    ],
  },
  {
    id: "trois-fenetres",
    n: "07",
    title: "Ta façon de travailler : 3 onglets + Claude",
    intro: "Comme Mady dans la vidéo : tu demandes à gauche, tu regardes à droite.",
    steps: [
      {
        title: "Trois onglets dans ton navigateur",
        text: "1. Le tableau de bord Shopify (admin.shopify.com), pour te balader. 2. L'éditeur de thème (Boutique en ligne > Thèmes > Personnaliser), pour rattraper un détail à la souris. 3. Ta boutique en ligne, celle que tes clients voient.",
        link: { label: "Ouvrir mon admin Shopify", href: "https://admin.shopify.com" },
      },
      {
        title: "Écran partagé",
        text: "Si ton écran est assez grand : VS Code avec Claude à gauche, le navigateur à droite. À chaque modification de Claude, F5 sur ta boutique.",
      },
    ],
  },
  {
    id: "modifier",
    n: "08",
    title: "Modifier ta boutique avec Claude",
    intro: "Une demande à la fois. Tu demandes, F5, tu vérifies. Si ce n'est pas ça, tu le lui dis.",
    steps: [
      {
        title: "Enlever une section",
        text: "Exemple de la vidéo : les exemples de produits de Mady n'ont rien à voir avec le tien, tu les enlèves.",
        cmds: [MSG_EDIT],
      },
      {
        title: "Annuler",
        text: "Tu t'es trompé ? Il remet comme avant.",
        cmds: [MSG_UNDO],
      },
      {
        title: "Menus, police, textes",
        text: "- « Change les menus : enlève Glow up, Our protocol, Track my order, mets Accueil, Collection, Contact »\n- « Je ne suis pas fan de cette police, mets-la plus grasse et plus espacée »\n- « Réécris le titre de la bannière pour mon produit : [ton produit] »",
      },
      {
        title: "Ton logo",
        text: "Fais-le sur Canva en 450 × 150 px, simple. Glisse le fichier dans la fenêtre Claude Code et dis : « Voilà mon logo, mets-le sur ma boutique à la place de l'actuel ».",
        link: { label: "Ouvrir Canva", href: "https://www.canva.com" },
      },
      {
        title: "Tes couleurs, à partir d'un concurrent",
        text: "Installe l'extension ColorZilla, prends la couleur principale de la boutique de ton concurrent direct, colle le code couleur à Claude : « Je veux cette couleur pour les titres, sur un fond blanc, et trouve une deuxième couleur un peu plus claire qui va avec ».",
        link: { label: "ColorZilla pour Chrome", href: "https://chromewebstore.google.com/detail/colorzilla/bhlhnicpbhignbdhedgjhgdocnmhomnp" },
      },
      {
        title: "Les images et les textes de ton produit",
        text: "Tes images produit, tu les fais dans le Studio IA (page Créatives) et tu les mets dans un sous-dossier « creatives ». Pour le copywriting, colle l'adresse de ton concurrent : « Analyse cette boutique, c'est mon concurrent direct. Réadapte mon thème avec un copywriting pour mon produit ».",
        note: { kind: "info", title: "L'éditeur de thème en secours", text: "Boutique en ligne > Thèmes > Personnaliser permet de remettre une section ou de corriger un détail à la souris. Ce n'est pas le but, Claude fait tout, mais c'est là." },
      },
    ],
  },
  {
    id: "parametrer",
    n: "09",
    title: "Les réglages Shopify pour pouvoir vendre (30 min)",
    intro: "À faire une fois, dans l'admin Shopify > Paramètres. Sans ça, personne ne peut te payer.",
    steps: [
      {
        title: "Paiements",
        text: "Paramètres > Paiements : active Shopify Payments (carte bancaire) en remplissant ton identité, ton adresse et ton IBAN. Ajoute PayPal si tu as un compte PayPal Business.",
        link: { label: "Ouvrir Paiements", href: "https://admin.shopify.com/settings/payments" },
      },
      {
        title: "Livraison",
        text: "Paramètres > Expédition et livraison : une zone France (ou ton pays), un seul tarif « Livraison standard 5 à 10 jours », gratuit (ou 4,90 €). Supprime les autres tarifs.",
        link: { label: "Ouvrir Expédition", href: "https://admin.shopify.com/settings/shipping" },
      },
      {
        title: "Politiques et mentions légales",
        text: "Paramètres > Politiques : clique sur « Créer à partir d'un modèle » pour chaque texte (remboursement, confidentialité, conditions de vente, livraison). Ils s'ajoutent tout seuls en bas de ta boutique.",
        link: { label: "Ouvrir Politiques", href: "https://admin.shopify.com/settings/legal" },
      },
      {
        title: "Ton nom de domaine",
        text: "Paramètres > Domaines > Acheter un nouveau domaine (environ 15 € par an). Sans ça ta boutique s'appelle xxx.myshopify.com, et ça fait fuir.",
      },
      {
        title: "Fais une commande test",
        text: "Boutique en ligne > Préférences : enlève le mot de passe. Puis, depuis ton téléphone, achète un produit sur ta boutique comme un client. Tu dois recevoir l'e-mail de commande.",
        note: { kind: "info", title: "Tu n'as pas envie de cliquer partout ?", text: "Installe Claude pour Chrome (section 11) et dis-lui : « Ouvre mes paramètres Shopify et configure la livraison : zone France, livraison offerte ». Il clique à ta place, tu regardes." },
      },
    ],
  },
  {
    id: "pixel",
    n: "10",
    title: "Le Pixel Meta (pour que tes pubs marchent)",
    intro: "Le Pixel dit à Meta qui achète. Sans lui, tes pubs n'apprennent rien. À faire avant ta première campagne.",
    steps: [
      {
        title: "Installe l'application Facebook & Instagram dans Shopify",
        text: "Admin Shopify > Applications > cherche « Facebook & Instagram » > Installer. Connecte ton compte Facebook, choisis ton compte publicitaire et ton Pixel (crée-le si on te le propose).",
        link: { label: "Application Facebook & Instagram", href: "https://apps.shopify.com/facebook" },
      },
      {
        title: "Partage de données : Maximal",
        text: "Dans l'application, partie Partage des données, choisis Maximal. C'est tout.",
      },
      {
        title: "Vérifie",
        text: "Va sur ta boutique, ouvre un produit, ajoute-le au panier. Dans Meta (Gestionnaire d'événements > Tester les événements) tu dois voir apparaître des lignes vertes. Si tu ne vois rien, demande à Claude : « Vérifie que mon Pixel Meta remonte bien les événements ».",
        link: { label: "Gestionnaire d'événements Meta", href: "https://business.facebook.com/events_manager" },
      },
    ],
  },
  {
    id: "claude-aide",
    n: "11",
    title: "Bloqué ? Demande à Claude, pas à Mady",
    intro: "Claude règle 80 % des problèmes en direct. Mady, c'est pour les urgences et les validations.",
    steps: [
      {
        title: "Dis-lui tout",
        text: "Colle le message d'erreur, envoie une capture d'écran, explique ce que tu voulais faire. Plus tu lui en dis, plus il est précis. Pose des questions bêtes, il ne juge pas.",
      },
      {
        title: "Installe Claude pour Chrome",
        text: "Claude peut prendre le contrôle de ton navigateur : il clique dans Shopify, dans Meta, remplit les réglages, pendant que tu regardes. Installe l'extension, connecte-la à ton compte, ouvre le panneau Claude sur la page et dis-lui ce que tu veux.",
        link: { label: "Installer Claude pour Chrome", href: "https://claude.ai/chrome" },
      },
      {
        title: "Chrome Remote Desktop pour les vrais blocages",
        text: "Installe-le une fois : si tu es vraiment bloqué, Mady prend la main sur ton écran pendant un call.",
        link: { label: "Installer Chrome Remote Desktop", href: "https://remotedesktop.google.com/access" },
      },
    ],
  },
];

export const GUIDE_SOURCES: { label: string; href: string }[] = [];
