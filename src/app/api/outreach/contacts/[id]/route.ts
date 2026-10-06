import { NextRequest } from "next/server";
import { readDB, writeDB } from "@/lib/db";
import { Forbidden, readSession, requireOutreach } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { isOutreachStatus } from "@/lib/outreach";

export const dynamic = "force-dynamic";

/**
 * Changement de statut d'un contact : la seule ecriture de la VA.
 *
 * Enregistre tout de suite, sans confirmation : c'est ce qui permet de
 * traiter des centaines de profils a la chaine. Remettre un contact en
 * « To Contact » est reserve a l'admin.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = requireOutreach(readSession(req));
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as { status?: unknown };
    if (!isOutreachStatus(body.status)) throw new Error("Statut inconnu.");
    if (body.status === "to-contact" && !session.isAdmin) {
      throw new Forbidden("Seul l'administrateur peut remettre un contact en « To Contact ».");
    }
    const db = readDB();
    const contact = db.outreachContacts.find((c) => c.id === id);
    if (!contact) throw new Error("Contact introuvable.");
    if (contact.status !== body.status) {
      contact.status = body.status;
      contact.statusAt = new Date().toISOString();
      writeDB(db);
    }
    return { contact };
  });
}
