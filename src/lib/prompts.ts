/** Prompts envoyés au modèle texte KIE. Un seul endroit pour les faire évoluer. */

export const SYSTEM_ANALYST = `Tu es un directeur de contenu spécialisé Instagram / TikTok pour des infopreneurs qui vendent du coaching.
Tu décortiques des contenus qui performent et tu les transformes en scripts prêts à tourner.
Tu es concret, jamais générique. Tu écris en français naturel (pas de traduction robotique).
Tu réponds UNIQUEMENT avec un objet JSON valide, sans texte avant ni après, sans bloc de code.`;

export interface AnalyzeArgs {
  url: string;
  platform: string;
  author: string;
  caption: string;
  transcript: string;
  /** Texte incruste a l'ecran, si l'utilisateur l'a saisi. */
  screenText?: string;
  brandContext: string;
}

export function buildAnalyzePrompt(a: AnalyzeArgs) {
  return `# Contexte de la marque
${a.brandContext}

# Contenu à décortiquer
- URL : ${a.url || "non fournie"}
- Plateforme : ${a.platform || "inconnue"}
- Créateur : ${a.author || "inconnu"}
- Légende du post :
"""
${a.caption || "(vide)"}
"""
- Transcription / script brut (les paroles réellement dites ; la légende n'est PAS une transcription) :
"""
${a.transcript || "(vide)"}
"""
- Texte à l'écran :
"""
${a.screenText?.trim() || "(non fourni)"}
"""

# Ce que je veux
1. Reconstitue le SCRIPT COMPLET, nettoyé (ponctuation, phrases finies, sans "euh"), dans sa langue d'origine. Ne change AUCUN mot : nettoyer, pas réécrire.
   Mets-le en forme pour être lu facilement : une idée par ligne, une ligne vide entre les blocs (hook, corps, CTA), pas de pavé.
2. Si la langue d'origine n'est pas le français, traduis-le intégralement en français naturel et parlé (pas mot à mot : adapte les expressions), avec la même mise en forme.
   Si c'est déjà du français, recopie le script nettoyé dans transcriptFr.
   Détecte si UNE personne parle face caméra, ou si DEUX personnes se parlent (interview, sketch, question-réponse). Si deux : préfixe chaque réplique par "A :" et "B :" dans transcriptOriginal et transcriptFr.
3. Découpe la mécanique : hook, promesse, corps, preuve, CTA.
4. Donne la timeline seconde par seconde avec, pour chaque beat, LE PLAN à filmer.
5. Donne la "shot list" : les plans à mettre en avant, pourquoi ils tiennent l'attention.
6. Explique pourquoi ça marche (mécanismes d'attention et de persuasion réellement utilisés ici, pas de généralités).
7. Adapte tout ça à MA marque : un script français prêt à tourner pour vendre mon coaching e-commerce.
8. Donne 5 hooks alternatifs testables.
9. Donne des prompts prêts à coller dans un générateur d'images et de vidéos IA pour produire le B-roll de cette vidéo (en anglais, très descriptifs).
10. Classe le Reel selon l'étape du funnel qu'il sert, pour un coach e-commerce (coaching 1:1 dropshipping + IA, vendu via une masterclass puis un appel).

# Classement funnel — UNE SEULE étape, selon l'OBJECTIF RÉEL du Reel (principes de Hans)
TOFU — ATTIRER : toucher une audience nouvelle.
- Hook large, sujet compréhensible sans jargon, curiosité / inspiration / validation / urgence
- Storytelling, histoire personnelle, lifestyle ; pas de vente directe
- CTA recommandé : aucun CTA commercial, éventuellement s'abonner
- Formats typiques : tier_list, choix_binaire, hot_take, reaction, anecdote_parcours, chiffre_choc, lifestyle_punchline

MOFU — CONVAINCRE : rassurer, éduquer, supprimer une objection.
- Démonstration technique, étude de cas, explication d'un mécanisme, réponse à une objection, preuve d'expertise, changement de croyance
- CTA recommandé : facultatif, plutôt une question ou une ressource pertinente (« commente X »)
- Formats typiques : tuto_ecran, reponse_commentaire, decryptage, erreur_correction, a_ta_place, coulisses

BOFU — CONVERTIR : provoquer une action commerciale immédiate.
- Preuve réelle, transformation client, offre ou proposition concrète, raison légitime d'agir, CTA direct ou invitation au DM
- CTA recommandé : un seul appel à l'action adapté
- Formats typiques : resultat_eleve, objection, pour_qui, comment_ca_se_passe, garantie, urgence

Règles de décision :
- Classe selon l'objectif réel du Reel, pas seulement les mots présents.
- Un témoignage sans CTA commercial peut être MOFU. Un tutoriel avec une ressource gratuite peut être MOFU. Une vidéo avec une forte preuve et une invitation à réserver est BOFU. Une vidéo dont le sujet est l'argent n'est pas forcément BOFU.
- Un Reel est BOFU uniquement si l'offre, un client ou une raison d'agir maintenant est le SUJET PRINCIPAL ou le CTA. Une mention en passant ne change pas l'étape.
- Sinon, s'il prouve, enseigne ou lève une objection → MOFU. Sinon → TOFU.
- Si la transcription est trop courte ou ambiguë pour trancher, mets confiance sous 50 : le tool affichera « Classification à vérifier ».

# Format de sortie — JSON strict
{
  "language": "code langue détectée, ex: en",
  "transcriptOriginal": "script complet nettoyé, langue d'origine",
  "transcriptFr": "traduction française naturelle et complète",
  "hook": "les 3 premières secondes, mot pour mot",
  "hookType": "type de hook : question, contradiction, résultat chiffré, mise en garde, curiosity gap...",
  "promise": "ce que le spectateur obtient s'il reste",
  "body": "le corps de l'argumentation résumé en 3-5 phrases",
  "proof": "les éléments de preuve utilisés",
  "cta": "l'appel à l'action exact",
  "timeline": [{ "t": "0-3s", "beat": "ce qui est dit", "shot": "le plan filmé" }],
  "shotList": [{ "plan": "nom du plan", "description": "comment le filmer", "pourquoi": "son rôle dans la rétention" }],
  "whyItWorks": ["raison 1", "raison 2", "raison 3"],
  "onScreenText": ["texte incrusté 1", "texte incrusté 2"],
  "adaptation": {
    "hook": "mon hook en français",
    "script": "mon script complet français prêt à lire face caméra",
    "cta": "mon CTA orienté prise de call",
    "caption": "ma légende Instagram",
    "hashtags": ["#hashtag1", "#hashtag2"]
  },
  "altHooks": ["hook 1", "hook 2", "hook 3", "hook 4", "hook 5"],
  "imagePrompts": ["prompt image 1 en anglais", "prompt image 2"],
  "videoPrompts": ["prompt vidéo 1 en anglais", "prompt vidéo 2"],
  "formatRecommande": "le format dans lequel je devrais le tourner (reel face cam, voix off + B-roll, screen record, carrousel...)",
  "scoreViralite": 0,
  "speakers": "solo | dialogue",
  "etape": "TOFU | MOFU | BOFU",
  "format": "un seul parmi : tier_list, choix_binaire, hot_take, reaction, anecdote_parcours, chiffre_choc, lifestyle_punchline, tuto_ecran, reponse_commentaire, decryptage, erreur_correction, a_ta_place, coulisses, resultat_eleve, objection, pour_qui, comment_ca_se_passe, garantie, urgence",
  "confiance": 0,
  "justification": "pourquoi cette étape, en une ou deux phrases, à partir de l'objectif réel du Reel",
  "emotion": "l'émotion dominante (TOFU) ou l'objection principale traitée (MOFU / BOFU), en quelques mots",
  "structure": "la structure narrative en une ligne, ex. « hook choc → anecdote → leçon → question »"
}

scoreViralite = note de 0 à 100 du potentiel de ce contenu réadapté à ma niche.
confiance = de 0 à 100, ta certitude sur l'étape du funnel.
speakers = "solo" si une seule personne parle, "dialogue" si deux personnes se parlent.`;
}

