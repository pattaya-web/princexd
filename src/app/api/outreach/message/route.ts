import { NextRequest } from "next/server";
import { getSettings, saveSettings } from "@/lib/db";
import { readSession, requireAdmin, requireOutreach } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { DEFAULT_OUTREACH_DAILY_GOAL, DEFAULT_OUTREACH_MESSAGE } from "@/lib/outreach";

export const dynamic = "force-dynamic";

/**
 * Le message que la VA envoie en DM.
 *
 * Un seul texte, ecrit par l'admin, lu par la VA avec un bouton « Copier » :
 * elle n'a jamais a le retaper ni a le chercher ailleurs. Route a part de
 * /api/settings, que la VA ne doit pas pouvoir lire.
 */
export async function GET(req: NextRequest) {
  return handle(() => {
    requireOutreach(readSession(req));
    const s = getSettings();
    return { message: s.outreachMessage ?? DEFAULT_OUTREACH_MESSAGE, dailyGoal: s.outreachDailyGoal || DEFAULT_OUTREACH_DAILY_GOAL };
  });
}

export async function PATCH(req: NextRequest) {
  return handle(async () => {
    requireAdmin(readSession(req));
    const body = (await req.json().catch(() => ({}))) as { message?: unknown; dailyGoal?: unknown };
    const patch: { outreachMessage?: string; outreachDailyGoal?: number } = {};
    if (typeof body.message === "string") patch.outreachMessage = body.message.trim().slice(0, 2000) || DEFAULT_OUTREACH_MESSAGE;
    if (body.dailyGoal !== undefined) {
      const n = Math.round(Number(body.dailyGoal));
      if (!Number.isFinite(n) || n < 1 || n > 5000) throw new Error("L'objectif du jour doit être un nombre entre 1 et 5000.");
      patch.outreachDailyGoal = n;
    }
    const s = saveSettings(patch);
    return { message: s.outreachMessage ?? DEFAULT_OUTREACH_MESSAGE, dailyGoal: s.outreachDailyGoal || DEFAULT_OUTREACH_DAILY_GOAL };
  });
}
