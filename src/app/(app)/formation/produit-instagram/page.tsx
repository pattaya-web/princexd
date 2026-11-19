"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { ErrorNote, Spinner } from "@/components/ui";
import { StepGate } from "@/components/formation/StepGate";
import { PortalFooter, SectionLabel } from "@/components/formation/portal";
import { MethodVideoLesson } from "@/components/formation/VideoLesson";
import type { MethodPayload } from "@/app/api/formation/methode/route";

/**
 * Recherche produit · Instagram (Scale X) : la deuxième stratégie de
 * recherche produit de Mady, celle qu'il utilise au quotidien. Elle vient
 * après la boutique (et la vidéo « Avant de commencer »), en complément de la
 * première méthode sur BrandSearch (onglet Recherche produit · BrandSearch).
 * Le lien, le résumé et les étapes de la vidéo se modifient sur place par l'admin.
 */
export default function ProduitInstagramPage() {
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
    <StepGate tab="instagram">
      <div className="flex flex-col gap-5">
        <header>
          <div className="label-xs" style={{ letterSpacing: "0.12em" }}>
            Scale X / Recherche produit · Instagram
          </div>
          <h1 className="text-[28px] sm:text-[34px] font-semibold leading-tight mt-2" style={{ letterSpacing: "-0.03em" }}>
            La deuxième stratégie de recherche produit : Instagram.
          </h1>
          <p className="muted text-[14px] mt-1 max-w-[64ch]">
            C&apos;est la méthode que Mady utilise au quotidien pour trouver ses produits. La première méthode, avec les filtres BrandSearch, reste dans l&apos;onglet{" "}
            <Link href="/formation/produit" className="underline">
              Recherche produit · BrandSearch
            </Link>
            .
          </p>
          {data.preview && <div className="badge badge-warn w-fit !text-[11.5px] mt-3">Aperçu : tu vois Scale X comme {data.student?.name}.</div>}
        </header>

        <MethodVideoLesson
          lesson="instagram"
          n="01"
          title="Stratégie de recherche produit sur Instagram"
          intro="Regarde la vidéo en entier une première fois, puis refais chaque étape avec ton compte Instagram. Les produits que tu trouves, tu les ajoutes à ton tableau et tu les envoies à Mady sur WhatsApp, comme pour BrandSearch."
          placeholder="La vidéo arrive bientôt."
        />

        <section className="card p-5">
          <SectionLabel n="02" title="Deux méthodes, un seul but : un produit qui se vend déjà" />
          <div className="grid gap-3 mt-3 sm:grid-cols-2">
            <div className="rounded-md p-3.5" style={{ background: "var(--surface-2)" }}>
              <div className="text-[14px] font-semibold">BrandSearch (méthode 1)</div>
              <p className="muted text-[13px] mt-1 leading-relaxed">Les filtres de Mady, les boutiques qui scalent, les pubs actives. C&apos;est par là que tu as trouvé ton premier produit.</p>
              <Link href="/formation/produit" className="btn btn-sm mt-3">
                Recherche produit · BrandSearch →
              </Link>
            </div>
            <div className="rounded-md p-3.5" style={{ background: "var(--surface-2)", border: "1px solid var(--accent-ring)" }}>
              <div className="text-[14px] font-semibold">Instagram (méthode 2, celle de Mady)</div>
              <p className="muted text-[13px] mt-1 leading-relaxed">Celle de la vidéo ci-dessus : tu la gardes en routine pour trouver tes prochains produits et nourrir ta boutique.</p>
              <Link href="/formation/meta" className="btn btn-sm mt-3">
                Étape suivante : Campagnes Meta →
              </Link>
            </div>
          </div>
        </section>

        <PortalFooter quote="Le produit fait 80 % du résultat. Deux méthodes pour le trouver, une seule règle : il se vend déjà." author="Mady" />
      </div>
    </StepGate>
  );
}
