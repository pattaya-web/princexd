import fs from "fs";
import path from "path";
import type { NextRequest } from "next/server";
import { newId, readDB, writeDB } from "@/lib/db";
import { Forbidden, readSession } from "@/lib/sales/access";
import type { DB, Session, Student, StudentWorkspace, WorkspaceFile, WorkspaceFolder, WorkspaceTable } from "@/lib/types";

export { fileKind, safeExt } from "@/lib/formation-espace-shared";

/**
 * Mon espace (Scale X) : le tableau de bord personnel de l'élève.
 *
 * Tout ce qu'il notait avant dans Excel, Google Sheets ou un Drive vit ici :
 * des tableaux libres (concurrents, prix produits…), un drive de dossiers
 * (créatives, photos produit…) et des notes. Mady voit et modifie l'espace de
 * chaque élève depuis Accès élèves → Espace. Les fichiers sont posés dans
 * data/media comme ceux du Studio (vignettes par lib/thumbs), mais servis par
 * /api/formation/espace/fichiers/<id> qui vérifie que c'est bien le sien.
 */

export const MEDIA_DIR = path.join(process.cwd(), "data", "media");

/** Cloudflare (plan gratuit) refuse un corps au-delà de 100 Mo : on s'arrête avant. */
export const MAX_FILE_BYTES = 90 * 1024 * 1024;

const MAX_TABLES = 40;
const MAX_COLUMNS = 20;
const MAX_ROWS = 500;
const MAX_CELL = 2000;
const MAX_FOLDERS = 40;
const MAX_NAME = 80;
const MAX_NOTES = 20_000;

/** Modèles de tableaux proposés à la création : le vide, et les deux que tout élève finit par faire. */
export const TABLE_TEMPLATES: { key: string; name: string; columns: string[]; hint: string }[] = [
  { key: "concurrents", name: "Concurrents", columns: ["Marque", "Site", "Produit phare", "Prix", "Pubs actives", "Ce qu'ils font bien", "Notes"], hint: "Les marques que tu as repérées sur BrandSearch, avec leurs prix et ce qu'elles font bien." },
  { key: "prix", name: "Prix produits", columns: ["Produit", "Fournisseur", "Coût d'achat", "Livraison", "Prix de vente", "Marge", "Lien"], hint: "Tes produits candidats : coût, livraison, prix de vente visé et marge." },
  { key: "idees", name: "Idées de créatives", columns: ["Angle", "Hook", "Format", "Référence", "Statut"], hint: "Les angles et hooks à tourner, avec la pub qui t'a inspiré." },
  { key: "vide", name: "Nouveau tableau", columns: ["Colonne 1", "Colonne 2", "Colonne 3"], hint: "Un tableau vide, tu nommes les colonnes toi-même." },
];

const DEFAULT_FOLDERS = ["Créatives", "Photos produit", "Inspirations"];

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

function tableFromTemplate(key: string, now: string): WorkspaceTable {
  const t = TABLE_TEMPLATES.find((x) => x.key === key) ?? TABLE_TEMPLATES[TABLE_TEMPLATES.length - 1];
  return { id: newId(), name: t.name, columns: [...t.columns], rows: Array.from({ length: 3 }, () => t.columns.map(() => "")), createdAt: now, updatedAt: now };
}

