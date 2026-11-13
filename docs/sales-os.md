# Sales OS — cockpit commercial et moteur de tâches

Mis en place le 2026-11-13. But : que le Head of Setting (Jorah) suive tout le pipeline coaching sans qu'aucun lead ne soit oublié, pendant que Mady se concentre sur le contenu et les calls.

## Principe

Pas de seconde base : les pôles sont des vues des collections existantes (`leads`, `appointments`, `followUps`, `sales`). Une seule collection est ajoutée, **`salesTasks`**, tenue par un moteur pur (`src/lib/sales/ops/engine.ts`) :

1. à chaque passage, il **recalcule** ce qui doit être fait à partir de l'état réel du CRM ;
2. il **aligne** `salesTasks` : crée ce qui manque, met à jour le contexte et l'échéance, ferme avec une raison ce qui n'a plus lieu d'être (« Rendez-vous annulé », « Confirmé par le prospect », « Paiement encaissé ») ;
3. une tâche terminée n'est **jamais rouverte**.

Chaque tâche a une clé stable (`confirm-j1:<rdv>:<date du call>`) : synchro rejouée, webhook reçu deux fois, page rechargée → aucun doublon. Un call déplacé change de clé : les anciennes confirmations tombent, les nouvelles arrivent aux bons horaires.

Passages : scheduler toutes les 2 min (`src/lib/scheduler.ts`), à chaque ouverture du cockpit, après chaque action. Les erreurs sont gardées (`opsState`) et affichées dans Sales → Opérations et Automatisations.

## Rôles

| Rôle | Où | Droits |
|---|---|---|
| Admin / owner | tout | tout ; seul à encaisser, rembourser, régler commissions et automatisations |
| Head of Setting | `TeamMember.salesHead` | voit tous les leads coaching (`canSee`), transfère des leads, voit la charge des autres, valide le compte rendu ; ni encaissement, ni commissions des autres, ni réglages |
| Setter | rôle existant | sa file, ses leads |
| Closer | rôle existant | statue ses calls, encaisse ses ventes |

Vérifications côté serveur : `canSee`, `requireSalesManager`, `requireAdmin` (`src/lib/sales/access.ts`), plus les contrôles de `src/lib/sales/ops/actions.ts`. Le middleware ferme `/sales/operations` et `/sales/automatisations` aux membres.

## Quatre notions distinctes sur un lead

- **Source d'acquisition** : `sourceChannel`, `funnelSource`, first / last touch (inchangé).
- **Responsable actuel** : `Lead.ownerId` (nouveau). Attribué automatiquement au responsable par défaut (le Head of Setting) ou en tour de rôle ; transférable, chaque transfert est journalisé.
- **Setter à l'origine du rendez-vous** : `Appointment.setterId` (inchangé, figé).
- **Closer** : `Appointment.closerId` / `Sale.closerId` (inchangé).

## Règles de tâches (configurables)

| Type | Quand | Pour qui |
|---|---|---|
| Premier contact | lead entrant sans rendez-vous, jamais contacté | responsable |
| Relance de conversation | contacté / en attente / RDV proposé, sans réponse depuis N h | responsable |
| Action planifiée | `nextActionAt` posé sur la fiche | responsable |
| Rappel demandé | `callbackAt` / `followUpAt` de la liste à appeler | responsable |
| Confirmer la réservation | call dans plus de 24 h, rien envoyé | responsable |
| Confirmation J-1 / contrôle H-3 | tant que le prospect n'a pas confirmé explicitement | responsable |
| Résultat du call | call passé depuis 1 h sans résultat | closer actif, sinon admin |
| No-show | cadence 15 min / J+1 / J+3 (réglable), arrêtée si reprogrammé, perdu, ne plus contacter | responsable |
| Relance après call | chaque relance en attente, avec l'objection et le conseil | responsable |
| Paiement | promis, en retard, échéance proche ; relance suivante 2 jours après ou à la date promise | responsable |
| Paiement à préciser / à vérifier | vente iClosed sans façon de payer, ou « il dit avoir payé » | closer actif, sinon admin |
| Réactivation | date de reprise d'un prospect en nurturing | responsable |
| Tâche de l'admin | relance envoyée à la main à un setter | ce setter |

