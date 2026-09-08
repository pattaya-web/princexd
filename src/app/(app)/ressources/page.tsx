"use client";

import { EntityView } from "@/components/EntityView";
import { RESOURCES } from "@/lib/schemas";

export default function RessourcesPage() {
  return (
    <EntityView
      spec={RESOURCES}
      title="Ressources"
      subtitle="Ta bibliothèque : templates, docs, outils, formations. Tout ce que tu ne veux pas rechercher deux fois."
    />
  );
}
