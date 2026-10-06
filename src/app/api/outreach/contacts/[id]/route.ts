import { NextRequest } from "next/server";
import { readDB, writeDB } from "@/lib/db";
import { Forbidden, readSession, requireOutreach } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { dailyProgress, isOutreachStatus } from "@/lib/outreach";

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
    if (!isOutreachStatus(body.status)) throw new Error("Unknown status.");
    if (body.status === "to-contact" && !session.isAdmin) {
      throw new Forbidden("Only the admin can set a contact back to “To Contact”.");
    }
    const db = readDB();
    const contact = db.outreachContacts.find((c) => c.id === id);
    if (!contact) throw new Error("Contact not found.");
    if (contact.status !== body.status) {
      const now = new Date().toISOString();
      // Premier DM : on date le passage hors de « To Contact », une fois pour toutes.
      if (!contact.contactedAt && contact.status === "to-contact" && body.status !== "to-contact") contact.contactedAt = now;
      // L'admin remet en « To Contact » : le DM n'a pas eu lieu, il ne compte plus.
      if (body.status === "to-contact") contact.contactedAt = undefined;
      contact.status = body.status;
      contact.statusAt = now;
      writeDB(db);
    }
    return { contact, today: dailyProgress(db.outreachContacts, db.settings.outreachDailyGoal) };
  });
}
