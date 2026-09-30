"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, Field, InfoNote, PageHeader, useToast } from "@/components/ui";

/**
 * Kit tournage.
 *
 * Le format « je monte une marque e-commerce en direct » demande cinq
 * fenetres et trois prompts a chaque video. Ici : un produit, un clic, tout
 * s'ouvre, les prompts sont ecrits avec le produit dedans et se copient en
 * un clic. Zero temps perdu entre deux enregistrements.
 *
 * Les prompts et l'adresse Shopify se gardent dans le navigateur : ce sont
 * des reglages personnels, pas des donnees du CRM.
 */

const KEY = "princexd:tournage";

/** Produits au hasard : des categories qui tournent bien en e-commerce. */
const RANDOM_PRODUCTS = [
  "lampe de chevet tactile",
  "brosse nettoyante visage",
  "support téléphone voiture magnétique",
  "coussin cervical ergonomique",
  "gourde isotherme design",
  "masseur de cou électrique",
  "organisateur de câbles",
  "mini projecteur portable",
  "sac banane imperméable",
  "tapis de yoga épais",
  "bougie parfumée artisanale",
  "montre minimaliste homme",
  "lunettes anti lumière bleue",
  "correcteur de posture",
  "gadget cuisine coupe-légumes",
  "veilleuse projecteur galaxie",
  "brosse à dents électrique",
  "chargeur sans fil 3 en 1",
  "collier pour chien lumineux",
  "sérum pousse de cils",
];

interface Kit {
  product: string;
  shopifyUrl: string;
  claudePrompt: string;
  higgsPrompt: string;
  klingPrompt: string;
}

const DEFAULTS: Kit = {
  product: "",
  shopifyUrl: "https://admin.shopify.com/",
  claudePrompt:
    "Crée-moi une marque e-commerce de {produit} qui fait +50 000 € par mois : nom de marque, positionnement, cible précise, offre irrésistible, angle marketing principal, structure de la page produit, 3 hooks de publicité vidéo, et un plan Meta Ads sur 30 jours avec budget.",
  higgsPrompt:
    "Ultra-realistic product photography of {produit}, vertical 9:16, premium e-commerce brand aesthetic, soft studio lighting, subtle shadows, clean minimalist background with a hint of lifestyle context, shot on Sony A7IV 50mm, 8k, razor-sharp details, no text, no watermark",
  klingPrompt:
    "Cinematic product reveal of {produit}: slow elegant 360° rotation on a clean background, soft studio light sweeping across the surface, subtle depth of field, camera slowly pushes in, vertical 9:16, 5 seconds, photorealistic, no text",
};

const fill = (tpl: string, product: string) => tpl.split("{produit}").join(product || "{produit}");

