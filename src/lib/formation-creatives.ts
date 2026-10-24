import type { CreativeExample, CreativePrompt, Settings, StudentCreativesSettings } from "@/lib/types";

/**
 * Page Créatives de la plateforme élèves (Scale X).
 *
 * La méthode (Studio IA : onglet Image, photo de référence + prompt, ratios
 * 3:4 / 1:1 / 9:16, vidéo 9:16), des créatives exemples, la boutique exemple
 * (affichée sur Ta boutique), et la bibliothèque de prompts : surtout ceux
 * que l'élève copie dans Claude ou GPT pour se faire écrire ses prompts du
 * Studio, plus deux exemples prêts à coller directement. Tout est modifiable
 * par l'admin depuis la page ; les valeurs par défaut sont ici.
 * Module pur : serveur et navigateur.
 */

const RATIO_RULE = "Formats autorisés : images statiques en 3:4, 1:1 ou 9:16 ; vidéos en 9:16 uniquement.";

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
    id: "statiques",
    kind: "image",
    title: "2. Pubs statiques (image + accroche) : Claude t'écrit les prompts du Studio",
    target: "Claude ou GPT → puis Studio IA, onglet Image, avec ta photo de référence",
    text: `Tu es un créatif publicitaire spécialisé dans les pubs statiques Meta qui convertissent pour des marques e-commerce.

Mon produit : [description précise : ce que c'est, matière, couleur, ce qu'il fait]. Ma cible : [cible]. Mon angle principal : [angle choisi à l'étape 1]. Prix : [prix]. Offre : [ex. livraison offerte / -20 % lancement / 2 achetés = 1 offert]. Langue des textes sur l'image : français.

Je génère les images dans un studio IA (modèle GPT Image 2) en mettant une PHOTO DE RÉFÉRENCE de mon produit : le produit doit rester strictement identique sur chaque image (forme, couleurs, matière, logo), interdiction de le redessiner. ${RATIO_RULE}

Propose-moi 5 concepts de pub statique. Pour chaque concept :
1. Le nom du concept (ex. « Avant / après », « Témoignage », « Nous vs eux », « Liste de bénéfices », « Pub façon note iPhone »).
2. Le ratio à choisir dans le studio : 3:4, 1:1 ou 9:16, et pourquoi.
3. Le texte qui sera ÉCRIT SUR L'IMAGE : une accroche de 6 à 10 mots, un sous-titre de 12 mots max, un appel à l'action de 3 mots.
4. Le prompt image en anglais, prêt à coller dans le studio, qui décrit la scène, le produit (identique à ma photo de référence), le placement des zones de texte, le style (photo réelle, pas d'illustration). Précise que le texte doit être rendu lisible, en français, sans faute. Termine par ce qu'il faut éviter (no extra logo, no distorted hands, no blurry text).
5. Le texte principal de la pub (au-dessus de l'image) : 3 lignes max, qui commence par le hook et finit par le lien.

Donne aussi 2 variantes d'accroche par concept pour que je teste.`,
  },
  {
    id: "images-produit",
    kind: "image",
    title: "3. Images produit pour la boutique (bannières, lifestyle, avis)",
    target: "Claude ou GPT → puis Studio IA, onglet Image, avec ta photo de référence",
    text: `Tu es directeur artistique e-commerce. Ma marque : [nom]. Mon produit : [description précise : ce que c'est, matière, couleur, taille, ce qu'il fait]. Ma cible : [qui achète, âge, besoin]. Ton de marque : [ex. clean et premium / naturel et chaleureux / sportif]. Ma boutique est en français.

Je génère dans un studio IA (GPT Image 2) avec une PHOTO DE RÉFÉRENCE de mon produit : le produit doit rester strictement identique sur chaque image (forme, couleurs, matière, logo), interdiction de le redessiner. Pour la boutique, les ratios possibles sont 1:1, 3:4, 9:16 et 16:9 (bannière).

Écris-moi UN prompt par image de la liste ci-dessous, en anglais, prêt à coller. Chaque prompt : photo-réaliste, style photo smartphone ou studio selon la section, personne crédible si besoin (pas de visage de célébrité), cadrage adapté au ratio, lumière naturelle, peau réelle, fond cohérent avec la marque, aucun texte dans l'image, aucun logo inventé. Termine chaque prompt par ce qu'il faut éviter.

Présente le résultat en liste : numéro, section, ratio, puis le prompt dans un bloc à copier. Pour les photos avis clients, varie les personnes, les lieux et les gestes. Pour les avant / après, même personne, même cadrage, même lumière, seule la différence promise change.

Liste des images :
- 1 × 16:9 · Bannière d'accueil (produit en situation, héros)
- 1 × 9:16 · Bannière mobile
- 3 × 1:1 · Photos produit fond simple (3 angles)
- 3 × 3:4 · Produit en situation d'usage (lifestyle)
- 2 × 1:1 · Avant / après
- 4 × 1:1 · Photos « avis clients » (personnes différentes avec le produit)
- 1 × 16:9 · Section « Comment ça marche »`,
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
    title: "5. Transformer un script en prompts vidéo pour le Studio (9:16)",
    target: "Claude ou GPT → puis Studio IA, onglet Vidéo, à partir d'une image générée",
    text: `Tu es réalisateur de pubs vidéo générées par IA (modèles Seedance, Veo, Kling). Tu convertis un script UGC en prompts vidéo prêts à coller, un par plan.

Voici mon script : [colle le script de l'étape 4]
Mon produit : [description précise, il doit rester identique à ma photo de référence]
Personnage : [ex. femme 30 ans, cheveux bruns, salle de bain lumineuse] (le même sur tous les plans)
Format : 9:16 vertical, toujours. Durée totale : [20-30 s]. Chaque clip : 5 à 10 secondes maximum.

Pour chaque plan, écris :
1. L'image de départ à générer d'abord dans l'onglet Image (prompt image en anglais, ratio 9:16, même personnage, même décor, produit identique à ma photo de référence), car la vidéo part de cette image.
2. Le prompt vidéo en anglais pour l'onglet Vidéo (une seule scène, caméra décrite, mouvement, lumière, ambiance, ce que fait la personne, où est le produit, « realistic smartphone footage, natural skin, no text, no logo »).
3. Si le plan est parlé : la ligne de dialogue en français, pour que je la mette dans le modèle (ou que je l'enregistre en voix off).
4. La durée du clip.

Garde la cohérence totale entre les plans (même personne, même tenue, même lieu, même lumière). Termine par la liste des clips dans l'ordre de montage et le texte des sous-titres.`,
  },
  {
    id: "avant-apres",
    kind: "image",
    title: "6. Visuels avant / après crédibles",
    target: "Claude ou GPT → puis Studio IA, onglet Image",
    text: `Tu es directeur artistique. Je veux 3 visuels « avant / après » pour mon produit : [description, ce qu'il change concrètement]. Cible : [cible]. Résultat promis : [résultat réaliste, pas de promesse médicale].

Pour chaque visuel, écris 2 prompts en anglais pour un studio IA (GPT Image 2) : le prompt « avant » et le prompt « après ». Les deux doivent décrire exactement la même personne (décris-la précisément : âge, peau, cheveux, tenue), le même cadrage, la même lumière, le même décor et le même angle. Seule la différence promise change, de façon subtile et crédible (pas de miracle). Ratio 1:1 (ou 3:4 si je veux l'utiliser en pub), photo smartphone réaliste, pas de texte, pas de logo, pas de retouche visible.

Ajoute pour chaque visuel la légende courte (5 mots) à mettre sous chaque image, et une phrase de mise en garde si le produit touche à la santé ou au corps.`,
  },
  {
    id: "plan-test",
    kind: "strategie",
    title: "7. Ton plan de créatives pour la première campagne",
    target: "Claude ou GPT",
    text: `Tu es média buyer Meta Ads. Je lance ma première campagne de test avec un budget de [ex. 30 €/jour] pour mon produit : [description], cible : [cible], boutique : [URL].

J'ai ces angles : [colle tes 3 meilleurs angles de l'étape 1]. ${RATIO_RULE}

Dis-moi exactement quelles créatives produire pour la campagne de test : combien de vidéos UGC (9:16), combien d'images statiques (3:4, 1:1 ou 9:16), quel angle pour chacune, quel hook. Objectif : 3 à 6 créatives, pas plus, qui testent des angles différents et pas des variantes du même.

Pour chaque créative : nom de fichier à lui donner (ex. UGC-angle1-hookA-9x16), texte principal de la pub (3 lignes), titre (5 mots), description (1 ligne), appel à l'action. Puis donne-moi la grille de lecture pour J+3 : les 4 chiffres à regarder (dépense, CPM, CTR, coût par achat), les seuils pour couper, garder ou scaler chaque créative.`,
  },
  {
    id: "exemple-statique",
    kind: "image",
    title: "Exemple · une pub statique prête à coller (à adapter à ton produit)",
    target: "Studio IA, onglet Image, ratio 3:4, avec ta photo de référence",
    text: `Realistic smartphone photo, vertical 3:4. A woman in her early thirties sits on the edge of a white bed in soft morning light, holding the product from the reference image exactly as it is (same shape, same colors, same materials, same logo, do not redesign it). She looks relieved and natural, real skin texture, no makeup retouching. Clean, bright bedroom, neutral tones, slight depth of field.

Leave a clean empty area in the top third of the image for text. Render this French text in the top area, bold, highly legible, no spelling mistakes, modern sans-serif font, dark text on the light background:
"[ACCROCHE DE 6 À 10 MOTS]"
Smaller line below it: "[SOUS-TITRE DE 12 MOTS MAX]"
At the bottom, a small rounded pill button with the text: "[APPEL À L'ACTION, 3 MOTS]"

Avoid: extra logos, invented brand names, distorted hands, blurry or misspelled text, cartoon or 3D render look, watermark.`,
  },
  {
    id: "exemple-video",
    kind: "video",
    title: "Exemple · une vidéo 9:16 prête à coller (à partir d'une image générée)",
    target: "Studio IA, onglet Vidéo, 9:16, 5 à 10 secondes, image de départ = ton image générée",
    text: `Start from the provided image. Vertical 9:16, 8 seconds, realistic handheld smartphone footage, natural daylight.

The same person as in the image picks up the product (keep it exactly identical to the image: shape, colors, materials, logo) and shows it to the camera, turns it slowly so we see it from two angles, then uses it once in a simple natural gesture. Slight handheld camera movement, subtle zoom-in at the end on the product. Real skin, natural expressions, no exaggerated acting.

Dialogue (French, natural, speaking to the camera): "[LA PHRASE DU SCRIPT POUR CE PLAN, 15 MOTS MAX]"

No text on screen, no logo, no subtitles, no music, no scene change, no extra people.`,
  },
];

