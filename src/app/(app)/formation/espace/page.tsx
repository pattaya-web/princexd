"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type DragEvent } from "react";
import { api } from "@/lib/client";
import { formatBytes } from "@/lib/upload-client";
import { fileKind } from "@/lib/formation-espace-shared";
import { Card, Empty, ErrorNote, Modal, PageHeader, Spinner, Tabs, useToast } from "@/components/ui";
import { PortalFooter, SectionLabel } from "@/components/formation/portal";
import type { EspacePayload, EspacePickPayload } from "@/app/api/formation/espace/route";
import type { StudentWorkspace, WorkspaceFile, WorkspaceFolder, WorkspaceTable } from "@/lib/types";

/**
 * Mon espace (Scale X) : le mini-écosystème de l'élève, à la place d'Excel,
 * Google Sheets et d'un Drive à part.
 *  - Tableaux : concurrents, prix produits, idées… colonnes et lignes libres,
 *    enregistrés à chaque frappe ;
 *  - Drive : dossiers (Créatives, Photos produit…) où il glisse photos,
 *    vidéos, PDF ; aperçus, téléchargement, commentaire ;
 *  - Notes : un bloc de texte libre.
 * Mady ouvre le même écran pour chaque élève (Accès élèves → Espace, ou
 * ?student=<id>) et y voit tout, peut commenter et déposer aussi.
 */

type Tab = "tableaux" | "drive" | "notes";

const EMOJI: Record<ReturnType<typeof fileKind>, string> = { image: "🖼", video: "🎬", audio: "🎧", pdf: "📄", other: "📎" };

function fmtDate(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

/** Un tableau en texte tabulé : collable dans Claude, WhatsApp ou un tableur. */
function tableAsText(t: WorkspaceTable): string {
  const lines = [t.columns.join("\t"), ...t.rows.filter((r) => r.some((c) => c.trim())).map((r) => r.join("\t"))];
  return lines.join("\n");
}

/** Lecture d'un collage venu d'Excel / Google Sheets : lignes, cellules séparées par des tabulations. */
function parsePasted(text: string): string[][] {
  return text
    .replace(/\r/g, "")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => l.split("\t"));
}

export default function EspacePage() {
  return (
    <Suspense fallback={<Spinner label="Chargement…" />}>
      <EspaceInner />
    </Suspense>
  );
}

