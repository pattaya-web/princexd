"use client";

import { InfoNote, PageHeader } from "@/components/ui";
import { CosShell, Fold } from "@/components/content-os/CosShell";

/* Page de référence : la stratégie de contenu issue de l'accompagnement d'Isma. Texte fixe, consultable à tout moment. */
export default function ContentOsStrategy() {
  return (
    <CosShell>
      <PageHeader title="Stratégie de contenu" subtitle="La ligne fixée avec Isma : YouTube pour la personnalité et l'expertise, Instagram pour le volume, un CTA qui démarre une conversation." />

      <div className="grid gap-4">
        <Fold title="YouTube — contenu TOFU (personnalité)" open>
          <p className="muted">Objectif : développer mon personal branding, faire découvrir ma personnalité et créer une connexion avec les spectateurs.</p>
          <ul className="list-disc pl-5 grid gap-0.5">
            <li>Vlogs du quotidien à Dubaï.</li>
            <li>Journées de travail.</li>
            <li>Coulisses e-commerce.</li>
            <li>Mon histoire entrepreneuriale.</li>
            <li>Discussions naturelles.</li>
            <li>Challenges e-commerce.</li>
            <li>Lifestyle contextualisé.</li>
          </ul>
          <InfoNote>Règle : pas de script mot pour mot pour les vlogs. Rester naturel.</InfoNote>
        </Fold>

        <Fold title="YouTube — contenu de valeur (expertise)" open>
          <p className="muted">Objectif : démontrer mon expertise. Deux formats :</p>
          <ol className="list-decimal pl-5 grid gap-0.5">
            <li>
              <b>Mon mécanisme</b> : Shopify, Claude Code, IA, créatives publicitaires, recherche produit, Meta Ads.
            </li>
            <li>
              <b>Tendances</b> : innovations IA et nouvelles opportunités e-commerce.
            </li>
          </ol>
          <p className="font-medium mt-1">Règles</p>
          <ul className="list-disc pl-5 grid gap-0.5">
            <li>Préparer le hook et les chapitres.</li>
            <li>Expliquer simplement.</li>
            <li>Montrer des démonstrations.</li>
            <li>Pas de longue introduction inutile.</li>
          </ul>
          <InfoNote>Cadence conseillée par Isma : commencer à une vidéo par semaine, viser progressivement deux vidéos de valeur par semaine.</InfoNote>
        </Fold>

        <Fold title="YouTube — chaîne secondaire (plus tard)">
          <p className="muted">À mettre en place ultérieurement, sans cadence fixe.</p>
          <ul className="list-disc pl-5 grid gap-0.5">
            <li>Témoignages élèves.</li>
            <li>Extraits de coaching 1:1.</li>
            <li>Interviews.</li>
            <li>Discussions avec des entrepreneurs.</li>
          </ul>
        </Fold>

        <Fold title="Instagram — stratégie" open>
          <ul className="list-disc pl-5 grid gap-0.5">
            <li>Réutiliser les hooks et formats qui fonctionnent.</li>
            <li>Transformer des vidéos longues en Reels.</li>
            <li>Recycler les passages intéressants des vlogs.</li>
            <li>Exploiter les témoignages autorisés.</li>
            <li>Sous-titres sobres et propres.</li>
            <li>Tester des titres visuels percutants.</li>
            <li>Ne pas rechercher la perfection systématiquement.</li>
          </ul>
          <InfoNote>
            Volumes conseillés par Isma, pas des obligations déjà activées : environ 3 Reels par jour au début, objectif 4 à 5 Reels par jour, augmentation éventuelle quand le système tourne.
          </InfoNote>
        </Fold>

        <Fold title="CTA YouTube — la méthode" open>
          <ol className="list-decimal pl-5 grid gap-0.5">
            <li>Apporter de la valeur.</li>
            <li>Proposer une ressource gratuite en rapport avec la vidéo.</li>
            <li>Tester le CTA autour de 50 % de la vidéo.</li>
            <li>Inviter les spectateurs à envoyer un mot-clé sur Instagram.</li>
            <li>Démarrer une conversation et qualifier les prospects.</li>
            <li>Proposer un call lorsque c&apos;est pertinent.</li>
          </ol>
          <InfoNote>Le positionnement du CTA s&apos;adapte ensuite à la rétention réelle : on regarde les courbes avant de trancher.</InfoNote>
        </Fold>

        <Fold title="Matériel & tournage">
          <p className="font-medium">Sony Alpha ZV-E10</p>
          <ul className="list-disc pl-5 grid gap-0.5">
            <li>YouTube en horizontal 16:9.</li>
            <li>4K / 25p.</li>
            <li>Profil Log évoqué par Isma, à régler selon les capacités du modèle exact.</li>
            <li>Plans travaillés et vlogs.</li>
          </ul>
          <p className="font-medium mt-1">DJI Osmo</p>
          <ul className="list-disc pl-5 grid gap-0.5">
            <li>Documentation quotidienne, images spontanées en 4K.</li>
            <li>Bureau, déplacements, discussions, coulisses.</li>
            <li>Facile à poser et à déclencher vite.</li>
          </ul>
          <InfoNote>Règle permanente : toujours capturer de la matière pour le monteur, même si aucune vidéo n&apos;est planifiée aujourd&apos;hui.</InfoNote>
        </Fold>
      </div>
    </CosShell>
  );
}
