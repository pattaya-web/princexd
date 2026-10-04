"use client";

import { TodoList } from "@/components/TodoDock";
import { Card, PageHeader } from "@/components/ui";

/**
 * La to-do en pleine page. C'est la meme liste que le panneau flottant
 * (bouton TODO en haut de chaque page) : cocher, prioriser, reordonner,
 * colorer, decrire, annoter, photographier.
 */
export default function TodoPage() {
  return (
    <>
      <PageHeader
        title="To-do"
        subtitle="La même liste que le bouton TODO en haut de l'écran. Glisse la poignée ⋮⋮ pour réordonner, ouvre une tâche pour sa description, ses notes et ses photos."
      />
      <Card>
        <div style={{ minHeight: 420 }}>
          <TodoList />
        </div>
      </Card>
    </>
  );
}
