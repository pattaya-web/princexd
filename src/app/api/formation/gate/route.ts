import { NextRequest } from "next/server";
import { readDB, writeDB } from "@/lib/db";
import { readSession, requireFormation } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { gateState, isGateTab, type GateState } from "@/lib/formation-gate";
import { escTelegram, notifyOwner } from "@/lib/telegram";

export const dynamic = "force-dynamic";

export interface GatePayload extends GateState {
  isAdmin: boolean;
  preview: boolean;
  /** Vrai quand il y a un élève derrière la session (élève connecté, ou admin en « Voir comme »). */
  hasStudent: boolean;
}

function studentOf(req: NextRequest) {
  const session = requireFormation(readSession(req));
  const db = readDB();
  const student = session.role === "student" ? db.students.find((s) => s.id === session.memberId) : undefined;
  return { session, db, student };
}

/** L'état du parcours de l'élève connecté : quels onglets sont ouverts, lesquels sont faits. */
export async function GET(req: NextRequest) {
  return handle((): GatePayload => {
    const { session, student } = studentOf(req);
    return { ...gateState(student, { admin: session.isAdmin }), isAdmin: session.isAdmin, preview: Boolean(session.impersonated), hasStudent: Boolean(student) };
  });
}

/**
 * L'élève avance :
 *  - « request » : il a rempli le formulaire d'onboarding et demande l'accès (Mady est prévenue sur Telegram) ;
 *  - « done » + tab : il marque une étape débloquée comme faite (ou la rouvre avec done: false).
 */
export async function POST(req: NextRequest) {
  return handle(async (): Promise<GatePayload> => {
    const { session, db, student } = studentOf(req);
    const body = (await req.json().catch(() => ({}))) as { action?: string; tab?: string; done?: boolean };
    const view = (): GatePayload => ({ ...gateState(student, { admin: session.isAdmin }), isAdmin: session.isAdmin, preview: Boolean(session.impersonated), hasStudent: Boolean(student) });
    if (!student) {
      if (session.isAdmin) return view();
      throw new Error("Élève introuvable.");
    }
    if (session.impersonated) return view();

    const now = new Date().toISOString();
    if (body.action === "request") {
      if (!student.accessRequestedAt) {
        student.accessRequestedAt = now;
        writeDB(db);
        notifyOwner(`📝 <b>${escTelegram(student.name)}</b> a rempli le formulaire d'onboarding.\nÀ voir sur ton tableau de bord (bouton « Vu »).`);
      }
      return view();
    }
    if (body.action === "done") {
      if (!isGateTab(body.tab)) throw new Error("Étape inconnue.");
      const state = gateState(student);
      const tab = state.tabs.find((t) => t.key === body.tab)!;
      if (!tab.unlocked) throw new Error("Cette étape n'est pas encore débloquée.");
      const cur = new Set(student.tabsDone ?? []);
      if (body.done === false) cur.delete(tab.key);
      else cur.add(tab.key);
      student.tabsDone = Array.from(cur);
      writeDB(db);
      return view();
    }
    throw new Error("Action inconnue.");
  });
}
