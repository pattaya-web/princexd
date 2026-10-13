"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client";
import { Card, Empty, ErrorNote, PageHeader, Spinner, useToast } from "@/components/ui";
import { DropZone, ProgressBar, type Progress } from "@/components/upload-ui";
import type { CourseResourceRow } from "@/lib/formation-resources";
import type { CourseResourcesPayload } from "@/app/api/formation/resources/route";

/**
 * Ressources formation (admin).
 *
 * Toutes les annexes PDF de la formation au meme endroit : on les depose en
 * glisser-deposer (n'importe ou sur la page, ou dans la zone), puis on
 * telecharge celle dont l'eleve a besoin pour la lui envoyer. Rien n'est
 * montre aux eleves : c'est la reserve de l'admin.
 */

const MAX_MB = 50;

const isPdf = (f: File) => /\.pdf$/i.test(f.name) || f.type === "application/pdf";

function fmtSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
  return `${(bytes / (1024 * 1024)).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`;
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });

/** Envoi d'un PDF avec progression (XHR : fetch ne sait pas encore la donner). */
function uploadPdf(file: File, onProgress: (fraction: number) => void): Promise<CourseResourcesPayload> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/formation/resources");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onerror = () => reject(new Error("Connexion au serveur impossible. Vérifie ta connexion et réessaie."));
    xhr.onload = () => {
      let body: { error?: string } & Partial<CourseResourcesPayload> = {};
      try {
        body = JSON.parse(xhr.responseText || "{}");
      } catch {
        // Reponse vide ou non JSON : traitee comme une erreur ci-dessous.
      }
      if (xhr.status >= 200 && xhr.status < 300 && body.resources) resolve(body as CourseResourcesPayload);
      else reject(new Error(body.error ?? `Erreur ${xhr.status}`));
    };
    const form = new FormData();
    form.append("file", file, file.name);
    xhr.send(form);
  });
}