function emptyWorkspace(studentId: string): StudentWorkspace {
  const now = new Date().toISOString();
  return {
    id: newId(),
    studentId,
    notes: "",
    tables: [tableFromTemplate("concurrents", now), tableFromTemplate("prix", now)],
    folders: DEFAULT_FOLDERS.map((name) => ({ id: newId(), name, createdAt: now })),
    files: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** L'espace d'un élève, créé à la première visite (avec les deux tableaux et les trois dossiers de départ). */
export function getWorkspace(db: DB, studentId: string): StudentWorkspace {
  db.studentWorkspaces = db.studentWorkspaces ?? [];
  let w = db.studentWorkspaces.find((x) => x.studentId === studentId);
  if (!w) {
    w = emptyWorkspace(studentId);
    db.studentWorkspaces.push(w);
    writeDB(db);
  }
  return w;
}

/** Relit des tableaux envoyés par le navigateur : tailles bornées, cellules alignées sur les colonnes, ids conservés. */
export function sanitizeTables(input: unknown, previous: WorkspaceTable[]): WorkspaceTable[] {
  if (!Array.isArray(input)) return previous;
  const now = new Date().toISOString();
  const before = new Map(previous.map((t) => [t.id, t]));
  return input.slice(0, MAX_TABLES).map((raw) => {
    const r = (raw ?? {}) as Partial<WorkspaceTable>;
    const old = typeof r.id === "string" ? before.get(r.id) : undefined;
    const columns = (Array.isArray(r.columns) ? r.columns : ["Colonne 1"]).slice(0, MAX_COLUMNS).map((c, i) => str(c, MAX_NAME) || `Colonne ${i + 1}`);
    if (!columns.length) columns.push("Colonne 1");
    const rows = (Array.isArray(r.rows) ? r.rows : []).slice(0, MAX_ROWS).map((row) => {
      const cells = Array.isArray(row) ? row : [];
      return columns.map((_, i) => str(cells[i], MAX_CELL));
    });
    const same = old && JSON.stringify({ n: old.name, c: old.columns, r: old.rows }) === JSON.stringify({ n: r.name, c: columns, r: rows });
    return {
      id: old?.id ?? (typeof r.id === "string" && r.id ? r.id.slice(0, 40) : newId()),
      name: str(r.name, MAX_NAME) || "Tableau",
      columns,
      rows,
      createdAt: old?.createdAt ?? now,
      updatedAt: same ? old.updatedAt : now,
    };
  });
}

/** Relit les dossiers : un dossier qui contient encore des fichiers ne peut pas disparaître. */
export function sanitizeFolders(input: unknown, previous: WorkspaceFolder[], files: WorkspaceFile[]): WorkspaceFolder[] {
  if (!Array.isArray(input)) return previous;
  const before = new Map(previous.map((f) => [f.id, f]));
  const now = new Date().toISOString();
  const out: WorkspaceFolder[] = input.slice(0, MAX_FOLDERS).map((raw) => {
    const r = (raw ?? {}) as Partial<WorkspaceFolder>;
    const old = typeof r.id === "string" ? before.get(r.id) : undefined;
    return { id: old?.id ?? (typeof r.id === "string" && r.id ? r.id.slice(0, 40) : newId()), name: str(r.name, MAX_NAME) || "Dossier", createdAt: old?.createdAt ?? now };
  });
  const kept = new Set(out.map((f) => f.id));
  for (const f of previous) {
    if (!kept.has(f.id) && files.some((x) => x.folderId === f.id)) {
      throw new Error(`Le dossier « ${f.name} » contient encore des fichiers : vide-le avant de le supprimer.`);
    }
  }
  if (!out.length) out.push({ id: newId(), name: "Mes fichiers", createdAt: now });
  return out;
}

export const sanitizeNotes = (v: unknown, previous: string) => (typeof v === "string" ? v.slice(0, MAX_NOTES) : previous);

export interface EspaceScope {
  session: Session;
  student: Student;
  isAdmin: boolean;
  /** Aperçu « Voir comme » : l'admin dans la peau de l'élève. */
  preview: boolean;
}

/**
 * Qui regarde l'espace de qui.
 *  - un élève : le sien, toujours ;
 *  - l'admin : celui de l'élève passé en `?student=` (obligatoire).
 */
export function espaceScope(req: NextRequest, studentParam?: string | null): EspaceScope {
  const session = readSession(req);
  const db = readDB();
  if (session.role === "student") {
    const student = db.students.find((s) => s.id === session.memberId);
    if (!student) throw new Forbidden("Accès refusé.");
    return { session, student, isAdmin: false, preview: Boolean(session.impersonated) };
  }
  if (!session.isAdmin) throw new Forbidden("Cet espace est réservé aux élèves de la formation.");
  const id = (studentParam ?? "").trim();
  if (!id) throw new Error("Choisis un élève (?student=).");
  const student = db.students.find((s) => s.id === id);
  if (!student) throw new Error("Élève introuvable.");
  return { session, student, isAdmin: true, preview: false };
}

/** Chemin absolu d'un fichier du drive, ou null si le nom stocké est suspect. */
export function filePath(f: Pick<WorkspaceFile, "stored">): string | null {
  if (!/^[A-Za-z0-9]+\.[A-Za-z0-9]+$/.test(f.stored)) return null;
  const full = path.join(MEDIA_DIR, f.stored);
  return full.startsWith(MEDIA_DIR) ? full : null;
}

export function removeFileFromDisk(f: Pick<WorkspaceFile, "stored">) {
  const full = filePath(f);
  if (!full) return;
  try {
    fs.rmSync(full, { force: true });
  } catch {
    // déjà parti : la fiche disparaît quand même.
  }
}

/** Taille totale du drive d'un élève. */
export const driveSize = (w: Pick<StudentWorkspace, "files">) => w.files.reduce((n, f) => n + (f.size || 0), 0);