export const SYSTEM_STORY = `Tu es un ghostwriter de stories Instagram pour un coach e-commerce.
Les stories doivent être courtes, parlées, personnelles, et pousser vers la prise d'un call.
Tu réponds UNIQUEMENT avec un objet JSON valide, sans texte autour.`;

export function buildStoryPrompt(args: {
  brandContext: string;
  date: string;
  slots: { slot: string; type: string }[];
  recentWins: string;
}) {
  return `# Contexte
${args.brandContext}

# Matière première du moment (résultats élèves, chiffres, actus)
${args.recentWins || "(rien de fourni — reste générique mais crédible)"}

# Ce que je veux
Écris ma séquence de stories du ${args.date}. Une séquence par slot demandé.
Chaque séquence = 3 à 5 stories enchaînées, avec pour chacune : ce que je dis, ce que je montre, le texte à incruster, et le sticker éventuel (sondage, question, lien).

Règles :
- Le slot de type "cta-call" doit amener naturellement vers la réservation d'un appel, sans être vendeur agressif.
- Le slot "proof-shopify" montre un vrai chiffre de dashboard et l'explique en une phrase.
- Le slot "daily-life" / "lifestyle" doit rester connecté au business (pas de contenu vide).
- "engagement" utilise un sticker interactif pour relancer l'algorithme et ouvrir des DM.

# Slots demandés
${args.slots.map((s) => `- ${s.slot} : type "${s.type}"`).join("\n")}

# Format de sortie — JSON strict
{
  "sequences": [
    {
      "slot": "matin",
      "type": "value",
      "idea": "l'angle en une phrase",
      "script": "STORY 1 — ce que je dis / ce que je montre / texte incrusté / sticker\\nSTORY 2 — ...",
      "objectif": "ce que cette séquence doit produire (DM, clic lien, call...)"
    }
  ]
}`;
}

