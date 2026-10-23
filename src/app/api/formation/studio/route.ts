import { NextRequest } from "next/server";
import { readDB, withKieKey, writeDB } from "@/lib/db";
import { getCredits } from "@/lib/kie";
import { readSession, requireFormation } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";

export const dynamic = "force-dynamic";

export interface StudentStudioPayload {
  student: { id: string; name: string; firstName: string } | null;
  isAdmin: boolean;
  preview: boolean;
  /** Studio ouvert par Mady pour cet élève. */
  access: boolean;
  hasKey: boolean;
  /** Clé masquée (début et fin), vide sans clé. */
  keyMask: string;
  /** Solde KIE de l'élève, null si pas de clé ou clé refusée. */
  credits: number | null;
  creditsError: string;
}

const mask = (k: string) => (k ? `${k.slice(0, 6)}…${k.slice(-4)}` : "");

function studentOf(req: NextRequest) {
  const session = requireFormation(readSession(req));
  const db = readDB();
  const student = session.role === "student" ? db.students.find((s) => s.id === session.memberId) : undefined;
  return { session, db, student };
}

/** État du Studio IA pour l'élève connecté : accès, clé, solde. */
export async function GET(req: NextRequest) {
  return handle(async (): Promise<StudentStudioPayload> => {
    const { session, student } = studentOf(req);
    const key = (student?.kieApiKey ?? "").trim();
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
      student: student ? { id: student.id, name: student.name, firstName: student.name.trim().split(/\s+/)[0] ?? student.name } : null,
      isAdmin: session.isAdmin,
      preview: Boolean(session.impersonated),
      access: student ? Boolean(student.studioAccess) : session.isAdmin,
      hasKey: Boolean(key),
      keyMask: mask(key),
      credits,
      creditsError,
    };
  });
}

/** L'élève pose (ou remplace, ou efface avec « CLEAR ») sa clé KIE. Vérifiée auprès de KIE avant d'être gardée. */
export async function PATCH(req: NextRequest) {
  return handle(async (): Promise<{ ok: true; preview: boolean; credits: number | null }> => {
    const { session, db, student } = studentOf(req);
    const body = (await req.json().catch(() => ({}))) as { kieApiKey?: string };
    const key = (body.kieApiKey ?? "").trim();
    if (!student) {
      if (session.isAdmin) return { ok: true, preview: true, credits: null };
      throw new Error("Élève introuvable.");
    }
    if (session.impersonated) return { ok: true, preview: true, credits: null };
    if (key === "CLEAR") {
      delete student.kieApiKey;
      writeDB(db);
      return { ok: true, preview: false, credits: null };
    }
    if (key.length < 10) throw new Error("Colle ta clé API KIE complète (kie.ai → API Key).");
    let credits: number;
    try {
      credits = await withKieKey(key, () => getCredits());
    } catch (e) {
      throw new Error(`KIE refuse cette clé : ${(e as Error).message}. Vérifie-la sur kie.ai → API Key.`);
    }
    student.kieApiKey = key.slice(0, 200);
    writeDB(db);
    return { ok: true, preview: false, credits };
  });
}
