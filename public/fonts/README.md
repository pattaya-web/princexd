# Polices

Le design cible les deux polices de qoves.com, toutes deux commerciales :

| Famille            | Fichiers attendus ici                                                                                   | Où l'acheter                              |
| ------------------ | ------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| PP Neue Montreal   | `PPNeueMontreal-Regular.woff2`, `PPNeueMontreal-Medium.woff2`, `PPNeueMontreal-SemiBold.woff2`, `PPNeueMontreal-Bold.woff2` | https://pangrampangram.com/products/neue-montreal |
| F37 Zagma Mono     | `F37ZagmaMono-Book.woff2`                                                                               | https://f37foundry.com/fonts/f37-zagma-mono |

Dépose les fichiers `.woff2` dans ce dossier avec exactement ces noms, puis
décommente le bloc `@font-face` en tête de `src/app/globals.css` (il est
commenté par défaut pour éviter des 404 tant que les fichiers manquent).

Tant qu'ils sont absents, l'app utilise Inter et DM Mono (Google Fonts,
auto-hébergées par `next/font`), qui sont les équivalents libres les plus
proches.
