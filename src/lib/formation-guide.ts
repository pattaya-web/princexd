/**
 * Guide Démarrage de la plateforme élèves (Scale X).
 *
 * Tout le contenu de la page /formation/demarrage, en données : l'élève
 * installe seul Claude Code + Shopify CLI, paramètre sa boutique Shopify,
 * installe le thème Aesthetic Lab et le Pixel Meta. Module pur, utilisable
 * serveur et navigateur. Le PDF d'origine est servi depuis /formation/.
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
  /** Commandes à copier, une par bloc. */
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
  /** Définitions (section « Avant de commencer »). */
  defs?: { term: string; text: string }[];
  /** Dépannage (section finale). */
  fixes?: { problem: string; fix: string }[];
}

const WINDOWS: GuideStep[] = [
  {
    title: "Installer Git for Windows",
    text: "Dans Chrome, ouvre git-scm.com/download/win. Télécharge Git, ouvre le fichier puis laisse les options par défaut : Next jusqu'à Install, puis Finish.",
    link: { label: "Télécharger Git for Windows", href: "https://git-scm.com/download/win" },
  },
  {
    title: "Installer Node.js",
    text: "Sur nodejs.org, télécharge la version LTS. Elle doit être au minimum en version 22.12. Lance l'installateur puis Next > Install.",
    link: { label: "Télécharger Node.js", href: "https://nodejs.org" },
  },
  {
    title: "Ouvrir l'Invite de commandes",
    text: "Appuie sur la touche Windows, tape cmd, puis ouvre « Invite de commandes ». Une fenêtre noire apparaît : c'est normal.\n\nCopie ces trois commandes UNE PAR UNE et appuie sur Entrée après chaque ligne :",
    cmds: ["git --version", "node -v", "npm -v"],
    note: { kind: "ok", title: "Résultat attendu", text: "Git et npm affichent un numéro. Node doit afficher v22.12.0 ou une version plus récente." },
  },
  {
    title: "Installer Shopify CLI",
    text: "Dans la même fenêtre noire, copie la commande suivante puis attends la fin. Vérifie ensuite avec la deuxième commande.",
    cmds: ["npm install -g @shopify/cli@latest", "shopify help"],
  },
  {
    title: "Installer Claude Code",
    text: "Ouvre PowerShell : touche Windows > tape PowerShell > ouvre Windows PowerShell. Colle la commande officielle ci-dessous. Pas besoin du mode administrateur.\n\nFerme PowerShell puis rouvre-le, ensuite vérifie avec les deux commandes suivantes.",
    cmds: ["irm https://claude.ai/install.ps1 | iex", "claude --version", "claude doctor"],
  },
  {
    title: "Se connecter à Claude",
    text: "Tape claude puis Entrée. Une page de connexion s'ouvre dans ton navigateur. Connecte-toi avec ton compte Claude Max (ou Pro).",
    cmds: ["claude"],
  },
];

const MAC: GuideStep[] = [
  {
    title: "Ouvrir Terminal et vérifier Git",
    text: "Appuie sur ⌘ + Espace, tape Terminal puis Entrée. Colle la commande suivante. Si un numéro apparaît, Git est prêt. Si macOS propose les « Command Line Developer Tools », clique sur Installer et attends la fin.",
    cmds: ["git --version"],
  },
  {
    title: "Installer Node.js",
    text: "Sur nodejs.org, télécharge la version LTS pour macOS. Elle doit être au minimum en version 22.12. Ouvre le fichier .pkg puis Continuer > Installer.",
    link: { label: "Télécharger Node.js", href: "https://nodejs.org" },
  },
  {
    title: "Vérifier Node et npm",
    text: "Ferme puis rouvre Terminal et lance :",
    cmds: ["node -v", "npm -v"],
  },
  {
    title: "Installer Shopify CLI",
    text: "Dans Terminal, copie la commande puis attends la fin. Vérifie ensuite avec la deuxième commande.",
    cmds: ["npm install -g @shopify/cli@latest", "shopify help"],
    note: { kind: "warn", title: "Erreur de permission ?", text: "Ne mets pas « sudo » au hasard. Fais une capture du message complet et envoie-la à Mady." },
  },
  {
    title: "Installer Claude Code",
    text: "Dans Terminal, copie la commande officielle suivante puis Entrée. Ferme Terminal puis rouvre-le, ensuite vérifie avec les deux commandes suivantes.",
    cmds: ["curl -fsSL https://claude.ai/install.sh | bash", "claude --version", "claude doctor"],
  },
  {
    title: "Se connecter à Claude",
    text: "Tape claude puis suis la connexion dans le navigateur. Connecte-toi avec ton compte Claude Max (ou Pro).",
    cmds: ["claude"],
  },
];

