"use client";

import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { NewStudentChat } from "@/components/NewStudentChat";

/** L'assistant en grand. Le même assistant vit dans la bulle en bas à droite de toutes les pages. */
export default function NouvelElevePage() {
  return (
    <div>
      <PageHeader
        title="Assistant"
        subtitle="Un élève à ajouter, un chiffre à vérifier (encaissé, reels à tourner, vidéos prêtes), un reel à mettre dans le swipe file : dis-le, il s'en occupe."
        actions={
          <>
            <Link href="/eleves/onboarding" className="btn btn-sm btn-ghost">
              Message d&apos;onboarding
            </Link>
            <Link href="/sales/dashboard" className="btn btn-sm btn-ghost">
              Sales Dashboard
            </Link>
          </>
        }
      />
      <div className="max-w-[760px] mx-auto">
        <NewStudentChat variant="page" />
      </div>
    </div>
  );
}
