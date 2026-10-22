import { NextRequest } from "next/server";
import { readDB, saveSettings, writeDB } from "@/lib/db";
import { readSession, requireAdmin } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { DEFAULT_ONBOARDING_MESSAGE, onboardingSettings } from "@/lib/onboarding";
import type { StudentOnboardingSettings } from "@/lib/types";

export const dynamic = "force-dynamic";

export interface OnboardingStudentRow {
  id: string;
  name: string;
  email: string;
  phone: string;
  username: string;
  hasPassword: boolean;
  portalAccess: boolean;
  onboardingSentAt: string;
  startedAt: string;
}

export interface OnboardingPayload {
  settings: StudentOnboardingSettings;
  defaultMessage: string;
  students: OnboardingStudentRow[];
  baseUrl: string;
}

const BASE = () => (process.env.PUBLIC_BASE_URL?.trim() || "https://mvdyprince.fr").replace(/\/$/, "");

/** Réglages du message d'onboarding et liste des élèves (pour l'aperçu et le suivi « envoyé »). */
export async function GET(req: NextRequest) {
  return handle((): OnboardingPayload => {
    requireAdmin(readSession(req));
    const db = readDB();
    const students = db.students
      .slice()
      .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
      .map((s) => ({
        id: s.id,
        name: s.name,
        email: s.email ?? "",
        phone: s.phone ?? "",
        username: s.username ?? "",
        hasPassword: Boolean(s.passwordHash),
        portalAccess: Boolean(s.portalAccess),
        onboardingSentAt: s.onboardingSentAt ?? "",
        startedAt: s.startedAt ?? "",
      }));
    return { settings: onboardingSettings(db.settings), defaultMessage: DEFAULT_ONBOARDING_MESSAGE, students, baseUrl: BASE() };
  });
}

/** Enregistre liens et texte. Un texte vide remet le message par défaut. */
export async function PATCH(req: NextRequest) {
  return handle(async () => {
    requireAdmin(readSession(req));
    const raw = (await req.json().catch(() => ({}))) as Partial<StudentOnboardingSettings>;
    const current = readDB().settings.studentOnboarding ?? {};
    const pick = (k: keyof StudentOnboardingSettings) => (typeof raw[k] === "string" ? (raw[k] as string).trim() : (current[k] ?? ""));
    const next: StudentOnboardingSettings = {
      formUrl: pick("formUrl"),
      shopifyUrl: pick("shopifyUrl"),
      claudeUrl: pick("claudeUrl"),
      brainsearchUrl: pick("brainsearchUrl"),
      message: typeof raw.message === "string" ? raw.message : (current.message ?? ""),
    };
    for (const k of ["formUrl", "shopifyUrl", "claudeUrl", "brainsearchUrl"] as const) {
      if (next[k] && !/^https?:\/\//i.test(next[k])) throw new Error(`Le lien « ${k} » doit commencer par http:// ou https://.`);
    }
    saveSettings({ studentOnboarding: next });
    return { settings: onboardingSettings({ studentOnboarding: next }) };
  });
}

/** Marque le message comme envoyé (ou pas) à un élève. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    requireAdmin(readSession(req));
    const body = (await req.json().catch(() => ({}))) as { studentId?: string; sent?: boolean };
    const db = readDB();
    const s = db.students.find((x) => x.id === body.studentId);
    if (!s) throw new Error("Élève introuvable.");
    s.onboardingSentAt = body.sent === false ? "" : new Date().toISOString();
    writeDB(db);
    return { onboardingSentAt: s.onboardingSentAt };
  });
}
