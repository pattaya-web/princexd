import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { getSettings, newId, saveSettings } from "@/lib/db";
import { refuseUnless } from "@/lib/sales/access";
import { themeZipUrl } from "@/lib/boutique/build";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/*
 * Cette route est hors du middleware (elle reçoit un fichier) : elle vérifie
 * la session elle-même, admin seulement.
 */
const DIR = path.join(process.cwd(), "data", "boutiques");
const MAX_BYTES = 60 * 1024 * 1024;

export async function GET(req: NextRequest) {
  const denied = refuseUnless(req, []);
  if (denied) return denied;
  const z = getSettings().shopThemeZip;
  return NextResponse.json(z ? { name: z.name, size: z.size, uploadedAt: z.uploadedAt, url: themeZipUrl() } : null);
}

/** Corps brut = le zip ; `x-file-name` = son nom d'origine. */
export async function POST(req: NextRequest) {
  const denied = refuseUnless(req, []);
  if (denied) return denied;
  const name = decodeURIComponent(req.headers.get("x-file-name") ?? "theme.zip");
  if (!name.toLowerCase().endsWith(".zip")) return NextResponse.json({ error: "Dépose le zip du thème (export Shopify)." }, { status: 400 });
  const buf = Buffer.from(await req.arrayBuffer());
  if (!buf.length) return NextResponse.json({ error: "Fichier vide." }, { status: 400 });
  if (buf.length > MAX_BYTES) return NextResponse.json({ error: "Zip trop lourd (60 Mo max)." }, { status: 413 });
  // Signature zip « PK ».
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) return NextResponse.json({ error: "Ce fichier n'est pas un zip." }, { status: 400 });

  await fs.mkdir(DIR, { recursive: true });
  const previous = getSettings().shopThemeZip;
  const file = `theme-${newId()}.zip`;
  await fs.writeFile(path.join(DIR, file), buf);
  const token = `${newId()}${newId()}`;
  saveSettings({ shopThemeZip: { file, name, size: buf.length, uploadedAt: new Date().toISOString(), token } });
  if (previous?.file) await fs.rm(path.join(DIR, previous.file), { force: true });
  return NextResponse.json({ name, size: buf.length, url: themeZipUrl() });
}

export async function DELETE(req: NextRequest) {
  const denied = refuseUnless(req, []);
  if (denied) return denied;
  const z = getSettings().shopThemeZip;
  if (z?.file) await fs.rm(path.join(DIR, z.file), { force: true });
  saveSettings({ shopThemeZip: null });
  return NextResponse.json({ ok: true });
}
