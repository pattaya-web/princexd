"use client";

import { useToast } from "./ui";

/**
 * Copie un lien dans le presse-papiers. Dans l'app de bureau (Edge en mode
 * application) il n'y a pas de barre d'adresse : sans ce bouton, impossible
 * de recuperer l'URL d'un Reel pour la coller ailleurs.
 */
export function CopyLinkButton({ url, label = "Copier le lien", className = "btn btn-sm", title = "Copier le lien du Reel", style }: { url: string; label?: string; className?: string; title?: string; style?: React.CSSProperties }) {
  const toast = useToast();
  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(url);
      toast("Lien copié.");
    } catch {
      // Presse-papiers refuse (http, iframe) : on montre le lien a selectionner.
      window.prompt("Copie ce lien :", url);
    }
  };
  return (
    <button type="button" className={className} style={style} onClick={(e) => void copy(e)} title={title}>
      {label}
    </button>
  );
}
