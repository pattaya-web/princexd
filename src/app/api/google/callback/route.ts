import { NextRequest, NextResponse } from "next/server";
import { connectWithCode, publicOrigin } from "@/lib/google";
import { readSession } from "@/lib/sales/access";

export const dynamic = "force-dynamic";

/** Retour du consentement Google : on echange le code et on garde le jeton. */
export async function GET(req: NextRequest) {
  const session = readSession(req);
  if (!session.isAdmin) return NextResponse.redirect(new URL("/login", req.url));
  const p = req.nextUrl.searchParams;
  const back = (q: string) => NextResponse.redirect(new URL(`/meet?${q}`, req.url));
  if (p.get("error")) return back(`error=${encodeURIComponent(`Google : ${p.get("error")}`)}`);
  const code = p.get("code") ?? "";
  const state = p.get("state") ?? "";
  if (!code || !state || state !== req.cookies.get("google_oauth_state")?.value) return back(`error=${encodeURIComponent("Retour Google invalide (state). Recommence la connexion.")}`);
  try {
    const email = await connectWithCode(code, publicOrigin(req));
    const res = back(`connected=${encodeURIComponent(email || "1")}`);
    res.cookies.set("google_oauth_state", "", { path: "/", maxAge: 0 });
    return res;
  } catch (e) {
    return back(`error=${encodeURIComponent((e as Error).message)}`);
  }
}