export default function TournagePage() {
  const toast = useToast();
  const [kit, setKit] = useState<Kit>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(KEY);
      if (saved) setKit({ ...DEFAULTS, ...(JSON.parse(saved) as Partial<Kit>) });
    } catch {
      // Stockage indisponible : valeurs par defaut.
    }
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(kit));
    } catch {
      // idem
    }
  }, [kit, loaded]);

  const set = (patch: Partial<Kit>) => setKit((k) => ({ ...k, ...patch }));
  const product = kit.product.trim();

  const links = useMemo(() => {
    const claude = `https://claude.ai/new?q=${encodeURIComponent(fill(kit.claudePrompt, product))}`;
    const ali = product
      ? `https://www.aliexpress.com/w/wholesale-${encodeURIComponent(product.replace(/\s+/g, "-"))}.html?sortType=total_tranpro_desc`
      : "https://www.aliexpress.com/";
    return [
      { key: "claude", label: "Claude", sub: "prompt écrit, pas envoyé", url: claude },
      { key: "ali", label: "AliExpress", sub: product ? `recherche « ${product} »` : "accueil", url: ali },
      { key: "higgs", label: "Higgsfield", sub: "photo 9:16 du produit", url: "https://higgsfield.ai/create/image" },
      { key: "shopify", label: "Shopify", sub: "mes chiffres", url: kit.shopifyUrl || "https://admin.shopify.com/" },
      { key: "meta", label: "Meta Ads Manager", sub: "page d'accueil", url: "https://adsmanager.facebook.com/adsmanager/manage/campaigns" },
    ];
  }, [kit.claudePrompt, kit.shopifyUrl, product]);

  const openAll = () => {
    // Un seul geste utilisateur : le navigateur laisse passer les fenetres.
    // Ordre inverse pour que Claude finisse au premier plan.
    let blocked = 0;
    for (const l of [...links].reverse()) {
      const w = window.open(l.url, `tournage-${l.key}`);
      if (!w) blocked++;
    }
    toast(
      blocked
        ? `${links.length - blocked} onglet(s) ouvert(s), ${blocked} bloqué(s) : autorise les pop-ups pour mvdyprince.fr, ou ouvre-les un par un ci-dessous.`
        : "Les 5 onglets sont ouverts. Bon tournage.",
    );
  };

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${what} copié.`);
    } catch {
      window.prompt("Copie :", text);
    }
  };

  const random = () => {
    const p = RANDOM_PRODUCTS[Math.floor(Math.random() * RANDOM_PRODUCTS.length)];
    set({ product: p });
    toast(`Produit : ${p}`);
  };

  return (
    <>
      <PageHeader
        title="Kit tournage"
        subtitle="Un produit, un clic : Claude avec le prompt prêt, AliExpress, Higgsfield, Shopify et Meta Ads Manager s'ouvrent, les prompts se copient."
      />

      <div className="flex flex-col gap-4">
        <Card>
          <div className="flex flex-col gap-3">
            <div className="flex gap-2 items-end flex-wrap">
              <Field label="Produit" className="flex-1 min-w-[240px]">
                <input
                  className="input"
                  placeholder="ex. lampe de chevet tactile"
                  value={kit.product}
                  onChange={(e) => set({ product: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && openAll()}
                />
              </Field>
              <button className="btn" onClick={random} title="Pioche un produit dans une liste de catégories qui marchent">
                🎲 Produit au hasard
              </button>
              <button className="btn btn-primary !h-[40px] !px-5 !text-[14px]" onClick={openAll}>
                ▶ Tout ouvrir
              </button>
            </div>
            <InfoNote>
              Au premier clic, Chrome peut bloquer les fenêtres : clique sur l&apos;icône « pop-up bloqué » à droite de la
              barre d&apos;adresse et autorise mvdyprince.fr. Ensuite, c&apos;est instantané à chaque fois.
            </InfoNote>
            <div className="grid sm:grid-cols-5 gap-2">
              {links.map((l, i) => (
                <a
                  key={l.key}
                  href={l.url}
                  target={`tournage-${l.key}`}
                  rel="noreferrer"
                  className="card-flat px-3 py-2.5 hover:opacity-90"
                  title={l.url}
                >
                  <div className="text-[12.5px] font-semibold">
                    {i + 1}. {l.label}
                  </div>
                  <div className="dim text-[11px] truncate">{l.sub}</div>
                </a>
              ))}
            </div>
          </div>
        </Card>

        <div className="grid lg:grid-cols-3 gap-4 items-start">
          <PromptCard
            title="1. Claude — la marque"
            hint="Ouvert avec ce texte déjà écrit. Tu n'as qu'à appuyer sur Entrée face caméra."
            value={kit.claudePrompt}
            filled={fill(kit.claudePrompt, product)}
            onChange={(v) => set({ claudePrompt: v })}
            onCopy={() => void copy(fill(kit.claudePrompt, product), "Prompt Claude")}
          />
          <PromptCard
            title="2. Higgsfield — photo 9:16"
            hint="Colle-le dans Higgsfield pour une photo réaliste du produit, verticale."
            value={kit.higgsPrompt}
            filled={fill(kit.higgsPrompt, product)}
            onChange={(v) => set({ higgsPrompt: v })}
            onCopy={() => void copy(fill(kit.higgsPrompt, product), "Prompt Higgsfield")}
          />
          <PromptCard
            title="3. Kling Motion 3.0 — animation"
            hint="Colle-le avec la photo Higgsfield pour animer le produit."
            value={kit.klingPrompt}
            filled={fill(kit.klingPrompt, product)}
            onChange={(v) => set({ klingPrompt: v })}
            onCopy={() => void copy(fill(kit.klingPrompt, product), "Prompt Kling")}
          />
        </div>

        <Card title="Réglages" subtitle="Gardés dans ce navigateur.">
          <Field label="Adresse de ton admin Shopify" hint="Celle qui s'ouvre sur tes chiffres, ex. https://admin.shopify.com/store/ta-boutique">
            <input className="input" value={kit.shopifyUrl} onChange={(e) => set({ shopifyUrl: e.target.value })} />
          </Field>
          <div className="mt-3">
            <button className="btn btn-sm btn-ghost" onClick={() => setKit({ ...DEFAULTS, shopifyUrl: kit.shopifyUrl })}>
              Remettre les prompts par défaut
            </button>
          </div>
        </Card>
      </div>
    </>
  );
}

function PromptCard({
  title,
  hint,
  value,
  filled,
  onChange,
  onCopy,
}: {
  title: string;
  hint: string;
  value: string;
  filled: string;
  onChange: (v: string) => void;
  onCopy: () => void;
}) {
  return (
    <Card
      title={title}
      subtitle={hint}
      actions={
        <button className="btn btn-sm btn-primary" onClick={onCopy}>
          Copier
        </button>
      }
    >
      <textarea className="textarea w-full" rows={6} value={value} onChange={(e) => onChange(e.target.value)} />
      <div className="dim text-[11.5px] mt-2">
        <span className="label-xs">Aperçu avec le produit : </span>
        {filled}
      </div>
    </Card>
  );
}
