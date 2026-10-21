"use client";

import { useEffect, useState } from "react";
import { Card, Field, InfoNote, Modal, PageHeader, Spinner } from "@/components/ui";
import { CosShell } from "@/components/content-os/CosShell";
import { useContentOs } from "@/components/content-os/useContentOs";
import { ROADMAP_URL } from "@/lib/content-os";
import type { CosProject, CosResource } from "@/lib/types";

const STATUS_LABEL: Record<CosProject["status"], string> = { done: "Terminé", doing: "En cours", todo: "À venir" };

/* Ressources Isma (liens modifiables, aucun lien inventé) et mes chantiers (statuts modifiables). */
export default function ContentOsResources() {
  const { state, loading, patchState } = useContentOs();
  const [editRes, setEditRes] = useState<CosResource | null>(null);
  const [projects, setProjects] = useState<CosProject[]>([]);
  const [projectsDirty, setProjectsDirty] = useState(false);
  const [newProject, setNewProject] = useState("");

  useEffect(() => {
    if (!projectsDirty) setProjects([...state.projects].sort((a, b) => a.order - b.order));
  }, [state.projects, projectsDirty]);

  const roadmap = state.resources.find((r) => r.id === "roadmap");
  const others = state.resources.filter((r) => r.id !== "roadmap");

  async function saveResource() {
    if (!editRes) return;
    const next = state.resources.map((r) => (r.id === editRes.id ? editRes : r));
    await patchState({ resources: next });
    setEditRes(null);
  }

  function setStatus(id: string, status: CosProject["status"]) {
    const next = projects.map((p) => (p.id === id ? { ...p, status } : p));
    setProjects(next);
    void patchState({ projects: next });
  }

  function removeProject(id: string) {
    const next = projects.filter((p) => p.id !== id);
    setProjects(next);
    void patchState({ projects: next });
  }

  function addProject() {
    const title = newProject.trim();
    if (!title) return;
    const next = [...projects, { id: `p${Date.now()}`, title, status: "todo" as const, order: projects.length + 1 }];
    setProjects(next);
    setNewProject("");
    void patchState({ projects: next });
  }

  return (
    <CosShell>
      <PageHeader title="Ressources & roadmap" subtitle="Tout ce qu'Isma a fourni, au même endroit, et l'état de mes chantiers." />

      {loading ? (
        <Spinner label="Chargement…" />
      ) : (
        <div className="grid gap-5">
          <div className="card p-5 flex items-center justify-between gap-3 flex-wrap" style={{ borderColor: "var(--accent-ring)", background: "var(--accent-soft)" }}>
            <div>
              <div className="font-semibold text-[15px]">ROADMAP OFFICIELLE D&apos;ISMA</div>
              <div className="dim text-[12.5px] mono truncate" style={{ maxWidth: 520 }}>
                {roadmap?.url || ROADMAP_URL}
              </div>
            </div>
            <a className="btn btn-primary" href={roadmap?.url || ROADMAP_URL} target="_blank" rel="noreferrer">
              Ouvrir la roadmap
            </a>
          </div>

          <Card title="Ressources Isma" subtitle="Les cases vides le restent tant que tu n'as pas le lien : rien n'est inventé.">
            <ul className="grid gap-2 sm:grid-cols-2">
              {others.map((r) => (
                <li key={r.id} className="rounded-xl p-3 flex flex-col gap-1" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-[13.5px]">{r.label}</span>
                    <button className="btn btn-sm btn-ghost" onClick={() => setEditRes({ ...r })}>
                      Modifier
                    </button>
                  </div>
                  {r.url ? (
                    <a className="mono text-[12px] truncate" style={{ color: "var(--accent)" }} href={r.url} target={r.url.startsWith("/") ? undefined : "_blank"} rel="noreferrer">
                      {r.url}
                    </a>
                  ) : (
                    <span className="dim text-[12px]">Pas encore de lien.</span>
                  )}
                  {r.notes && <span className="dim text-[12px] whitespace-pre-wrap">{r.notes}</span>}
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Mes chantiers" subtitle="Statuts modifiables. Ajoute, termine, retire.">
            <div className="grid gap-4 sm:grid-cols-3">
              {(["doing", "todo", "done"] as const).map((st) => (
                <div key={st}>
                  <div className="label-xs mb-1.5">
                    {STATUS_LABEL[st]} · {projects.filter((p) => p.status === st).length}
                  </div>
                  <ul className="grid gap-1.5">
                    {projects
                      .filter((p) => p.status === st)
                      .map((p) => (
                        <li key={p.id} className="rounded-xl px-3 py-2 flex items-center gap-2" style={{ background: st === "done" ? "var(--surface-3)" : "var(--surface-2)", border: "1px solid var(--border)" }}>
                          <span className="text-[13px] flex-1" style={{ textDecoration: st === "done" ? "line-through" : "none", color: st === "done" ? "var(--text-2)" : "var(--text)" }}>
                            {p.title}
                          </span>
                          <select className="select select-sm !w-auto" value={p.status} onChange={(e) => setStatus(p.id, e.target.value as CosProject["status"])}>
                            <option value="todo">À venir</option>
                            <option value="doing">En cours</option>
                            <option value="done">Terminé</option>
                          </select>
                          <button className="btn btn-sm btn-ghost" title="Retirer" onClick={() => removeProject(p.id)}>
                            ✕
                          </button>
                        </li>
                      ))}
                  </ul>
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-4">
              <input
                className="input"
                placeholder="Nouveau chantier…"
                value={newProject}
                onChange={(e) => setNewProject(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addProject();
                }}
              />
              <button className="btn btn-sm" onClick={addProject} disabled={!newProject.trim()}>
                Ajouter
              </button>
            </div>
          </Card>

          <InfoNote>La routine de production hebdomadaire (checklist, historique) est dans l&apos;onglet Pipeline, sous le tableau.</InfoNote>
        </div>
      )}

      <Modal
        open={Boolean(editRes)}
        onClose={() => setEditRes(null)}
        title={editRes?.label ?? ""}
        footer={
          <div className="flex justify-end w-full">
            <button className="btn btn-sm btn-primary" onClick={saveResource}>
              Enregistrer
            </button>
          </div>
        }
      >
        {editRes && (
          <div className="grid gap-3">
            <Field label="Lien">
              <input className="input mono" value={editRes.url} placeholder="https://…" onChange={(e) => setEditRes({ ...editRes, url: e.target.value })} />
            </Field>
            <Field label="Notes">
              <textarea className="textarea" style={{ minHeight: 100 }} value={editRes.notes} onChange={(e) => setEditRes({ ...editRes, notes: e.target.value })} />
            </Field>
          </div>
        )}
      </Modal>
    </CosShell>
  );
}
