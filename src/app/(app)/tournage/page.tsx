"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/client";
import { clipboardFiles, uploadFile } from "@/lib/upload-client";
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

  /*
   * Chrome n'autorise qu'UNE fenetre par clic tant que les pop-ups ne sont
   * pas autorises pour le site. On ouvre tout d'un coup ; ce qui est bloque
   * reste dans une file, et chaque clic sur « Ouvrir le suivant » en ouvre
   * un de plus. Une fois les pop-ups autorises, tout part en un clic.
   */
  const [queue, setQueue] = useState<typeof links>([]);
  const openAll = () => {
    const blocked: typeof links = [];
    // Ordre inverse pour que Claude finisse au premier plan.
    for (const l of [...links].reverse()) {
      const w = window.open(l.url, `tournage-${l.key}`);
      if (!w) blocked.push(l);
    }
    setQueue(blocked.reverse());
    toast(
      blocked.length
        ? `${links.length - blocked.length} ouvert, ${blocked.length} bloqués par Chrome. Clique « Ouvrir le suivant », ou autorise les pop-ups une fois pour toutes.`
        : "Les 5 onglets sont ouverts. Bon tournage.",
    );
  };
  const openNext = () => {
    const [next, ...rest] = queue;
    if (!next) return;
    window.open(next.url, `tournage-${next.key}`);
    setQueue(rest);
  };

  /*
   * Fenetre Chrome a part : on ouvre une page de lancement dans une nouvelle
   * fenetre (taille de l'ecran), et c'est elle qui ouvre les autres adresses
   * en onglets chez elle. La fenetre de travail reste propre pour enregistrer.
   */
  const openInNewWindow = () => {
    const u = encodeURIComponent(JSON.stringify(links.map((l) => l.url)));
    const w = screen.availWidth || 1600;
    const h = screen.availHeight || 1000;
    const win = window.open(`/tournage/launch?u=${u}`, "tournage-window", `popup=yes,width=${w},height=${h},left=0,top=0`);
    if (!win) toast("Chrome a bloqué la nouvelle fenêtre : autorise les pop-ups pour mvdyprince.fr.", "err");
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
              <button className="btn btn-primary !h-[40px] !px-5 !text-[14px]" onClick={openAll} title="Ouvre les 5 pages en onglets">
                ▶ Tout ouvrir
              </button>
            </div>
            {queue.length > 0 ? (
              <div
                className="rounded-[10px] px-3.5 py-3 flex items-center gap-3 flex-wrap"
                style={{ background: "color-mix(in srgb, var(--warning) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--warning) 40%, transparent)" }}
              >
                <span className="text-[13px]">
                  Chrome a bloqué {queue.length} onglet{queue.length > 1 ? "s" : ""} : {queue.map((l) => l.label).join(", ")}.
                </span>
                <button className="btn btn-primary" onClick={openNext}>
                  Ouvrir le suivant ({queue[0].label})
                </button>
                <span className="dim text-[12px]">
                  Pour que tout s&apos;ouvre en un clic : icône « pop-up bloqué » à droite de la barre d&apos;adresse → « Toujours
                  autoriser sur mvdyprince.fr ».
                </span>
              </div>
            ) : (
              <InfoNote>
                Chrome n&apos;ouvre qu&apos;un onglet par clic tant que les pop-ups ne sont pas autorisés : au premier essai, clique
                sur l&apos;icône « pop-up bloqué » à droite de la barre d&apos;adresse et choisis « Toujours autoriser ». Ensuite, un
                clic ouvre les cinq.
              </InfoNote>
            )}
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

        <ProductPhoto
          onTitle={(t) => !product && set({ product: t })}
          onPrompts={(r) =>
            set({
              product: r.product || kit.product,
              ...(r.brandPrompt ? { claudePrompt: r.brandPrompt } : {}),
              higgsPrompt: r.imagePrompt,
              klingPrompt: r.videoPrompt,
            })
          }
        />

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

/**
 * Photo du produit AliExpress, pour Higgsfield.
 *
 * Colle le lien de la page ou de l'image ; ou copie l'image sur AliExpress
 * et fais Ctrl+V ici. Elle est gardee chez nous et se telecharge en un clic.
 */
interface GeneratedPrompts {
  product: string;
  brandPrompt: string;
  imagePrompt: string;
  videoPrompt: string;
}

function ProductPhoto({ onTitle, onPrompts }: { onTitle: (title: string) => void; onPrompts: (r: GeneratedPrompts) => void }) {
  const toast = useToast();
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [photo, setPhoto] = useState<{ url: string; name: string } | null>(null);
  /** Etat affiche dans le bloc : une notification seule passe inapercue. */
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);

  /**
   * L'IA regarde la photo et ecrit le nom du produit et les trois prompts.
   * Lancee automatiquement des qu'une photo arrive (collage ou lien) : pas de
   * bouton a trouver, et l'etat reste visible dans le bloc.
   */
  const generate = async (url: string) => {
    setThinking(true);
    setStatus({ text: "L'IA regarde la photo et écrit les prompts… 30 à 40 secondes." });
    try {
      const r = await api<GeneratedPrompts>("/api/tournage/prompts", { method: "POST", body: JSON.stringify({ url }) });
      onPrompts(r);
      setStatus({ text: `Prompts écrits pour « ${r.product || "ce produit"} » : ils sont dans les trois cartes en dessous.` });
      toast("Prompts écrits.");
    } catch (e) {
      setStatus({ text: `L'IA n'a pas répondu : ${(e as Error).message}. Clique « Réécrire les prompts » pour réessayer.`, error: true });
    } finally {
      setThinking(false);
    }
  };

  const grab = async () => {
    if (!link.trim()) return;
    setBusy(true);
    setStatus({ text: "Récupération de la photo…" });
    try {
      const r = await api<{ url: string; name: string; title?: string }>("/api/tournage/fetch", { method: "POST", body: JSON.stringify({ url: link }) });
      setPhoto({ url: r.url, name: r.name });
      if (r.title) onTitle(r.title);
      setBusy(false);
      await generate(r.url);
    } catch (e) {
      setStatus({ text: (e as Error).message, error: true });
      setBusy(false);
    }
  };

  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      const files = clipboardFiles(e).filter((f) => f.type.startsWith("image/"));
      if (!files.length) {
        // Rien d'image dans le presse-papier : on le dit, sinon on croit que ca n'a pas marche.
        const txt = e.clipboardData?.getData("text") ?? "";
        if (!txt.trim()) setStatus({ text: "Le presse-papier ne contient pas d'image. Sur AliExpress : clic droit sur la photo → « Copier l'image », puis Ctrl+V ici.", error: true });
        return;
      }
      e.preventDefault();
      setBusy(true);
      setStatus({ text: "Image collée, enregistrement…" });
      try {
        const up = await uploadFile(files[0]);
        setPhoto({ url: up.url, name: "produit-aliexpress.png" });
        setBusy(false);
        await generate(up.url);
      } catch (err) {
        setStatus({ text: (err as Error).message, error: true });
        setBusy(false);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Card title="Photo du produit" subtitle="Copie la photo sur AliExpress et Ctrl+V ici (ou colle son adresse). L'IA écrit aussitôt le produit, le prompt image 9:16 et le prompt vidéo.">
      {status && (
        <div
          className="rounded-[10px] px-3.5 py-2.5 mb-3 text-[13px] flex items-center gap-2"
          style={{
            background: status.error ? "color-mix(in srgb, var(--critical) 10%, transparent)" : "color-mix(in srgb, var(--accent) 10%, transparent)",
            border: `1px solid ${status.error ? "color-mix(in srgb, var(--critical) 40%, transparent)" : "color-mix(in srgb, var(--accent) 35%, transparent)"}`,
          }}
        >
          {(thinking || busy) && <span className="spinner" />}
          {status.text}
        </div>
      )}
      <div className="flex gap-2 items-end flex-wrap">
        <Field label="Lien AliExpress ou lien de l'image" className="flex-1 min-w-[260px]">
          <input
            className="input"
            placeholder="https://fr.aliexpress.com/item/… ou https://ae01.alicdn.com/kf/….jpg"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void grab()}
          />
        </Field>
        <button className="btn btn-primary" onClick={() => void grab()} disabled={busy || !link.trim()}>
          {busy ? <span className="spinner" /> : "Récupérer la photo"}
        </button>
      </div>
      {photo && (
        <div className="mt-3 flex items-center gap-4 flex-wrap">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo.url} alt="" className="rounded-[10px] object-cover" style={{ width: 120, height: 150, background: "var(--surface-3)" }} />
          <div className="flex flex-col gap-2">
            <button className="btn btn-primary" onClick={() => void generate(photo.url)} disabled={thinking} title="L'IA regarde la photo et écrit le produit, le prompt image 9:16 et le prompt vidéo">
              {thinking ? <span className="spinner" /> : "✨ Réécrire les prompts"}
            </button>
            <a className="btn" href={`${photo.url}?download=1&name=${encodeURIComponent(photo.name)}`} download>
              ⬇ Télécharger la photo
            </a>
            <a className="btn btn-ghost" href={photo.url} target="_blank" rel="noreferrer">
              Ouvrir en grand ↗
            </a>
            <span className="dim text-[11.5px]">Glisse-la ensuite dans Higgsfield avec le prompt 2.</span>
          </div>
        </div>
      )}
    </Card>
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
