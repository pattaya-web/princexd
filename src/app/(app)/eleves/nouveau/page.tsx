"use client";

import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { NewStudentChat } from "@/components/NewStudentChat";

/** Le chat « Nouvel élève » en grand. Le même assistant vit dans la bulle en bas à droite de toutes les pages. */
export default function NouvelElevePage() {
  return (
    <div>
      <PageHeader
        title="Nouvel élève"
        subtitle="Dis-moi qui vient de rejoindre, le montant, comment il paie et d'où il vient. Je remplis le CRM, la vente, la fiche élève et son accès."
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
