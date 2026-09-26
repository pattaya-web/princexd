"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useCollection } from "@/lib/client";
import { MontageDrive } from "@/components/MontageDrive";
import { PageHeader } from "@/components/ui";
import type { EditJob } from "@/lib/types";

/**
 * Espace du monteur, dans le Shell comme le Studio IA : même menu, même
 * en-tête, un seul univers. Le cloisonnement est fait par le middleware
 * (un monteur ne voit que /monteur et /studio) ; en ligne, un visiteur sans
 * session est renvoyé vers /login avant d'arriver ici.
 *
 * La page parle à un monteur de 17 ans qui découvre le tool : trois gestes,
 * dans l'ordre, puis les dossiers.
 */

function Step({ n, title, children, action }: { n: number; title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="card-flat p-4 flex flex-col gap-2">
      <div className="flex items-center gap-2.5">
        <span
          className="grid place-items-center shrink-0 rounded-full mono text-[12px] font-semibold"
          style={{ width: 26, height: 26, background: "var(--accent)", color: "var(--accent-on)" }}
        >
          {n}
        </span>
        <h3 className="text-[14px] font-semibold leading-tight">{title}</h3>
      </div>
      <p className="text-[12.5px] leading-relaxed" style={{ color: "var(--text-2)" }}>{children}</p>
      {action && <div className="mt-auto pt-1">{action}</div>}
    </div>
  );
}

export default function MonteurPage() {
  const { rows } = useCollection<EditJob>("edits");

  const counts = useMemo(() => {
    const aMonter = rows.filter((j) => j.status === "a-monter").length;
    const enCours = rows.filter((j) => j.status === "en-cours").length;
    const retouches = rows.filter((j) => j.status === "retouches").length;
    return { aMonter, enCours, retouches, todo: aMonter + enCours + retouches };
  }, [rows]);

  const subtitle =
    counts.todo === 0
      ? "Rien à monter pour l'instant. Les nouveaux dossiers apparaissent ici dès que Mady dépose des rushs."
      : `${counts.todo} vidéo${counts.todo > 1 ? "s" : ""} à monter` +
        (counts.retouches ? ` dont ${counts.retouches} en retouches` : "") +
        ". Ouvre un dossier pour commencer.";

  return (
    <>
      <PageHeader
        title="Espace monteur"
        subtitle={subtitle}
        actions={
          <Link href="/studio?kind=swap" className="btn btn-primary">
            ✦ Studio IA · Swap vidéo
          </Link>
        }
      />

      <div className="grid sm:grid-cols-3 gap-3 mb-6">
        <Step n={1} title="Ouvre un dossier « À monter »">
          Tu y trouves les rushs à télécharger, l&apos;inspiration à reproduire et les consignes. Clique sur
          <strong> Je commence le montage</strong> pour que Mady sache que tu es dessus.
        </Step>
        <Step
          n={2}
          title="Monte, et change la personne si besoin"
          action={
            <Link href="/studio?kind=swap" className="btn btn-sm">
              Ouvrir le Swap vidéo →
            </Link>
          }
        >
          Pour remplacer le visage ou la personne d&apos;un rush : <strong>Studio IA → Swap vidéo</strong>. Tu mets la
          vidéo, la photo du personnage, tu cliques Transformer, puis tu télécharges le rendu et tu montes avec.
        </Step>
        <Step n={3} title="Dépose ta vidéo finie">
          Dans le dossier, section <strong>Montage livré</strong>. Il passe tout seul en « Livrée ». Si Mady demande
          des retouches, le dossier revient dans « À monter » avec un badge <strong>Retouches</strong> et son commentaire.
        </Step>
      </div>

      <MontageDrive role="editor" />
    </>
  );
}
