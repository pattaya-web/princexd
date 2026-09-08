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
- Transcription / script brut :
"""
${a.transcript || "(vide — déduis ce que tu peux de la légende, et signale-le dans transcriptOriginal)"}
"""

# Ce que je veux
1. Reconstitue le SCRIPT COMPLET, nettoyé (ponctuation, phrases finies, sans "euh"), dans sa langue d'origine.
2. Si la langue d'origine n'est pas le français, traduis-le intégralement en français naturel et parlé (pas mot à mot : adapte les expressions).
   Si c'est déjà du français, recopie le script nettoyé dans transcriptFr.
3. Découpe la mécanique : hook, promesse, corps, preuve, CTA.
4. Donne la timeline seconde par seconde avec, pour chaque beat, LE PLAN à filmer.
5. Donne la "shot list" : les plans à mettre en avant, pourquoi ils tiennent l'attention.
6. Explique pourquoi ça marche (mécanismes d'attention et de persuasion réellement utilisés ici, pas de généralités).
7. Adapte tout ça à MA marque : un script français prêt à tourner pour vendre mon coaching e-commerce.
8. Donne 5 hooks alternatifs testables.
9. Donne des prompts prêts à coller dans un générateur d'images et de vidéos IA pour produire le B-roll de cette vidéo (en anglais, très descriptifs).

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
  "scoreViralite": 0
}

scoreViralite = note de 0 à 100 du potentiel de ce contenu réadapté à ma niche.`;
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
