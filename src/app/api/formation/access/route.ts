import { NextRequest } from "next/server";
import { readDB } from "@/lib/db";
import { readSession, requireAdmin } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { toAccessRow, type StudentAccessRow } from "@/lib/formation";

export const dynamic = "force-dynamic";

export interface StudentAccessPayload {
  students: StudentAccessRow[];
  /** Nombre de modules publies : le denominateur de l'avancement. */
  publishedModules: number;
}

/** Tous les eleves du CRM avec l'etat de leur acces a la plateforme. */
export async function GET(req: NextRequest) {
  return handle((): StudentAccessPayload => {
    requireAdmin(readSession(req));
    const db = readDB();
    const published = new Set(db.courseModules.filter((m) => m.published).map((m) => m.id));
    const students = db.students
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, "fr"))
      .map((s) => toAccessRow(s, published));
    return { students, publishedModules: published.size };
  });
}
