/**
 * Guide Démarrage de la plateforme élèves (Scale X).
 *
 * Écrit pour un débutant complet : pas de jargon, pas de commande à taper.
 * L'élève installe VS Code, y met l'extension Claude Code, ouvre son dossier
 * et PARLE à Claude : c'est Claude qui installe et connecte le reste. Trois
 * fenêtres ouvertes (VS Code, admin Shopify, sa boutique) et F5 pour voir.
 * Module pur, utilisable serveur et navigateur.
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

const MSG_INSTALL = `Salut Claude. Je lance une boutique Shopify et je ne sais pas coder. Ce dossier est vide : c'est ici qu'on va travailler sur ma boutique.
Mon adresse Shopify : MA-BOUTIQUE.myshopify.com
Fais tout toi-même, étape par étape : installe sur mon ordinateur ce qu'il faut pour travailler sur un thème Shopify (Shopify CLI et ce dont il a besoin), connecte-toi à ma boutique, récupère le thème qui est en ligne dans ce dossier, puis lance l'aperçu de la boutique et donne-moi le lien à ouvrir.
Quand tu as besoin que je fasse quelque chose (me connecter dans le navigateur, cliquer sur Autoriser), dis-le moi en une phrase simple. Explique-moi chaque étape comme à un débutant complet.`;

const MSG_CHECK = `Vérifie que tout est prêt : tu vois bien les fichiers du thème dans ce dossier, tu es connecté à ma boutique, et l'aperçu fonctionne. Dis-moi « C'est prêt » et donne-moi le lien de l'aperçu. Ne modifie rien pour l'instant.`;

const MSG_EDIT = `Sur la page d'accueil, change le titre de la bannière en « [ton titre] » et le texte en dessous en « [ton texte] ». Montre-moi dans l'aperçu avant de mettre en ligne.`;

const MSG_LIVE = `C'est bon pour moi. Mets ces modifications en ligne sur ma boutique.`;

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
    intro: "Claude Code, c'est l'extension qui fait le travail. Tu lui parles en français, il fait.",
    steps: [
      {
        title: "Ouvre les extensions",
        text: "Dans la barre de gauche de VS Code, clique sur l'icône faite de 4 petits carrés (Extensions). Une barre de recherche apparaît en haut.",
      },
      {
        title: "Tape « Claude Code » et installe",
        text: "Dans la recherche, tape Claude Code. Clique sur le résultat « Claude Code » (éditeur : Anthropic), puis sur le bouton bleu Install.",
        link: { label: "Voir l'extension Claude Code", href: "https://marketplace.visualstudio.com/items?itemName=anthropic.claude-code" },
      },
      {
        title: "Connecte-toi avec ton compte Claude Max",
        text: "Une nouvelle icône Claude apparaît dans la barre de gauche. Clique dessus, puis sur Se connecter : ton navigateur s'ouvre, tu te connectes avec le compte Claude Max que tu as pris, tu reviens dans VS Code. C'est fait une fois pour toutes.",
        link: { label: "Prendre Claude Max si ce n'est pas fait", href: "https://claude.ai/upgrade" },
      },
    ],
  },
  {
    id: "dossier",
    n: "03",
    title: "Crée ton dossier et ouvre-le dans VS Code (2 min)",
    steps: [
      {
        title: "Crée un dossier vide",
        text: "Dans Documents, crée un dossier qui s'appelle MA-BOUTIQUE (clic droit > Nouveau dossier). Il reste vide, c'est normal : Claude va le remplir.",
      },
      {
        title: "Ouvre ce dossier dans VS Code",
        text: "Dans VS Code : menu Fichier > Ouvrir le dossier, choisis MA-BOUTIQUE, puis clique sur « Oui, je fais confiance aux auteurs ». Le nom du dossier apparaît en haut à gauche.",
      },
    ],
  },
  {
    id: "premier-message",
    n: "04",
    title: "Parle à Claude : il installe et connecte tout (15 min)",
    intro: "Tu ne tapes aucune commande. Tu copies ce message, tu remplaces MA-BOUTIQUE par ton adresse Shopify, et tu laisses Claude faire.",
    steps: [
      {
        title: "Trouve ton adresse Shopify",
        text: "Dans ton admin Shopify : Paramètres (en bas à gauche) > Domaines. C'est l'adresse qui finit par .myshopify.com, par exemple ma-boutique.myshopify.com. Copie-la.",
        link: { label: "Ouvrir mes domaines Shopify", href: "https://admin.shopify.com/settings/domains" },
      },
      {
        title: "Colle ce message à Claude",
        text: "Clique sur l'icône Claude à gauche dans VS Code, colle le message ci-dessous dans la zone de texte (bouton Copier), remplace MA-BOUTIQUE par ton adresse, Entrée.",
        cmds: [MSG_INSTALL],
      },
      {
        title: "Dis oui quand il demande",
        text: "Claude va installer des choses et te demander la permission à chaque fois : clique sur Yes / Autoriser. À un moment, ton navigateur s'ouvre pour te connecter à Shopify : connecte-toi, choisis ta boutique, clique sur Autoriser, et reviens dans VS Code. Ça prend 5 à 15 minutes, tu n'as rien d'autre à faire.",
        note: { kind: "warn", title: "Un message rouge ?", text: "Ne ferme rien. Fais une capture d'écran et colle-la à Claude en écrivant : « Voilà l'erreur, corrige et continue ». Il se débrouille." },
      },
      {
        title: "Vérifie que c'est prêt",
        text: "Quand Claude a fini, colle-lui ce message :",
        cmds: [MSG_CHECK],
        note: { kind: "ok", title: "C'est bon quand", text: "Claude répond « C'est prêt » et te donne un lien (souvent http://127.0.0.1:9292). Tu l'ouvres : c'est ta boutique, en aperçu, sur ton ordinateur." },
      },
    ],
  },
  {
    id: "trois-fenetres",
    n: "05",
    title: "Ta façon de travailler : 3 fenêtres ouvertes",
    intro: "C'est comme ça que tu bosses sur ta boutique, tous les jours. Toujours ces 3 fenêtres.",
    steps: [
      {
        title: "Fenêtre 1 : VS Code avec Claude Code",
        text: "C'est là que tu parles. Tu lui dis ce que tu veux changer sur ta boutique, en français, comme à une personne. Il modifie le thème.",
      },
      {
        title: "Fenêtre 2 : ton admin Shopify",
        text: "admin.shopify.com, avec les onglets à gauche : Commandes, Produits, Clients, Boutique en ligne. C'est là que tu gères tes produits, tes commandes, tes réglages, et que tu peux aussi modifier le thème à la souris (Boutique en ligne > Thèmes > Personnaliser).",
        link: { label: "Ouvrir mon admin Shopify", href: "https://admin.shopify.com" },
      },
      {
        title: "Fenêtre 3 : ta boutique",
        text: "Le lien d'aperçu que Claude t'a donné (ou ta boutique en ligne). Après chaque modification de Claude, tu appuies sur F5 (actualiser) et tu vois le résultat en direct.",
      },
      {
        title: "Mets-les côte à côte",
        text: "VS Code à gauche, ton navigateur à droite avec deux onglets (admin Shopify et ta boutique). Tu demandes à gauche, tu regardes à droite.",
      },
    ],
  },
  {
    id: "modifier",
    n: "06",
    title: "Modifier ta boutique avec Claude, et mettre en ligne",
    intro: "Une modification = un message. Tu vérifies dans l'aperçu, puis tu dis « mets en ligne ».",
    steps: [
      {
        title: "Demande une modification",
        text: "Exemple, à adapter :",
        cmds: [MSG_EDIT],
      },
      {
        title: "Regarde dans l'aperçu",
        text: "Fenêtre 3, F5. Si ce n'est pas ça, dis-lui simplement ce qui ne va pas : « plus gros », « en noir », « remonte cette section au-dessus des avis ». Il recommence.",
      },
      {
        title: "Mets en ligne",
        text: "Quand c'est bon :",
        cmds: [MSG_LIVE],
        note: { kind: "info", title: "Deux façons de modifier, pas de conflit", text: "Tu peux aussi changer des textes et des images à la souris dans Shopify (Personnaliser). Les deux marchent. Règle simple : les textes et images dans Shopify, tout ce qui touche à la structure ou au design avec Claude." },
      },
      {
        title: "Ce que tu peux lui demander",
        text: "- « Ajoute une section avis clients sous le produit »\n- « Rends le bouton Acheter plus visible sur mobile »\n- « Mets mes couleurs : fond blanc, boutons #1F6F5B »\n- « Fais une page Livraison et retours avec ce texte : … »\n- « Ma page est lente sur téléphone, améliore ça »\n- « Traduis la boutique en anglais »",
      },
    ],
  },
  {
    id: "parametrer",
    n: "07",
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
        note: { kind: "info", title: "Tu n'as pas envie de cliquer partout ?", text: "Installe Claude pour Chrome (section 09) et dis-lui : « Ouvre mes paramètres Shopify et configure la livraison : zone France, livraison offerte ». Il clique à ta place, tu regardes." },
      },
    ],
  },
  {
    id: "pixel",
    n: "08",
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
    n: "09",
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
