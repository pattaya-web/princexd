import type { CreativeExample, CreativePrompt, Settings, StudentCreativesSettings } from "@/lib/types";

/**
 * Page Créatives de la plateforme élèves (Scale X).
 *
 * La boutique exemple de Mady, des créatives exemples (images / vidéos), et
 * la bibliothèque de prompts que l'élève copie dans Claude ou GPT pour se
 * faire écrire ses prompts d'images (GPT Image 2 / Higgsfield), ses scripts
 * UGC et ses prompts vidéo (Seedance, Veo…). Tout est modifiable par
 * l'admin depuis la page elle-même ; les valeurs par défaut sont ici.
 * Module pur : serveur et navigateur.
 */

export const DEFAULT_CREATIVE_PROMPTS: CreativePrompt[] = [
  {
    id: "angles",
    kind: "strategie",
    title: "1. Trouver tes angles marketing (à faire en premier)",
    target: "Claude ou GPT",
    text: `Tu es un expert en publicité e-commerce (Meta Ads, TikTok Ads) spécialisé dans les marques DTC qui scalent.

Mon produit : [ce que c'est, matière, ce qu'il fait, prix de vente]
Ma cible : [qui achète : âge, sexe, situation, ce qu'elle veut vraiment]
Lien concurrent qui vend déjà ce produit : [URL]
Ma marque : [nom] · ton : [ex. clean et premium / chaleureux / sportif]

Donne-moi 10 angles marketing différents pour vendre ce produit en publicité. Pour chaque angle : le nom de l'angle, la douleur ou le désir qu'il touche, le hook (première phrase, 8 mots max, qui arrête le scroll), et le type de créative qui marche le mieux pour cet angle (UGC face caméra, démonstration, avant / après, image statique avec texte, unboxing).

Classe-les du plus prometteur au moins prometteur pour un lancement à petit budget, et explique en une phrase pourquoi le numéro 1 est le numéro 1.`,
  },
  {
    id: "images-produit",
    kind: "image",
    title: "2. Prompts d'images produit pour la boutique (GPT Image 2 / Higgsfield)",
    target: "Claude ou GPT → puis Higgsfield (GPT Image 2) ou Studio IA",
    text: `Tu es directeur artistique e-commerce. Ma marque : [nom]. Mon produit : [description précise : ce que c'est, matière, couleur, taille, ce qu'il fait]. Ma cible : [qui achète, âge, besoin]. Ton de marque : [ex. clean et premium / naturel et chaleureux / sportif]. Ma boutique est en [français / anglais].

J'ai une image de référence du produit que je mets en référence dans l'outil de génération (GPT Image 2 sur Higgsfield) : le produit doit rester strictement identique sur chaque image (forme, couleurs, matière, logo), interdiction de le redessiner.

Écris-moi UN prompt par image de la liste ci-dessous, en anglais, prêt à coller. Chaque prompt : photo-réaliste, style photo smartphone ou studio selon la section, personne crédible si besoin (pas de visage de célébrité), cadrage adapté au ratio, lumière naturelle, peau réelle, fond cohérent avec la marque, aucun texte dans l'image, aucun logo inventé. Termine chaque prompt par ce qu'il faut éviter.

Présente le résultat en liste : numéro, section, ratio, puis le prompt dans un bloc à copier. Pour les photos avis clients, varie les personnes, les lieux et les gestes. Pour les avant / après, même personne, même cadrage, même lumière, seule la différence promise change.

Liste des images :
- 1 × ratio 16:9 · Bannière d'accueil (produit en situation, héros)
- 1 × ratio 9:16 · Bannière mobile
- 3 × ratio 1:1 · Photos produit fond simple (3 angles)
- 3 × ratio 4:5 · Produit en situation d'usage (lifestyle)
- 2 × ratio 1:1 · Avant / après
- 4 × ratio 1:1 · Photos « avis clients » (personnes différentes avec le produit)
- 1 × ratio 16:9 · Section « Comment ça marche »`,
  },
  {
    id: "statiques",
    kind: "image",
    title: "3. Pubs statiques Meta (image + accroche)",
    target: "Claude ou GPT → puis GPT Image 2 / Studio IA",
    text: `Tu es un créatif publicitaire spécialisé dans les pubs statiques Meta qui convertissent pour des marques e-commerce.

Mon produit : [description]. Ma cible : [cible]. Mon angle principal : [angle choisi à l'étape 1]. Prix : [prix]. Offre : [ex. livraison offerte / -20 % lancement / 2 achetés = 1 offert].

Propose-moi 5 concepts de pub statique (format 4:5, pour Facebook et Instagram). Pour chaque concept :
1. Le nom du concept (ex. « Avant / après », « Témoignage », « Nous vs eux », « Liste de bénéfices », « Pub façon note iPhone »).
2. Le texte qui sera ÉCRIT SUR L'IMAGE : une accroche de 6 à 10 mots, un sous-titre de 12 mots max, un appel à l'action de 3 mots.
3. Le prompt image en anglais pour GPT Image 2, prêt à coller, qui décrit la scène, le produit (identique à mon image de référence), le placement des zones de texte, le style (photo réelle, pas d'illustration), le ratio 4:5. Précise que le texte doit être rendu lisible, en français, sans faute, dans la police indiquée.
4. Le texte principal de la pub (au-dessus de l'image) : 3 lignes max, qui commence par le hook et finit par le lien.

Donne aussi 2 variantes d'accroche par concept pour que je teste.`,
  },
  {
    id: "script-ugc",
    kind: "video",
    title: "4. Scripts vidéo UGC (15 à 30 secondes)",
    target: "Claude ou GPT",
    text: `Tu es scénariste de pubs UGC (contenu généré par les utilisateurs) pour TikTok et Meta. Tu écris des scripts qui ressemblent à une vraie personne qui parle à sa caméra, pas à une pub.

Mon produit : [description]. Ma cible : [cible]. Angle : [angle]. Objection principale de mes clients : [ex. « ça marche vraiment ? » / « trop cher » / « j'ai déjà essayé »]. Langue : français parlé, naturel, tutoiement.

Écris-moi 3 scripts de 20 à 30 secondes (60 à 80 mots chacun), structure :
- Hook (0-3 s) : une phrase qui arrête le scroll, liée à la douleur ou au résultat.
- Problème (3-8 s) : ce que la personne vivait avant.
- Produit (8-20 s) : comment elle l'a découvert, ce que ça fait, démonstration.
- Preuve (20-25 s) : un résultat concret, un chiffre, un avant / après.
- Appel à l'action (25-30 s) : simple, avec l'offre.

Pour chaque script, donne : le texte parlé (tel quel, à lire), les plans à filmer ou à générer (une ligne par plan : lieu, action, ce qu'on voit), et le texte à afficher à l'écran (sous-titres clés, 3 à 5 mots max par carte). Les 3 scripts doivent avoir 3 hooks de nature différente : question, affirmation choc, résultat.`,
  },
  {
    id: "video-ia",
    kind: "video",
    title: "5. Transformer un script en prompts vidéo IA (Seedance / Veo / Studio IA)",
    target: "Claude ou GPT → puis Studio IA (Seedance) ou Higgsfield",
    text: `Tu es réalisateur de pubs vidéo générées par IA (modèles Seedance, Veo, Kling). Tu convertis un script UGC en prompts vidéo prêts à coller, un par plan.

Voici mon script : [colle le script de l'étape 4]
Mon produit : [description précise, il doit rester identique à mon image de référence]
Personnage : [ex. femme 30 ans, cheveux bruns, salle de bain lumineuse] (le même sur tous les plans)
Format : 9:16 vertical. Durée totale : [20-30 s]. Chaque clip : 5 à 10 secondes maximum.

Pour chaque plan, écris :
1. Le prompt vidéo en anglais (une seule scène, caméra décrite, mouvement, lumière, ambiance, ce que fait la personne, où est le produit, « realistic smartphone footage, natural skin, no text, no logo »).
2. Si le plan est parlé : la ligne de dialogue en français, pour que je la mette dans le modèle (ou que je l'enregistre en voix off).
3. La durée du clip.
4. L'image de départ à générer d'abord (prompt image, même personnage, même décor), car la vidéo part de cette image.

Garde la cohérence totale entre les plans (même personne, même tenue, même lieu, même lumière). Termine par la liste des clips dans l'ordre de montage et le texte des sous-titres.`,
  },
  {
    id: "avant-apres",
    kind: "image",
    title: "6. Visuels avant / après crédibles",
    target: "Claude ou GPT → puis GPT Image 2",
    text: `Tu es directeur artistique. Je veux 3 visuels « avant / après » pour mon produit : [description, ce qu'il change concrètement]. Cible : [cible]. Résultat promis : [résultat réaliste, pas de promesse médicale].

Pour chaque visuel, écris 2 prompts en anglais pour GPT Image 2 : le prompt « avant » et le prompt « après ». Les deux doivent décrire exactement la même personne (décris-la précisément : âge, peau, cheveux, tenue), le même cadrage, la même lumière, le même décor et le même angle. Seule la différence promise change, de façon subtile et crédible (pas de miracle). Format 1:1, photo smartphone réaliste, pas de texte, pas de logo, pas de retouche visible.

Ajoute pour chaque visuel la légende courte (5 mots) à mettre sous chaque image, et une phrase de mise en garde si le produit touche à la santé ou au corps.`,
  },
  {
    id: "plan-test",
    kind: "strategie",
    title: "7. Ton plan de créatives pour la première campagne",
    target: "Claude ou GPT",
    text: `Tu es média buyer Meta Ads. Je lance ma première campagne de test avec un budget de [ex. 30 €/jour] pour mon produit : [description], cible : [cible], boutique : [URL].

J'ai ces angles : [colle tes 3 meilleurs angles de l'étape 1].

Dis-moi exactement quelles créatives produire pour la campagne de test : combien de vidéos UGC, combien d'images statiques, quel angle pour chacune, quel hook, quel format (9:16, 4:5, 1:1). Objectif : 3 à 6 créatives, pas plus, qui testent des angles différents et pas des variantes du même.

Pour chaque créative : nom de fichier à lui donner (ex. UGC-angle1-hookA-9x16), texte principal de la pub (3 lignes), titre (5 mots), description (1 ligne), appel à l'action. Puis donne-moi la grille de lecture pour J+3 : les 4 chiffres à regarder (dépense, CPM, CTR, coût par achat), les seuils pour couper, garder ou scaler chaque créative.`,
  },
];

