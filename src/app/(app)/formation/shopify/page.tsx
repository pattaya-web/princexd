"use client";

import Link from "next/link";
import { PortalFooter } from "@/components/formation/portal";

/**
 * Astuces Shopify (Scale X) : tout ce qu'un élève fait lui-même dans son
 * admin Shopify une fois la boutique livrée, sans attendre Mady. Nom de
 * domaine, chat Inbox, collections, pages légales, paiements, livraison,
 * codes promo… et Claude pour aller plus vite sur chacun de ces points.
 * Page statique : le texte vit ici.
 */

interface Tip {
  id: string;
  n: string;
  title: string;
  intro: string;
  steps: { title: string; text: string }[];
  claude?: string;
  links?: { label: string; href: string }[];
}

const TIPS: Tip[] = [
  {
    id: "domaine",
    n: "01",
    title: "Ton nom de domaine : achète-le directement dans Shopify",
    intro: "Une boutique en « .myshopify.com », ça ne vend pas. Il te faut ton propre nom de domaine, et le plus simple est de le prendre dans Shopify : tout se configure tout seul (DNS, certificat https), rien à brancher.",
    steps: [
      { title: "Où", text: "Admin Shopify > Paramètres > Domaines > Acheter un nouveau domaine. Tape le nom de ta marque, choisis l'extension (.com en priorité, .fr si tu ne vends qu'en France). Compte 15 à 20 € par an, c'est ta boutique, c'est normal." },
      { title: "Quel nom", text: "Court, facile à écrire à l'oral, sans tiret ni chiffre. Le nom de ta marque, pas le nom du produit : tu changeras peut-être de produit, pas de marque." },
      { title: "Après l'achat", text: "Domaines > ton nouveau domaine > « Définir comme principal ». Attends 10 à 30 minutes : ta boutique répond sur ton domaine, en https, et l'ancienne adresse redirige automatiquement." },
      { title: "Tu as déjà un domaine ailleurs (OVH, GoDaddy, Ionos…) ?", text: "Paramètres > Domaines > Connecter un domaine existant. Shopify te donne deux lignes à copier chez ton hébergeur (un A et un CNAME). Si tu bloques, colle les instructions à Claude, il te dit exactement quoi mettre où." },
    ],
    claude: "« Je viens d'acheter le domaine [ton-domaine].com, dis-moi comment le mettre en principal dans Shopify et vérifie que le https est actif. »",
    links: [{ label: "Guide Shopify : acheter un domaine", href: "https://help.shopify.com/fr/manual/domains/add-a-domain/buying-domains" }],
  },
  {
    id: "inbox",
    n: "02",
    title: "Un chat sur ta boutique : Shopify Inbox (gratuit)",
    intro: "Un client qui a une question et personne pour répondre, c'est une vente perdue. Shopify Inbox met une bulle de chat sur ta boutique, et tu réponds depuis ton téléphone.",
    steps: [
      { title: "Installe l'app", text: "Admin Shopify > Applications > cherche « Shopify Inbox » > Installer (c'est l'app officielle, gratuite). Active le chat sur la boutique en ligne." },
      { title: "Réponses automatiques", text: "Dans Inbox > Paramètres, règle les réponses instantanées : délai de livraison, frais de port, retours, « on vous répond sous 1 h ». 80 % des questions sont là-dedans." },
      { title: "Sur ton téléphone", text: "Installe l'application Shopify Inbox (iOS / Android) : tu reçois chaque message en notification et tu réponds en 30 secondes, même dehors. Un client qui a une réponse vite, c'est un client qui achète." },
      { title: "Le ton", text: "Tutoie si ta marque tutoie, réponds court, propose toujours une action : « Je t'envoie le lien du produit en bleu ? ». Et pense à demander l'email pour la relance." },
    ],
    claude: "« Écris-moi 6 réponses automatiques pour Shopify Inbox pour une boutique de [produit] : livraison, délais, retours, taille, paiement, contact. Ton [tutoiement / vouvoiement]. »",
    links: [{ label: "Shopify Inbox sur l'App Store", href: "https://apps.shopify.com/inbox" }],
  },
  {
    id: "collections",
    n: "03",
    title: "Les collections : ça se crée dans Produits > Collections",
    intro: "Une collection, c'est un rayon : « Nouveautés », « Best-sellers », « Pour la maison ». C'est ce qui remplit ton menu et tes pages de catégorie. Tout se fait dans l'admin, pas dans le thème.",
    steps: [
      { title: "Créer", text: "Admin Shopify > Produits > Collections > Créer une collection. Un titre, une image de couverture (format paysage), une description courte." },
      { title: "Manuelle ou automatique", text: "Manuelle : tu choisis les produits un par un (parfait pour « Sélection du mois »). Automatique : une règle (tag = été, prix < 30 €…) et les produits y entrent tout seuls. Pour une mono-produit, une collection « Tout » suffit au départ." },
      { title: "La mettre dans le menu", text: "Boutique en ligne > Navigation > Menu principal > Ajouter un élément > Collections > ta collection. Sans ça, la collection existe mais personne ne la trouve." },
      { title: "Sur la page d'accueil", text: "Boutique en ligne > Personnaliser > ajoute une section « Collection en vedette » et choisis la collection. C'est là que tes best-sellers doivent être." },
    ],
    claude: "« Propose-moi 4 collections pour ma boutique de [produit] avec, pour chacune, le titre, une description de 2 lignes et la règle automatique à mettre dans Shopify. »",
    links: [{ label: "Guide Shopify : les collections", href: "https://help.shopify.com/fr/manual/products/collections" }],
  },
  {
    id: "claude",
    n: "04",
    title: "Claude : ton bras droit pour aller 10 fois plus vite",
    intro: "Tout ce qu'il y a sur cette page, Claude peut le faire avec toi ou à ta place. Tu as Claude Max et Claude Code pour la boutique, et Claude pour Chrome qui clique dans ton admin pendant que tu regardes.",
    steps: [
      { title: "Les textes", text: "Fiche produit, page « À propos », FAQ, politique de livraison, emails de confirmation : donne-lui ton produit et ta cible, demande 3 versions, choisis. Ne pars jamais d'une page blanche." },
      { title: "La boutique", text: "Dans Claude Code (VS Code), ton thème est un dossier : « ajoute une section avis sous le bouton d'achat », « passe la couleur du bouton en noir », « rends la page produit plus rassurante ». Il modifie, tu regardes, tu valides." },
      { title: "L'admin Shopify", text: "Avec Claude pour Chrome, ouvre ton admin et dis : « crée la collection Best-sellers avec ces 3 produits », « règle la livraison offerte en France », « active Shopify Inbox ». Il clique, tu surveilles." },
      { title: "Les problèmes", text: "Un message d'erreur, une capture d'écran, un « ça ne marche pas » : colle tout à Claude avant d'écrire à Mady. Il règle 80 % des blocages en direct, à n'importe quelle heure." },
    ],
    claude: "« Voici ma boutique [lien]. Fais-moi la liste de tout ce qui manque pour inspirer confiance (pages légales, avis, moyens de paiement, FAQ, délais) et donne-moi, pour chaque point, où le régler dans Shopify. »",
  },
  {
    id: "confiance",
    n: "05",
    title: "Ce qui rassure un client (à faire une fois, le premier jour)",
    intro: "Un client qui hésite regarde trois choses : est-ce que je peux payer comme je veux, quand est-ce que je reçois, et est-ce que c'est sérieux. Tout se règle dans Paramètres.",
    steps: [
      { title: "Paiements", text: "Paramètres > Paiements : active Shopify Payments (carte, Apple Pay, Google Pay) et PayPal. Chaque moyen de paiement en moins, c'est des ventes en moins." },
      { title: "Livraison", text: "Paramètres > Expédition et livraison : une zone par pays où tu vends, livraison offerte à partir d'un montant (ça monte le panier moyen). Mets un délai honnête sur la page produit." },
      { title: "Pages légales", text: "Paramètres > Politiques : Shopify génère les modèles (remboursement, confidentialité, CGV, mentions légales). Relis, adapte avec Claude, et vérifie qu'elles sont dans le menu du pied de page." },
      { title: "Emails et notifications", text: "Paramètres > Notifications : l'email de confirmation de commande et d'expédition partent tout seuls. Ajoute ton logo et une phrase à toi, c'est ce que le client lit en premier après avoir payé." },
      { title: "Codes promo", text: "Réductions > Créer une réduction : un code de bienvenue (-10 %) pour le pop-up, un code pour tes relances, et une offre « 2 achetés, le 3e offert » si ton produit s'y prête." },
    ],
    claude: "« Rédige ma politique de livraison et de retours pour une boutique française de [produit], délai [X jours], retours sous 14 jours, ton rassurant et simple. »",
  },
];

