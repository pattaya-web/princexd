"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Page de lancement du kit tournage, ouverte dans une fenetre Chrome a part.
 *
 * Elle recoit la liste des adresses, ouvre les suivantes en onglets dans sa
 * propre fenetre, puis se remplace elle-meme par la premiere (Claude). Si
 * Chrome bloque l'ouverture automatique, un bouton fait le meme travail au
 * clic, qui lui est toujours autorise.
 */
function Launcher() {
  const params = useSearchParams();
  const [urls, setUrls] = useState<string[]>([]);
  const [left, setLeft] = useState<string[]>([]);
  const [done, setDone] = useState(false);

  useEffect(() => {
    try {
      const list = JSON.parse(params.get("u") ?? "[]") as string[];
      setUrls(list.filter((u) => /^https:\/\//.test(u)));
    } catch {
      setUrls([]);
    }
  }, [params]);

  const launch = (list: string[]) => {
    const [first, ...rest] = list;
    const blocked: string[] = [];
    for (const u of rest) {
      if (!window.open(u, "_blank")) blocked.push(u);
    }
    setLeft(blocked);
    if (!blocked.length && first) {
      setDone(true);
      window.location.replace(first);
    }
  };

  // Tentative automatique : passe si les pop-ups sont autorises pour le site.
  useEffect(() => {
    if (urls.length) launch(urls);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urls]);

  return (
    <div className="min-h-screen grid place-items-center p-6" style={{ background: "var(--bg)", color: "var(--text)" }}>
      <div className="card p-6 max-w-[520px] w-full flex flex-col gap-3">
        <h1 className="text-[18px] font-semibold">Kit tournage</h1>
        {!urls.length ? (
          <p className="dim text-[13px]">Aucune adresse à ouvrir. Ferme cette fenêtre et reclique « Tout ouvrir ».</p>
        ) : done ? (
          <p className="dim text-[13px]">Ouverture de Claude…</p>
        ) : left.length ? (
          <>
            <p className="text-[13px]">
              Chrome a bloqué {left.length} onglet{left.length > 1 ? "s" : ""} dans cette fenêtre. Un clic suffit :
            </p>
            <button className="btn btn-primary" onClick={() => launch([urls[0], ...left])}>
              Ouvrir les {left.length} onglet{left.length > 1 ? "s" : ""} restant{left.length > 1 ? "s" : ""} ici
            </button>
            <p className="dim text-[12px]">
              Pour ne plus voir ce message : icône « pop-up bloqué » à droite de la barre d&apos;adresse → « Toujours autoriser ».
            </p>
          </>
        ) : (
          <button className="btn btn-primary" onClick={() => launch(urls)}>
            Ouvrir les {urls.length} onglets dans cette fenêtre
          </button>
        )}
      </div>
    </div>
  );
}

export default function LaunchPage() {
  return (
    <Suspense fallback={null}>
      <Launcher />
    </Suspense>
  );
}
