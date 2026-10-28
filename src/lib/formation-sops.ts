/**
 * SOP de la plateforme élèves (Scale X), octobre 2026.
 *
 * Une procédure par tâche, écrite d'après la méthode de Mady (vidéos
 * Démarrage, Création de la boutique, Créatives, guide d'installation) :
 * quand la faire, combien de temps, les étapes dans l'ordre, les messages
 * à coller à Claude, à quoi on voit que c'est bon, les erreurs vues chez
 * les élèves. Module pur : serveur et navigateur.
 */

export interface SopPrompt {
  title: string;
  text: string;
}

export interface Sop {
  id: string;
  n: string;
  icon: string;
  title: string;
  /** Ce qu'on obtient à la fin, en une phrase. */
  goal: string;
  when: string;
  time: string;
  tools: string[];
  steps: string[];
  prompts: SopPrompt[];
  /** « C'est bon quand » : la checklist de fin. */
  done: string[];
  mistakes: string[];
  links?: { label: string; href: string }[];
  /** Petit avertissement en haut de la fiche. */
  note?: string;
}

export const SOP_GROUPS: { key: string; label: string }[] = [
  { key: "claude", label: "Claude Code" },
  { key: "shopify", label: "Shopify" },
  { key: "produit", label: "Produit" },
  { key: "creatives", label: "Créatives" },
  { key: "meta", label: "Meta Ads" },
  { key: "routine", label: "Routine" },
];

