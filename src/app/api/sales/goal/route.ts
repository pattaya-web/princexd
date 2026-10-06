import { NextRequest } from "next/server";
import { saveSettings } from "@/lib/db";
import { readSession, requireAdmin } from "@/lib/sales/access";
import { handle, num } from "@/lib/sales/http";

export const dynamic = "force-dynamic";

/**
 * Objectif de cash mensuel de l'equipe commerciale.
 *
 * Modifie depuis le dashboard, en ligne : l'admin ajuste l'objectif du mois
 * sans quitter l'ecran qui le lui montre. Un objectif a 0 l'efface.
 */
export async function PATCH(req: NextRequest) {
  return handle(async () => {
    requireAdmin(readSession(req));
    const body = (await req.json().catch(() => ({}))) as { target?: unknown };
    const target = Math.max(0, Math.round(num(body.target, 0)));
    saveSettings({ salesMonthlyGoal: target });
    return { target };
  });
}
