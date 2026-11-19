"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { ErrorNote, Spinner } from "@/components/ui";
import { StepGate } from "@/components/formation/StepGate";
import { PortalFooter } from "@/components/formation/portal";
import { MethodVideoLesson } from "@/components/formation/VideoLesson";
import type { MethodPayload } from "@/app/api/formation/methode/route";

/**
 * Campagnes Meta (Scale X) : la vidéo de Mady qui lance la première campagne
 * publicitaire sur Meta, avec son résumé et les étapes à suivre. La boutique
 * est en ligne, les créatives sont prêtes : c'est le dernier temps du parcours.
 * Le lien, le résumé et les étapes se modifient sur place par l'admin.
 */
export default function MetaPage() {
  const [data, setData] = useState<MethodPayload | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<MethodPayload>("/api/formation/methode")
      .then((d) => {
        setData(d);
        setError("");
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Spinner label="Chargement…" />;

  return (
    <StepGate tab="meta">
    <div className="flex flex-col gap-5">
      <header>
        <div className="label-xs" style={{ letterSpacing: "0.12em" }}>
          Scale X / Campagnes Meta
        </div>
        <h1 className="text-[28px] sm:text-[34px] font-semibold leading-tight mt-2" style={{ letterSpacing: "-0.03em" }}>
          Lance tes campagnes publicitaires sur Meta.
        </h1>
        <p className="muted text-[14px] mt-1 max-w-[64ch]">Ta boutique est en ligne, tes créatives sont prêtes. Mady te montre comment lancer ta première campagne, puis tu reproduis exactement la structure ci-dessous, avec ton enveloppe budgétaire.</p>
        {data.preview && <div className="badge badge-warn w-fit !text-[11.5px] mt-3">Aperçu : tu vois Scale X comme {data.student?.name}.</div>}
      </header>

      <MethodVideoLesson
        lesson="meta"
        n="01"
        title="Regarde Mady lancer une campagne Meta"
        intro="Toute la mise en ligne d'une campagne en vidéo. Regarde-la une fois en entier, puis refais chaque étape avec ta boutique et tes créatives."
        placeholder="La vidéo arrive bientôt. En attendant : Meta Business, compte publicitaire et Pixel (Ressources, guides 08 et 09)."
      />

      <section className="card p-5" id="omega">
        <div className="label-xs" style={{ letterSpacing: "0.12em" }}>
          L&apos;APP PIXEL : OMEGA FACEBOOK PIXEL
        </div>
        <h2 className="text-[18px] font-semibold mt-2" style={{ letterSpacing: "-0.02em" }}>
          Installe Omega Facebook Pixel sur ta boutique (9,99 € / mois).
        </h2>
        <p className="text-[13.5px] mt-2 leading-relaxed max-w-[64ch]">
          C&apos;est obligatoire avant de lancer tes campagnes. L&apos;application Facebook &amp; Instagram de Shopify pose le Pixel, mais elle perd une partie des événements (iPhone, bloqueurs de pub, cookies refusés). Omega renvoie aussi les événements côté serveur (API Conversions) : Meta voit <strong>vraiment</strong> qui regarde, qui ajoute au panier et qui achète. Sans ça, tes campagnes apprennent sur des données à moitié vides et tu paies tes pubs plus cher.
        </p>
        <ul className="list-disc pl-5 mt-3 flex flex-col gap-1.5 text-[13.5px] leading-relaxed">
          <li>
            <strong>Installe l&apos;app</strong> depuis l&apos;App Store Shopify, prends l&apos;abonnement à 9,99 € / mois (c&apos;est un coût de ta boutique, comme Shopify).
          </li>
          <li>
            <strong>Connecte ton Pixel Meta</strong> (celui de ton compte publicitaire) et active l&apos;API Conversions avec le jeton que l&apos;app te demande.
          </li>
          <li>
            <strong>Vérifie</strong> : ajoute un produit au panier sur ta boutique, puis Gestionnaire d&apos;événements Meta → Tester les événements. Tu dois voir les événements remonter deux fois (navigateur + serveur), c&apos;est normal, Omega les dédoublonne.
          </li>
        </ul>
        <div className="flex flex-wrap items-center gap-3 mt-4">
          <a className="btn btn-primary btn-sm" href="https://apps.shopify.com/facebook-multi-pixels" target="_blank" rel="noreferrer">
            Installer Omega Facebook Pixel ↗
          </a>
          <a className="text-[13px] font-medium hover:underline" href="https://business.facebook.com/events_manager" target="_blank" rel="noreferrer">
            Gestionnaire d&apos;événements Meta ↗
          </a>
        </div>
      </section>

      <section className="card p-5">
        <div className="label-xs" style={{ letterSpacing: "0.12em" }}>
          02 / AVANT DE LANCER
        </div>
        <ul className="list-disc pl-5 mt-3 flex flex-col gap-1.5 text-[13.5px] leading-relaxed">
          <li>
            <strong>Ta boutique encaisse.</strong> Commande test faite depuis ton téléphone (Démarrage, réglages Shopify).
          </li>
          <li>
            <strong>Le Pixel Meta est posé</strong> et il remonte les événements (vue de page, ajout au panier, achat). Pas encore fait :{" "}
            <Link href="/formation/demarrage#pixel" className="underline">
              Démarrage, section 10
            </Link>
            .
          </li>
          <li>
            <strong>Omega Facebook Pixel est installé</strong> (bloc ci-dessus) et l&apos;API Conversions est active : sinon Meta ne voit qu&apos;une partie de tes ventes.
          </li>
          <li>
            <strong>Tes créatives sont prêtes</strong> : 6 créatives, 6 statiques (3:4, 1:1 ou 9:16) ou 6 vidéos (9:16) selon ton produit, générées dans le Studio IA.
          </li>
        </ul>
        <div className="flex flex-wrap items-center gap-3 mt-4">
          <Link href="/formation/boutique" className="btn btn-sm">
            ← Ta boutique
          </Link>
          <Link href="/formation/sops" className="text-[13px] font-medium hover:underline">
            Les guides Meta Business, Pixel et campagne (Ressources)
          </Link>
        </div>
      </section>

      <section className="card p-5" style={{ borderColor: "var(--accent-ring)" }}>
        <div className="label-xs" style={{ letterSpacing: "0.12em" }}>
          03 / LA STRUCTURE DE TA PREMIÈRE CAMPAGNE
        </div>
        <p className="muted text-[13.5px] mt-3 leading-relaxed max-w-[64ch]">
          Exactement cette structure, celle de la vidéo. Objectif Ventes (conversion Achat sur ton Pixel), budget posé sur l&apos;ad set (ABO), ciblage large (pays cible, pas d&apos;intérêts).
        </p>
        <div className="grid gap-3 mt-4 sm:grid-cols-2">
          <div className="rounded-md p-3.5" style={{ background: "var(--surface-2)" }}>
            <div className="label-xs">Budget 50 € / jour · la base</div>
            <ul className="list-disc pl-5 mt-2 flex flex-col gap-1.5 text-[13.5px] leading-relaxed">
              <li>
                <strong>1 campagne ABO</strong>
              </li>
              <li>
                <strong>1 ad set</strong> à 50 €/jour
              </li>
              <li>
                <strong>6 créatives</strong> dedans : 6 statiques <em>ou</em> 6 vidéos, selon ton produit (ci-dessous)
              </li>
              <li>
                <strong>3 jours sans toucher.</strong> Jour 2 : tu ne touches que si les stats sont vraiment éclatées.
              </li>
            </ul>
          </div>
          <div className="rounded-md p-3.5" style={{ background: "var(--surface-2)" }}>
            <div className="label-xs">Budget 100 € / jour · si tu as le budget</div>
            <ul className="list-disc pl-5 mt-2 flex flex-col gap-1.5 text-[13.5px] leading-relaxed">
              <li>
                <strong>1 campagne ABO</strong>
              </li>
              <li>
                <strong>2 ad sets</strong> à 50 €/jour chacun
              </li>
              <li>
                <strong>Ad set 1 : statiques</strong>, 6 créatives dedans
              </li>
              <li>
                <strong>Ad set 2 : vidéos</strong>, 6 créatives dedans
              </li>
              <li>Même règle : 3 jours sans toucher.</li>
            </ul>
          </div>
        </div>
        <div className="mt-4 rounded-md p-3.5" style={{ border: "1px solid var(--border)" }}>
          <div className="text-[14px] font-semibold">Statiques ou vidéos ? Ça dépend du produit.</div>
          <ul className="list-disc pl-5 mt-2 flex flex-col gap-1.5 text-[13.5px] leading-relaxed">
            <li>
              <strong>Produit démontrable</strong> (il faut le voir fonctionner, une démo) : vidéo. Une vidéo vend mieux qu&apos;une photo, on part sur le format vidéo.
            </li>
            <li>
              <strong>Produit classique</strong>, qui se comprend sans vidéo : 6 statiques.
            </li>
          </ul>
        </div>
      </section>

      <section className="card p-5" id="budget">
        <div className="label-xs" style={{ letterSpacing: "0.12em" }}>
          04 / TON ENVELOPPE BUDGÉTAIRE ADS
        </div>
        <p className="muted text-[13.5px] mt-3 leading-relaxed max-w-[64ch]">
          Avant de lancer, tu sais combien tu mets en tout sur la partie ads. C&apos;est une enveloppe, pas une dépense au jour le jour.
        </p>
        <div className="grid gap-3 mt-4 sm:grid-cols-3">
          <div className="rounded-md p-3.5" style={{ background: "var(--surface-2)", border: "1px solid var(--accent-ring)" }}>
            <div className="label-xs">Idéal</div>
            <div className="num text-[22px] font-semibold mt-1" style={{ letterSpacing: "-0.02em" }}>
              1 000 € et +
            </div>
            <p className="muted text-[13px] mt-1 leading-relaxed">De quoi tester, lire, remplacer les créatives et scaler ce qui marche.</p>
          </div>
          <div className="rounded-md p-3.5" style={{ background: "var(--surface-2)" }}>
            <div className="label-xs">Acceptable</div>
            <div className="num text-[22px] font-semibold mt-1" style={{ letterSpacing: "-0.02em" }}>
              400 à 500 €
            </div>
            <p className="muted text-[13px] mt-1 leading-relaxed">Tu lances à 50 €/jour : un vrai test, à lire sérieusement à J+3.</p>
          </div>
          <div className="rounded-md p-3.5" style={{ background: "var(--surface-2)" }}>
            <div className="label-xs">En dessous</div>
            <div className="num text-[22px] font-semibold mt-1" style={{ letterSpacing: "-0.02em" }}>
              Pas nécessaire
            </div>
            <p className="muted text-[13px] mt-1 leading-relaxed">Ce n&apos;est pas la peine de lancer : attends d&apos;avoir l&apos;enveloppe.</p>
          </div>
        </div>
        <p className="text-[13.5px] mt-4 leading-relaxed max-w-[64ch]">
          <strong>C&apos;est un investissement, pas une perte.</strong> Cette enveloppe achète de la donnée : tu sais si ton produit, tes créatives et ta page convertissent. Tu ne la considères pas comme de l&apos;argent perdu, c&apos;est comme ça que ça marche.
        </p>
      </section>

      <PortalFooter quote="La pub ne répare pas un produit moyen. Elle accélère un bon produit." author="Mady" />
    </div>
    </StepGate>
  );
}
