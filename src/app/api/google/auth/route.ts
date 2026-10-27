import { NextRequest, NextResponse } from "next/server";
import { authUrl, newState, publicOrigin } from "@/lib/google";
import { readSession } from "@/lib/sales/access";

export const dynamic = "force-dynamic";

/**
 * Envoie l'admin sur l'ecran de consentement Google (Agenda). Derriere le
 * proxy Coolify, `req.url` porte l'adresse d'ecoute du conteneur
 * (0.0.0.0:3000) : toutes les redirections se construisent sur l'origine
 * publique (`publicOrigin`), jamais sur `req.url`.
 */
export async function GET(req: NextRequest) {
  const origin = publicOrigin(req);
  const session = readSession(req);
  if (!session.isAdmin) return NextResponse.redirect(`${origin}/login`);
  const state = newState();
  let url: string;
  try {
    url = authUrl(origin, state);
  } catch (e) {
    return NextResponse.redirect(`${origin}/meet?error=${encodeURIComponent((e as Error).message)}`);
  }
  const res = NextResponse.redirect(url);
  res.cookies.set("google_oauth_state", state, { httpOnly: true, sameSite: "lax", secure: origin.startsWith("https:"), path: "/", maxAge: 600 });
  return res;
}
