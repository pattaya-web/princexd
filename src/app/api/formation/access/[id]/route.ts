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
 * Le mot de passe est hache a la reception et jamais relu : l'admin le
 * communique lui-meme a l'eleve. Le premier mot de passe ouvre l'acces ;
 * ensuite, `portalAccess` le coupe ou le rouvre sans toucher aux identifiants.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    requireAdmin(readSession(req));
    const { id } = await ctx.params;
    const raw = (await req.json().catch(() => ({}))) as { username?: unknown; password?: unknown; portalAccess?: unknown };
    const db = readDB();
    const s = db.students.find((x) => x.id === id);
    if (!s) throw new Error("Élève introuvable.");

    if (typeof raw.username === "string") s.username = checkStudentUsername(raw.username, s.id);

    if (typeof raw.password === "string" && raw.password) {
      if (raw.password.length < 6) throw new Error("Mot de passe trop court : 6 caractères minimum.");
      if (!s.username) throw new Error("Définis d'abord un identifiant.");
      const first = !s.passwordHash;
      s.passwordHash = hashPassword(raw.password);
      if (first && raw.portalAccess === undefined) s.portalAccess = true;
    }

    if (typeof raw.portalAccess === "boolean") {
      if (raw.portalAccess && (!s.username || !s.passwordHash)) {
        throw new Error("Définis un identifiant et un mot de passe avant d'ouvrir l'accès.");
      }
      s.portalAccess = raw.portalAccess;
    }

    writeDB(db);
    const published = new Set(db.courseModules.filter((m) => m.published).map((m) => m.id));
    return toAccessRow(s, published);
  });
}
