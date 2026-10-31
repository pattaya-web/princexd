import { NextRequest } from "next/server";
import { readDB, withKieKey, writeDB } from "@/lib/db";
import { getCredits } from "@/lib/kie";
import { Forbidden, readSession } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { checkKieKey, maskKey } from "@/lib/studio-members";

export const dynamic = "force-dynamic";

export interface StudioMemberMe {
  name: string;
  firstName: string;
  preview: boolean;
  hasKey: boolean;
  keyMask: string;
  /** Solde KIE du membre, null sans clé ou clé refusée. */
  credits: number | null;
  creditsError: string;
}

function memberOf(req: NextRequest) {
  const session = readSession(req);
  if (session.role !== "studio") throw new Forbidden("Réservé aux membres Studio IA.");
  const db = readDB();
  const member = db.studioMembers.find((m) => m.id === session.memberId);
  if (!member) throw new Forbidden("Accès refusé.");
  return { session, db, member };
}

/** Le membre Studio connecté : sa clé (masquée) et son solde KIE. */
export async function GET(req: NextRequest) {
  return handle(async (): Promise<StudioMemberMe> => {
    const { session, member } = memberOf(req);
    const key = (member.kieApiKey ?? "").trim();
    let credits: number | null = null;
    let creditsError = "";
    if (key) {
      try {
        credits = await withKieKey(key, () => getCredits());
      } catch (e) {
        creditsError = (e as Error).message;
      }
    }
    return {
      name: member.name,
      firstName: member.name.trim().split(/\s+/)[0] ?? member.name,
      preview: Boolean(session.impersonated),
      hasKey: Boolean(key),
      keyMask: maskKey(key),
      credits,
      creditsError,
    };
  });
}

/** Le membre pose, remplace ou efface (« CLEAR ») sa clé KIE, vérifiée auprès de KIE avant d'être gardée. */
export async function PATCH(req: NextRequest) {
  return handle(async (): Promise<{ ok: true; preview: boolean; credits: number | null }> => {
    const { session } = memberOf(req);
    const key = String(((await req.json().catch(() => ({}))) as { kieApiKey?: string }).kieApiKey ?? "").trim();
    if (session.impersonated) return { ok: true, preview: true, credits: null };
    const credits = key === "CLEAR" ? null : await checkKieKey(key);
    // Relue après l'appel à KIE : une génération a pu s'écrire entre-temps.
    const { db, member } = memberOf(req);
    if (key === "CLEAR") delete member.kieApiKey;
    else member.kieApiKey = key.slice(0, 200);
    writeDB(db);
    return { ok: true, preview: false, credits };
  });
}
