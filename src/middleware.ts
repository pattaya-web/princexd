import { NextRequest, NextResponse } from "next/server";

/**
 * Cloisonnement du monteur.
 * Un visiteur porteur du cookie de rôle "editor" ne voit que /monteur et les
 * quelques routes dont ce board a besoin. Tout le reste du tool lui est fermé,
 * y compris les collections CRM et les appels IA (qui consomment mes crédits).
 */
const EDITOR_PAGES = ["/monteur"];
const EDITOR_APIS = ["/api/auth/editor", "/api/data/edits", "/api/upload", "/api/media/"];

export function middleware(req: NextRequest) {
  const role = req.cookies.get("mvp_role")?.value;
  if (role !== "editor") return NextResponse.next();

  const { pathname } = req.nextUrl;
  const allowed =
    EDITOR_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ||
    EDITOR_APIS.some((p) => pathname === p || pathname.startsWith(p));

  if (allowed) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Accès réservé." }, { status: 403 });
  }
  return NextResponse.redirect(new URL("/monteur", req.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