Priorités : P0 urgence, P1 aujourd'hui, P2 prochainement, P3 nurturing. Une tâche à échéance remonte à P1, une tâche en retard de plus de 24 h gagne un cran.

Périmètre : les leads arrivés avant la date de mise en route (`salesOps.startedOn`, posée automatiquement à J-7 la première fois) ne créent pas de premier contact. Ils sont dans Nurturing → anciens prospects, bouton « Réactiver ».

## Statuts

- **Confirmation** : réservé / confirmation à faire / envoyée / confirmé par le prospect / sans réponse / reprogrammé / annulé / terminé / no-show — dérivé de `Appointment.status` + `confirmation`. « Envoyée » ≠ « confirmé ».
- **Setting** (`Lead.settingStatus`) : à contacter, premier contact fait, en conversation, en attente de réponse, qualifié, non qualifié, RDV proposé, nurturing, perdu, ne plus contacter. « RDV réservé » se lit sur les rendez-vous.
- **No-show** (`Appointment.noShow`) : à récupérer, relance effectuée, en attente, reprogrammé (dérivé d'un nouveau call), perdu, ne plus contacter.
- **Paiement** : le suivi de l'équipe (`Sale.paymentFollow` : promis, lien envoyé, à vérifier, échoué, abandonné) ne vaut **jamais** encaissement. Seul un encaissement enregistré par l'admin ou le closer compte.

## Commissions du Head of Setting

- Setting : règle `role: "setter"`, `pct-cash` (7,5 %) sur les ventes dont il a posé le rendez-vous (`Sale.setterId`).
- Management : règle `role: "manager"`, `pct-cash` (5 %) sur **tout** le cash coaching encaissé, quelle que soit la source ou le closer.
- Calcul par mouvement de cash (encaissement à la vente, chaque échéance, remboursement en négatif à sa date) : pas de double comptage, remboursements tracés.
- Les taux posés depuis Automatisations ne désactivent pas l'ancienne règle : elle s'arrête la veille de la nouvelle (`effectiveTo`). Les commissions acquises gardent leur taux. Fin de contrat possible.
- Versements : toujours par l'admin (Sales → Commissions).

## Intégrations

| Outil | État réel | Ce que le Sales OS en tire |
|---|---|---|
| iClosed | connecté (API + webhook `/api/webhooks/iclosed`, synchro 5 min) | rendez-vous, reprogrammations, issues → confirmations, no-shows, résultats manquants |
| Systeme.io | connecté (API 2 min + webhook) | opt-ins → nouveaux leads, premier contact |
| Meta Ads | lecture des campagnes (media buying) + IDs Meta sur les leads | source d'acquisition, filtres |
| Fathom | connecté si clé posée | résumé du call dans le contexte des relances |
| Telegram | bot existant, si jeton posé et membre relié | notification interne des nouveaux leads attribués |
| Instagram DM | **pas d'API d'envoi** utilisée | lien profond `ig.me/m/<pseudo>` ; le contact n'est compté que confirmé par le membre |
| ManyChat | **non connecté** | rien. Point d'entrée à prévoir : webhook ManyChat → création de lead (comme Systeme.io) |
| Hyros | **non connecté** | rien |
| Paiement (Stripe…) | **non connecté** | encaissements saisis à la main par l'admin / le closer |

Système maître : les rendez-vous restent maîtres dans iClosed (le CRM ne réécrit jamais iClosed) ; une reprogrammation faite dans le CRM est locale, à refaire dans iClosed si le lien doit changer.

## Fichiers

- `src/lib/sales/ops/` : `config.ts` (règles, objections), `engine.ts` (moteur), `views.ts` (cockpit, anomalies), `report.ts` (compte rendu, KPI), `actions.ts` (actions rapides), `run.ts` (passage réel), `time.ts`, `ops.test.ts`.
- API : `/api/sales/ops` (cockpit + actions), `/ops/settings`, `/ops/report`, `/ops/kpis`, `/ops/commissions`, `/ops/objections`.
- Pages : `/sales/workspace` (cockpit), `/sales/operations` (admin), `/sales/automatisations` (admin), `/sales/accueil` (ancien accueil du Head).

## Tests

`npm run test:sales` : compile les tests avec le TypeScript du projet et les lance avec `node:test` (16 scénarios métier + changement de taux + paiement déclaré).
