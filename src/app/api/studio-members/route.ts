import { NextRequest } from "next/server";
import { newId, readDB, writeDB } from "@/lib/db";
import { readSession, requireAdmin } from "@/lib/sales/access";
import { handle, required } from "@/lib/sales/http";
import { checkKieKey, cleanUsername, memberView, usernameTaken, type StudioMemberView } from "@/lib/studio-members";
import type { StudioMember } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Accès Studio IA (admin) : créer, couper, renommer, changer la langue ou la
 * clé KIE d'un membre Studio. Pas de mot de passe : l'identifiant suffit.
 */
export async function GET(req: NextRequest) {
  return handle((): { members: StudioMemberView[] } => {
    requireAdmin(readSession(req));
    return { members: readDB().studioMembers.map(memberView) };
  });
}

export async function POST(req: NextRequest) {
  return handle(async (): Promise<{ member: StudioMemberView }> => {
    requireAdmin(readSession(req));
    const b = (await req.json().catch(() => ({}))) as { name?: string; username?: string; lang?: string; notes?: string };
    const name = required(b.name, "Le nom");
    const username = cleanUsername(b.username || name);
    if (usernameTaken(username)) throw new Error(`L'identifiant « ${username} » est déjà pris.`);
    const db = readDB();
    const member: StudioMember = {
      id: newId(),
      name: name.slice(0, 80),
      username,
      lang: b.lang === "en" ? "en" : "fr",
      active: true,
      notes: (b.notes ?? "").trim().slice(0, 500),
      createdAt: new Date().toISOString(),
    };
    db.studioMembers.push(member);
    writeDB(db);
    return { member: memberView(member) };
  });
}

export async function PATCH(req: NextRequest) {
  return handle(async (): Promise<{ member: StudioMemberView; credits?: number }> => {
    requireAdmin(readSession(req));
    const b = (await req.json().catch(() => ({}))) as {
      id?: string;
      name?: string;
      username?: string;
      active?: boolean;
      notes?: string;
      lang?: string;
      kieApiKey?: string;
    };
    if (!readDB().studioMembers.some((m) => m.id === b.id)) throw new Error("Membre Studio introuvable.");
    const newKey = typeof b.kieApiKey === "string" ? b.kieApiKey.trim() : null;
    // Vérifiée avant de relire la base : une génération a pu s'écrire pendant l'appel à KIE.
    const credits = newKey && newKey !== "CLEAR" ? await checkKieKey(newKey) : undefined;
    const db = readDB();
    const member = db.studioMembers.find((m) => m.id === b.id);
    if (!member) throw new Error("Membre Studio introuvable.");
    if (typeof b.name === "string" && b.name.trim()) member.name = b.name.trim().slice(0, 80);
    if (typeof b.username === "string") {
      const username = cleanUsername(b.username);
      if (usernameTaken(username, member.id)) throw new Error(`L'identifiant « ${username} » est déjà pris.`);
      member.username = username;
    }
    if (typeof b.active === "boolean") member.active = b.active;
    if (typeof b.notes === "string") member.notes = b.notes.trim().slice(0, 500);
    if (b.lang === "en" || b.lang === "fr") member.lang = b.lang;
    if (newKey === "CLEAR") delete member.kieApiKey;
    else if (newKey) member.kieApiKey = newKey.slice(0, 200);
    writeDB(db);
    return { member: memberView(member), ...(credits !== undefined ? { credits } : {}) };
  });
}

/** Supprime la fiche : l'accès tombe. Ses créations restent sur le serveur, invisibles (propriétaire disparu). */
export async function DELETE(req: NextRequest) {
  return handle((): { ok: true } => {
    requireAdmin(readSession(req));
    const id = req.nextUrl.searchParams.get("id") ?? "";
    const db = readDB();
    const before = db.studioMembers.length;
    db.studioMembers = db.studioMembers.filter((m) => m.id !== id);
    if (db.studioMembers.length === before) throw new Error("Membre Studio introuvable.");
    writeDB(db);
    return { ok: true };
  });
}
