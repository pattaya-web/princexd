import { NextRequest } from "next/server";
import { readSession, requireSales } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { updateFollowUp } from "@/lib/sales/repo";
import { FOLLOWUP_HEATS, type FollowUp, type FollowUpHeat } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Modification d'une relance :
 *  - status  : done | cancelled | pending (rouvrir) ;
 *  - dueAt   : nouvelle date (report) ;
 *  - notes   : texte libre de la relance ;
 *  - note    : ligne ajoutee au journal (« message envoyé sur WhatsApp ») ;
 *  - contact : vrai si cette ligne est un contact effectif avec le prospect ;
 *  - heat    : chaleur du prospect (hot | warm | cold, "" pour retirer).
 * La ligne reste en base dans tous les cas.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = requireSales(readSession(req));
    const { id } = await ctx.params;
    const b = (await req.json()) as { status?: string; dueAt?: string; notes?: string; note?: string; contact?: boolean; heat?: string };
    const patch: Parameters<typeof updateFollowUp>[2] = {};
    if (b.status !== undefined) {
      if (b.status !== "done" && b.status !== "cancelled" && b.status !== "pending") throw new Error("Statut de relance invalide.");
      patch.status = b.status as FollowUp["status"];
    }
    if (typeof b.dueAt === "string") patch.dueAt = b.dueAt;
    if (typeof b.notes === "string") patch.notes = b.notes;
    if (typeof b.note === "string") patch.note = b.note;
    if (typeof b.contact === "boolean") patch.contact = b.contact;
    if (b.heat !== undefined) {
      if (b.heat !== "" && !FOLLOWUP_HEATS.includes(b.heat as FollowUpHeat)) throw new Error("Chaleur inconnue.");
      patch.heat = b.heat as FollowUpHeat | "";
    }
    return updateFollowUp(session, id, patch);
  });
}
