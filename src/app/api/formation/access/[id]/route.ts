import { NextRequest } from "next/server";
import { readDB, writeDB } from "@/lib/db";
import { hashPassword, readSession, requireAdmin } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { toAccessRow } from "@/lib/formation";
import { checkStudentUsername } from "@/lib/formation-server";

export const dynamic = "force-dynamic";

/**
 * Identifiants et acces d'un eleve a la plateforme.
 *
 * L'identifiant suffit a entrer (prenom.nom). Un mot de passe reste possible
 * (hache, jamais relu) pour qui en veut un. `portalAccess` coupe ou rouvre
 * l'acces sans toucher aux identifiants.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    requireAdmin(readSession(req));
    const { id } = await ctx.params;
    const raw = (await req.json().catch(() => ({}))) as { username?: unknown; password?: unknown; portalAccess?: unknown };
    const db = readDB();
    const s = db.students.find((x) => x.id === id);
    if (!s) throw new Error("Élève introuvable.");

    if (typeof raw.username === "string") {
      const first = !s.username;
      s.username = checkStudentUsername(raw.username, s.id);
      // Un identifiant suffit : le poser ouvre l'acces, sauf demande contraire.
      if (first && raw.portalAccess === undefined && typeof raw.password !== "string") s.portalAccess = true;
    }

    if (typeof raw.password === "string" && raw.password) {
      if (raw.password.length < 6) throw new Error("Mot de passe trop court : 6 caractères minimum.");
      if (!s.username) throw new Error("Définis d'abord un identifiant.");
      const first = !s.passwordHash;
      s.passwordHash = hashPassword(raw.password);
      if (first && raw.portalAccess === undefined) s.portalAccess = true;
    }

    if (typeof raw.portalAccess === "boolean") {
      if (raw.portalAccess && !s.username) {
        throw new Error("Définis un identifiant avant d'ouvrir l'accès.");
      }
      s.portalAccess = raw.portalAccess;
    }

    writeDB(db);
    const published = new Set(db.courseModules.filter((m) => m.published).map((m) => m.id));
    return toAccessRow(s, published);
  });
}
