# princexd — règles pour Claude Code

Dashboard personnel de Mady (coach e-commerce + IA) : contenu Instagram / TikTok / YouTube, Studio IA (KIE), CRM sales (iClosed, Systeme.io), plateforme élèves, générateur de boutiques Shopify. Next.js 15 (app router), React 19, TypeScript strict, base `data/db.json` (fichier, voir `src/lib/db.ts`).

## Conventions
- Tout en français (UI, journaux, commentaires), montants en euros.
- Pas de lint configuré : vérifier avec `npx tsc --noEmit -p .` avant de commiter.
- Dev local : `npx next dev -p 3001` (3000 est pris), sortie redirigée vers un fichier, jamais pipée dans `head`.
- Les prompts IA passent par `askText` (`src/lib/kie.ts`) ; le contexte de marque (`/marque`, `src/lib/brand.ts`) est injecté dans tous les prompts de contenu.
- Nouvelle collection de données : l'ajouter dans `DB` (`src/lib/types.ts`) et dans `EMPTY_DB` (`src/lib/db.ts`), elle est créée vide au prochain `readDB()`.
- Routes API : `src/app/api/**/route.ts`, `export const dynamic = "force-dynamic"`. Les routes qui reçoivent un fichier vérifient la session avec `refuseUnless`.

## Déploiement
- Site en ligne : https://mvdyprince.fr (VPS Hostinger, Coolify, volume `/app/data`).
- Chaque push sur `main` déclenche `.github/workflows/deploy.yml` (API Coolify). Depuis un poste avec le jeton local : `node scripts/deploy.mjs`.
- Ne jamais copier `data/db.json` local vers le serveur : la base de vérité est en ligne.
- Secrets jamais dans le dépôt : `.env.local` en local, variables Coolify en ligne.

## Commits
- Messages en français, une ligne de résumé orientée utilisateur (ex. « Boutiques : … », « Studio Création : … »).
- Terminer par `Co-Authored-By: Claude <noreply@anthropic.com>` si c'est Claude qui commite.
