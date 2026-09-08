import { NextRequest, NextResponse } from "next/server";
import { getSettings } from "@/lib/db";

export const dynamic = "force-dynamic";

const ROLE_COOKIE = "mvp_role";

/** Le rôle courant, pour que /monteur sache s'il doit afficher le formulaire. */
export async function GET(req: NextRequest) {
  return NextResponse.json({
    role: req.cookies.get(ROLE_COOKIE)?.value ?? "anonyme",
    codeDefini: Boolean(getSettings().editorAccessCode.trim()),
  });
}

export async function POST(req: NextRequest) {
  const { code } = (await req.json()) as { code?: string };
  const expected = getSettings().editorAccessCode.trim();

  if (!expected) {
    return NextResponse.json(
      { error: "Aucun code monteur n'a encore été défini. À configurer dans Réglages." },
      { status: 400 },
    );
  }
  if (!code?.trim() || code.trim() !== expected) {
    return NextResponse.json({ error: "Code incorrect." }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ROLE_COOKIE, "editor", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}

/** Déconnexion du monteur. */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(ROLE_COOKIE);
  return res;
}
