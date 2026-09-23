"use client";

import { EntityView } from "@/components/EntityView";
import { RESOURCES } from "@/lib/schemas";

export default function RessourcesPage() {
  return (
    <EntityView
      spec={RESOURCES}
      title="Ressources"
    />
  );
}
