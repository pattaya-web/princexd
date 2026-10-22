import { NextRequest } from "next/server";
import { readSession, requireAdmin } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { chatContext, confirmNewStudent, parseNewStudent } from "@/lib/eleves/new-student";
import type { NewStudentDraft } from "@/lib/eleves/draft";

export const dynamic = "force-dynamic";

/** Contexte du chat : offres, setters, devise, date du jour. */
export async function GET(req: NextRequest) {
  return handle(() => {
    requireAdmin(readSession(req));
    return chatContext();
  });
}

/**
 * Chat « Nouvel élève ».
 *  - action "parse"   : lit le message, renvoie le brouillon à valider (rien n'est écrit) ;
 *  - action "confirm" : écrit lead, vente, élève, accès, et renvoie le message d'onboarding.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const session = requireAdmin(readSession(req));
    const body = (await req.json().catch(() => ({}))) as { action?: string; message?: string; draft?: NewStudentDraft };
    const message = (body.message ?? "").trim();
    if (body.action === "confirm") {
      if (!body.draft) throw new Error("Brouillon manquant.");
      return confirmNewStudent(session, body.draft, message);
    }
    if (!message) throw new Error("Écris-moi qui a rejoint, le montant et d'où il vient.");
    return parseNewStudent(message);
  });
}