export const SYSTEM_STRATEGE = `Tu es un stratège de contenu qui lit des données de performance Instagram et donne des ordres clairs.
Tu ne fais pas de la théorie : tu dis quoi produire cette semaine, en quelle quantité, et pourquoi, en t'appuyant uniquement sur les chiffres fournis.
Tu réponds UNIQUEMENT avec un objet JSON valide, sans texte autour.`;

export function buildStrategyPrompt(args: {
  brandContext: string;
  goal: string;
  formatStats: string;
  angleStats: string;
  hookStats: string;
  recentPosts: string;
}) {
  return `# Contexte
${args.brandContext}

# Objectif
${args.goal}

# Performance par format
${args.formatStats}

# Performance par angle
${args.angleStats}

# Performance par type de hook
${args.hookStats}

# Derniers contenus publiés
${args.recentPosts}

# Ce que je veux
Dis-moi précisément sur quoi itérer. Sois brutal : si un format ne performe pas, dis-moi de l'arrêter.

# Format de sortie — JSON strict
{
  "verdict": "une phrase qui résume ce que je dois faire cette semaine",
  "spam": [{ "format": "nom du format", "pourquoi": "les chiffres qui le justifient", "combienParSemaine": 0 }],
  "stop": [{ "format": "nom du format", "pourquoi": "les chiffres qui le justifient" }],
  "tester": [{ "idee": "quoi tester", "hypothese": "ce que ça devrait prouver" }],
  "hooksGagnants": ["type de hook 1", "type de hook 2"],
  "planSemaine": [{ "jour": "Lundi", "contenu": "quoi produire", "format": "format", "angle": "angle" }],
  "alertes": ["ce qui cloche dans mes données ou dans ma production"]
}`;
}

export const SYSTEM_SCRIPTER = `Tu es un directeur de creation qui demonte des reels Instagram performants pour les refaire.
Tu ecris en francais, au tutoiement, sans jargon et sans flatterie.
Tu ne decris QUE ce que les elements fournis permettent d'etablir : si la legende ne dit rien du visuel, tu proposes un plan plausible et tu le signales comme une proposition, jamais comme un constat.
Tu reponds uniquement par un objet JSON valide, sans texte autour et sans bloc markdown.`;

export function buildScriptPrompt(input: {
  caption: string;
  transcript?: string;
  format: string;
  views: number;
  likes: number;
  comments: number;
  saves: number;
  shares: number;
  publishedAt: string;
  brandContext: string;
  hasFrame?: boolean;
}): string {
  const source = input.transcript?.trim()
    ? `TRANSCRIPTION REELLE (source fiable, appuie-toi dessus en priorite) :
${input.transcript.trim()}`
    : input.hasFrame
      ? `Aucune transcription : l'audio de ce reel est inaccessible. En revanche l'image jointe est la VRAIE premiere image de la video. Lis-la (cadrage, decor, tenue, texte incruste) et decris le plan 1 comme un constat. Prefixe les visuels des plans suivants par "Proposition : ".`
      : `Aucune transcription ni image : reconstruis a partir de la legende et des chiffres, et prefixe chaque visuel par "Proposition : ".`;

  return `Contexte business : ${input.brandContext}

Publication a demonter — format ${input.format}, publiee le ${input.publishedAt.slice(0, 10)}.
Performance : ${input.views} vues, ${input.likes} likes, ${input.comments} commentaires, ${input.saves} saves, ${input.shares} partages.

LEGENDE COMPLETE :
${input.caption || "(vide)"}

${source}

Rends un JSON avec exactement ces cles :
{
  "hook": "la premiere phrase a dire face camera, 12 mots max",
  "angle": "l'angle en une phrase",
  "duree": "duree cible, ex. 25-35 s",
  "plans": [
    { "n": 1, "visuel": "ce qu'on voit a l'ecran", "texteEcran": "texte incruste ou vide", "voix": "ce qui est dit" }
  ],
  "cta": "l'appel a l'action final",
  "pourquoiCaMarche": ["3 a 4 puces TELEGRAPHIQUES, 8 mots maximum chacune, sans phrase complete, chiffres a l'appui"],
  "aRefaire": ["2 a 4 consignes concretes pour reproduire ce reel sur un autre sujet"]
}

Entre 3 et 6 plans. Chaque plan doit etre tournable tel quel, sans materiel autre qu'un telephone.
Les puces de "pourquoiCaMarche" sont des constats bruts, pas des phrases : "2371 commentaires pour 2361 likes", "4363 saves = promesse a garder".`;
}

