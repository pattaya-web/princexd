import type { CreativeExample, CreativePrompt, Settings, StudentCreativesSettings } from "@/lib/types";

/**
 * Page Créatives de la plateforme élèves (Scale X).
 *
 * La méthode (Studio IA : onglet Image, photo de référence + prompt, ratios
 * 3:4 / 1:1 / 9:16 ; vidéo Seedance 2.5 en 9:16 à partir d'une image de base
 * où le produit est porté), les créatives exemples de Mady avec, pour
 * chacune, le prompt qui permet de la reproduire, la boutique exemple
 * (affichée sur Ta boutique), et la bibliothèque de prompts : surtout ceux
 * que l'élève copie dans Claude ou GPT pour se faire écrire les prompts du
 * Studio, plus des exemples prêts à coller directement. Tout est modifiable
 * par l'admin depuis la page ; les valeurs par défaut sont ici.
 * Module pur : serveur et navigateur.
 */

const RATIO_RULE = "Formats autorisés : images statiques en 3:4, 1:1 ou 9:16 ; vidéos en 9:16 uniquement.";

/** Règle commune à tous les prompts image : le produit de la photo de référence, jamais redessiné. */
const REF = "The product must be exactly the one from the reference image (same shape, size, colors, materials, details), never redesigned.";

/* ------------------------------ Familles de créatives ------------------------------ */

/** Une famille de créatives (un format de la page Créatives) : une ligne, trois repères au plus. */
export interface CreativeFolder {
  id: string;
  title: string;
  /** Une ligne : l'idée. */
  tagline: string;
  /** Trois repères courts, pas plus. */
  tips: string[];
}

/**
 * Les familles, dans l'ordre de la page. Les exemples de chaque famille sont
 * les `CreativeExample` dont `folder` vaut l'id ; une famille sans exemple
 * affiche « exemples à venir ». Mady ajoute ses exemples au fil de l'eau.
 */
export const CREATIVE_FOLDERS: CreativeFolder[] = [
  {
    id: "punchy",
    title: "Punchy sales",
    tagline: "L'offre en pleine face, à l'américaine. Le format qui vend le plus.",
    tips: ["Une accroche en gros, l'offre en rouge, un badge d'urgence.", "Une seule idée, une seule offre, des mots courts.", "Décline la même créative sur 4 ou 5 fonds : Meta choisit."],
  },
  {
    id: "native",
    title: "Native ads",
    tagline: "Ne ressemble pas à une pub : un post, un selfie, une capture. C'est la phrase qui arrête le scroll.",
    tips: ["Pas de badge, pas de prix en rouge, pas de logo.", "Une phrase vraie et précise (« Got stopped 3 times today »).", "Moins cher au clic, use moins l'audience. Tout se fait à l'IA."],
  },
  {
    id: "notes",
    title: "Notes iPhone",
    tagline: "Une capture de l'app Notes, comme un message perso.",
    tips: ["Une liste courte : « 3 raisons pour lesquelles je garde ce collier ».", "Claude écrit le texte, le Studio fait la capture."],
  },
  {
    id: "chatgpt",
    title: "ChatGPT",
    tagline: "Une question posée à ChatGPT, et sa réponse qui recommande ton produit.",
    tips: ["Parfait pour les cadeaux et les produits « problème → solution ».", "Deux arguments dans la réponse, pas plus."],
  },
  {
    id: "twitter",
    title: "Tweet",
    tagline: "Un tweet avec avatar, pseudo, phrase qui claque et chiffres de likes.",
    tips: ["Le plus simple à produire : un avis déguisé en opinion.", "Fond blanc ou noir, 1:1, photo du produit en pièce jointe."],
  },
  {
    id: "avant-apres",
    title: "Avant / après",
    tagline: "Le problème à gauche, le résultat à droite.",
    tips: ["Pour les produits qui transforment quelque chose de visible.", "Reste honnête : Meta refuse le médical et l'irréaliste."],
  },
  {
    id: "badge",
    title: "Badge, prix, tag",
    tagline: "Une photo produit propre, et un ou deux éléments par-dessus.",
    tips: ["Étiquette -50 %, tag « Best seller », sticker « Livraison offerte ».", "Moins de texte, plus de produit : idéal en retargeting."],
  },
  {
    id: "video",
    title: "Vidéo 9:16",
    tagline: "Toujours verticale : Reels, TikTok, Stories.",
    tips: ["Part d'une image que tu as générée (produit porté ou en main).", "15 secondes, 5 plans, une voix. La méthode est plus bas."],
  },
];