export const DEFAULT_CREATIVES_METHOD = `1. Récupère l'image de référence de ton produit : la plus nette possible, produit bien visible, fond simple (site concurrent, AliExpress, ou ta propre photo).
2. Ouvre Claude (ou GPT) et colle le prompt 1 pour trouver tes angles. Garde-en 3.
3. Colle le prompt 2 (images boutique) et le prompt 3 (pubs statiques) : Claude t'écrit un prompt propre par visuel.
4. Va sur Higgsfield → modèle GPT Image 2 → importe ton image de référence → colle chaque prompt avec le bon ratio. Génère, garde la meilleure. (Ou dans le Studio IA de la plateforme quand il est ouvert pour toi.)
5. Pour les vidéos : prompt 4 (scripts UGC) puis prompt 5 (prompts vidéo IA). Tu génères d'abord l'image de départ, puis la vidéo à partir de cette image. Ou tu filmes toi-même avec ton téléphone : c'est souvent ce qui marche le mieux.
6. Objectif pour la première campagne : 3 vidéos + 3 images par produit. Pas de perfection, on teste vite et on garde ce qui marche.
7. Formats : vidéos 9:16 (1080×1920), images 4:5 (1080×1350) pour le feed, 1:1 pour la boutique. JPG ou PNG, 1600 px minimum. Pas de logo inventé, pas de texte généré illisible, pas de promesse médicale.`;

