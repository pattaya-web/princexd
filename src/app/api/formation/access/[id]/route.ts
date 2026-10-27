import { NextRequest } from "next/server";
import { readDB, writeDB } from "@/lib/db";
import { readSession, requireAdmin } from "@/lib/sales/access";
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
    const raw = (await req.json().catch(() => ({}))) as { username?: unknown; portalAccess?: unknown; studioAccess?: unknown; kieApiKey?: unknown; accessApproved?: unknown };
    const db = readDB();
    const s = db.students.find((x) => x.id === id);
    if (!s) throw new Error("Élève introuvable.");

    if (typeof raw.username === "string") {
      const first = !s.username;
      s.username = checkStudentUsername(raw.username, s.id);
      // Un identifiant suffit : le poser ouvre l'acces, sauf demande contraire.
      if (first && raw.portalAccess === undefined) s.portalAccess = true;
      // Plus de mot de passe eleve depuis le 2026-10-27 : un ancien hash est efface.
      delete s.passwordHash;
    }

    if (typeof raw.portalAccess === "boolean") {
      if (raw.portalAccess && !s.username) {
        throw new Error("Définis un identifiant avant d'ouvrir l'accès.");
      }
      s.portalAccess = raw.portalAccess;
    }

    // Studio IA : ouvert par l'admin ; la cle KIE peut aussi etre posee ici (vide = inchangee, « CLEAR » = effacee).
    if (typeof raw.studioAccess === "boolean") s.studioAccess = raw.studioAccess;
    if (typeof raw.kieApiKey === "string") {
      const k = raw.kieApiKey.trim();
      if (k === "CLEAR") delete s.kieApiKey;
      else if (k) s.kieApiKey = k.slice(0, 200);
    }

    // Parcours : Mady confirme qu'elle a le formulaire d'onboarding, Démarrage s'ouvre (ou se referme).
    if (typeof raw.accessApproved === "boolean") {
      if (raw.accessApproved) s.accessApprovedAt = s.accessApprovedAt || new Date().toISOString();
      else delete s.accessApprovedAt;
    }

    writeDB(db);
    const published = new Set(db.courseModules.filter((m) => m.published).map((m) => m.id));
    return toAccessRow(s, published);
  });
}