/**
 * Les créatives d'Alison (collier Venom, punchy sales), faites avec Mady dans
 * le Studio IA. Fichiers dans public/formation/creatives, toujours présentes
 * sur la page, en plus de ce que l'admin enregistre.
 */
export const FOLDER_EXAMPLES: CreativeExample[] = [
  { id: "venom-his-hers-noir", folder: "punchy", kind: "image", ratio: "3:4", url: "/formation/creatives/venom-his-hers-noir.jpg", title: "His. Hers. · fond noir", note: "Deux boîtes côte à côte, l'offre en rouge, « for you » / « FREE » en manuscrit, badge Low stock. L'achat en couple sans le dire." },
  { id: "venom-look-twice-violet", folder: "punchy", kind: "image", ratio: "3:4", url: "/formation/creatives/venom-look-twice-violet.jpg", title: "They'll look twice · violet", note: "Même offre, fond violet et produits suspendus : la déclinaison de couleur qui fait une nouvelle créative pour Meta. Post-it « one for you, one for bae »." },
  { id: "venom-one-for-you-avis", folder: "punchy", kind: "image", ratio: "3:4", url: "/formation/creatives/venom-one-for-you-avis.jpg", title: "One for you. One for them. · avis", note: "L'offre + une carte d'avis « My boyfriend and I got matching ones » : la preuve sociale posée sur la punchy sales." },
  { id: "venom-one-for-you-creme", folder: "punchy", kind: "image", ratio: "3:4", url: "/formation/creatives/venom-one-for-you-creme.jpg", title: "One for you. One for them. · crème", note: "Version claire : texte noir, offre rouge. Même boîte, même produit, autre ambiance pour toucher un autre public." },
  { id: "venom-everyone-asks-portrait", folder: "punchy", kind: "image", ratio: "9:16", url: "/formation/creatives/venom-everyone-asks-portrait.jpg", title: "The necklace everyone asks about · portrait", note: "Produit porté, visage, phrase de preuve « where'd you get that?! » et avis. À la frontière du native : c'est celle-ci qui chauffe l'audience en story." },
  { id: "venom-selfie-avis", folder: "punchy", kind: "image", ratio: "3:4", url: "/formation/creatives/venom-selfie-avis.jpg", title: "Selfie miroir · avis", note: "Un selfie dans la salle de bain, flèche rouge sur le produit, avis « Got 3 compliments the first day » : look UGC, zéro décor, l'offre en petit badge." },
  { id: "venom-one-for-you-noir", folder: "punchy", kind: "image", ratio: "3:4", url: "/formation/creatives/venom-one-for-you-noir.jpg", title: "One for you. One for them. · noir", note: "La version de base : boîte ouverte, flèche « FREE », prix. C'est celle qu'on décline ensuite en couleurs et en accroches." },
  { id: "venom-everyone-asks-rose", folder: "punchy", kind: "image", ratio: "3:4", url: "/formation/creatives/venom-everyone-asks-rose.jpg", title: "The necklace everyone asks about · rose", note: "Produits posés en serpentin sur fond rose, badge noir, avis en carte. Une mise en scène plus douce, même message." },
  { id: "venom-his-hers-rouge", folder: "punchy", kind: "image", ratio: "3:4", url: "/formation/creatives/venom-his-hers-rouge.jpg", title: "His. Hers. · rouge", note: "Fond rouge velours, badge doré, typographie serif : la déclinaison « premium » du His. Hers. pour un public plus âgé." },
  { id: "venom-two-necklaces-jaune", folder: "punchy", kind: "image", ratio: "3:4", url: "/formation/creatives/venom-two-necklaces-jaune.jpg", title: "Two necklaces. One price. · jaune", note: "Le prix en énorme, badge rouge Buy 1 Get 1, fond jaune qui arrête le scroll. L'accroche la plus simple de la série." },
];

/** Les exemples enregistrés par l'admin, puis ceux du code qui n'y sont pas encore (jamais perdus). */
export function withFolderExamples(stored: CreativeExample[]): CreativeExample[] {
  const ids = new Set(stored.map((e) => e.id));
  return [...stored, ...FOLDER_EXAMPLES.filter((e) => !ids.has(e.id))];
}

