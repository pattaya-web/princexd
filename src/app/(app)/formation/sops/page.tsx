"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { Empty, ErrorNote, Spinner } from "@/components/ui";
import { LessonGuides } from "@/components/formation/LessonGuides";
import { PortalFooter } from "@/components/formation/portal";
import type { CourseResourcesPayload } from "@/app/api/formation/resources/route";

/**
 * Ressources (Scale X) : les guides PDF du cours, étape par étape (ex-page
 * Education, fusionnée ici en octobre 2026), puis les PDF complémentaires
 * déposés par Mady. Les vidéos sont sur les pages du parcours ; ici, le
 * détail écrit.
 */

function fmtSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
  return `${(bytes / (1024 * 1024)).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`;
}

export default function RessourcesElevePage() {
  const [data, setData] = useState<CourseResourcesPayload | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    api<CourseResourcesPayload>("/api/formation/resources")
      .then(setData)
      .catch((e) => setError((e as Error).message));
  }, []);

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Spinner label="Chargement des ressources…" />;

  const q = query.trim().toLowerCase();
  const rows = data.resources.filter((r) => r.studentVisible !== false && (!q || r.title.toLowerCase().includes(q)));

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] sm:text-[34px] font-semibold leading-tight" style={{ letterSpacing: "-0.03em" }}>
            Ressources
          </h1>
          <p className="muted text-[14px] mt-1 max-w-[64ch]">Les vidéos sont sur chaque page du parcours. Ici, les étapes détaillées en PDF : les guides du cours dans l&apos;ordre, puis les PDF complémentaires (procédures, checklists, modèles).</p>
        </div>
        <div className="flex items-center gap-2">
          {data.resources.length > 4 && <input className="input !h-[34px] w-[220px] max-w-full text-[13px]" placeholder="Rechercher…" value={query} onChange={(e) => setQuery(e.target.value)} />}
        </div>
      </header>

      <LessonGuides />

      <div className="label-xs mt-2" style={{ letterSpacing: "0.12em" }}>
        02 / PDF COMPLÉMENTAIRES
      </div>
      {rows.length === 0 ? (
        <Empty>{q ? `Aucune ressource ne correspond à « ${query} ».` : "Aucun PDF complémentaire pour l'instant."}</Empty>
      ) : (
        <ul className="card divide-y" style={{ borderColor: "var(--border)" }}>
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 sm:px-5 py-3" style={{ borderColor: "var(--border)" }}>
              <span className="shrink-0 w-[42px] h-[42px] rounded-[9px] flex items-center justify-center text-[11px] font-bold tracking-wide" style={{ background: "color-mix(in srgb, #e5484d 14%, transparent)", color: "#e5484d" }} aria-hidden>
                PDF
              </span>
              <div className="flex-1 min-w-[180px]">
                <div className="text-[14.5px] font-semibold leading-tight">{r.title}</div>
                <div className="dim text-[12px] mt-0.5">{fmtSize(r.size)}</div>
              </div>
              <div className="flex items-center gap-1.5">
                <a href={r.viewUrl} target="_blank" rel="noreferrer" className="btn btn-sm btn-primary">
                  Ouvrir
                </a>
                <a href={r.downloadUrl} download={r.fileName} className="btn btn-sm btn-ghost">
                  Télécharger
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}

      <PortalFooter quote="Plus vite tu lances, plus vite tu apprends. Le reste, c'est de l'optimisation." author="Mady" />
    </div>
  );
}
