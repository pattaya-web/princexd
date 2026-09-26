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
          monteur qui traite les rushs. Un monteur ajouté ici se connecte avec son identifiant et son mot de passe ;
          sans compte, le code d&apos;accès défini dans Réglages suffit. Dans les deux cas il n&apos;ouvre que ses
          vidéos à monter et le Studio IA, rien d&apos;autre du tool.
        </InfoNote>
      </div>
      <EntityView
        spec={TEAM}
        title="Équipe"
      />
    </>
  );
}
