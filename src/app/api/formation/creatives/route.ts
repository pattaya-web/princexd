import { NextRequest } from "next/server";
import { readDB, writeDB } from "@/lib/db";
import { readSession, requireAdmin, requireFormation } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { creativesSettings, readCreativesSettings } from "@/lib/formation-creatives";
import type { StudentCreativesSettings } from "@/lib/types";

export const dynamic = "force-dynamic";

export interface CreativesPayload {
  student: { id: string; name: string; firstName: string } | null;
  isAdmin: boolean;
  preview: boolean;
  creatives: StudentCreativesSettings;
  /** Studio IA : ouvert par Mady pour cet élève, clé KIE posée. */
  studio: { access: boolean; hasKey: boolean };
}

/** Page Créatives : boutique exemple, créatives exemples, prompts à copier. */
export async function GET(req: NextRequest) {
  return handle((): CreativesPayload => {
    const session = requireFormation(readSession(req));
    const db = readDB();
    const student = session.role === "student" ? db.students.find((s) => s.id === session.memberId) : undefined;
    return {
      student: student ? { id: student.id, name: student.name, firstName: student.name.trim().split(/\s+/)[0] ?? student.name } : null,
      isAdmin: session.isAdmin,
      preview: Boolean(session.impersonated),
      creatives: creativesSettings(db.settings),
      studio: { access: student ? Boolean(student.studioAccess) : session.isAdmin, hasKey: Boolean((student?.kieApiKey ?? "").trim()) },
    };
  });
}

/** Admin : enregistre la page entière (boutique exemple, exemples, prompts). */
export async function PATCH(req: NextRequest) {
  return handle(async (): Promise<{ creatives: StudentCreativesSettings }> => {
    requireAdmin(readSession(req));
    const body = (await req.json().catch(() => ({}))) as Partial<StudentCreativesSettings>;
    const db = readDB();
    db.settings.studentCreatives = readCreativesSettings(body);
    writeDB(db);
    return { creatives: creativesSettings(db.settings) };
  });
}
