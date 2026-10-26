import { NextRequest } from "next/server";
import { readDB, writeDB } from "@/lib/db";
import { readSession, requireAdmin, requireFormation } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { methodSettings, readMethodSettings } from "@/lib/formation-methode";
import { creativesSettings } from "@/lib/formation-creatives";
import { portalSettings } from "@/lib/formation-steps";
import { currentTheme } from "@/lib/formation-theme";
import { onboardingSettings } from "@/lib/onboarding";
import type { StudentMethodSettings } from "@/lib/types";

export const dynamic = "force-dynamic";

export interface MethodPayload {
  student: { id: string; name: string; firstName: string } | null;
  isAdmin: boolean;
  preview: boolean;
  method: StudentMethodSettings;
  /** Numéro WhatsApp de Mady (vide = pas de bouton d'envoi, copie seulement). */
  whatsapp: string;
  /** Le thème de Mady, s'il est déposé. */
  theme: { fileName: string; size: number; uploadedAt: string; downloadUrl: string; bundled: boolean } | null;
  /** Boutique exemple (réglée dans Créatives). */
  exampleShopUrl: string;
  /** Studio IA : ouvert par Mady pour cet élève, clé KIE posée. */
  studio: { access: boolean; hasKey: boolean };
  /** BrandSearch avec le lien affilié de Mady (Élèves → Onboarding). */
  brandsearchUrl: string;
}

/** Pages Recherche produit et Ta boutique : consignes, vidéo, thème, état du Studio. */
export async function GET(req: NextRequest) {
  return handle((): MethodPayload => {
    const session = requireFormation(readSession(req));
    const db = readDB();
    const student = session.role === "student" ? db.students.find((s) => s.id === session.memberId) : undefined;
    const theme = currentTheme(db.settings);
    return {
      student: student ? { id: student.id, name: student.name, firstName: student.name.trim().split(/\s+/)[0] ?? student.name } : null,
      isAdmin: session.isAdmin,
      preview: Boolean(session.impersonated),
      method: methodSettings(db.settings),
      whatsapp: portalSettings(db.settings).whatsapp,
      theme: theme ? { fileName: theme.fileName, size: theme.size, uploadedAt: theme.uploadedAt, downloadUrl: "/api/formation/theme/file", bundled: theme.bundled } : null,
      exampleShopUrl: creativesSettings(db.settings).exampleShopUrl,
      studio: { access: Boolean(student) || session.isAdmin, hasKey: Boolean((student?.kieApiKey ?? "").trim()) },
      brandsearchUrl: onboardingSettings(db.settings).brainsearchUrl,
    };
  });
}

/** Admin : enregistre les consignes (vidéo, nombre de produits, textes, message pour Claude Code). */
export async function PATCH(req: NextRequest) {
  return handle(async (): Promise<{ method: StudentMethodSettings }> => {
    requireAdmin(readSession(req));
    const body = (await req.json().catch(() => ({}))) as Partial<StudentMethodSettings>;
    const db = readDB();
    db.settings.studentMethod = readMethodSettings(body);
    writeDB(db);
    return { method: methodSettings(db.settings) };
  });
}
