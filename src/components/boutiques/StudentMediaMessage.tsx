"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { Card, useToast } from "@/components/ui";

/**
 * Le message « médias » à envoyer à l'élève après la génération : méthode
 * (image de référence → Higgsfield GPT Image 2 → prompts écrits par Claude →
 * bons ratios), liste des images du template avec leur ratio, et le prompt
 * qu'il doit donner à Claude. Texte modifiable avant de copier.
 */
export function StudentMediaMessage({ brandName, hasTheme }: { brandName: string; hasTheme: boolean }) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<{ message: string }>(`/api/boutiques/theme/media?brand=${encodeURIComponent(brandName)}`);
      setText(r.message);
      setLoaded(true);
    } catch (e) {
      toast((e as Error).message, "err");
    }
  }, [brandName, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast("Message copié : colle-le à ton élève.");
    } catch {
      window.prompt("Copie ce message :", text);
    }
  }

  return (
    <Card
      title="Message élève : médias de la boutique"
      subtitle={
        hasTheme
          ? "Prêt à coller : méthode Higgsfield (GPT Image 2) + Claude pour les prompts, liste des images du template avec leur ratio, prompt à donner à Claude."
          : "Dépose le zip du template pour que la liste des images (nombre, ratios) soit exacte. La méthode est déjà là."
      }
      actions={
        <div className="flex gap-1.5">
          <button className="btn btn-sm" onClick={() => setOpen((v) => !v)}>
            {open ? "Replier" : "Voir / modifier"}
          </button>
          <button className="btn btn-sm btn-primary" onClick={copy} disabled={!loaded}>
            Copier le message
          </button>
        </div>
      }
    >
      {open ? (
        <textarea className="textarea mono text-[12px]" style={{ minHeight: 420 }} value={text} onChange={(e) => setText(e.target.value)} />
      ) : (
        <div className="dim text-[12.5px]">
          {loaded ? `${text.split("\n").length} lignes · remplace [prénom] et les crochets du prompt avant d'envoyer.` : "Préparation du message…"}
        </div>
      )}
    </Card>
  );
}