/**
 * Les créatives exemples de Mady (fichiers dans public/formation/creatives)
 * et, pour chacune, le prompt GPT Image 2 reconstitué qui la reproduit avec
 * la photo de référence du produit. L'élève remplace le produit, les textes
 * et l'offre par les siens.
 */
export const DEFAULT_EXAMPLES: CreativeExample[] = [
  {
    id: "ex-hemios-last-chance",
    kind: "image",
    ratio: "1:1",
    title: "Pub statique · urgence + promo (bracelet)",
    url: "/formation/creatives/hemios-last-chance.jpg",
    note: "Accroche en gros, phrase choc sur bandeau jaune, promo en rouge, offre en bas. Scène sombre et masculine, produit porté + produit seul en médaillon.",
    prompt: `Square 1:1 realistic cinematic photo for a Meta ad. Close-up of a man's forearm and clenched fist gripping black satin bed sheets in a dim bedroom, warm bedside lamp glow in the background, veins visible, strong masculine energy, shallow depth of field. On his wrist, the bracelet from the reference image, exactly identical: polished black rectangular beads, same bead size and count. ${REF} In the bottom right corner, the bracelet alone, floating, with a soft golden glow behind it.

Text layout, all perfectly legible, no spelling mistakes, bold condensed uppercase sans-serif:
- Top: "LAST CHANCE TO PERFORM" in white with a thin black outline.
- Below: "She Noticed The Difference. Night One." in black on a bright yellow highlight bar.
- Below: "4TH OF JULY SALE" in bold red.
- Bottom: a dark semi-transparent band with white text "HEMIOS - BUY 1 GET 1 FREE".

Avoid: second bracelet, extra jewelry, deformed hand or fingers, blurry or warped text, watermark, cartoon look.`,
  },
  {
    id: "ex-hemios-dad-bod",
    kind: "image",
    ratio: "1:1",
    title: "Pub statique · avant / après façon BD",
    url: "/formation/creatives/hemios-dad-bod.jpg",
    note: "Trois cases en illustration comics, transformation en 30 jours, fond rouge électrique. Style volontairement dessiné : ça arrête le scroll.",
    prompt: `Square 1:1 bold comic-book style illustration for a Meta ad, red and black background with glowing red lightning cracks. Three vertical panels side by side showing the same man: left panel "BEFORE" = overweight, tired, sad face, grey t-shirt, slouched; middle panel = same man mid-transformation, tense, lightning energy around him; right panel "AFTER 30 DAYS" = fit, muscular, confident, black t-shirt, flames behind him, wearing the bracelet from the reference image on his wrist. ${REF}

Text, bold condensed uppercase, perfectly legible: top "FROM DAD BOD TO ALPHA" in white with black outline; below it "IN 30 DAYS" in black on a yellow highlight box; "BEFORE" above the left panel and "AFTER 30 DAYS" above the right panel in white. Bottom banner, red, white text: "HEMIOS - 4TH OF JULY SALE - " followed by "BUY 1 GET 1 FREE" in yellow. The bracelet alone appears in the bottom right corner on a dark circle.

Avoid: photorealistic style, extra panels, blurry text, misspelled words, watermark.`,
  },
  {
    id: "ex-hemios-best-47",
    kind: "image",
    ratio: "1:1",
    title: "Pub statique · promesse + bénéfices fléchés + logos presse",
    url: "/formation/creatives/hemios-best-at-47.jpg",
    note: "Produit au centre en packshot premium, 4 bénéfices avec des flèches dessinées, garantie en sous-titre, bandeau de logos presse en bas.",
    prompt: `Square 1:1 premium product photo for a Meta ad. The bracelet from the reference image stands upright in the center on a dark textured stone table, moody warm lighting, in the background out of focus: a black gift box with a satin ribbon on the left and a glass of whisky on the right. ${REF} Deep brown and amber tones, luxurious masculine atmosphere.

Text in white, clean bold uppercase sans-serif, perfectly legible, no spelling mistakes:
- Top headline on two lines: "I'M HAVING THE" then "BEST S❤X AT 47" with a small red heart replacing the letter E.
- Subtitle below, smaller, regular weight: "Or get your money back."
- Four short benefits placed around the product, each with a thin hand-drawn white curved arrow pointing to the bracelet: top left "BURNS OFF BEER BELLY", bottom left "BOOSTS DESIRE", top right "MELTS MAN BOOBS", bottom right "REDUCES JOINT PAIN".
- Bottom: a thin white separator line, then a row of five white press logos: Men's Health, Forbes, The Guardian, Cosmopolitan, WellBeing.

Avoid: extra products, hands, people, warped text, watermark, flat lighting.`,
  },
  {
    id: "ex-hemios-best-47-violet",
    kind: "image",
    ratio: "1:1",
    title: "Même pub, variante fond violet (pour tester)",
    url: "/formation/creatives/hemios-best-at-47-violet.jpg",
    note: "Même composition, fond uni dégradé : on garde le texte, on change seulement le décor. Deux variantes = un test A/B.",
    prompt: `Square 1:1 clean product ad. Same composition as a premium studio shot: the bracelet from the reference image stands upright in the center on a smooth deep purple to magenta gradient background with a soft vignette, soft studio lighting, subtle shadow under the product. ${REF} No table, no props.

Text in white, clean bold uppercase sans-serif, perfectly legible: top headline on two lines "I'M HAVING THE" then "BEST S❤X AT 47" with a small red heart replacing the letter E; subtitle "Or get your money back."; four benefits around the product with thin hand-drawn white curved arrows pointing to it: top left "BURNS OFF BEER BELLY", bottom left "BOOSTS DESIRE", top right "MELTS MAN BOOBS", bottom right "REDUCES JOINT PAIN"; bottom: thin white line and a row of five white press logos: Men's Health, Forbes, The Guardian, Cosmopolitan, WellBeing.

Avoid: props, hands, people, warped text, watermark.`,
  },
  {
    id: "ex-slushie-prix",
    kind: "image",
    ratio: "3:4",
    title: "Pub statique · le prix en héros + post-it",
    url: "/formation/creatives/slushie-prix.jpg",
    note: "Produit en situation (cuisine lumineuse), un post-it manuscrit qui pose la question, prix barré et nouveau prix énorme. Zéro accroche compliquée.",
    prompt: `Vertical 3:4 realistic lifestyle product photo for a Meta ad. The slushie machine from the reference image sits on a granite kitchen island in a bright modern white kitchen, daylight from a window on the left, the tank full of orange frozen slush. ${REF} Next to it on the left: a margarita glass filled with orange slush, salt rim, two black straws, a lime wedge and a halved lime.

Graphic elements, all perfectly legible: top right, a yellow sticky note slightly tilted with handwritten black marker text "$29.99?! for the whole machine?" and a small hand-drawn black arrow pointing down to the machine. Bottom third of the image: small white text "was" followed by "$79.99" crossed out in red, then a huge bold white price "$29.99" filling the width, with a soft dark shadow for contrast.

Avoid: people, hands, extra appliances, blurry or misspelled text, watermark, cartoon style.`,
  },
  {
    id: "ex-slushie-probleme",
    kind: "image",
    ratio: "3:4",
    title: "Pub statique · problème / solution manuscrit",
    url: "/formation/creatives/slushie-probleme.jpg",
    note: "En-tête papier déchiré avec le problème écrit à la main, flèche « Solution » vers le produit, prix barré. Le lecteur comprend en une seconde.",
    prompt: `Vertical 3:4 realistic lifestyle product photo for a Meta ad. The slushie machine from the reference image on a light marble kitchen counter, bright airy kitchen with a window, two empty coupe glasses on the left, a white bowl of frozen fruit pieces (mango, strawberry) on the right, tank empty and clean. ${REF}

Graphic elements, all perfectly legible: across the top, a torn white paper strip with handwritten black marker text on two lines: "PROBLEM:" underlined in blue, then "$9 SLUSHIES ALL SUMMER?". Bottom left, handwritten white text "SOLUTION." with a hand-drawn white arrow pointing to the machine's drip tray. Bottom center: small white text "was $79.99" crossed out, then a huge bold white price "$29.99" with a soft shadow.

Avoid: people, hands, slush in the tank, blurry or misspelled text, watermark.`,
  },
  {
    id: "ex-slushie-story",
    kind: "image",
    ratio: "9:16",
    title: "Pub statique 9:16 · post-it + 3 bénéfices + preuve visuelle",
    url: "/formation/creatives/slushie-story.jpg",
    note: "Version story / Reel : question sur post-it, trois petites pastilles de bénéfices, le gobelet de slush du commerce renversé à côté (le « avant »), prix en bas.",
    prompt: `Vertical 9:16 realistic lifestyle product photo for a Meta story ad. The slushie machine from the reference image on a grey stone kitchen counter, tank full of orange slush, cozy kitchen background out of focus (plant, jars, wooden board). ${REF} Bottom left: a cheap plastic takeaway slushie cup labeled "FROST & SIP" tipped over with orange slush spilling on the counter.

Graphic elements, all perfectly legible: top, a large yellow sticky note slightly tilted with handwritten black marker text on three lines "Still buying $9 slushies all summer?" underlined, with a hand-drawn white arrow pointing from the note down to the machine. On the left, three small rounded mint-green pills with a black icon and short text: "No ice needed" (snowflake), "12-hr reservation" (clock), "Makes ice cream too." (ice cream cone), with a thin white arrow from the pills to the machine's lever. Bottom: small white text "was $79.99" crossed out in red, then a huge bold white price "$29.99" filling the width, soft shadow.

Avoid: people, hands, extra appliances, blurry or misspelled text, watermark.`,
  },
  {
    id: "ex-hemios-brick",
    kind: "image",
    ratio: "1:1",
    title: "Pub statique · accroche provocante + 4 bénéfices + logos presse",
    url: "/formation/creatives/hemios-brick-wall.jpg",
    note: "Mur de briques blanc crevé, homme musclé qui en sort, produit géant à côté, 4 bénéfices en colonnes, logos presse. Fond clair = contraste fort dans le feed.",
    prompt: `Square 1:1 realistic photo composite for a Meta ad on a white painted brick wall background. On the left, a muscular grey-haired man in his fifties, intense stare, fists clenched, bursting out of a jagged hole in the brick wall, broken plaster pieces around the hole. On the right, the bracelet from the reference image shown very large, standing upright, with a soft shadow on the wall. ${REF}

Text in black, bold uppercase sans-serif, perfectly legible, no spelling mistakes: top headline on two lines "WEAR THIS TO" (regular bold) then "FIX YOUR BALLS" (extra bold, larger). Below the headline, one row of four short benefits in two lines each, evenly spaced: "DAD BOD DISAPPEAR", "ENERGY RESTORED", "MORNING WOOD LIKE 15", "MELT MAN BOOBS". Bottom: a row of five black press logos: Men's Health, Muscle & Fitness, GQ, Forbes, Esquire.

Avoid: extra people, deformed hands, second bracelet, warped text, watermark, dark background.`,
  },
];

