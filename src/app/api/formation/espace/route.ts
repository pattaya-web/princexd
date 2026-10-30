import { NextRequest } from "next/server";
import { readDB, writeDB } from "@/lib/db";
import { readSession } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { driveSize, espaceScope, getWorkspace, MAX_FILE_BYTES, sanitizeFolders, sanitizeNotes, sanitizeTables, TABLE_TEMPLATES } from "@/lib/formation-espace";
import type { StudentWorkspace } from "@/lib/types";

export const dynamic = "force-dynamic";

export interface EspacePayload {
  student: { id: string; name: string; firstName: string };
  isAdmin: boolean;
  preview: boolean;
  workspace: StudentWorkspace;
  templates: typeof TABLE_TEMPLATES;
  maxFileBytes: number;
  driveBytes: number;
}

/** Admin sans élève choisi : la liste pour en choisir un. */
export interface EspacePickPayload {
  pick: { id: string; name: string; username: string; files: number; tables: number; updatedAt: string }[];
}

/** Mon espace : tableaux, dossiers, fichiers et notes de l'élève (ou de l'élève choisi par l'admin). */
export async function GET(req: NextRequest) {
  return handle((): EspacePayload | EspacePickPayload => {
    const studentId = req.nextUrl.searchParams.get("student");
    const session = readSession(req);
    if (session.isAdmin && !studentId) {
      const db = readDB();
      const spaces = new Map((db.studentWorkspaces ?? []).map((w) => [w.studentId, w]));
      return {
        pick: db.students
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name, "fr"))
          .map((s) => {
            const w = spaces.get(s.id);
            return { id: s.id, name: s.name, username: s.username ?? "", files: w?.files.length ?? 0, tables: w?.tables.length ?? 0, updatedAt: w?.updatedAt ?? "" };
          }),
      };
    }
    const scope = espaceScope(req, studentId);
    const db = readDB();
    const workspace = getWorkspace(db, scope.student.id);
    return {
      student: { id: scope.student.id, name: scope.student.name, firstName: scope.student.name.trim().split(/\s+/)[0] ?? scope.student.name },
      isAdmin: scope.isAdmin,
      preview: scope.preview,
      workspace,
      templates: TABLE_TEMPLATES,
      maxFileBytes: MAX_FILE_BYTES,
      driveBytes: driveSize(workspace),
    };
  });
}

/**
 * Enregistre ce qui a changé : `tables`, `folders`, `notes` (chacun optionnel,
 * remplacé en entier). Un tableau neuf est demandé par `newTable: <clé de modèle>`.
 */
export async function PATCH(req: NextRequest) {
  return handle(async (): Promise<{ workspace: StudentWorkspace }> => {
    const scope = espaceScope(req, req.nextUrl.searchParams.get("student"));
    const body = (await req.json().catch(() => ({}))) as { tables?: unknown; folders?: unknown; notes?: unknown; newTable?: unknown };
    const db = readDB();
    const w = getWorkspace(db, scope.student.id);
    if (body.tables !== undefined) w.tables = sanitizeTables(body.tables, w.tables);
    if (body.folders !== undefined) w.folders = sanitizeFolders(body.folders, w.folders, w.files);
    if (body.notes !== undefined) w.notes = sanitizeNotes(body.notes, w.notes);
    if (typeof body.newTable === "string") {
      const t = TABLE_TEMPLATES.find((x) => x.key === body.newTable) ?? TABLE_TEMPLATES[TABLE_TEMPLATES.length - 1];
      const now = new Date().toISOString();
      w.tables = sanitizeTables([...w.tables, { id: "", name: t.name, columns: t.columns, rows: Array.from({ length: 3 }, () => t.columns.map(() => "")), createdAt: now, updatedAt: now }], w.tables);
    }
    w.updatedAt = new Date().toISOString();
    writeDB(db);
    return { workspace: w };
  });
}

/** Même chose que PATCH : `navigator.sendBeacon` (fermeture de la page) n'envoie que des POST. */
export const POST = PATCH;