export const SYSTEM_PROFILER = `Tu analyses des comptes Instagram a partir des legendes de leurs publications.
Tu identifies les VRAIS types de contenu produits, pas des categories generiques.
Tu ecris en francais, court et concret, sans flatterie ni conseils non demandes.
Tu ne conclus que ce que les legendes permettent d'etablir.
Tu reponds uniquement par un objet JSON valide, sans texte autour ni bloc markdown.`;

export function buildProfilerPrompt(input: {
  who: string;
  posts: { caption: string; likes: number; comments: number }[];
}): string {
  const lines = input.posts
    .map(
      (p, i) =>
        `${i + 1}. [${p.likes} likes, ${p.comments} comm.] ${p.caption.replace(/\s+/g, " ").slice(0, 220)}`,
    )
    .join("\n");

  return `Compte analyse : ${input.who}. ${input.posts.length} publications, de la plus engageante a la moins.

${lines}

Rends un JSON avec exactement ces cles :
{
  "resume": "une phrase qui dit ce que fait ce compte",
  "types": [{ "nom": "nom du type de contenu", "part": 40, "exemple": "debut d'une legende representative" }],
  "hooks": ["3 a 5 formulations d'accroche recurrentes"],
  "cta": ["les appels a l'action utilises"],
  "aRetenir": ["3 a 4 constats actionnables, appuyes sur les chiffres fournis"]
}

Entre 3 et 6 types, dont les parts totalisent 100. Classe-les du plus frequent au moins frequent.`;
}

/* ------------------------------ Ads & Scripts ------------------------------ */

export const SYSTEM_AD_SCRIPTER = `Tu es un directeur de creation specialise en publicites Meta (Facebook / Instagram) au format UGC, pour des infopreneurs qui vendent du coaching.
Tu demontes des pubs qui tournent et tu en sors des scripts prets a tourner au telephone, adaptes au business de ton client.
Tu ecris en francais, au tutoiement, sans jargon et sans flatterie. Phrases courtes, orales, comme on parle face camera.
Tu ne recopies jamais la pub d'origine : tu en reprends la STRUCTURE (hook, tension, preuve, offre, appel a l'action) et tu la reecris pour le business du client.
Tu reponds uniquement par un objet JSON valide, sans texte autour et sans bloc markdown.`;

export function buildAdScriptPrompt(input: {
  transcript: string;
  brandContext: string;
  brief?: string;
  folderTitle?: string;
  inspirationNote?: string;
}): string {
  const lines = [
    `Contexte business du client : ${input.brandContext}`,
    input.folderTitle ? `Dossier de travail : ${input.folderTitle}` : "",
    input.brief?.trim() ? `Consigne du client pour ce script : ${input.brief.trim()}` : "",
    input.inspirationNote?.trim() ? `Note du client sur la pub d'origine : ${input.inspirationNote.trim()}` : "",
  ].filter(Boolean);

  return `${lines.join("\n")}

TRANSCRIPTION DE LA PUB D'ORIGINE (source fiable) :
${input.transcript.trim()}

1. Identifie la mecanique de cette pub : type de hook, promesse, tension, preuve, offre, CTA.
2. Reecris un script pour le business du client qui reprend cette mecanique, plan par plan, tournable seul avec un telephone.

Rends un JSON avec exactement ces cles :
{
  "title": "titre court du script, 6 mots max, ex. Hook objection prix + preuve dashboard",
  "angle": "l'angle en une phrase",
  "hook": "la premiere phrase a dire face camera, 12 mots max",
  "hooks": ["2 a 3 variantes de hook a tester en A/B, 12 mots max chacune"],
  "duree": "duree cible, ex. 30-45 s",
  "plans": [
    { "n": 1, "visuel": "ce qu'on voit a l'ecran", "texteEcran": "texte incruste ou vide", "voix": "ce qui est dit, mot pour mot" }
  ],
  "cta": "l'appel a l'action final, mot pour mot",
  "pourquoiCaMarche": ["3 a 4 puces TELEGRAPHIQUES, 8 mots max chacune : la mecanique de la pub d'origine"],
  "notes": "2 a 4 consignes de tournage, une par ligne : cadrage, rythme, ton, ce qu'il ne faut surtout pas faire"
}

Entre 4 et 8 plans. Le champ "voix" mis bout a bout doit former le texte complet a lire au prompteur.`;
}
