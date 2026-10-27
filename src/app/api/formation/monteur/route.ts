import { NextRequest, NextResponse } from "next/server";
import { readDB } from "@/lib/db";
import { issueStudentEditorToken, issueStudentToken, readSession } from "@/lib/sales/access";
import { LEGACY_ROLE_COOKIE, SESSION_COOKIE, SESSION_MAX_AGE_S } from "@/lib/sales/session";

export const dynamic = "force-dynamic";

/**
 * Élève qui est aussi le monteur de Mady (Lucas) : son bouton « Espace
 * monteur » bascule sa session élève vers une session monteur (mêmes droits
 * que le code monteur : vidéos à monter, témoignages, Studio IA), et le
 * bouton « Retour à Scale X » la ramène à sa formation. Un seul compte, un
 * seul identifiant, deux espaces.
 */

const cookie = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_MAX_AGE_S,
  secure: process.env.NODE_ENV === "production",
};

/** Élève → monteur. */
export async function POST(req: NextRequest) {
  const session = readSession(req);
  if (session.role !== "student") return NextResponse.json({ error: "Réservé aux élèves." }, { status: 403 });
  const student = readDB().students.find((s) => s.id === session.memberId);
  if (!student || !student.editorAccess) {
    return NextResponse.json({ error: "Ton compte n'a pas d'espace monteur. Demande à Mady de l'ouvrir dans Accès élèves." }, { status: 403 });
  }
  const res = NextResponse.json({ ok: true, redirect: "/monteur" });
  res.cookies.set(SESSION_COOKIE, issueStudentEditorToken(student), cookie);
  res.cookies.delete(LEGACY_ROLE_COOKIE);
  return res;
}

/** Monteur → élève (retour). */
export async function DELETE(req: NextRequest) {
  const session = readSession(req);
  if (session.role !== "editor" || !session.studentId) return NextResponse.json({ error: "Pas de formation à retrouver." }, { status: 403 });
  const student = readDB().students.find((s) => s.id === session.studentId);
  if (!student || !student.portalAccess) return NextResponse.json({ error: "Ton accès à la formation est fermé." }, { status: 403 });
  const res = NextResponse.json({ ok: true, redirect: "/formation" });
  res.cookies.set(SESSION_COOKIE, issueStudentToken(student), cookie);
  return res;
}