function EspaceInner() {
  const toast = useToast();
  const params = useSearchParams();
  const studentParam = params.get("student") ?? "";
  const q = studentParam ? `?student=${encodeURIComponent(studentParam)}` : "";
  const [data, setData] = useState<EspacePayload | null>(null);
  const [pick, setPick] = useState<EspacePickPayload["pick"] | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("tableaux");
  const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const load = useCallback(async () => {
    try {
      const r = await api<EspacePayload | EspacePickPayload>(`/api/formation/espace${q}`);
      if ("pick" in r) {
        setPick(r.pick);
        setData(null);
      } else {
        setData(r);
        setPick(null);
      }
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [q]);

  useEffect(() => {
    void load();
  }, [load]);

  /* --- Enregistrement : différé 700 ms après la dernière frappe, un seul envoi en vol. --- */
  const pending = useRef<Partial<Pick<StudentWorkspace, "tables" | "folders" | "notes">>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(async () => {
    const body = pending.current;
    pending.current = {};
    if (!Object.keys(body).length) return;
    setSaving("saving");
    try {
      const r = await api<{ workspace: StudentWorkspace }>(`/api/formation/espace${q}`, { method: "PATCH", body: JSON.stringify(body) });
      // Si l'utilisateur a retapé pendant l'envoi, on garde sa version : elle partira au prochain envoi.
      if (!Object.keys(pending.current).length) setData((d) => (d ? { ...d, workspace: { ...r.workspace, files: d.workspace.files } } : d));
      setSaving("saved");
    } catch (e) {
      setSaving("error");
      toast((e as Error).message, "err");
    }
  }, [q, toast]);
  const queue = useCallback(
    (patch: Partial<Pick<StudentWorkspace, "tables" | "folders" | "notes">>) => {
      setData((d) => (d ? { ...d, workspace: { ...d.workspace, ...patch } } : d));
      pending.current = { ...pending.current, ...patch };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 700);
    },
    [flush],
  );
  useEffect(() => {
    const onHide = () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      const body = pending.current;
      pending.current = {};
      if (Object.keys(body).length) navigator.sendBeacon?.(`/api/formation/espace${q}`, new Blob([JSON.stringify(body)], { type: "application/json" }));
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [q]);

  if (error) return <ErrorNote>{error}</ErrorNote>;

  /* --- Admin sans élève choisi : la liste des espaces. --- */
  if (pick) {
    return (
      <div>
        <PageHeader title="Espaces élèves" subtitle="Le tableau de bord personnel de chaque élève : ses tableaux (concurrents, prix…), son drive de créatives et ses notes. Clique pour l'ouvrir, tu peux y écrire et y déposer aussi." />
        {!pick.length && <Empty>Aucun élève pour l&apos;instant.</Empty>}
        {pick.length > 0 && (
          <Card padded={false}>
            <table className="table w-full text-[13px]">
              <thead>
                <tr>
                  <th className="text-left">Élève</th>
                  <th className="text-left">Tableaux</th>
                  <th className="text-left">Fichiers</th>
                  <th className="text-left">Dernière modification</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pick.map((s) => (
                  <tr key={s.id} className="row-hover">
                    <td>
                      <div className="font-medium">{s.name}</div>
                      <div className="dim text-[12px]">{s.username || "pas d'accès"}</div>
                    </td>
                    <td className="num">{s.tables}</td>
                    <td className="num">{s.files}</td>
                    <td className="dim">{s.updatedAt ? fmtDate(s.updatedAt) : "jamais ouvert"}</td>
                    <td className="text-right">
                      <Link href={`/formation/espace?student=${s.id}`} className="btn btn-sm btn-primary">
                        Ouvrir
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    );
  }

  if (!data) return <Spinner label="Chargement de ton espace…" />;
  const w = data.workspace;
  const title = data.isAdmin ? `Espace de ${data.student.firstName}` : "Mon espace";

  return (
    <div>
      <PageHeader
        title={title}
        subtitle={
          data.isAdmin
            ? `Tout ce que ${data.student.name} note et dépose. Ce que tu écris ici, il le voit.`
            : "Ton tableau de bord à toi : tes concurrents, tes prix, tes créatives, tes notes. Tout reste ici, Mady peut y jeter un œil, et tu n'as plus besoin d'Excel ni d'un Drive à côté."
        }
        actions={
          <>
            {data.isAdmin && (
              <Link href="/formation/espace" className="btn btn-sm btn-ghost">
                ← Tous les élèves
              </Link>
            )}
            <span className="dim text-[12px]" aria-live="polite">
              {saving === "saving" ? "Enregistrement…" : saving === "saved" ? "✓ Enregistré" : saving === "error" ? "⚠ Non enregistré" : ""}
            </span>
          </>
        }
      />

      {data.preview && (
        <div className="card p-3 mb-4 text-[13px]" style={{ borderColor: "var(--warn)" }}>
          Aperçu « Voir comme » : tu es dans l&apos;espace de {data.student.name}. Ce que tu modifies ici est enregistré pour de vrai.
        </div>
      )}

      <div className="mb-5">
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: "tableaux", label: "Tableaux", count: w.tables.length },
            { value: "drive", label: "Drive", count: w.files.length },
            { value: "notes", label: "Notes" },
          ]}
        />
      </div>

      {tab === "tableaux" && <TablesTab data={data} onChange={(tables) => queue({ tables })} onCreate={async (key) => {
        try {
          const r = await api<{ workspace: StudentWorkspace }>(`/api/formation/espace${q}`, { method: "PATCH", body: JSON.stringify({ newTable: key }) });
          setData((d) => (d ? { ...d, workspace: { ...r.workspace, files: d.workspace.files } } : d));
        } catch (e) {
          toast((e as Error).message, "err");
        }
      }} />}
      {tab === "drive" && <DriveTab data={data} q={q} onFolders={(folders) => queue({ folders })} onFiles={(files) => setData((d) => (d ? { ...d, workspace: { ...d.workspace, files } } : d))} reload={load} />}
      {tab === "notes" && (
        <Card title="Mes notes" subtitle="Tout ce qui ne rentre pas dans un tableau : idées, retours de Mady, liens, à faire. Enregistré tout seul.">
          <textarea
            className="textarea w-full min-h-[360px] text-[14px] leading-relaxed"
            data-nodraft
            value={w.notes}
            placeholder={"Ex. :\n– Produit validé avec Mady le 12/11 : la gourde isotherme\n– Fournisseur à relancer pour les échantillons\n– Idée de hook : « j'ai testé 5 gourdes, une seule a tenu 24 h »"}
            onChange={(e) => queue({ notes: e.target.value })}
          />
        </Card>
      )}

      <PortalFooter quote="Ce qui n'est pas écrit n'existe pas." author="Mady" />
    </div>
  );
}

/* ----------------------------- Tableaux ----------------------------- */

function TablesTab({ data, onChange, onCreate }: { data: EspacePayload; onChange: (tables: WorkspaceTable[]) => void; onCreate: (templateKey: string) => Promise<void> }) {
  const toast = useToast();
  const tables = data.workspace.tables;
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  const update = (id: string, fn: (t: WorkspaceTable) => WorkspaceTable) => onChange(tables.map((t) => (t.id === id ? fn(t) : t)));

  const create = async (key: string) => {
    setBusy(true);
    try {
      await onCreate(key);
      setCreating(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5" data-nodraft>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionLabel n="01" title="Mes tableaux" />
        <button className="btn btn-sm btn-primary" onClick={() => setCreating(true)}>
          + Nouveau tableau
        </button>
      </div>

      {!tables.length && (
        <Empty action={<button className="btn btn-sm btn-primary" onClick={() => setCreating(true)}>Créer mon premier tableau</button>}>
          Aucun tableau. Commence par « Concurrents » ou « Prix produits ».
        </Empty>
      )}

      {tables.map((t) => (
        <TableCard
          key={t.id}
          table={t}
          onChange={(next) => update(t.id, () => next)}
          onDelete={() => {
            if (!window.confirm(`Supprimer le tableau « ${t.name} » ? Ses lignes seront perdues.`)) return;
            onChange(tables.filter((x) => x.id !== t.id));
          }}
          onCopy={async () => {
            try {
              await navigator.clipboard.writeText(tableAsText(t));
              toast("Tableau copié : colle-le dans Claude, WhatsApp ou un tableur.");
            } catch {
              toast("Copie impossible dans ce navigateur.", "err");
            }
          }}
        />
      ))}

      <Modal open={creating} onClose={() => setCreating(false)} title="Nouveau tableau">
        <div className="grid gap-2">
          {data.templates.map((tpl) => (
            <button key={tpl.key} className="card card-hover p-3 text-left" disabled={busy} onClick={() => void create(tpl.key)}>
              <div className="font-medium text-[14px]">{tpl.name}</div>
              <div className="dim text-[12.5px] mt-0.5">{tpl.hint}</div>
              <div className="mono text-[11px] mt-1.5 opacity-70">{tpl.columns.join(" · ")}</div>
            </button>
          ))}
        </div>
      </Modal>
    </div>
  );
}

function TableCard({ table, onChange, onDelete, onCopy }: { table: WorkspaceTable; onChange: (t: WorkspaceTable) => void; onDelete: () => void; onCopy: () => void }) {
  const t = table;
  const toast = useToast();
  const setCell = (ri: number, ci: number, v: string) => onChange({ ...t, rows: t.rows.map((r, i) => (i === ri ? r.map((c, j) => (j === ci ? v : c)) : r)) });
  const addRow = () => onChange({ ...t, rows: [...t.rows, t.columns.map(() => "")] });
  const delRow = (ri: number) => onChange({ ...t, rows: t.rows.filter((_, i) => i !== ri) });
  const addCol = () => onChange({ ...t, columns: [...t.columns, `Colonne ${t.columns.length + 1}`], rows: t.rows.map((r) => [...r, ""]) });
  const renameCol = (ci: number, v: string) => onChange({ ...t, columns: t.columns.map((c, j) => (j === ci ? v : c)) });
  const delCol = (ci: number) => {
    if (t.columns.length <= 1) return;
    if (!window.confirm(`Supprimer la colonne « ${t.columns[ci]} » ?`)) return;
    onChange({ ...t, columns: t.columns.filter((_, j) => j !== ci), rows: t.rows.map((r) => r.filter((_, j) => j !== ci)) });
  };
  /** Collage Excel / Google Sheets dans une cellule : remplit la grille à partir de là. */
  const onPaste = (ri: number, ci: number, e: ReactClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text/plain");
    if (!text.includes("\t") && !text.includes("\n")) return;
    e.preventDefault();
    const grid = parsePasted(text);
    const rows = t.rows.map((r) => [...r]);
    let columns = [...t.columns];
    for (let i = 0; i < grid.length; i++) {
      const target = ri + i;
      while (rows.length <= target) rows.push(columns.map(() => ""));
      for (let j = 0; j < grid[i].length; j++) {
        const col = ci + j;
        if (col >= columns.length) {
          if (columns.length >= 20) break;
          columns = [...columns, `Colonne ${columns.length + 1}`];
          for (const r of rows) r.push("");
        }
        rows[target][col] = grid[i][j].slice(0, 2000);
      }
    }
    onChange({ ...t, columns, rows: rows.slice(0, 500) });
    toast(`${grid.length} ligne${grid.length > 1 ? "s" : ""} collée${grid.length > 1 ? "s" : ""}.`);
  };
  const filled = t.rows.filter((r) => r.some((c) => c.trim())).length;

  return (
    <Card
      title={
        <input
          className="bg-transparent font-semibold text-[15px] outline-none w-full"
          value={t.name}
          onChange={(e) => onChange({ ...t, name: e.target.value })}
          aria-label="Nom du tableau"
          data-nodraft
        />
      }
      subtitle={`${filled} ligne${filled > 1 ? "s" : ""} remplie${filled > 1 ? "s" : ""} · modifié le ${fmtDate(t.updatedAt)} · colle directement depuis Excel ou Google Sheets dans une cellule`}
      actions={
        <>
          <button className="btn btn-sm btn-ghost" onClick={onCopy} title="Copier le tableau en texte">
            Copier
          </button>
          <button className="btn btn-sm btn-ghost" onClick={addCol}>
            + Colonne
          </button>
          <button className="btn btn-sm btn-danger" onClick={onDelete} title="Supprimer ce tableau">
            ✕
          </button>
        </>
      }
      padded={false}
    >
      <div className="overflow-x-auto">
        <table className="table w-full text-[13px]" style={{ minWidth: Math.max(520, t.columns.length * 160) }}>
          <thead>
            <tr>
              <th className="w-[36px] text-center dim">#</th>
              {t.columns.map((c, ci) => (
                <th key={ci} className="text-left">
                  <div className="flex items-center gap-1">
                    <input className="bg-transparent font-semibold outline-none w-full min-w-[90px]" value={c} onChange={(e) => renameCol(ci, e.target.value)} aria-label={`Nom de la colonne ${ci + 1}`} data-nodraft />
                    {t.columns.length > 1 && (
                      <button className="dim text-[11px] hover:opacity-100 opacity-50" onClick={() => delCol(ci)} title="Supprimer la colonne" aria-label="Supprimer la colonne">
                        ✕
                      </button>
                    )}
                  </div>
                </th>
              ))}
              <th className="w-[36px]" />
            </tr>
          </thead>
          <tbody>
            {t.rows.map((r, ri) => (
              <tr key={ri} className="row-hover">
                <td className="text-center dim num">{ri + 1}</td>
                {t.columns.map((_, ci) => (
                  <td key={ci} className="!p-1">
                    <input
                      className="input !h-[34px] w-full !text-[13px]"
                      value={r[ci] ?? ""}
                      onChange={(e) => setCell(ri, ci, e.target.value)}
                      onPaste={(e) => onPaste(ri, ci, e)}
                      data-nodraft
                    />
                  </td>
                ))}
                <td className="text-center">
                  <button className="dim text-[12px] opacity-50 hover:opacity-100" onClick={() => delRow(ri)} title="Supprimer la ligne" aria-label="Supprimer la ligne">
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="p-3 border-t" style={{ borderColor: "var(--border)" }}>
        <button className="btn btn-sm" onClick={addRow}>
          + Ligne
        </button>
      </div>
    </Card>
  );
}

/* ------------------------------ Drive ------------------------------ */

function DriveTab({ data, q, onFolders, onFiles, reload }: { data: EspacePayload; q: string; onFolders: (f: WorkspaceFolder[]) => void; onFiles: (f: WorkspaceFile[]) => void; reload: () => Promise<void> }) {
  const toast = useToast();
  const w = data.workspace;
  const [folderId, setFolderId] = useState(w.folders[0]?.id ?? "");
  const [drag, setDrag] = useState(false);
  const [progress, setProgress] = useState("");
  const [open, setOpen] = useState<WorkspaceFile | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const folder = w.folders.find((f) => f.id === folderId) ?? w.folders[0];
  useEffect(() => {
    if (!w.folders.some((f) => f.id === folderId)) setFolderId(w.folders[0]?.id ?? "");
  }, [w.folders, folderId]);
  const files = w.files.filter((f) => f.folderId === folder?.id);
  const fileUrl = (f: WorkspaceFile, extra = "") => `/api/formation/espace/fichiers/${f.id}${q}${extra ? (q ? "&" : "?") + extra : ""}`;

  const upload = async (list: File[]) => {
    if (!list.length || !folder) return;
    const tooBig = list.filter((f) => f.size > data.maxFileBytes);
    if (tooBig.length) toast(`${tooBig.map((f) => f.name).join(", ")} : plus de 90 Mo, compresse-le d'abord (HandBrake, ou une version plus légère).`, "err");
    const ok = list.filter((f) => f.size <= data.maxFileBytes);
    let done = 0;
    for (const f of ok) {
      setProgress(`Envoi ${done + 1} / ${ok.length} : ${f.name}`);
      const fd = new FormData();
      fd.append("folder", folder.id);
      fd.append("file", f);
      try {
        const res = await fetch(`/api/formation/espace/fichiers${q}`, { method: "POST", body: fd });
        const j = (await res.json().catch(() => ({}))) as { files?: WorkspaceFile[]; error?: string };
        if (!res.ok) throw new Error(j.error || `Erreur ${res.status}`);
        if (j.files?.length) onFiles([...j.files, ...w.files.filter((x) => !j.files!.some((y) => y.id === x.id))]);
        done++;
      } catch (e) {
        toast(`${f.name} : ${(e as Error).message}`, "err");
      }
    }
    setProgress("");
    if (done) {
      toast(`${done} fichier${done > 1 ? "s" : ""} déposé${done > 1 ? "s" : ""} dans « ${folder.name} ».`);
      await reload();
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDrag(false);
    void upload(Array.from(e.dataTransfer.files ?? []));
  };

  const addFolder = () => {
    const name = window.prompt("Nom du dossier ?", "Nouveau dossier")?.trim();
    if (!name) return;
    const f: WorkspaceFolder = { id: `tmp${Date.now().toString(36)}`, name, createdAt: new Date().toISOString() };
    onFolders([...w.folders, f]);
    setFolderId(f.id);
  };
  const renameFolder = () => {
    if (!folder) return;
    const name = window.prompt("Nouveau nom du dossier ?", folder.name)?.trim();
    if (!name || name === folder.name) return;
    onFolders(w.folders.map((f) => (f.id === folder.id ? { ...f, name } : f)));
  };
  const deleteFolder = () => {
    if (!folder) return;
    if (files.length) {
      toast("Ce dossier contient encore des fichiers : déplace-les ou supprime-les d'abord.", "err");
      return;
    }
    if (!window.confirm(`Supprimer le dossier « ${folder.name} » ?`)) return;
    onFolders(w.folders.filter((f) => f.id !== folder.id));
  };

  const patchFile = async (f: WorkspaceFile, patch: Partial<Pick<WorkspaceFile, "name" | "note" | "folderId">>) => {
    try {
      const r = await api<{ file: WorkspaceFile }>(fileUrl(f), { method: "PATCH", body: JSON.stringify(patch) });
      onFiles(w.files.map((x) => (x.id === f.id ? r.file : x)));
      setOpen((o) => (o && o.id === f.id ? r.file : o));
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  const deleteFile = async (f: WorkspaceFile) => {
    if (!window.confirm(`Supprimer « ${f.name} » ?`)) return;
    try {
      await api(fileUrl(f), { method: "DELETE" });
      onFiles(w.files.filter((x) => x.id !== f.id));
      setOpen(null);
      toast("Fichier supprimé.");
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  return (
    <div className="space-y-4" data-nodraft>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionLabel n="02" title="Mon drive" />
        <div className="dim text-[12px]">
          {w.files.length} fichier{w.files.length > 1 ? "s" : ""} · {formatBytes(data.driveBytes)} · 90 Mo max par fichier
        </div>
      </div>

      {/* Dossiers */}
      <div className="flex flex-wrap items-center gap-2">
        {w.folders.map((f) => {
          const n = w.files.filter((x) => x.folderId === f.id).length;
          const active = f.id === folder?.id;
          return (
            <button key={f.id} className={`btn btn-sm ${active ? "btn-primary" : ""}`} onClick={() => setFolderId(f.id)}>
              📁 {f.name}
              {n > 0 && <span className="ml-1.5 opacity-70 num">{n}</span>}
            </button>
          );
        })}
        <button className="btn btn-sm btn-ghost" onClick={addFolder}>
          + Dossier
        </button>
        {folder && (
          <>
            <button className="btn btn-sm btn-ghost" onClick={renameFolder} title="Renommer ce dossier">
              Renommer
            </button>
            <button className="btn btn-sm btn-ghost" onClick={deleteFolder} title="Supprimer ce dossier (vide)">
              Supprimer
            </button>
          </>
        )}
      </div>

      {/* Zone de dépôt */}
      <div
        className="card p-6 text-center cursor-pointer"
        style={{ borderStyle: "dashed", borderColor: drag ? "var(--accent)" : "var(--border-strong)", background: drag ? "rgb(27 116 201 / 0.08)" : undefined }}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        onClick={() => !progress && inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
      >
        <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => void upload(Array.from(e.target.files ?? [])).then(() => { if (inputRef.current) inputRef.current.value = ""; })} />
        {progress ? (
          <div className="flex items-center justify-center gap-2 text-[13px]">
            <span className="spinner" /> {progress}
          </div>
        ) : (
          <>
            <div className="text-[15px] font-medium">Glisse tes photos, vidéos ou PDF ici{folder ? ` → ${folder.name}` : ""}</div>
            <div className="dim text-[12.5px] mt-1">ou clique pour choisir des fichiers · tes créatives, tes photos produit, les pubs qui t&apos;inspirent</div>
          </>
        )}
      </div>

      {/* Fichiers */}
      {!files.length && <Empty>Dossier vide pour l&apos;instant.</Empty>}
      {files.length > 0 && (
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))" }}>
          {files.map((f) => {
            const kind = fileKind(f);
            return (
              <button key={f.id} className="tile card p-0 overflow-hidden text-left" onClick={() => setOpen(f)} title={f.name}>
                <div className="relative" style={{ aspectRatio: "1 / 1", background: "rgb(0 0 0 / 0.18)" }}>
                  <div className="absolute inset-0 flex items-center justify-center text-[34px] pointer-events-none">{EMOJI[kind]}</div>
                  {(kind === "image" || kind === "video") && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={fileUrl(f, "thumb=1")} alt={f.name} className="absolute inset-0 w-full h-full object-cover" loading="lazy" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                  )}
                  {kind === "video" && <span className="absolute left-2 top-2 badge !text-[10px] !py-0">▶ vidéo</span>}
                  {f.by === "admin" && <span className="absolute right-2 top-2 badge badge-accent !text-[10px] !py-0">Mady</span>}
                  {f.note && <span className="absolute right-2 bottom-2 badge !text-[10px] !py-0">💬</span>}
                </div>
                <div className="p-2">
                  <div className="text-[12.5px] font-medium truncate">{f.name}</div>
                  <div className="dim text-[11px]">{formatBytes(f.size)} · {fmtDate(f.createdAt)}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <FileModal file={open} folders={w.folders} q={q} isAdmin={data.isAdmin} onClose={() => setOpen(null)} onPatch={patchFile} onDelete={deleteFile} />
    </div>
  );
}

function FileModal({ file, folders, q, isAdmin, onClose, onPatch, onDelete }: { file: WorkspaceFile | null; folders: WorkspaceFolder[]; q: string; isAdmin: boolean; onClose: () => void; onPatch: (f: WorkspaceFile, p: Partial<Pick<WorkspaceFile, "name" | "note" | "folderId">>) => Promise<void>; onDelete: (f: WorkspaceFile) => Promise<void> }) {
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => {
    setName(file?.name ?? "");
    setNote(file?.note ?? "");
  }, [file]);
  if (!file) return null;
  const kind = fileKind(file);
  const url = `/api/formation/espace/fichiers/${file.id}${q}`;
  const dl = `${url}${q ? "&" : "?"}download=1`;
  const dirty = name.trim() !== file.name || note !== file.note;
  return (
    <Modal
      open
      onClose={onClose}
      title={file.name}
      wide
      footer={
        <>
          <button className="btn btn-sm btn-danger" onClick={() => void onDelete(file)}>
            Supprimer
          </button>
          <a className="btn btn-sm" href={dl}>
            Télécharger
          </a>
          <a className="btn btn-sm" href={url} target="_blank" rel="noreferrer">
            Ouvrir
          </a>
          <button className="btn btn-sm btn-primary" disabled={!dirty} onClick={() => void onPatch(file, { name: name.trim() || file.name, note })}>
            Enregistrer
          </button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-[1.4fr_1fr]" data-nodraft>
        <div className="card p-0 overflow-hidden flex items-center justify-center" style={{ minHeight: 240, background: "rgb(0 0 0 / 0.25)" }}>
          {kind === "image" && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={file.name} className="max-h-[60vh] w-auto max-w-full object-contain" />
          )}
          {kind === "video" && <video src={url} controls preload="metadata" className="max-h-[60vh] w-full" />}
          {kind === "audio" && <audio src={url} controls className="w-full p-4" />}
          {kind === "pdf" && <iframe src={url} title={file.name} className="w-full" style={{ height: "60vh" }} />}
          {kind === "other" && <div className="dim text-[13px] p-6">Pas d&apos;aperçu pour ce type de fichier. Télécharge-le pour l&apos;ouvrir.</div>}
        </div>
        <div className="space-y-3">
          <label className="block">
            <span className="label-xs block mb-1.5">Nom</span>
            <input className="input w-full" value={name} onChange={(e) => setName(e.target.value)} data-nodraft />
          </label>
          <label className="block">
            <span className="label-xs block mb-1.5">Dossier</span>
            <select className="select w-full" value={file.folderId} onChange={(e) => void onPatch(file, { folderId: e.target.value })}>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label-xs block mb-1.5">{isAdmin ? "Ton retour (l'élève le voit)" : "Commentaire"}</span>
            <textarea className="textarea w-full min-h-[120px]" value={note} onChange={(e) => setNote(e.target.value)} placeholder={isAdmin ? "Ex. : bon hook, raccourcis les 2 premières secondes" : "Ex. : version 2 du hook, tournée le 14/11"} data-nodraft />
          </label>
          <div className="dim text-[12px]">
            {formatBytes(file.size)} · déposé le {fmtDate(file.createdAt)} par {file.by === "admin" ? "Mady" : "toi"}
          </div>
        </div>
      </div>
    </Modal>
  );
}
