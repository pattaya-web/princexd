import { NextRequest } from "next/server";
import { getSettings, saveSettings } from "@/lib/db";
import { readSession, requireAdmin, requireOutreach } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { DEFAULT_OUTREACH_MESSAGE } from "@/lib/outreach";

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
    return { message: getSettings().outreachMessage ?? DEFAULT_OUTREACH_MESSAGE };
  });
}

export async function PATCH(req: NextRequest) {
  return handle(async () => {
    requireAdmin(readSession(req));
    const body = (await req.json().catch(() => ({}))) as { message?: unknown };
    const message = typeof body.message === "string" ? body.message.trim().slice(0, 2000) : "";
    saveSettings({ outreachMessage: message || DEFAULT_OUTREACH_MESSAGE });
    return { message: message || DEFAULT_OUTREACH_MESSAGE };
  });
}
