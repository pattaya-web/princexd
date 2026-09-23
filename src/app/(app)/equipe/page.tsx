"use client";

import { EntityView } from "@/components/EntityView";
import { InfoNote } from "@/components/ui";
import { TEAM } from "@/lib/schemas";

export default function EquipePage() {
  return (
    <>
      <div className="mb-4">
        <InfoNote>
          La brique que tu montes pour te libérer : setters qui qualifient en DM, closers qui prennent les calls,
          monteur qui traite les rushs. Le monteur ajouté ici doit aussi recevoir le code d&apos;accès défini dans
          Réglages — il n&apos;ouvre que le board Montage, rien d&apos;autre du tool.
        </InfoNote>
      </div>
      <EntityView
        spec={TEAM}
        title="Équipe"
      />
    </>
  );
}
