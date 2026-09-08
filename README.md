# mvdyprince — Content & Coaching OS

Le cockpit de ton écosystème : contenu Instagram, génération IA via KIE, CRM coaching,
board de montage, stats et objectifs.

## Démarrer

```bash
npm install
npm run dev
```

Puis ouvre http://localhost:3000

Pour un usage quotidien plus rapide :

```bash
npm run build
npm start
```

## La clé API KIE

Deux façons de la renseigner, l'environnement gagne toujours :

1. **`.env.local`** (recommandé) — ouvre le fichier et colle ta clé :
   ```
   KIE_API_KEY=sk-…
   ```
   Redémarre le serveur après modification.
2. **Réglages → Clé API KIE** — enregistrée dans `data/db.json`.

La clé ne quitte jamais le serveur : aucune page ne la reçoit, les appels à KIE
passent tous par les routes `/api/kie/*`.

Récupère-la sur https://kie.ai/api-key

### Modèles texte disponibles

La traduction des scripts et les recommandations passent par l'endpoint compatible
OpenAI de KIE (`POST /v1/chat/completions`). Les modèles vérifiés comme disponibles
sur le compte, au moment de l'intégration :

| Modèle | Usage |
|---|---|
| `gemini-3-pro` | par défaut — le plus solide pour l'analyse de scripts |
| `gemini-2.5-pro` | équivalent, un peu plus rapide |
| `gemini-2.5-flash` | le moins cher, pour les tâches simples |

Les modèles Claude, GPT et Grok renvoient `The model is not supported` sur ce compte.
Si KIE en ouvre d'autres, ajoute-les dans `TEXT_MODELS` (page Réglages) — le code
ne change pas.

## Ce que fait chaque page

| Page | Rôle |
|---|---|
| **Dashboard** | Objectif abonnés, stories du jour, calls à venir, leads chauds, to-do |
| **Croissance** | Un relevé d'abonnés par jour, courbes, projection de la date d'objectif |
| **Quoi spammer** | Classe tes formats par score et te dit lequel produire en volume, lequel couper |
| **Studio IA** | Génération d'images et de vidéos via KIE (Nano Banana, Veo, Sora, Kling, Seedream) |
| **Swipe file** | Colle un lien → script complet, traduction FR, mécanique, plans à filmer, ton adaptation |
| **Calendrier** | Le pipeline de contenu, de l'idée au post publié + saisie des stats |
| **Story OS** | Rotation hebdo des types de story, scripts écrits par l'IA, tracking des calls générés |
| **Montage** | Tu déposes les rushs + le brief, ton monteur rend la vidéo finie |
| **CRM** | Les leads issus du contenu, jusqu'au closing |
| **Élèves** | Suivi des coachings ; le champ « Résultat obtenu » alimente tes contenus preuve |
| **Calls** | Appels de vente, taux de présence, taux de closing, synchro iClosed |
| **Meta Ads** | Suivi manuel des campagnes : ROAS et coût par call |
| **Équipe** | Setters, closers, monteur, commissions |
| **Ressources / To-do** | La bibliothèque et les tâches |

## L'espace monteur

1. **Réglages → Accès monteur** : définis un code (ex. `MONTAGE-2026`).
2. Envoie-lui `http://…/monteur` + le code.

Une fois le code saisi, un cookie de rôle l'enferme dans ce board : le middleware
(`src/middleware.ts`) lui refuse le CRM, les réglages, les crédits et les routes IA.
Il ne peut passer une carte qu'entre **À monter**, **En cours** et **Livré** — le
statut « Posté » reste ta décision.

Les fichiers uploadés vont dans `data/media/` et sont servis par `/api/media/[file]`
avec support des requêtes Range (donc scrub de vidéo dans le navigateur). Limite :
2 Go par fichier, extensions vidéo / image / audio uniquement. Pour des rushs
volumineux, colle plutôt un lien Drive ou WeTransfer.

## iClosed

**L'API publique est branchée** (`ICLOSED_API_KEY` dans `.env.local`). Bouton
« Synchroniser iClosed » sur la page Calls, avec choix de la profondeur d'historique.

Ce que la synchro ramène :

- tous les appels passés et à venir (`GET /v1/eventCalls`, paginé par `page`) ;
- l'issue de chaque call (`task.outcome`, `objection`, `noSaleReason`, `cancelReason`)
  mappée sur *booké / présent / no-show / closé / perdu* ;
- pour chaque appel : email, téléphone et **les réponses au questionnaire de
  qualification** (niveau e-commerce, tranche d'âge, objectif, budget), lisibles en
  ouvrant le call.

**La synchro ne crée aucun lead.** Le CRM reste ce que tu y mets à la main : un call
booké n'est pas encore un lead qualifié. (Si tu changes d'avis, l'endpoint accepte
`{"withLeads": true}`.)

La synchro est idempotente : les enregistrements portent l'ID iClosed, une resynchro
met à jour au lieu de dupliquer. Un montant closé saisi à la main n'est pas écrasé
par le `0` de l'API.

Un appel passé dont l'issue n'a jamais été renseignée dans iClosed reste en « à
qualifier » et **est exclu des taux de présence et de closing** — mieux vaut un
chiffre absent qu'un chiffre faux.

Deux compléments optionnels :

- **Flux `.ics`** — repli sans API : Réglages → iClosed → URL d'abonnement iCal.
- **Webhook** — colle `https://ton-domaine/api/webhooks/iclosed` dans iClosed pour
  recevoir les bookings en temps réel. Nécessite que le tool soit joignable depuis
  Internet (tunnel ou déploiement).

## Les données

Tout est dans `data/` :

- `data/db.json` — toutes les collections (contenus, leads, élèves, stories, montages…)
- `data/media/` — les fichiers uploadés

**Sauvegarde ce dossier régulièrement.** Il n'est pas versionné (`.gitignore`).
Le fichier est réécrit de façon atomique, donc un crash en pleine écriture ne le
corrompt pas.

## Sécurité

Le tool **n'a pas d'authentification propriétaire** : il est pensé pour tourner en
local sur ta machine. Si tu le déploies en ligne, mets-le derrière une
authentification au niveau de l'hébergeur (Vercel Password Protection, Basic Auth
Cloudflare…), sinon n'importe qui avec l'URL voit ton CRM. Le code monteur ne
protège que `/monteur`, pas le reste.

## Stack

Next.js 15 (App Router) · React 19 · TypeScript · Tailwind v4 · stockage fichier JSON.
Aucune dépendance native, aucune base de données à installer.
