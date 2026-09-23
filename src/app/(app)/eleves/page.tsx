"use client";

import { EntityView } from "@/components/EntityView";
import { StatTile } from "@/components/ui";
import { STUDENTS } from "@/lib/schemas";
import { fmtEur, fmtInt } from "@/lib/format";
import type { Student } from "@/lib/types";

export default function ElevesPage() {
  return (
    <EntityView
      spec={STUDENTS}
      title="Élèves"
      summary={(rows) => {
        const students = rows as unknown as Student[];
        const actifs = students.filter((s) => s.status === "actif" || s.status === "onboarding");
        const ca = students.reduce((a, s) => a + (s.price || 0), 0);
        const encaisse = students.reduce((a, s) => a + (s.paid || 0), 0);
        const withResult = students.filter((s) => s.result?.trim());
        return (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile label="Élèves actifs" value={fmtInt(actifs.length)} hint={`${students.length} au total`} />
            <StatTile label="CA signé" value={fmtEur(ca)} />
            <StatTile
              label="Reste à encaisser"
              value={fmtEur(ca - encaisse)}
              hint={`${fmtEur(encaisse)} déjà encaissés`}
              accent={ca - encaisse > 0 ? "var(--warning)" : undefined}
            />
            <StatTile
              label="Preuves dispo"
              value={fmtInt(withResult.length)}
              accent="var(--good)"
            />
          </div>
        );
      }}
    />
  );
}