export const SOPS: (Sop & { group: string })[] = [
  /* ------------------------------ Claude Code ------------------------------- */
  {
    id: "parler-a-claude",
    group: "claude",
    n: "01",
    icon: "💬",
    title: "Parler à Claude : la règle n°1",
    goal: "Tu sais écrire un message à Claude qui donne le bon résultat du premier coup.",
    when: "Avant chaque message à Claude, du premier jour jusqu'au scaling.",
    time: "2 min à lire, à vie",
    tools: ["Claude Code dans VS Code", "Micro (dictée)", "Captures d'écran"],
    steps: [
      "Donne le contexte à chaque message : qui tu es, ce que tu veux, pour quel produit, sur quelle page. Claude ne devine pas.",
      "Une demande à la fois. Tu demandes, tu fais F5 sur ta boutique, tu vérifies, tu passes à la suivante.",
      "Écris proprement : peu de fautes, Shift + Entrée pour aller à la ligne, Entrée pour envoyer. Ou tu dictes au micro, c'est encore mieux.",
      "Si le résultat n'est pas ce que tu voulais : dis-le clairement (« non, je voulais … »), il corrige. Tu peux toujours lui dire « annule ce que tu viens de faire ».",
      "S'il te propose un détour (un lien de prévisualisation, une autre méthode) et que tu veux autre chose : tu le lui dis, il le fait.",
      "Bloqué ou message rouge : capture d'écran, « voilà l'erreur, corrige et continue ». Pose toutes tes questions, même bêtes : Claude est ton meilleur ami.",
    ],
    prompts: [
      {
        title: "La structure d'un bon message (à adapter)",
        text: `Contexte : je monte une boutique Shopify pour [mon produit], ma cible c'est [qui], ma boutique est [adresse].
Ce que je veux : [une seule chose, précise].
Où : [page d'accueil / page produit / menu / section « … »].
Contraintes : tu ne touches pas au design ni à la structure, seulement [textes / images / cette section].
Quand c'est fait, dis-le moi en une phrase et je fais F5 pour vérifier.`,
      },
      {
        title: "Quand ce n'est pas ce que tu voulais",
        text: `Ce n'est pas ça. Ce que je voulais : [explique avec tes mots, précis]. Annule ce que tu viens de faire et refais-le comme ça.`,
      },
      {
        title: "Quand il y a une erreur",
        text: `Voilà l'erreur (capture d'écran jointe / message ci-dessous). Corrige-la et continue ce que tu faisais. Explique-moi en une phrase simple ce qui s'est passé.`,
      },
    ],
    done: ["Chaque message a un contexte, une demande, un endroit.", "Tu vérifies sur la boutique après chaque modification.", "Tu n'as jamais passé plus de 10 minutes bloqué sans le dire à Claude."],
    mistakes: ["Dix demandes dans un seul message : il en rate la moitié.", "« Fais-moi une belle boutique » : trop vague, il invente.", "Rester bloqué en silence au lieu d'envoyer la capture d'écran.", "Coller tes secrets (Client secret, mots de passe) dans le chat : ils vont dans le fichier .env."],
    links: [{ label: "La vidéo de Mady (Création de la boutique)", href: "/formation/boutique" }],
  },
  {
    id: "installer-claude-code",
    group: "claude",
    n: "02",
    icon: "🧩",
    title: "Installer VS Code et Claude Code",
    goal: "Claude Code est ouvert dans VS Code, connecté à ton compte, avec le bon modèle.",
    when: "Jour 1, avant tout le reste.",
    time: "10 min",
    tools: ["VS Code (gratuit)", "Extension « Claude Code for VS Code »", "Abonnement Claude (formule à 90 €/mois)"],
    steps: [
      "Télécharge VS Code (Windows ou Mac), installe-le en laissant tout par défaut, ouvre-le.",
      "Barre de gauche, tout en bas : Extensions. Tape « Claude Code », prends « Claude Code for VS Code » (éditeur Anthropic), Installer.",
      "Bouton « Claude Code » en haut à droite > Se connecter : le navigateur s'ouvre, tu te connectes, tu reviens dans VS Code.",
      "Abonnement : la formule à 90 € par mois suffit, la 200 € n'est pas nécessaire.",
      "En bas du panneau Claude Code, choisis le modèle Fable 5.1 ou Opus 5.5. Le réglage « Effort », tu le laisses.",
      "Ouvre Claude Code en grand (icône en haut à droite du panneau) : plus confortable pour travailler.",
    ],
    prompts: [
      {
        title: "Ton tout premier message, pour tester",
        text: `Salut Claude. Je suis débutant complet, je vais monter une boutique Shopify avec toi. Pour l'instant je vérifie juste que tout marche : réponds-moi en une phrase et dis-moi comment tu t'appelles et quel modèle tu es.`,
      },
    ],
    done: ["Le bouton Claude Code est en haut à droite de VS Code.", "Tu es connecté et le modèle Fable 5.1 ou Opus 5.5 est sélectionné.", "Claude a répondu à ton message test."],
    mistakes: ["Prendre une autre extension qui s'appelle « Claude » : il faut celle d'Anthropic.", "Rester sur le plan gratuit : Claude Code a besoin d'un abonnement payant."],
    links: [
      { label: "Télécharger VS Code", href: "https://code.visualstudio.com/download" },
      { label: "Le guide pas à pas (Démarrage)", href: "/formation/demarrage" },
    ],
  },

  /* ------------------------------ Shopify ------------------------------- */
  {
    id: "connecter-shopify",
    group: "shopify",
    n: "03",
    icon: "🔗",
    title: "Connecter ta boutique Shopify à Claude",
    goal: "Le thème de Mady est publié sur ta boutique et chaque modification demandée à Claude arrive en live (F5 et c'est là).",
    when: "Jour 1 ou 2, juste après l'installation de Claude Code.",
    time: "30 min",
    tools: ["Admin Shopify", "Dev Dashboard Shopify (app)", "Le zip du thème Aesthetic Lab de Mady", "VS Code + Claude Code"],
    steps: [
      "Récupère l'adresse de ta boutique : Shopify > Paramètres, tout en haut, l'adresse qui finit par .myshopify.com.",
      "Crée ton app : Paramètres > Applications et canaux de vente > Développer des applications > Dev Dashboard > Create app. Versions > Create version, coche read_themes, write_themes, read_products, write_products, write_content, Release.",
      "INSTALLE l'app sur ta boutique (carte Installs > Install app). C'est l'étape que tout le monde oublie : sans elle, Shopify répond « app not installed ».",
      "App settings > Credentials : copie le Client ID et le Client secret dans un fichier texte. Jamais dans le chat.",
      "Sur ton Bureau, crée un dossier « Prénom boutique », glisse le zip du thème dedans sans l'ouvrir. VS Code > Fichier > Ouvrir un dossier > ce dossier.",
      "Colle le premier message à Claude (ci-dessous). Il prépare tout et te demande de remplir un fichier .env.",
      "Dans l'explorateur de VS Code : renomme .env.example en .env, colle l'adresse .myshopify.com, le Client ID et le Client secret, Ctrl + S. Dis-le à Claude (message 2).",
      "Claude envoie le thème sur ta boutique, non publié. Dans Shopify > Boutique en ligne > Thèmes : trois points > Publier. Préférences > enlève le mot de passe.",
      "Dis à Claude que c'est publié et exige le live (message 3). Refuse les liens de prévisualisation.",
    ],
    prompts: [
      {
        title: "Message 1 : le premier message à Claude",
        text: `Salut Claude, j'ai besoin de créer une boutique Shopify avec toi.
Dans ce dossier il y a le thème template de mon coach (le fichier .zip).
J'ai en ma possession le Client ID et le Client secret de mon app Shopify, et l'adresse de ma boutique.
Je veux connecter Shopify à cette session pour qu'on bosse ensemble et que je voie les modifications du thème en live sur ma boutique.
Dis-moi ce que tu as besoin que je fasse, étape par étape, comme à un débutant complet.`,
      },
      {
        title: "Message 2 : le fichier .env est rempli",
        text: `C'est bon : j'ai renommé .env.example en .env, j'ai rempli l'adresse .myshopify.com, le Client ID et le Client secret.
Dis-moi les prochaines étapes. Je veux bosser sur ma boutique en live avec toi et que tu fasses les modifications.
Commence par pousser le thème sur la boutique.`,
      },
      {
        title: "Message 3 : le thème est publié, je veux le live",
        text: `J'ai publié le thème et il n'y a plus de mot de passe sur la boutique.
Je ne veux pas de lien de prévisualisation : je veux que chaque modification se pousse en live sur le thème publié, et que je voie le changement en faisant F5 sur ma boutique.`,
      },
      {
        title: "Si Shopify répond « app not installed »",
        text: `C'est bon, l'app est installée sur ma boutique. On avance.`,
      },
    ],
    done: ["Le thème « Aesthetic » de Mady est le thème publié de ta boutique.", "La boutique est publique (plus de mot de passe).", "Tu demandes une modification à Claude, tu fais F5, elle est là."],
    mistakes: ["App créée mais pas installée.", "Client secret collé dans le chat au lieu du fichier .env.", "Décompresser le zip à la main : Claude s'en occupe.", "Accepter un lien de prévisualisation : tu veux le live."],
    links: [
      { label: "Ouvrir mes paramètres Shopify", href: "https://admin.shopify.com/settings" },
      { label: "Le guide pas à pas (Démarrage, étapes 03 à 06)", href: "/formation/demarrage" },
    ],
  },
  {
    id: "modifier-boutique",
    group: "shopify",
    n: "04",
    icon: "🛠",
    title: "Modifier ta boutique en parlant à Claude",
    goal: "Le thème de Mady est devenu TA boutique : ton produit, tes textes, ton logo, tes couleurs, tes images. Sans toucher au design.",
    when: "Dès que Shopify est connecté, produit validé par Mady.",
    time: "2 à 4 h, section par section",
    tools: ["VS Code + Claude Code", "3 onglets : admin Shopify, éditeur « Personnaliser », ta boutique", "Canva (logo 450 × 150)", "Extensions ColorZilla et CSS Peeper (facultatif)"],
    steps: [
      "Organise ton écran : VS Code avec Claude à gauche, ta boutique à droite. F5 après chaque modification.",
      "Enlève ce qui n'est pas ton produit (les exemples de Mady : jawliner, patch, tape…). Une section à la fois.",
      "Les menus : remplace par Accueil, Collection, Contact (ou ce qui colle à ta marque).",
      "Ton logo : fais-le sur Canva en 450 × 150 px, simple. Glisse le fichier dans la fenêtre Claude Code et dis-lui de le poser.",
      "Tes couleurs : prends la couleur principale d'un concurrent direct (ColorZilla), colle le code couleur à Claude.",
      "Le copywriting : colle l'adresse de la boutique du concurrent, Claude réadapte tous les textes pour ton produit. Puis tu corriges section par section.",
      "Les images : les tiennes viennent du Studio IA (page Créatives). Mets-les dans le sous-dossier « creatives » et dis à Claude où les placer et en quel format.",
      "La page produit : un seul produit, titre, description, prix, prix barré, tes images. Supprime les exemples.",
      "Vérifie sur mobile, puis commande test depuis ton téléphone.",
    ],
    prompts: [
      {
        title: "Le message complet pour poser ton produit sur le thème de Mady",
        text: `Dans mon dossier il y a le fichier [NOM-DU-ZIP].zip : c'est le thème Shopify « Aesthetic Lab » de mon coach Mady. Sa page est parfaite. Tu ne changes ni la structure, ni le design, ni l'ordre des sections, ni les couleurs, ni les polices, ni le CSS.

Ma boutique : [mon-adresse].myshopify.com
Mon produit : [nom, ce que c'est, ce qu'il fait, prix de vente, prix barré]
Ma marque : [nom de marque] · e-mail support : [support@…]
Ma cible : [qui achète et pourquoi]
Mes images et vidéos : dans le sous-dossier « creatives »

Remplace UNIQUEMENT le contenu, dans cet ordre, une section à la fois, et attends mon OK entre chaque :
- Réglages du thème : nom de marque, favicon, e-mail support, liens clés.
- Hero : ma vidéo 9:16 (ou mon image) du dossier creatives, titre et sous-titre pour mon produit.
- Sections bénéfices, comment ça marche, avant / après, avis, FAQ, pied de page : réécris tous les textes pour mon produit, en français, même longueur ; mes images à la place des placeholders ; propose-moi 6 avis clients crédibles à valider.
- Page produit : un seul produit, supprime les exemples, crée le mien (titre, description, prix, prix barré, images).
- Dis-moi les images ou vidéos qui manquent, où, et en quel format (3:4, 1:1, 9:16, 16:9) : je les génère dans mon Studio IA.
Vérifie que l'accueil et la page produit s'affichent bien sur mobile.`,
      },
      { title: "Enlever une section", text: `Enlève la section de la page d'accueil où il y a écrit « [le texte de la section] ».` },
      { title: "Changer les menus", text: `Change les menus de la boutique : enlève [Glow up, Our protocol, Track my order], remplace par Accueil, Collection, Contact.` },
      { title: "Poser ton logo", text: `Voilà mon logo (fichier joint, 450 × 150). Mets-le sur ma boutique à la place du logo actuel, en haut à gauche, et vérifie qu'il est net sur mobile.` },
      { title: "Tes couleurs à partir d'un concurrent", text: `Je veux la couleur [#CODE] comme couleur principale des titres et des boutons, sur un fond blanc. Trouve-moi une deuxième couleur un peu plus claire qui va avec pour les fonds de section. Applique, je fais F5.` },
      { title: "Le copywriting à partir d'un concurrent", text: `Analyse cette boutique : [adresse du concurrent]. C'est mon concurrent direct. Réadapte tous les textes de mon thème actuel avec un copywriting pour mon produit [nom], même ton, même structure, en français. Section par section, attends mon OK entre chaque.` },
      { title: "La page produit", text: `Garde un seul template produit, supprime les produits d'exemple, crée mon produit : titre « [titre] », description [colle-la ou dis « écris-la à partir de ma page d'accueil »], prix [X] €, prix barré [Y] €, mes images du dossier creatives. Puis vérifie la page sur mobile.` },
    ],
    done: ["Plus aucun texte ou image de l'exemple de Mady.", "Logo, menus, couleurs, textes, page produit : tout est à toi.", "Commande test passée depuis ton téléphone, e-mail de commande reçu."],
    mistakes: ["Toucher au design ou à la structure : le thème est fait pour convertir, tu changes le contenu.", "Trop de produits : un seul produit, une seule page qui convertit.", "Des images de concurrent en production : elles servent à aller vite, tes vraies images viennent du Studio IA."],
    links: [{ label: "La vidéo et les étapes (Création de la boutique)", href: "/formation/boutique" }],
  },
  {
    id: "regler-shopify",
    group: "shopify",
    n: "05",
    icon: "⚙️",
    title: "Régler Shopify pour pouvoir vendre",
    goal: "Un client peut payer, être livré, lire tes politiques, et ta boutique a son nom de domaine.",
    when: "Une fois, avant la première campagne.",
    time: "30 min",
    tools: ["Admin Shopify > Paramètres", "Pièce d'identité + IBAN", "Claude pour Chrome (facultatif)"],
    steps: [
      "Paiements : active Shopify Payments (identité, adresse, IBAN). Ajoute PayPal si tu as un compte Business.",
      "Expédition : une zone (France ou ton pays), un seul tarif « Livraison standard 5 à 10 jours », gratuit ou 4,90 €. Supprime les autres.",
      "Politiques : « Créer à partir d'un modèle » pour remboursement, confidentialité, conditions de vente, livraison. Elles s'ajoutent en bas de la boutique.",
      "Domaine : Paramètres > Domaines > Acheter (environ 15 €/an). Une adresse xxx.myshopify.com fait fuir.",
      "Préférences : enlève le mot de passe. Commande test depuis ton téléphone, tu dois recevoir l'e-mail de commande.",
    ],
    prompts: [
      { title: "Claude pour Chrome fait les clics à ta place", text: `Ouvre mes paramètres Shopify et configure la livraison : une zone France, un seul tarif « Livraison standard 5 à 10 jours », livraison offerte. Supprime les autres tarifs. Dis-moi quand c'est fait.` },
      { title: "Les politiques", text: `Dans mes paramètres Shopify > Politiques, crée chaque politique à partir du modèle Shopify (remboursement, confidentialité, conditions de vente, livraison) et enregistre. Vérifie qu'elles apparaissent en bas de ma boutique.` },
    ],
    done: ["Shopify Payments actif.", "Un seul tarif de livraison.", "4 politiques en bas de la boutique.", "Nom de domaine relié.", "Commande test reçue par e-mail."],
    mistakes: ["Lancer des pubs avant la commande test : des clics qui ne peuvent pas payer.", "Trois tarifs de livraison : le client hésite, il part."],
    links: [
      { label: "Ouvrir Paiements", href: "https://admin.shopify.com/settings/payments" },
      { label: "Ouvrir Expédition", href: "https://admin.shopify.com/settings/shipping" },
      { label: "Installer Claude pour Chrome", href: "https://claude.ai/chrome" },
    ],
  },

  /* ------------------------------ Produit ------------------------------- */
  {
    id: "recherche-produit",
    group: "produit",
    n: "06",
    icon: "🔎",
    title: "Trouver ton produit avec BrandSearch",
    goal: "Un tableau de 10 produits envoyé à Mady sur WhatsApp, et UN produit validé avec son prix et son angle.",
    when: "Semaine 1, après le Démarrage. Rien ne se construit avant la validation.",
    time: "2 à 3 h",
    tools: ["BrandSearch (plan Starter, 63 $/mois)", "Page Recherche produit (le tableau)", "WhatsApp de Mady"],
    steps: [
      "Regarde la vidéo BrandSearch en entier avant de chercher.",
      "Dans BrandSearch, cherche les produits qui se vendent DÉJÀ : pubs qui tournent depuis plusieurs semaines, boutiques qui scalent, marché US ou francophone.",
      "Pour chaque produit, demande-toi : quelle douleur il règle ? (cervicales, sommeil, peau, temps perdu…). Un produit qui règle un problème se vend. Un gadget, non.",
      "Vérifie le prix : vente entre 30 et 80 € en général, au moins 3 fois le prix d'achat, livrable en 5 à 10 jours.",
      "Remplis le tableau de la page Recherche produit : produit, lien, prix de vente, pourquoi il marche (la douleur + la preuve que ça se vend).",
      "Envoie les 10 produits à Mady en UN seul message WhatsApp. Il valide avec toi : lequel, le prix, l'angle. Puis il t'ouvre le Studio IA.",
    ],
    prompts: [
      {
        title: "Faire pré-trier tes produits par Claude ou ChatGPT",
        text: `Je fais du e-commerce (Shopify, pubs Meta). Voici 10 produits que j'ai trouvés sur BrandSearch avec pour chacun : nom, prix de vente, prix d'achat, la douleur qu'il règle, et la preuve que ça se vend (pubs qui tournent, boutiques).
[colle ton tableau]
Classe-les du meilleur au moins bon pour un débutant qui lance sa première boutique, avec pour chacun : la douleur principale, l'angle marketing le plus fort, la marge, et le risque. Sois direct.`,
      },
      {
        title: "Trouver l'angle d'un produit",
        text: `Mon produit : [nom, ce qu'il fait, prix de vente]. Ma cible : [qui]. Trouve-moi 5 angles marketing qui tapent sur une douleur précise et vendent une solution, avec pour chacun : la douleur, la promesse, une phrase d'accroche, et une idée de validation sociale (la copine qui demande où tu l'as acheté, les gens qui regardent dans la rue…).`,
      },
    ],
    done: ["10 produits dans le tableau, avec le pourquoi.", "Message WhatsApp envoyé à Mady.", "Produit, prix et angle validés par Mady.", "Studio IA ouvert pour toi."],
    mistakes: ["Choisir un produit qu'on aime au lieu d'un produit qui se vend déjà.", "Pas de douleur = pas de vente.", "Commencer la boutique avant la validation de Mady."],
    links: [{ label: "Page Recherche produit", href: "/formation/produit" }],
  },

  /* ------------------------------ Créatives ------------------------------- */
  {
    id: "creatives-prompts",
    group: "creatives",
    n: "07",
    icon: "✦",
    title: "Créatives : l'angle, puis les prompts au micro",
    goal: "Un drive avec 5 à 15 créatives (photos et vidéos, formats mélangés) et les médias de la boutique.",
    when: "Produit validé, boutique en cours ou finie.",
    time: "1 h pour le premier batch",
    tools: ["ChatGPT ou Claude (avec le micro)", "Studio IA de la plateforme (clé KIE branchée)", "Une photo de ton produit sur fond blanc"],
    steps: [
      "Ta référence : une photo de ton produit sur fond blanc, sans texte ni élément autour. Plus 2 à 4 photos sous différents angles pour les vidéos.",
      "Trouve l'angle AVANT de prompter : la douleur (cervicales, nuque brisée au réveil…), la solution, la validation sociale.",
      "Demande les prompts au micro à ChatGPT ou Claude : produit, marché, prix, formats voulus. Exige les prompts bruts, un par un, chacun avec sa negative prompt (pas de rendu IA, ultra réaliste).",
      "Les formats qui marchent : punchy sales (gros titre, gros prix, badges, flèches, prix entouré), avant / après, épuré (petit texte, prix discret), note iPhone, conversation entre deux copines. Chaque élément qui accroche l'œil est un hook visuel : il en faut, mais pas trop.",
      "Génère en chaîne dans le Studio IA : image de référence, prompt collé, format, Générer. Ctrl + A, Ctrl + V, suivant. 0,03 € l'image.",
      "Trie : garde ce qui a un gros titre, un prix visible, un hook visuel, une mise en situation. Jette ce qui est surchargé. Une erreur (texte faux, mauvais pays) ? Recolle le prompt à Chat, dis-lui ce qui cloche au micro, il le réécrit.",
      "Formats pour Meta : statiques en 1:1 et 3:4 (9:16 en plus si tu veux), vidéos en 9:16.",
      "Livraison : un drive avec 5 à 15 créatives + les médias de la boutique (images produit, visuels de la page d'accueil, faux packaging si besoin). Premium, pas bâclé.",
    ],
    prompts: [
      {
        title: "Demander les angles (au micro ou collé)",
        text: `Voici mon produit : [nom, ce qu'il fait, prix de vente, marché US ou France]. Trouve-moi des angles marketing en respectant ces formats : punchy sales, avant / après, note iPhone, UGC. On tape sur la douleur et on vend une solution, avec de la validation sociale.`,
      },
      {
        title: "Demander le batch de prompts images",
        text: `Fais-moi 5 prompts « punchy sales » en 3:4 pour le marché [US / France], produit à [prix], avec badges, étiquettes, flèches, produit et prix entourés ; 5 prompts plus sobres avec de l'avant / après ; 1 format note iPhone ; et 3 images de référence pour des vidéos Seedance (une fille dans son lit qui déballe le produit, un unboxing, une réaction). Donne-moi les prompts bruts, un par un, chacun avec sa negative prompt (pas de rendu IA, ultra réaliste, pas de texte déformé). Les textes sur l'image sont en [anglais / français], sans faute.`,
      },
      {
        title: "Corriger une créative ratée",
        text: `Voilà le prompt que tu m'as donné : [colle le prompt]. Sur l'image générée, [ce qui cloche : « Designed in France » alors que c'est pour les US / texte illisible / trop d'éléments]. Réécris le prompt pour corriger ça, même structure.`,
      },
    ],
    done: ["Première série de 10 créatives générée et triée.", "Au moins une de chaque : punchy sales, avant / après, épuré ou note iPhone.", "Drive partagé à Mady avec 5 à 15 créatives + médias boutique."],
    mistakes: ["Prompter sans angle : des jolies images qui ne vendent rien.", "Trop de texte et trop d'éléments sur une image.", "Une seule créative : Meta a besoin de 5 à 8 variantes pour apprendre."],
    links: [{ label: "La vidéo et les 11 étapes (Créatives)", href: "/formation/creatives" }],
  },
  {
    id: "studio-ia",
    group: "creatives",
    n: "08",
    icon: "◐",
    title: "Studio IA : images et vidéos Seedance",
    goal: "Tu génères une image en 30 secondes et une vidéo 9:16 propre, sans gaspiller ton crédit KIE.",
    when: "À chaque batch de créatives et pour les médias de la boutique.",
    time: "10 min par batch",
    tools: ["Studio IA (onglet Image : GPT Image 2 · onglet Création : Seedance 2.5)", "Clé API KIE (Démarrage)", "Tes photos produit"],
    steps: [
      "Images : onglet Image, image de référence (produit sur fond blanc), prompt collé, format 3:4 ou 1:1, Générer. 0,03 € l'image. Génère par 5, trie, recommence.",
      "Vidéos : génère D'ABORD l'image de départ en 9:16 (pas en 3:4, sinon la vidéo sort en 3:4 : Mady a fait l'erreur pour toi).",
      "Onglet Création : image de départ 9:16 + 2 à 4 photos du produit (face, dos, côté) + prompt complet : hook, changements de séquence, validation sociale, appel à l'action à 15 secondes. Ou juste le script si la personne parle face caméra.",
      "Réglages : Auto, 16 s, 720 (ou 480 pour tester). Une vidéo coûte 2 à 3 € : surveille ton crédit KIE, génère une vidéo, regarde, puis la suivante.",
      "Adapte les prompts exemples de Mady (sous la vidéo Créatives) à ton produit avec Claude, en gardant la même structure.",
      "Si le serveur renvoie une erreur, le formulaire réessaie tout seul : ne clique pas dix fois sur Générer.",
    ],
    prompts: [
      {
        title: "Adapter un prompt vidéo de Mady à ton produit",
        text: `Mon coach m'a envoyé cette structure de prompt pour des vidéos Seedance 2.5 : [colle le prompt exemple]. Adapte-la à mon produit avec exactement la même structure (hook, séquences, validation sociale, appel à l'action à 15 s). Voici ma page produit : [adresse]. La personne dit le prix du produit. Donne-moi aussi la negative prompt.`,
      },
      {
        title: "Un prompt vidéo UGC face caméra",
        text: `Écris-moi un script de 15 secondes pour une vidéo UGC Seedance 2.5 : une [femme / homme] de [âge] dans [lieu], face caméra, style téléphone, qui raconte sa douleur ([douleur]), montre le produit [nom], et finit par un appel à l'action avec le prix [prix]. Phrases courtes, naturelles, en [langue]. Puis le prompt visuel complet avec la negative prompt.`,
      },
    ],
    done: ["Image de référence vidéo en 9:16.", "Une vidéo 9:16 propre, sans rendu IA visible.", "Crédit KIE vérifié avant et après."],
    mistakes: ["Image de départ en 3:4 pour une vidéo : elle sort en 3:4.", "Lancer 5 vidéos d'un coup sans regarder la première : 15 € partis.", "Pas de negative prompt : rendu IA, mains bizarres."],
    links: [{ label: "Ouvrir le Studio IA", href: "/formation/studio" }],
  },

  /* ------------------------------ Meta ------------------------------- */
  {
    id: "pixel-meta",
    group: "meta",
    n: "09",
    icon: "📡",
    title: "Meta Business, compte publicitaire et Pixel",
    goal: "Meta sait qui achète sur ta boutique : le Pixel remonte vue de page, ajout au panier et achat.",
    when: "Avant la première campagne, pendant que les créatives se font.",
    time: "45 min",
    tools: ["business.facebook.com", "Application « Facebook & Instagram » dans Shopify", "Gestionnaire d'événements Meta", "Claude pour Chrome (facultatif)"],
    steps: [
      "Crée un portefeuille Meta Business, un compte publicitaire, ajoute ta carte et vérifie-le. Crée une page Facebook et relie ton Instagram de marque.",
      "Donne l'accès partenaire à Mady quand il te le demande.",
      "Dans Shopify > Applications : installe « Facebook & Instagram ». Connecte ton compte, choisis ton compte publicitaire et ton Pixel (crée-le si on te le propose).",
      "Partage des données : Maximal.",
      "Vérifie : ouvre ta boutique, ajoute un produit au panier. Dans Gestionnaire d'événements > Tester les événements, des lignes vertes apparaissent.",
      "Pas envie de cliquer partout ? Claude (pour Chrome ou l'app) peut créer le Pixel et le connecter à ta boutique pendant que tu regardes.",
    ],
    prompts: [
      { title: "Claude crée et connecte ton Pixel", text: `Ouvre mon Gestionnaire d'événements Meta et ma boutique Shopify. Crée un Pixel Meta pour ma boutique [nom] s'il n'existe pas, connecte-le via l'application Facebook & Instagram de Shopify avec le partage de données Maximal, puis teste : vue de page, ajout au panier, achat. Dis-moi ce qui remonte.` },
      { title: "Vérifier que le Pixel remonte", text: `Vérifie que mon Pixel Meta remonte bien les événements PageView, AddToCart et Purchase depuis ma boutique [adresse]. Si quelque chose manque, dis-moi exactement quoi corriger, étape par étape.` },
    ],
    done: ["Compte publicitaire vérifié, carte ajoutée, Mady en partenaire.", "Lignes vertes dans Tester les événements (PageView, AddToCart).", "Partage des données sur Maximal."],
    mistakes: ["Lancer une campagne sans Pixel : Meta n'apprend rien, tu paies pour rien.", "Oublier le partage de données Maximal : la moitié des achats n'est pas vue."],
    links: [
      { label: "Meta Business", href: "https://business.facebook.com" },
      { label: "Gestionnaire d'événements", href: "https://business.facebook.com/events_manager" },
    ],
  },
  {
    id: "campagne-meta",
    group: "meta",
    n: "10",
    icon: "▲",
    title: "Lancer et lire ta première campagne Meta",
    goal: "Une campagne de test propre, 3 jours sans y toucher, puis une décision : couper, garder ou scaler.",
    when: "Boutique qui encaisse, Pixel posé, 5 à 8 créatives prêtes.",
    time: "1 h pour lancer, 10 min par jour pour lire",
    tools: ["Ads Manager (Gestionnaire de publicités)", "Tes créatives 1:1, 3:4 et 9:16", "Un tableau de suivi (ou Claude)"],
    note: "Trame standard de Scale X : la vidéo de Mady sur les campagnes arrive sur la page Campagnes Meta et affinera ces réglages. En attendant, c'est cette structure qu'on utilise.",
    steps: [
      "Objectif : Ventes (conversion Achat sur ton Pixel). Pas Trafic, pas Engagement.",
      "Structure de test : 1 campagne, budget au niveau de la campagne (CBO) de 30 à 50 € par jour, 1 ensemble de publicités large (pays cible, 18-65, pas d'intérêts, placements Advantage+), 5 à 8 publicités (tes créatives : 2 vidéos, 3 à 5 images, formats mélangés).",
      "Texte de la pub : la douleur en première ligne, la promesse, le prix ou l'offre, un appel à l'action. Titre court. Lien vers ta page produit.",
      "Lance le soir, et NE TOUCHE À RIEN pendant 3 jours : Meta apprend. Chaque modification relance l'apprentissage.",
      "Chaque matin, lis 4 chiffres par publicité : CPM (coût pour 1 000 vues), CTR (taux de clic, vise plus de 1 %), coût par ajout au panier, coût par achat (CPA).",
      "Décision à J+3 : CPA inférieur à ta marge → garde et augmente le budget de 20 % tous les 2 jours. CTR sous 1 % → la créative n'accroche pas, remplace-la. Beaucoup de clics, zéro panier → la page produit ou le prix pose problème. Zéro vente après 3 fois le prix du produit dépensé → coupe la pub.",
      "Remplace les créatives mortes par de nouvelles (Studio IA), jamais plus de 2 changements à la fois.",
    ],
    prompts: [
      {
        title: "Les textes de la pub",
        text: `Écris-moi 3 textes de publicité Meta pour mon produit [nom, prix, promesse], cible [qui], marché [pays]. Structure : la douleur en première ligne (hook), la promesse, l'offre ou le prix, un appel à l'action. 3 titres courts (moins de 40 caractères). Ton direct, pas de superlatifs vides, en [langue]. Pas d'emoji à chaque ligne.`,
      },
      {
        title: "Lire tes chiffres avec Claude",
        text: `Voici les résultats de ma campagne Meta après 3 jours, par publicité : [colle le tableau : dépense, impressions, CPM, CTR, ajouts au panier, achats, CPA]. Mon prix de vente est [X] €, mon prix d'achat [Y] €. Dis-moi pour chaque publicité : couper, garder ou scaler, et pourquoi. Puis ce que je dois changer en priorité (créative, page produit, prix ou offre).`,
      },
    ],
    done: ["Campagne Ventes active avec 5 à 8 publicités.", "3 jours sans modification.", "Décision prise à J+3 avec les 4 chiffres.", "Compte rendu envoyé à Mady (capture de l'Ads Manager)."],
    mistakes: ["Toucher au budget ou aux pubs toutes les 6 heures.", "Objectif Trafic : des clics pas chers qui n'achètent pas.", "Une seule créative.", "Scaler de 100 % d'un coup : la campagne se casse."],
    links: [
      { label: "Ads Manager", href: "https://adsmanager.facebook.com" },
      { label: "Page Campagnes Meta", href: "/formation/meta" },
    ],
  },

  /* ------------------------------ Routine ------------------------------- */
  {
    id: "routine-bloque",
    group: "routine",
    n: "11",
    icon: "🧭",
    title: "Ta routine, et quoi faire quand ça bloque",
    goal: "Tu avances tous les jours, tu ne restes jamais bloqué, et Mady est sollicité pour les bonnes choses.",
    when: "Tout le temps.",
    time: "1 h par jour minimum",
    tools: ["Claude (Code, Chrome ou l'app)", "WhatsApp de Mady", "Chrome Remote Desktop (installé une fois)", "Page Mes étapes"],
    steps: [
      "Chaque session : ouvre Mes étapes, prends la prochaine étape non cochée, fais-la, coche-la. Une étape finie vaut mieux que trois commencées.",
      "Valide chaque étape du parcours en bas de page quand c'est fait : Mady le voit dans son suivi et sait où tu en es.",
      "Bloqué ? Claude d'abord : message d'erreur, capture d'écran, ce que tu voulais faire. Il règle 80 % des problèmes en direct.",
      "Toujours bloqué après avoir vraiment essayé avec Claude ? WhatsApp à Mady, avec la capture et ce que tu as déjà tenté. Pas « ça marche pas ».",
      "Les vrais blocages se règlent en call : Chrome Remote Desktop installé, Mady prend la main sur ton écran.",
      "Mady, c'est pour les validations (produit, créatives, campagne) et les urgences. Le reste, c'est Claude.",
    ],
    prompts: [
      { title: "Débloquer avec Claude", text: `Je suis bloqué. Ce que je voulais faire : [quoi]. Ce que j'ai fait : [étapes]. Ce qui se passe : [erreur ou résultat, capture jointe]. Explique-moi ce qui se passe en une phrase simple, puis règle-le ou dis-moi exactement quoi cliquer.` },
      { title: "Le message à Mady, si Claude n'y arrive pas", text: `Salut Mady, je bloque sur [étape]. J'ai essayé avec Claude : [ce qu'il a proposé], ça donne [résultat]. Capture jointe. Tu peux regarder quand tu as 2 min ?` },
    ],
    done: ["Une étape cochée par session.", "Chaque blocage passé par Claude avant Mady.", "Chrome Remote Desktop installé."],
    mistakes: ["Rester bloqué trois jours sans rien dire.", "Envoyer « ça marche pas » sans capture ni contexte.", "Sauter des étapes : la boutique avant le produit validé."],
    links: [
      { label: "Mes étapes", href: "/formation/etapes" },
      { label: "Installer Chrome Remote Desktop", href: "https://remotedesktop.google.com/access" },
    ],
  },
];