export default function RessourcesFormationPage() {
  const toast = useToast();
  const [rows, setRows] = useState<CourseResourceRow[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [progress, setProgress] = useState<Progress | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [busyId, setBusyId] = useState("");
  const [pageOver, setPageOver] = useState(false);
  const dragDepth = useRef(0);
  const uploading = useRef(false);

  const load = useCallback(async () => {
    try {
      const r = await api<CourseResourcesPayload>("/api/formation/resources");
      setRows(r.resources);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const upload = useCallback(
    async (files: File[]) => {
      if (uploading.current) {
        toast("Un envoi est déjà en cours : attends qu'il se termine.");
        return;
      }
      const pdfs = files.filter(isPdf);
      const skipped = files.length - pdfs.length;
      if (skipped) toast(`${skipped} fichier${skipped > 1 ? "s" : ""} ignoré${skipped > 1 ? "s" : ""} : seuls les PDF sont acceptés.`, "err");
      if (!pdfs.length) return;
      uploading.current = true;
      let added = 0;
      try {
        for (let i = 0; i < pdfs.length; i++) {
          const f = pdfs[i];
          const p = { name: f.name, index: i + 1, total: pdfs.length };
          if (f.size > MAX_MB * 1024 * 1024) {
            toast(`« ${f.name} » dépasse ${MAX_MB} Mo : ignoré.`, "err");
            continue;
          }
          setProgress({ ...p, fraction: 0 });
          try {
            const r = await uploadPdf(f, (fraction) => setProgress({ ...p, fraction }));
            setRows(r.resources);
            added += 1;
          } catch (e) {
            toast(`« ${f.name} » : ${(e as Error).message}`, "err");
          }
        }
      } finally {
        uploading.current = false;
        setProgress(null);
      }
      if (added) toast(added === 1 ? "PDF ajouté." : `${added} PDF ajoutés.`);
    },
    [toast],
  );

  /*
   * Glisser-deposer sur toute la page, pas seulement dans la zone : on lache
   * le fichier ou on veut. Le navigateur, lui, ouvrirait le PDF a la place.
   */
  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current += 1;
      setPageOver(true);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setPageOver(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setPageOver(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) void upload(files);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [upload]);

  const saveTitle = async () => {
    if (!renaming) return;
    const title = renaming.title.trim();
    const current = rows?.find((r) => r.id === renaming.id);
    if (!title || !current || title === current.title) {
      setRenaming(null);
      return;
    }
    setBusyId(renaming.id);
    try {
      const updated = await api<CourseResourceRow>(`/api/formation/resources/${renaming.id}`, { method: "PATCH", body: JSON.stringify({ title }) });
      setRows((rs) => (rs ?? []).map((r) => (r.id === updated.id ? updated : r)));
      setRenaming(null);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusyId("");
    }
  };

  const remove = async (r: CourseResourceRow) => {
    if (!window.confirm(`Supprimer « ${r.title} » ?\nLe PDF sera effacé du CRM.`)) return;
    setBusyId(r.id);
    try {
      await api(`/api/formation/resources/${r.id}`, { method: "DELETE" });
      setRows((rs) => (rs ?? []).filter((x) => x.id !== r.id));
      toast("Annexe supprimée.");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusyId("");
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!rows) return [];
    if (!q) return rows;
    return rows.filter((r) => r.title.toLowerCase().includes(q) || r.fileName.toLowerCase().includes(q));
  }, [rows, query]);

  const totalSize = useMemo(() => (rows ?? []).reduce((s, r) => s + r.size, 0), [rows]);

  return (
    <div className="relative">
      {pageOver && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none"
          style={{ background: "color-mix(in srgb, var(--accent) 10%, transparent)", backdropFilter: "blur(2px)" }}
        >
          <div className="card px-8 py-6 text-center" style={{ border: "2px dashed var(--accent)" }}>
            <div className="text-[18px] font-semibold">Lâche tes PDF ici</div>
            <div className="dim text-[13px] mt-1">Ils seront ajoutés aux ressources de la formation.</div>
          </div>
        </div>
      )}

      <PageHeader
        title="Ressources formation"
        subtitle="Toutes tes annexes PDF au même endroit. Dépose-les ici, puis télécharge celle dont ton élève a besoin pour la lui envoyer."
        actions={
          rows && rows.length > 0 ? (
            <span className="dim text-[12.5px]">
              {rows.length} PDF · {fmtSize(totalSize)}
            </span>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-4">
        <DropZone
          label="Dépose tes PDF ici, ou clique pour les choisir"
          hint={`PDF uniquement · ${MAX_MB} Mo max par fichier · plusieurs fichiers à la fois`}
          accept="application/pdf,.pdf"
          disabled={Boolean(progress)}
          onFiles={(files) => void upload(files)}
        />
        {progress && <ProgressBar p={progress} />}

        {error && <ErrorNote>{error}</ErrorNote>}

        {!rows && !error && <Spinner label="Chargement des ressources…" />}

        {rows && rows.length === 0 && !error && (
          <Empty>Aucune annexe pour l&apos;instant. Glisse un PDF sur la page : il apparaîtra ici, prêt à être envoyé à un élève.</Empty>
        )}

        {rows && rows.length > 0 && (
          <Card
            title="Annexes"
            subtitle="Les plus récentes en premier. « Télécharger » rend le fichier sous son nom d'origine."
            actions={
              rows.length > 4 ? (
                <input
                  className="input !h-[34px] w-[220px] max-w-full text-[13px]"
                  placeholder="Rechercher une annexe…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              ) : undefined
            }
            padded={false}
          >
            {filtered.length === 0 ? (
              <div className="p-5">
                <Empty>Aucune annexe ne correspond à « {query} ».</Empty>
              </div>
            ) : (
              <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
                {filtered.map((r) => {
                  const isRenaming = renaming?.id === r.id;
                  const busy = busyId === r.id;
                  return (
                    <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 sm:px-5 py-3" style={{ borderColor: "var(--border)" }}>
                      <span
                        className="shrink-0 w-[42px] h-[42px] rounded-[9px] flex items-center justify-center text-[11px] font-bold tracking-wide"
                        style={{ background: "color-mix(in srgb, #e5484d 14%, transparent)", color: "#e5484d" }}
                        aria-hidden
                      >
                        PDF
                      </span>
                      <div className="flex-1 min-w-[200px]">
                        {isRenaming ? (
                          <form
                            className="flex items-center gap-2"
                            onSubmit={(e) => {
                              e.preventDefault();
                              void saveTitle();
                            }}
                          >
                            <input
                              className="input !h-[34px] flex-1 text-[14px]"
                              value={renaming.title}
                              autoFocus
                              maxLength={120}
                              onChange={(e) => setRenaming({ id: r.id, title: e.target.value })}
                              onKeyDown={(e) => {
                                if (e.key === "Escape") setRenaming(null);
                              }}
                            />
                            <button type="submit" className="btn btn-sm btn-primary" disabled={busy}>
                              Enregistrer
                            </button>
                            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setRenaming(null)} disabled={busy}>
                              Annuler
                            </button>
                          </form>
                        ) : (
                          <>
                            <div className="text-[14.5px] font-semibold leading-tight truncate" title={r.title}>
                              {r.title}
                            </div>
                            <div className="dim text-[12px] mt-0.5 truncate">
                              {r.fileName} · {fmtSize(r.size)} · ajouté le {fmtDate(r.createdAt)}
                            </div>
                          </>
                        )}
                      </div>
                      {!isRenaming && (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <a href={r.downloadUrl} download={r.fileName} className="btn btn-sm btn-primary">
                            Télécharger
                          </a>
                          <a href={r.viewUrl} target="_blank" rel="noreferrer" className="btn btn-sm btn-ghost">
                            Ouvrir
                          </a>
                          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setRenaming({ id: r.id, title: r.title })} disabled={busy}>
                            Renommer
                          </button>
                          <button type="button" className="btn btn-sm btn-ghost" onClick={() => void remove(r)} disabled={busy} title="Supprimer ce PDF">
                            Supprimer
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