export const DEFAULT_CREATIVES_METHOD = `1. **Ta photo de référence.** La photo la plus nette de ton produit, produit bien visible, fond simple (site du fournisseur, AliExpress, ou ta propre photo). Tu la gardes sur ton ordinateur : elle sert à toutes tes images.
2. **Tes prompts, écrits par Claude ou GPT.** Tu ne rédiges rien toi-même. Tu copies un prompt de la section 04 dans Claude ou GPT, tu remplis les crochets avec ton produit, il te renvoie des prompts prêts à coller.
3. **Onglet Image du Studio IA.** Tu importes ta photo de référence, tu colles le prompt, tu choisis le ratio : **3:4**, **1:1** ou **9:16**. Tu génères, tu gardes la meilleure, tu la télécharges.
4. **Onglet Vidéo.** Tu pars d'une image que tu viens de générer, tu colles le prompt vidéo, toujours en **9:16**, 5 à 10 secondes par clip. Filmer toi-même avec ton téléphone marche aussi très bien.
5. **Objectif pour la première campagne :** 3 vidéos + 3 images pour ton produit. Pas de perfection, on teste vite et on garde ce qui marche.
6. **Range tout** dans le dossier « creatives » de ton projet : c'est là que Claude Code ira les chercher pour ta boutique.`;

export const DEFAULT_CREATIVES: StudentCreativesSettings = {
  exampleShopUrl: "",
  exampleShopNote: "Regarde la structure : bannière avec promesse, bénéfices, preuve, avis, FAQ, offre. Ta boutique utilise exactement ce thème : seuls le produit, les textes et les médias changent.",
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