/** Le prompt vidéo Seedance 2.5 de Mady, pris tel quel : la structure à garder (voix, précision produit, 5 plans de 3 s, sons, négatifs). */
export const DEFAULT_VIDEO_EXAMPLE = `Vertical 9:16 UGC TikTok ad, shot entirely on iPhone 15, realistic handheld footage, same woman and same necklace in every shot, consistent face, hair, hoodie and lighting. Fast-paced energetic edit with quick natural jump cuts.

VOICE & ENERGY: Young American woman, high-energy, bubbly and genuinely hyped, fast breathless speaking pace, squeals and laughs, big expressive intonation that rises with excitement, emphasis on key words, sounds like she just got the best package ever. Wide eyes, open mouth, jumping a little, lots of hand gestures. Accurate lip sync.

PRODUCT ACCURACY: The necklace is exactly the one from the reference image: same flat snake-print chain, same pattern, same thickness, same length, same clasp and metal color. Realistic real-life scale in her hand and on her neck, never oversized, never thinner or longer than the reference.

Shot 1 (0-3s) – Front-camera selfie at the front door, she holds the small package next to her face, jumping: "It's HERE! I ordered it like three days ago!"
Shot 2 (3-6s) – Top-down POV shot of her hands ripping open the package on the floor and pulling the necklace out of a small clear bag. Then the necklace in her palm, she tilts her hand and it slithers like a real snake. Voice-over, gasping: "Wait, it MOVES like a snake, I'm OBSESSED!"
Shot 3 (6-9s) – Full-length hallway mirror shot, phone visible in her hand, she clasps it on, does a happy little spin and a shoulder shimmy, necklace clearly visible. (she says the spoken lines)
Shot 4 (9-12s) – Handheld shot like a friend filming, she orders at a coffee shop counter; the barista freezes mid-order, leans in and points at her necklace with a big smile, the woman behind her in line also looks at it. Voice-over, laughing: "The barista literally asked me where it's from!"
Shot 5 (12-15s) – Tight front-camera selfie walking out of the coffee shop with her cup, urgent and excited: "It's buy one, get one FREE! Run, don't walk!"

Real ambient sounds in each location (door, paper rustle, footsteps, coffee shop chatter, espresso machine), no music. Necklace must stay identical to the reference in every shot, no morphing, no changes in design, size or color.

Negative (must avoid): plastic skin, airbrushed, beauty filter, smooth poreless skin, CGI look, 3D render, cartoon, cinematic color grading, studio lighting, smooth gimbal camera, drone shot, slow motion, face morphing, identity change between shots, warped jewelry, distorted or changing necklace, oversized necklace, wrong chain thickness, wrong pattern, extra fingers, deformed hands, flickering, robotic voice, monotone voice, flat delivery, calm or bored tone, bad lip sync, fake exaggerated acting, background people staring at camera, text, subtitles, watermark, logo, uncanny eyes, doll face.`;

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

