"use client";

import Link from "next/link";
import { EntityView } from "@/components/EntityView";
import { StatTile } from "@/components/ui";
import { STUDENTS } from "@/lib/schemas";
import { fmtInt } from "@/lib/format";
import type { Student } from "@/lib/types";

/**
 * Fiches eleves : l'onboarding tient en quatre champs (nom prenom, email,
 * contrat signe, date du contrat). L'acces a la plateforme de formation se
 * donne ensuite dans Formation → Accès élèves.
 */
export default function ElevesPage() {
  return (
    <EntityView
      spec={STUDENTS}
      title="Élèves"
      summary={(rows) => {
        const students = rows as unknown as Student[];
        const signed = students.filter((s) => s.contractSigned);
        const withAccess = students.filter((s) => s.portalAccess);
        return (
          <div className="flex flex-wrap items-start gap-3">
            <div className="grid grid-cols-3 gap-3 flex-1 min-w-[280px]">
              <StatTile label="Élèves" value={fmtInt(students.length)} />
              <StatTile
                label="Contrats signés"
                value={fmtInt(signed.length)}
                hint={students.length - signed.length > 0 ? `${students.length - signed.length} en attente` : undefined}
                accent={students.length - signed.length > 0 ? "var(--warning)" : "var(--good)"}
              />
              <StatTile label="Accès plateforme" value={fmtInt(withAccess.length)} hint="ouverts" />
            </div>
            <Link href="/formation/eleves" className="btn btn-sm self-center">
              Gérer les accès à la formation
            </Link>
          </div>
        );
      }}
    />
  );
}
