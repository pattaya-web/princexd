import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { readDB, writeDB } from "@/lib/db";
import { Forbidden } from "@/lib/sales/access";
import { espaceScope, filePath, getWorkspace, removeFileFromDisk, type EspaceScope } from "@/lib/formation-espace";
import { ensureThumb } from "@/lib/thumbs";
import type { WorkspaceFile } from "@/lib/types";

export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  mp4: "video/mp4", mov: "video/quicktime", m4v: "video/x-m4v", webm: "video/webm", avi: "video/x-msvideo", mkv: "video/x-matroska",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", jfif: "image/jpeg", webp: "image/webp", gif: "image/gif", heic: "image/heic",
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac",
  pdf: "application/pdf", txt: "text/plain; charset=utf-8", csv: "text/csv; charset=utf-8",
};

function scopeOr(req: NextRequest): EspaceScope | NextResponse {
  try {
    return espaceScope(req, req.nextUrl.searchParams.get("student"));
  } catch (e) {
    const status = e instanceof Forbidden ? e.status : 400;
    return NextResponse.json({ error: e instanceof Error ? e.message : "Accès refusé." }, { status });
  }
}

function find(scope: EspaceScope, id: string): { db: ReturnType<typeof readDB>; file: WorkspaceFile | undefined; files: WorkspaceFile[] } {
  const db = readDB();
  const w = getWorkspace(db, scope.student.id);
  return { db, file: w.files.find((f) => f.id === id), files: w.files };
}

/**
 * Lecture d'un fichier du drive (hors middleware, session vérifiée ici) :
 * seulement le sien pour un élève, celui de l'élève regardé pour l'admin.
 *  - ?thumb=1    : vignette JPEG (lib/thumbs), 404 si impossible ;
 *  - ?download=1 : téléchargement sous son nom d'origine ;
 *  - sinon lecture en ligne, avec Range pour les vidéos.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const scope = scopeOr(req);
  if (scope instanceof NextResponse) return scope;
  const { id } = await ctx.params;
  const { file } = find(scope, id);
  const full = file ? filePath(file) : null;
  if (!file || !full || !fs.existsSync(full)) return NextResponse.json({ error: "Fichier introuvable." }, { status: 404 });

  if (req.nextUrl.searchParams.get("thumb") === "1") {
    const thumb = await ensureThumb(file.stored, 360);
    if (!thumb) return NextResponse.json({ error: "Pas de vignette" }, { status: 404 });
    const tstat = fs.statSync(thumb);
    return new NextResponse(fs.createReadStream(thumb) as unknown as ReadableStream, {
      headers: { "Content-Type": "image/jpeg", "Content-Length": String(tstat.size), "Cache-Control": "private, max-age=31536000, immutable" },
    });
  }

  const stat = fs.statSync(full);
  const ext = file.stored.split(".").pop()?.toLowerCase() ?? "";
  const type = MIME[ext] ?? file.mime ?? "application/octet-stream";
  const headers: Record<string, string> = { "Content-Type": type, "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=31536000, immutable" };
  if (req.nextUrl.searchParams.get("download") === "1") {
    headers["Content-Disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(file.name.replace(/[\r\n"]/g, ""))}`;
  }
  const range = req.headers.get("range");
  if (range) {
    const match = range.match(/bytes=(\d*)-(\d*)/);
    const start = match?.[1] ? Number(match[1]) : 0;
    const end = match?.[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
    if (start > end || start >= stat.size) {
      return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${stat.size}` } });
    }
    return new NextResponse(fs.createReadStream(full, { start, end }) as unknown as ReadableStream, {
      status: 206,
      headers: { ...headers, "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${stat.size}` },
    });
  }
  return new NextResponse(fs.createReadStream(full) as unknown as ReadableStream, { headers: { ...headers, "Content-Length": String(stat.size) } });
}

/** Renommer, commenter ou déplacer un fichier dans un autre dossier. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const scope = scopeOr(req);
  if (scope instanceof NextResponse) return scope;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { name?: unknown; note?: unknown; folderId?: unknown };
  const { db, file } = find(scope, id);
  if (!file) return NextResponse.json({ error: "Fichier introuvable." }, { status: 404 });
  if (typeof body.name === "string" && body.name.trim()) file.name = body.name.trim().slice(0, 120);
  if (typeof body.note === "string") file.note = body.note.slice(0, 2000);
  if (typeof body.folderId === "string") {
    const w = getWorkspace(db, scope.student.id);
    if (!w.folders.some((f) => f.id === body.folderId)) return NextResponse.json({ error: "Dossier introuvable." }, { status: 400 });
    file.folderId = body.folderId;
  }
  getWorkspace(db, scope.student.id).updatedAt = new Date().toISOString();
  writeDB(db);
  return NextResponse.json({ file });
}

/** Supprime le fichier (fiche et octets). */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const scope = scopeOr(req);
  if (scope instanceof NextResponse) return scope;
  const { id } = await ctx.params;
  const { db, file } = find(scope, id);
  if (!file) return NextResponse.json({ error: "Fichier introuvable." }, { status: 404 });
  const w = getWorkspace(db, scope.student.id);
  w.files = w.files.filter((f) => f.id !== id);
  w.updatedAt = new Date().toISOString();
  writeDB(db);
  removeFileFromDisk(file);
  return NextResponse.json({ ok: true });
}