Mon produit : [description précise : ce que c'est, matière, couleur, ce qu'il fait]. Ma cible : [cible]. Mon angle principal : [angle choisi à l'étape 1]. Prix : [prix]. Offre : [ex. livraison offerte / -20 % lancement / 2 achetés = 1 offert]. Langue des textes sur l'image : [français / anglais selon mon marché].

Je génère les images dans un studio IA (modèle GPT Image 2) en mettant une PHOTO DE RÉFÉRENCE de mon produit : le produit doit rester strictement identique sur chaque image (forme, couleurs, matière, logo), interdiction de le redessiner. ${RATIO_RULE}

Inspire-toi de ces 5 formats qui marchent : (a) le prix en héros avec un post-it manuscrit qui pose une question, prix barré + nouveau prix énorme ; (b) problème / solution écrit à la main sur un papier déchiré, flèche vers le produit ; (c) packshot premium au centre avec 4 bénéfices fléchés autour et une garantie en sous-titre ; (d) avant / après en 3 cases façon BD ; (e) accroche provocante en haut, personne forte à gauche, produit géant à droite, bénéfices en colonnes.

Propose-moi 5 concepts de pub statique. Pour chaque concept :
1. Le nom du concept et le format choisi parmi (a) à (e).
2. Le ratio à choisir dans le studio : 3:4, 1:1 ou 9:16, et pourquoi.
3. Le texte qui sera ÉCRIT SUR L'IMAGE : une accroche de 6 à 10 mots, un sous-titre de 12 mots max, un appel à l'action ou l'offre de 3 à 5 mots.
4. Le prompt image en anglais, prêt à coller dans le studio : la scène, le produit (identique à ma photo de référence), le placement exact de chaque texte avec sa couleur et son style (bandeau jaune, post-it, texte blanc avec contour…), le style photo réelle, et une ligne « Avoid: … ». Précise que le texte doit être rendu lisible, sans faute.
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
    title: "4. Scripts vidéo UGC (15 secondes, 5 plans)",
    target: "Claude ou GPT",
    text: `Tu es scénariste de pubs UGC (contenu généré par les utilisateurs) pour TikTok et Meta. Tu écris des scripts qui ressemblent à une vraie personne qui parle à sa caméra, pas à une pub.

Mon produit : [description]. Ma cible : [cible]. Angle : [angle]. Objection principale de mes clients : [ex. « ça marche vraiment ? » / « trop cher » / « j'ai déjà essayé »]. Langue parlée : [français / anglais selon mon marché], naturel, tutoiement.

Écris-moi 3 scripts de 15 secondes exactement, en 5 plans de 3 secondes (c'est le format de ma vidéo IA) :
- Plan 1 (0-3 s) : hook, la personne reçoit / découvre le produit, une phrase qui arrête le scroll.
- Plan 2 (3-6 s) : le produit en main, ce qu'il a de spécial, réaction sincère.
- Plan 3 (6-9 s) : le produit porté ou utilisé, démonstration.
- Plan 4 (9-12 s) : preuve sociale (quelqu'un d'autre réagit) ou résultat concret.
- Plan 5 (12-15 s) : appel à l'action urgent avec l'offre.

Pour chaque plan : le lieu, ce qu'on voit (une ligne), la phrase parlée exacte (10 mots max), le ton. Les 3 scripts doivent avoir 3 hooks de nature différente : colis qui arrive, question, résultat choc.`,
  },
  {
    id: "video-ia",
    kind: "video",
    title: "5. Transformer un script en prompt vidéo Seedance 2.5 (9:16, 15 s)",
    target: "Claude ou GPT → puis Studio IA : image de base dans Image, puis onglet Vidéo",
    text: `Tu es réalisateur de pubs vidéo UGC générées par IA avec le modèle Seedance 2.5. Je te donne un script, tu me rends DEUX choses : le prompt de l'image de base, puis le prompt vidéo complet.

Mon script (5 plans de 3 s) : [colle le script de l'étape 4]
Mon produit : [description précise ; il doit rester identique à ma photo de référence : forme, taille, couleur, matière]
Personnage : [ex. femme 25 ans, américaine, cheveux châtains, hoodie gris] (le même sur tous les plans)
Langue parlée : [anglais américain / français]

1) PROMPT IMAGE DE BASE (en anglais, ratio 9:16, pour GPT Image 2 avec ma photo de référence) : une photo réaliste type iPhone du personnage dans le décor du plan 1, avec le produit PORTÉ ou en main, bien visible, identique à la référence. Peau réelle, lumière naturelle, pas de texte. C'est cette image que je mettrai en entrée de la vidéo.

2) PROMPT VIDÉO (en anglais, 9:16, 15 secondes) avec exactement cette structure :
- Première phrase : "Vertical 9:16 UGC TikTok ad, shot entirely on iPhone 15, realistic handheld footage, same [personnage] and same [produit] in every shot, consistent face, hair, outfit and lighting. Fast-paced energetic edit with quick natural jump cuts."
- VOICE & ENERGY : la voix (âge, accent, énergie, débit, intonation), les expressions du visage et des mains, "Accurate lip sync".
- PRODUCT ACCURACY : le produit exactement comme sur l'image de référence (liste ses détails : forme, motif, épaisseur, longueur, fermoir, couleur), échelle réelle, jamais surdimensionné.
- Shot 1 (0-3s) à Shot 5 (12-15s) : pour chaque plan, le type de prise (selfie caméra avant, POV mains, miroir, filmé par un ami…), l'action, et la phrase parlée entre guillemets.
- Les sons d'ambiance réels de chaque lieu, "no music".
- Une phrase qui répète que le produit reste identique sur tous les plans, "no morphing".
- Negative (must avoid): plastic skin, airbrushed, beauty filter, CGI look, 3D render, cartoon, cinematic color grading, studio lighting, smooth gimbal camera, slow motion, face morphing, identity change between shots, warped or changing product, extra fingers, deformed hands, flickering, robotic voice, monotone voice, bad lip sync, fake exaggerated acting, text, subtitles, watermark, logo, uncanny eyes, doll face.

Rends les deux prompts dans deux blocs à copier, sans commentaire autour.`,
  },
  {
    id: "avant-apres",
    kind: "image",
    title: "6. Visuels avant / après crédibles",
    target: "Claude ou GPT → puis Studio IA, onglet Image",
    text: `Tu es directeur artistique. Je veux 3 visuels « avant / après » pour mon produit : [description, ce qu'il change concrètement]. Cible : [cible]. Résultat promis : [résultat réaliste].

Pour chaque visuel, écris 2 prompts en anglais pour un studio IA (GPT Image 2) : le prompt « avant » et le prompt « après ». Les deux doivent décrire exactement la même personne (décris-la précisément : âge, peau, cheveux, tenue), le même cadrage, la même lumière, le même décor et le même angle. Seule la différence promise change, de façon crédible. Ratio 1:1 (ou 3:4 si je veux l'utiliser en pub), photo smartphone réaliste, pas de texte, pas de logo, pas de retouche visible. Propose aussi une version « 3 cases façon BD » (avant / pendant / après) en un seul prompt 1:1 avec les titres BEFORE et AFTER écrits dans l'image.

Ajoute pour chaque visuel la légende courte (5 mots) à mettre sous chaque image.`,
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
    id: "exemple-image-base",
    kind: "video",
    title: "Exemple · l'image de base d'une vidéo (personne + produit porté)",
    target: "Studio IA, onglet Image, ratio 9:16, avec ta photo de référence. C'est l'image que tu mets ensuite dans l'onglet Vidéo.",
    text: `Vertical 9:16 realistic iPhone photo, front-camera selfie style. A young American woman in her mid-twenties, light brown hair in a loose bun, grey hoodie, genuine excited smile, stands at her apartment front door holding a small cardboard package next to her face. She is wearing the necklace from the reference image: exactly the same flat snake-print chain, same pattern, same thickness, same length, same clasp and metal color, realistic real-life scale on her neck. Natural daylight from a window, real skin texture with pores, slightly messy real apartment in the background, no text, no logo.

Avoid: beauty filter, smooth plastic skin, studio lighting, cinematic color grading, oversized or redesigned necklace, extra jewelry, deformed hands, watermark.`,
  },
  {
    id: "exemple-video",
    kind: "video",
    title: "Exemple · le prompt vidéo Seedance 2.5 de Mady (15 s, 5 plans)",
    target: "Studio IA, onglet Vidéo, 9:16, image d'entrée = l'image de base que tu viens de générer. Remplace le collier et les phrases par ton produit.",
    text: DEFAULT_VIDEO_EXAMPLE,
  },
];

