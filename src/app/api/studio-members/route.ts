import { NextRequest } from "next/server";
import { newId, readDB, writeDB } from "@/lib/db";
import { hashPassword, readSession, requireAdmin } from "@/lib/sales/access";
import { handle, required } from "@/lib/sales/http";
import { checkKieKey, cleanUsername, generatePassword, memberView, usernameTaken, type StudioMemberView } from "@/lib/studio-members";
import type { StudioMember } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Accès Studio IA (admin) : créer, couper, renommer, changer le mot de passe
 * ou la clé KIE d'un membre Studio. Le mot de passe en clair n'est rendu
 * qu'une fois, dans la réponse qui le crée, pour le message à envoyer.
 */
export async function GET(req: NextRequest) {
  return handle((): { members: StudioMemberView[] } => {
    requireAdmin(readSession(req));
    return { members: readDB().studioMembers.map(memberView) };
  });
}

export async function POST(req: NextRequest) {
  return handle(async (): Promise<{ member: StudioMemberView; password: string }> => {
    requireAdmin(readSession(req));
    const b = (await req.json().catch(() => ({}))) as { name?: string; username?: string; password?: string; notes?: string };
    const name = required(b.name, "Le nom");
    const username = cleanUsername(b.username || name);
    if (usernameTaken(username)) throw new Error(`L'identifiant « ${username} » est déjà pris.`);
    const password = (b.password ?? "").trim() || generatePassword();
    if (password.length < 6) throw new Error("Mot de passe : 6 caractères minimum.");
    const db = readDB();
    const member: StudioMember = {
      id: newId(),
      name: name.slice(0, 80),
      username,
      passwordHash: hashPassword(password),
      active: true,
      notes: (b.notes ?? "").trim().slice(0, 500),
      createdAt: new Date().toISOString(),
    };
    db.studioMembers.push(member);
    writeDB(db);
    return { member: memberView(member), password };
  });
}

export async function PATCH(req: NextRequest) {
  return handle(async (): Promise<{ member: StudioMemberView; password?: string; credits?: number }> => {
    requireAdmin(readSession(req));
    const b = (await req.json().catch(() => ({}))) as {
      id?: string;
      name?: string;
      username?: string;
      active?: boolean;
      notes?: string;
      /** « RESET » : nouveau mot de passe généré, rendu une fois. */
      password?: string;
      kieApiKey?: string;
    };
    if (!readDB().studioMembers.some((m) => m.id === b.id)) throw new Error("Membre Studio introuvable.");
    const newKey = typeof b.kieApiKey === "string" ? b.kieApiKey.trim() : null;
    // Vérifiée avant de relire la base : une génération a pu s'écrire pendant l'appel à KIE.
    const credits = newKey && newKey !== "CLEAR" ? await checkKieKey(newKey) : undefined;
    const db = readDB();
    const member = db.studioMembers.find((m) => m.id === b.id);
    if (!member) throw new Error("Membre Studio introuvable.");
    let password: string | undefined;
    if (typeof b.name === "string" && b.name.trim()) member.name = b.name.trim().slice(0, 80);
    if (typeof b.username === "string") {
      const username = cleanUsername(b.username);
      if (usernameTaken(username, member.id)) throw new Error(`L'identifiant « ${username} » est déjà pris.`);
      member.username = username;
    }
    if (typeof b.active === "boolean") member.active = b.active;
    if (typeof b.notes === "string") member.notes = b.notes.trim().slice(0, 500);
    if (typeof b.password === "string" && b.password.trim()) {
      password = b.password.trim() === "RESET" ? generatePassword() : b.password.trim();
      if (password.length < 6) throw new Error("Mot de passe : 6 caractères minimum.");
      member.passwordHash = hashPassword(password);
    }
    if (newKey === "CLEAR") delete member.kieApiKey;
    else if (newKey) member.kieApiKey = newKey.slice(0, 200);
    writeDB(db);
    return { member: memberView(member), ...(password ? { password } : {}), ...(credits !== undefined ? { credits } : {}) };
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