export default function AstucesShopifyPage() {
  return (
    <div className="flex flex-col gap-5">
      <header>
        <div className="label-xs" style={{ letterSpacing: "0.12em" }}>
          Scale X / Astuces Shopify
        </div>
        <h1 className="text-[28px] sm:text-[34px] font-semibold leading-tight mt-2" style={{ letterSpacing: "-0.03em" }}>
          Ta boutique, tu la gères toi-même.
        </h1>
        <p className="muted text-[14px] mt-1 max-w-[64ch]">Nom de domaine, chat, collections, paiements, livraison : tout se règle dans ton admin Shopify, en quelques clics. Et pour chaque point, Claude peut le faire avec toi.</p>
      </header>

      <nav className="flex flex-wrap gap-1.5">
        {TIPS.map((t) => (
          <a key={t.id} href={`#${t.id}`} className="btn btn-sm">
            {t.n} · {t.title.split(" : ")[0].split(" (")[0]}
          </a>
        ))}
      </nav>

      {TIPS.map((t) => (
        <section key={t.id} id={t.id} className="card p-5 scroll-mt-4">
          <div className="label-xs" style={{ letterSpacing: "0.12em" }}>
            {t.n} / {t.title.split(" : ")[0].toUpperCase()}
          </div>
          <h2 className="text-[18px] font-semibold mt-2" style={{ letterSpacing: "-0.02em" }}>
            {t.title}
          </h2>
          <p className="text-[13.5px] mt-2 leading-relaxed max-w-[64ch]">{t.intro}</p>
          <ol className="mt-4 flex flex-col gap-3">
            {t.steps.map((s, i) => (
              <li key={s.title} className="flex gap-3">
                <span className="shrink-0 w-6 h-6 rounded-full grid place-items-center text-[11.5px] font-semibold" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                  {i + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-semibold">{s.title}</span>
                  <span className="block text-[13.5px] leading-relaxed muted">{s.text}</span>
                </span>
              </li>
            ))}
          </ol>
          {t.claude && (
            <div className="mt-4 rounded-[8px] px-3.5 py-3 text-[13px] leading-relaxed" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
              <span className="font-semibold">À dire à Claude : </span>
              {t.claude}
            </div>
          )}
          {t.links && t.links.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 mt-4">
              {t.links.map((l) => (
                <a key={l.href} className="btn btn-sm" href={l.href} target="_blank" rel="noreferrer">
                  {l.label} ↗
                </a>
              ))}
            </div>
          )}
        </section>
      ))}

      <section className="card p-5">
        <div className="label-xs" style={{ letterSpacing: "0.12em" }}>
          ET ENSUITE
        </div>
        <p className="text-[13.5px] mt-2 leading-relaxed max-w-[64ch]">
          Boutique propre, domaine posé, chat actif, pages légales en place : tu es prêt pour les pubs. Direction{" "}
          <Link href="/formation/meta" className="underline">
            Campagnes Meta
          </Link>
          , et n&apos;oublie pas Omega Facebook Pixel avant de lancer.
        </p>
      </section>

      <PortalFooter quote="Une boutique, ça se règle une fois et ça se soigne tous les jours." author="Mady" />
    </div>
  );
}