export const DEFAULT_CREATIVES_METHOD = `1. **Ta photo de référence.** La photo la plus nette de ton produit, produit bien visible, fond simple (site du fournisseur, AliExpress, ou ta propre photo). Tu la gardes sur ton ordinateur : elle sert à toutes tes images.
2. **Tes prompts, écrits par Claude ou GPT.** Tu ne rédiges rien toi-même. Tu copies un prompt de la section 05 dans Claude ou GPT, tu remplis les crochets avec ton produit, il te renvoie des prompts prêts à coller.
3. **Onglet Image du Studio IA.** Tu importes ta photo de référence, tu colles le prompt, tu choisis le ratio : **3:4**, **1:1** ou **9:16**. Tu génères, tu gardes la meilleure, tu la télécharges. Regarde les exemples de la section 04 : chacun a son prompt.
4. **Les vidéos, en deux temps (section 03).** D'abord une image de base dans l'onglet Image : une personne dans une scène, ton produit porté ou en main, en 9:16. Puis l'onglet Vidéo : tu mets cette image + le prompt vidéo Seedance 2.5. Toujours en **9:16**, 15 secondes, 5 plans.
5. **Objectif pour la première campagne :** 3 vidéos + 3 images pour ton produit. Pas de perfection, on teste vite et on garde ce qui marche.
6. **Range tout** dans le dossier « creatives » de ton projet : c'est là que Claude Code ira les chercher pour ta boutique.`;