export const GUIDE_SECTIONS: GuideSection[] = [
  {
    id: "avant",
    n: "01",
    title: "Avant de commencer",
    intro: "Compte 20 à 30 minutes, tranquillement, dans l'ordre. Ton ordinateur doit être prêt AVANT ton premier call avec Mady : on ne perd pas le call à installer des logiciels.",
    notes: [
      { kind: "info", title: "À la fin tu dois avoir", text: "Git + Node.js installés · Shopify CLI installé et connecté à ta boutique · Claude Code installé et connecté à ton compte · un dossier de travail prêt à recevoir le thème." },
      { kind: "ok", title: "À retenir", text: "Shopify CLI connecte ton ordinateur à Shopify. Claude Code travaille ensuite dans les fichiers du thème présents sur ton ordinateur." },
      { kind: "warn", title: "Règle simple", text: "Copie uniquement les commandes de ce guide. Si un message d'erreur apparaît, fais une capture avant de fermer la fenêtre et envoie-la à Mady." },
    ],
    defs: [
      { term: "Boutique Shopify accessible", text: "Tu dois pouvoir ouvrir l'administration et voir Boutique en ligne > Thèmes. Tu dois être propriétaire ou avoir l'autorisation de gérer les thèmes." },
      { term: "Compte Claude", text: "Claude Code demande un compte Max (recommandé, c'est lui qui construit ta boutique) ou Pro." },
      { term: "Terminal / Invite de commandes", text: "Une petite fenêtre où tu copies-colles les commandes de ce guide. Tu n'as pas besoin de savoir coder." },
      { term: "Node.js", text: "Un logiciel nécessaire à Shopify CLI. Shopify demande Node.js 22.12 ou supérieur." },
      { term: "Shopify CLI", text: "L'outil qui connecte ta boutique à ton ordinateur et prévisualise le thème." },
      { term: "Claude Code", text: "L'outil qui lit et modifie le thème à partir de tes instructions, en français." },
    ],
  },
  {
    id: "installation",
    n: "02",
    title: "Installer les outils",
    intro: "Suis les étapes dans l'ordre. Ne passe à la suivante que si la précédente fonctionne. On installe une fois, tout reste disponible pour la suite.",
    os: { windows: WINDOWS, mac: MAC },
  },
  {
    id: "shopify-cli",
    n: "03",
    title: "Connecter Shopify à ton ordinateur",
    intro: "À partir d'ici, les étapes sont les mêmes sur Windows et Mac. Connecte-toi d'abord à ton administration Shopify dans Chrome et vérifie que tu vois Boutique en ligne > Thèmes.",
    steps: [
      {
        title: "Trouver ton adresse .myshopify.com",
        text: "Dans Shopify : Paramètres > Domaines. Repère l'adresse qui se termine par .myshopify.com, par exemple ma-boutique.myshopify.com. Note-la : tu en auras besoin partout, et Mady aussi pour te générer ta boutique.",
      },
      {
        title: "Créer le dossier de travail",
        text: "Dans Documents, crée un dossier nommé BOUTIQUE-SHOPIFY. C'est ici que tu mettras le thème et que Claude Code travaillera.\n\nOuvrir une commande directement dans ce dossier :\n- Windows : ouvre le dossier dans l'Explorateur. Clique dans la barre d'adresse tout en haut, tape cmd puis Entrée.\n- Mac : ouvre Terminal. Tape cd suivi d'un espace, fais glisser le dossier depuis Finder dans Terminal, puis Entrée.",
      },
      {
        title: "Tester la connexion Shopify",
        text: "Remplace MA-BOUTIQUE par ta vraie adresse puis lance :",
        cmds: ["shopify theme list --store MA-BOUTIQUE.myshopify.com"],
        note: { kind: "ok", title: "Connexion réussie", text: "La première fois, Shopify ouvre le navigateur : connecte-toi, choisis la bonne boutique et autorise Shopify CLI. Si une liste de thèmes apparaît, ton ordinateur est connecté. Rien n'a encore été modifié sur la boutique." },
      },
    ],
    notes: [{ kind: "danger", title: "Ne pousse rien sur le thème principal", text: "N'utilise pas « shopify theme push » ni « shopify theme publish » sans consigne de Mady." }],
  },
  {
    id: "parametrer",
    n: "04",
    title: "Paramétrer Shopify (les réglages de base)",
    intro: "30 minutes, une seule fois. Sans ça, personne ne peut te payer ni être livré. Tout se passe dans l'admin Shopify, menu Paramètres (en bas à gauche).",
    steps: [
      {
        title: "Général : nom, adresse, devise, langue",
        text: "Paramètres > Général : nom de la boutique, e-mail de contact, adresse de facturation. Devise de la boutique : EUR si tu vends en France. Fuseau horaire : Paris. Paramètres > Langues : français (ou la langue de ton marché).",
      },
      {
        title: "Moyens de paiement",
        text: "Paramètres > Paiements.\n- Active Shopify Payments (carte bancaire, Apple Pay, Google Pay) : remplis ton identité, ton adresse, ton IBAN. Statut auto-entrepreneur ou société, prépare ton SIRET.\n- Ajoute PayPal (compte PayPal Business) : beaucoup de clients paient avec.\n- Capture des paiements : automatique.\n- Tant que Shopify Payments n'est pas validé, tu peux tester le checkout avec la passerelle de test (Paramètres > Paiements > Passerelle fictive « Bogus »).",
        link: { label: "Ouvrir Shopify Payments", href: "https://admin.shopify.com/settings/payments" },
      },
      {
        title: "Livraison",
        text: "Paramètres > Expédition et livraison > Tarifs généraux.\n- Zone France (ou ton marché) : un tarif « Livraison standard 5 à 10 jours » gratuit à partir de 0 € (livraison offerte, on l'affiche comme argument), ou un tarif fixe de 4,90 €.\n- Zone Europe si tu veux vendre à côté.\n- Supprime les tarifs par défaut qui ne te concernent pas.\n- Pas de poids compliqué : un tarif unique, simple.",
        link: { label: "Ouvrir Expédition", href: "https://admin.shopify.com/settings/shipping" },
      },
      {
        title: "Taxes",
        text: "Paramètres > Taxes et droits de douane : France > TVA 20 %. Coche « Inclure les taxes dans les prix » pour afficher des prix TTC. Si tu es auto-entrepreneur en franchise de TVA, mets la TVA à 0 % et garde les prix TTC.",
      },
      {
        title: "Politiques légales",
        text: "Paramètres > Politiques. Shopify génère les textes : politique de remboursement, confidentialité, conditions de vente, mentions légales, livraison. Génère-les, lis-les vite, adapte le délai de retour (14 jours minimum en France). Les liens se mettent automatiquement dans le pied de page du thème.",
        link: { label: "Ouvrir Politiques", href: "https://admin.shopify.com/settings/legal" },
      },
      {
        title: "Checkout et comptes clients",
        text: "Paramètres > Paiement (checkout) : comptes clients facultatifs, téléphone facultatif, adresse e-mail obligatoire. Active « Panier abandonné » : Shopify envoie un e-mail automatique aux gens qui n'ont pas fini leur commande.",
      },
      {
        title: "Domaine",
        text: "Paramètres > Domaines : achète ton nom de domaine (dans Shopify, le plus simple, environ 15 €/an) ou connecte celui que tu as déjà. Mets-le en domaine principal. Sans domaine, ta boutique s'appelle xxx.myshopify.com et ça fait fuir.",
      },
      {
        title: "Retirer le mot de passe et faire une commande test",
        text: "Boutique en ligne > Préférences : décoche « Restreindre l'accès aux visiteurs avec un mot de passe » (dès que tu as choisi un forfait). Puis fais une commande test de bout en bout (passerelle fictive ou vraie carte puis remboursement) : page produit > panier > paiement > e-mail de confirmation.",
        note: { kind: "ok", title: "Tu as fini quand", text: "Tu peux acheter un produit sur ta boutique, de ton téléphone, en moins de 2 minutes, et tu reçois l'e-mail de commande." },
      },
    ],
  },
  {
    id: "theme",
    n: "05",
    title: "Installer le thème Aesthetic Lab",
    intro: "Le thème de travail s'appelle aesthetic-lab (fichier aesthetic-lab.zip). Soit Mady l'a installé directement sur ta boutique quand il a généré ta boutique, soit tu l'importes toi-même.",
    steps: [
      {
        title: "Cas 1 : Mady a généré ta boutique",
        text: "Admin Shopify > Boutique en ligne > Thèmes. Le thème apparaît dans « Bibliothèque de thèmes ». Clique sur « … » > Publier. Puis « Personnaliser » pour vérifier.",
      },
      {
        title: "Cas 2 : tu as reçu aesthetic-lab.zip",
        text: "Admin Shopify > Boutique en ligne > Thèmes > bouton « Ajouter un thème » > « Importer un fichier zip » > choisis aesthetic-lab.zip > Importer. Attends la fin, puis « … » > Publier. Ne décompresse pas le zip pour l'importer : Shopify veut le .zip tel quel.",
        link: { label: "Ouvrir Thèmes", href: "https://admin.shopify.com/themes" },
      },
      {
        title: "Mettre le thème dans ton dossier pour Claude Code",
        text: "Décompresse aesthetic-lab.zip et place les fichiers dans BOUTIQUE-SHOPIFY. Tu dois voir des dossiers comme assets, sections, snippets, templates, config, layout directement dans BOUTIQUE-SHOPIFY (pas dans un sous-dossier).\n\nSi Mady a installé le thème sans te donner le zip, récupère-le depuis ta boutique avec cette commande (dans BOUTIQUE-SHOPIFY) et choisis le thème Aesthetic Lab dans la liste :",
        cmds: ["shopify theme pull --store MA-BOUTIQUE.myshopify.com"],
      },
      {
        title: "Lancer la prévisualisation Shopify",
        text: "Dans le dossier du thème, lance :",
        cmds: ["shopify theme dev --store MA-BOUTIQUE.myshopify.com"],
        note: { kind: "info", title: "Ce que ça fait", text: "Shopify crée une prévisualisation de développement (lien http://127.0.0.1:9292). Elle sert à voir les changements en direct sans toucher au thème publié." },
      },
      {
        title: "Ouvrir Claude Code dans une deuxième fenêtre",
        text: "Garde « shopify theme dev » ouvert. Ouvre une DEUXIÈME fenêtre de commande dans le même dossier puis tape :",
        cmds: ["claude"],
      },
      {
        title: "Vérifier que Claude voit le projet",
        text: "Envoie ce message, sans demander de modification :",
        cmds: ["Analyse ce projet Shopify sans modifier aucun fichier. Confirme simplement que tu vois bien la structure du thème et que tu es prêt à travailler dessus."],
        note: { kind: "info", title: "Pourquoi deux fenêtres ?", text: "La première garde la prévisualisation Shopify active. La deuxième sert à travailler avec Claude Code. Quand un changement te plaît, dis-le à Mady avant de pousser quoi que ce soit." },
      },
      {
        title: "Tes médias dans le thème",
        text: "Les images et vidéos du thème, c'est toi qui les fais (page Créatives) et qui les places : Boutique en ligne > Thèmes > Personnaliser > la section > remplacer l'image. Les photos produit : Produits > le produit > Médias.",
      },
    ],
  },
  {
    id: "pixel",
    n: "06",
    title: "Installer le Pixel Meta et la Conversions API",
    intro: "Sans Pixel, Meta ne sait pas qui achète et tes pubs n'apprennent rien. À faire avant la première campagne, jamais après.",
    steps: [
      {
        title: "Créer le Pixel (jeu de données)",
        text: "Dans le Gestionnaire d'événements Meta (business.facebook.com/events_manager) > Connecter des sources de données > Web > donne un nom (ta marque) > Créer. Ne colle aucun code : on passe par l'application Shopify.",
        link: { label: "Ouvrir le Gestionnaire d'événements", href: "https://business.facebook.com/events_manager" },
      },
      {
        title: "Installer l'application Facebook & Instagram dans Shopify",
        text: "Admin Shopify > Applications > cherche « Facebook & Instagram » (par Meta) > Installer. Connecte ton compte Facebook, choisis ton portefeuille Meta Business, ta page Facebook, ton compte publicitaire et ton Pixel.",
        link: { label: "Application Facebook & Instagram", href: "https://apps.shopify.com/facebook" },
      },
      {
        title: "Partage de données : maximal",
        text: "Dans l'application, section Partage des données : choisis « Maximal » (c'est ça qui active la Conversions API côté serveur, en plus du Pixel navigateur). Accepte les conditions.",
      },
      {
        title: "Vérifier que ça remonte",
        text: "Gestionnaire d'événements > ton Pixel > Tester les événements > entre l'adresse de ta boutique > ouvre ta boutique dans un autre onglet, va sur un produit, ajoute au panier, va jusqu'au paiement. Tu dois voir apparaître PageView, ViewContent, AddToCart, InitiateCheckout. Fais une commande test pour voir Purchase.",
        note: { kind: "ok", title: "C'est bon quand", text: "Les 4 événements apparaissent en vert avec « Navigateur » ET « Serveur » dans la colonne source. Si tu ne vois que Navigateur, le partage de données n'est pas en Maximal." },
      },
    ],
  },
  {
    id: "claude",
    n: "07",
    title: "Travaille AVEC Claude, tout le temps",
    intro: "La règle n°1 de l'accompagnement : tu ne bloques jamais seul. Avant d'écrire à Mady, tu demandes à Claude. Il règle 80 % des problèmes en direct, si tu lui parles.",
    steps: [
      {
        title: "Prends Claude Max",
        text: "C'est l'abonnement qui donne assez d'usage pour construire une boutique entière avec Claude Code et travailler des heures par jour. Pro peut suffire pour commencer, mais tu vas taper la limite vite. Un jour de blocage coûte plus cher qu'un mois d'abonnement.",
        link: { label: "Prendre Claude Max", href: "https://claude.ai/upgrade" },
      },
      {
        title: "Installe l'extension Claude dans Chrome",
        text: "Claude peut prendre le contrôle de ton navigateur : il clique, remplit les réglages Shopify, vérifie le Pixel, crée tes zones de livraison… pendant que tu regardes. Installe « Claude in Chrome », connecte-le à ton compte, puis ouvre le panneau Claude sur ta page Shopify et dis-lui ce que tu veux faire.",
        link: { label: "Installer Claude pour Chrome", href: "https://claude.ai/chrome" },
      },
      {
        title: "Parle-lui beaucoup, comme à un associé",
        text: "Explique ton contexte en entier : « Je lance une boutique Shopify de [produit] pour [cible], je suis sur Windows, je ne sais pas coder. Je veux [objectif précis]. Guide-moi étape par étape et fais-le pour moi quand tu peux. » Puis colle les messages d'erreur, envoie des captures d'écran, pose des questions bêtes. Plus tu lui en dis, plus il est précis.",
      },
      {
        title: "Ne le sous-estime pas",
        text: "Claude peut : installer et dépanner Node, Shopify CLI, Git · modifier le thème (textes, couleurs, sections, vitesse) · écrire tes fiches produit, tes e-mails, tes politiques · configurer paiements, livraison, taxes avec l'extension Chrome · analyser tes résultats Meta Ads · t'écrire des scripts de créatives. Teste-le sur chaque chose qui te bloque AVANT de la mettre de côté.",
        note: { kind: "warn", title: "Une seule limite", text: "Il ne publie rien sur ton thème principal et il ne lance pas de pub sans que tu valides. Le reste, demande-lui." },
      },
      {
        title: "Exemples de demandes qui marchent",
        text: "- « Voici la capture d'une erreur dans PowerShell, explique-moi et donne-moi la commande exacte à taper. »\n- « Ouvre les paramètres d'expédition de ma boutique et crée une zone France avec livraison offerte. » (extension Chrome)\n- « Dans ce thème, change la couleur principale en #1F6F5B et vérifie que le contraste reste lisible. » (Claude Code)\n- « Relis ma fiche produit et réécris-la pour une femme de 35 ans qui veut [bénéfice]. »\n- « Vérifie que mon Pixel Meta remonte bien les événements et dis-moi ce qui manque. »",
      },
    ],
  },
  {
    id: "controle",
    n: "08",
    title: "Contrôle final avant ton call",
    intro: "Fais ce contrôle la veille, ou au minimum 30 minutes avant le rendez-vous. Fais une capture d'écran avec ces commandes et envoie-la à Mady.",
    steps: [
      {
        title: "Les cinq commandes",
        text: "Dans une fenêtre de commande :",
        cmds: ["git --version", "node -v", "npm -v", "shopify help", "claude --version"],
        note: { kind: "ok", title: "À envoyer à Mady", text: "Si les cinq commandes affichent un résultat sans erreur, ton ordinateur est prêt et le call peut commencer directement sur la boutique." },
      },
    ],
    fixes: [
      { problem: "node non reconnu", fix: "Redémarre l'ordinateur. Si besoin, réinstalle Node.js LTS." },
      { problem: "shopify non reconnu", fix: "Ouvre une nouvelle fenêtre et relance npm install -g @shopify/cli@latest." },
      { problem: "claude non reconnu", fix: "Ferme et rouvre Terminal / PowerShell, puis relance l'installation de Claude Code." },
      { problem: "Shopify refuse l'accès", fix: "Vérifie le compte utilisé et l'autorisation de gérer les thèmes." },
      { problem: "Toujours bloqué", fix: "Demande à Claude avec la capture du message complet. Puis, si ça ne passe pas, envoie la capture à Mady." },
    ],
  },
];

export const GUIDE_SOURCES: { label: string; href: string }[] = [
  { label: "Claude Code : installation officielle", href: "https://docs.claude.com/fr/docs/claude-code/setup" },
  { label: "Shopify CLI : installation et prérequis", href: "https://shopify.dev/docs/api/shopify-cli" },
  { label: "Shopify CLI pour les thèmes", href: "https://shopify.dev/docs/themes/tools/cli" },
  { label: "Application Facebook & Instagram (Pixel + Conversions API)", href: "https://help.shopify.com/fr/manual/online-sales-channels/facebook" },
];
