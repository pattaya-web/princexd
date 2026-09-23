import { NextRequest, NextResponse } from "next/server";
import { readDB, writeDB } from "@/lib/db";
import {
  issueOwnerToken,
  issueToken,
  normalizeUsername,
  ownerAuthEnabled,
  readSession,
  sessionFor,
  verifyOwnerPassword,
  verifyPassword,
} from "@/lib/sales/access";
import { LEGACY_ROLE_COOKIE, peekClaims, SESSION_COOKIE, SESSION_MAX_AGE_S } from "@/lib/sales/session";
import type { TeamMember } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Qui suis-je ? Utilise par le Shell pour n'afficher que le menu autorise. */
export async function GET(req: NextRequest) {
  const session = readSession(req);
  return NextResponse.json(session);
}

/**
 * Connexion d'un membre de l'equipe.
 *
 * Deux formes acceptees :
 *  - identifiant + mot de passe, definis par l'admin dans « Comptes » ;
 *  - l'ancien code personnel, saisi seul, pour les comptes crees avant.
 *
 * On parcourt toujours l'equipe entiere avant de repondre : s'arreter au
 * premier echec laisserait deviner, au temps de reponse, quels identifiants
 * existent.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    username?: string;
    password?: string;
    code?: string;
  };
  const username = normalizeUsername(body.username ?? "");
  const password = body.password ?? "";
  const code = (body.code ?? "").trim();

  // Proprietaire (site en ligne) : le mot de passe seul suffit, l'identifiant
  // est ignore. Verifie en premier, a temps constant.
  if (ownerAuthEnabled() && verifyOwnerPassword(password)) {
    const res = NextResponse.json({
      ok: true,
      role: "owner",
      roles: [],
      memberId: "",
      memberName: "Moi",
      isAdmin: true,
      redirect: "/",
    });
    res.cookies.set(SESSION_COOKIE, issueOwnerToken(), cookieOptions(SESSION_MAX_AGE_S));
    res.cookies.delete(LEGACY_ROLE_COOKIE);
    return res;
  }

  if (!username && !code) {
    // Mot de passe seul et refuse : c'etait une tentative proprietaire.
    if (ownerAuthEnabled() && password) {
      return NextResponse.json({ error: "Mot de passe incorrect." }, { status: 401 });
    }
    return NextResponse.json({ error: "Identifiant requis." }, { status: 400 });
  }

  const db = readDB();
  let matched: TeamMember | undefined;
  let disabled: TeamMember | undefined;

  for (const m of db.team) {
    const byAccount =
      Boolean(username) &&
      normalizeUsername(m.username ?? "") === username &&
      Boolean(m.passwordHash) &&
      verifyPassword(password, m.passwordHash);
    // Repli : l'ancien code, tape soit dans le champ code, soit comme
    // identifiant sans mot de passe.
    const legacy = (m.accessCode ?? "").trim();
    const byCode = Boolean(legacy) && (legacy === code || (!password && legacy.toLowerCase() === username));

    if (!byAccount && !byCode) continue;
    if (m.status === "inactif") disabled = m;
    else matched = matched ?? m;
  }

  if (!matched) {
    if (disabled) return NextResponse.json({ error: "Ce compte a été désactivé." }, { status: 403 });
    return NextResponse.json({ error: "Identifiant ou mot de passe incorrect." }, { status: 401 });
  }

  const session = sessionFor(matched);
  if (session.role === "anonyme") {
    return NextResponse.json({ error: "Ce rôle n'a pas d'espace dédié." }, { status: 403 });
  }

  matched.lastSeenAt = new Date().toISOString();
  writeDB(db);

  const res = NextResponse.json({
    ok: true,
    role: session.role,
    roles: session.roles,
    memberId: matched.id,
    memberName: matched.name,
    isAdmin: session.isAdmin,
    // Destination d'arrivee : chacun atterrit sur son espace. Le dashboard
    // /sales s'adapte au role, il sert donc de porte d'entree commune.
    redirect: session.role === "editor" ? "/monteur" : "/sales",
  });
  res.cookies.set(
    SESSION_COOKIE,
    issueToken({ role: session.role, memberId: matched.id, memberName: matched.name }),
    cookieOptions(SESSION_MAX_AGE_S),
  );
  return res;
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge,
    secure: process.env.NODE_ENV === "production",
  };
}

/**
 * Deconnexion : on redevient le proprietaire du tool.
 *
 * Les DEUX cookies sont effaces, y compris l'ancien cookie du monteur. Sans
 * cela, quelqu'un qui s'etait connecte a /monteur autrefois se retrouvait
 * renvoye sur le board de montage en quittant l'espace commercial : la session
 * commerciale disparaissait, et le vieux cookie reprenait la main.
 *
 * Site en ligne : quitter un apercu (« revenir admin ») ne doit pas
 * deconnecter le proprietaire. On lui re-emet alors son jeton au lieu de
 * tout effacer. Une vraie deconnexion efface tout, comme avant.
 */
export async function DELETE(req: NextRequest) {
  const res = NextResponse.json({ ok: true });
  const claims = peekClaims(req.cookies.get(SESSION_COOKIE)?.value);
  if (ownerAuthEnabled() && claims?.impersonated) {
    res.cookies.set(SESSION_COOKIE, issueOwnerToken(), cookieOptions(SESSION_MAX_AGE_S));
  } else {
    res.cookies.delete(SESSION_COOKIE);
  }
  res.cookies.delete(LEGACY_ROLE_COOKIE);
  return res;
}
