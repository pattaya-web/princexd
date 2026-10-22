import { NextRequest } from "next/server";
import { readSession, requireAdmin } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { chatContext, confirmNewStudent, parseNewStudent } from "@/lib/eleves/new-student";
import { talkNewStudent } from "@/lib/eleves/talk";
import { assistantSource, type ChatTurn } from "@/lib/assistant";
import type { NewStudentDraft } from "@/lib/eleves/draft";

export const dynamic = "force-dynamic";

/** Contexte du chat : offres, setters, devise, date du jour, et quel assistant répond. */
export async function GET(req: NextRequest) {
  return handle(() => {
    requireAdmin(readSession(req));
    return { ...chatContext(), assistant: assistantSource() };
  });
}

/**
 * Chat « Nouvel élève ».
 *  - action "talk"    : un tour de conversation avec l'assistant (il enregistre après un « ok ») ;
 *  - action "parse"   : lit un message, renvoie le brouillon à valider (rien n'est écrit) ;
 *  - action "confirm" : écrit lead, vente, élève, accès, et renvoie le message d'onboarding.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const session = requireAdmin(readSession(req));
    const body = (await req.json().catch(() => ({}))) as { action?: string; message?: string; draft?: NewStudentDraft; messages?: ChatTurn[] };
    const message = (body.message ?? "").trim();
    if (body.action === "talk") {
      const turns = (body.messages ?? []).filter((t) => (t.role === "user" || t.role === "assistant") && typeof t.content === "string").slice(-40);
      return talkNewStudent(session, turns);
    }
    if (body.action === "confirm") {
      if (!body.draft) throw new Error("Brouillon manquant.");
      return confirmNewStudent(session, body.draft, message);
    }
    if (!message) throw new Error("Écris-moi qui a rejoint, le montant et d'où il vient.");
    return parseNewStudent(message);
  });
}
