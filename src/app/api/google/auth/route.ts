import { NextRequest, NextResponse } from "next/server";
import { authUrl, newState } from "@/lib/google";
import { readSession } from "@/lib/sales/access";

export const dynamic = "force-dynamic";

/** Envoie l'admin sur l'ecran de consentement Google (Agenda). */
export async function GET(req: NextRequest) {
  const session = readSession(req);
  if (!session.isAdmin) return NextResponse.redirect(new URL("/login", req.url));
  const state = newState();
  let url: string;
  try {
    url = authUrl(req.nextUrl.origin, state);
  } catch (e) {
    return NextResponse.redirect(new URL(`/meet?error=${encodeURIComponent((e as Error).message)}`, req.url));
  }
  const res = NextResponse.redirect(url);
  res.cookies.set("google_oauth_state", state, { httpOnly: true, sameSite: "lax", secure: req.nextUrl.protocol === "https:", path: "/", maxAge: 600 });
  return res;
}