export const DEFAULT_CREATIVES: StudentCreativesSettings = {
  exampleShopUrl: "",
  exampleShopNote: "Regarde la structure : bannière avec promesse, bénéfices, preuve, avis, FAQ, offre. Ta boutique suit le même thème (Aesthetic Lab) : seuls le produit, les textes et les médias changent.",
  method: DEFAULT_CREATIVES_METHOD,
  examples: [],
  prompts: DEFAULT_CREATIVE_PROMPTS,
};

export function creativesSettings(settings: Pick<Settings, "studentCreatives">): StudentCreativesSettings {
  const s = settings.studentCreatives ?? {};
  const prompts = Array.isArray(s.prompts) && s.prompts.length ? s.prompts : DEFAULT_CREATIVE_PROMPTS;
  return {
    exampleShopUrl: (s.exampleShopUrl ?? "").trim(),
    exampleShopNote: (s.exampleShopNote ?? "").trim() || DEFAULT_CREATIVES.exampleShopNote,
    method: (s.method ?? "").trim() || DEFAULT_CREATIVES_METHOD,
    examples: Array.isArray(s.examples) ? s.examples : [],
    prompts,
  };
}

/** Lecture des réglages envoyés par l'admin : on ne garde que des champs propres. */
export function readCreativesSettings(raw: Partial<StudentCreativesSettings>): StudentCreativesSettings {
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const examples: CreativeExample[] = (Array.isArray(raw.examples) ? raw.examples : [])
    .map((e) => ({
      id: str(e?.id, 40) || `ex-${Math.random().toString(36).slice(2, 10)}`,
      title: str(e?.title, 160),
      kind: e?.kind === "video" ? ("video" as const) : ("image" as const),
      url: str(e?.url, 1000),
      note: str(e?.note, 600),
    }))
    .filter((e) => e.url);
  const prompts: CreativePrompt[] = (Array.isArray(raw.prompts) ? raw.prompts : [])
    .map((p) => ({
      id: str(p?.id, 40) || `p-${Math.random().toString(36).slice(2, 10)}`,
      kind: p?.kind === "video" || p?.kind === "strategie" ? p.kind : ("image" as const),
      title: str(p?.title, 200),
      target: str(p?.target, 160),
      text: str(p?.text, 12000),
    }))
    .filter((p) => p.title && p.text);
  return {
    exampleShopUrl: str(raw.exampleShopUrl, 500),
    exampleShopNote: str(raw.exampleShopNote, 1000),
    method: str(raw.method, 6000),
    examples,
    prompts: prompts.length ? prompts : DEFAULT_CREATIVE_PROMPTS,
  };
}