export const DEFAULT_CREATIVES: StudentCreativesSettings = {
  exampleShopUrl: "",
  exampleShopNote: "Regarde la structure : bannière avec promesse, bénéfices, preuve, avis, FAQ, offre. Ta boutique utilise exactement ce thème : seuls le produit, les textes et les médias changent.",
  method: DEFAULT_CREATIVES_METHOD,
  examples: DEFAULT_EXAMPLES,
  prompts: DEFAULT_CREATIVE_PROMPTS,
};

export function creativesSettings(settings: Pick<Settings, "studentCreatives">): StudentCreativesSettings {
  const s = settings.studentCreatives ?? {};
  const prompts = Array.isArray(s.prompts) && s.prompts.length ? s.prompts : DEFAULT_CREATIVE_PROMPTS;
  const examples = withFolderExamples(Array.isArray(s.examples) && s.examples.length ? s.examples : DEFAULT_EXAMPLES);
  return {
    exampleShopUrl: (s.exampleShopUrl ?? "").trim(),
    exampleShopNote: (s.exampleShopNote ?? "").trim() || DEFAULT_CREATIVES.exampleShopNote,
    method: (s.method ?? "").trim() || DEFAULT_CREATIVES_METHOD,
    examples,
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
      ratio: str(e?.ratio, 10),
      prompt: str(e?.prompt, 6000),
      folder: str(e?.folder, 40),
    }))
    .filter((e) => e.url);
  const prompts: CreativePrompt[] = (Array.isArray(raw.prompts) ? raw.prompts : [])
    .map((p) => ({
      id: str(p?.id, 40) || `p-${Math.random().toString(36).slice(2, 10)}`,
      kind: p?.kind === "video" || p?.kind === "strategie" ? p.kind : ("image" as const),
      title: str(p?.title, 200),
      target: str(p?.target, 240),
      text: str(p?.text, 12000),
    }))
    .filter((p) => p.title && p.text);
  return {
    exampleShopUrl: str(raw.exampleShopUrl, 500),
    exampleShopNote: str(raw.exampleShopNote, 1000),
    method: str(raw.method, 6000),
    examples: examples.length ? examples : DEFAULT_EXAMPLES,
    prompts: prompts.length ? prompts : DEFAULT_CREATIVE_PROMPTS,
  };
}
