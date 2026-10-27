import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { readSession } from "@/lib/sales/access";
import { EXAMPLE_SHOP_DIR, EXAMPLE_SHOP_PAGES, type ExampleShopPage } from "@/lib/formation-example-shop";

export const dynamic = "force-dynamic";

/**
 * La boutique d'exemple de Mady (Aesthetics Lab), en copie HTML lecture
 * seule : les pages sont dans content/boutique-exemple (générées hors ligne,
 * assets laissés sur le CDN Shopify, liens internes neutralisés, analytics
 * retirés). L'élève voit la structure d'une vraie boutique sans en recevoir
 * l'adresse. Admin ou élève connecté.
 */
export async function GET(req: NextRequest) {
  const session = readSession(req);
  if (!session.isAdmin && session.role !== "student") return NextResponse.json({ error: "Accès refusé." }, { status: 403 });
  const wanted = (req.nextUrl.searchParams.get("p") ?? "accueil").trim();
  const page: ExampleShopPage = (EXAMPLE_SHOP_PAGES as readonly string[]).includes(wanted) ? (wanted as ExampleShopPage) : "accueil";
  const file = path.join(EXAMPLE_SHOP_DIR, `${page}.html`);
  if (!fs.existsSync(file)) return NextResponse.json({ error: "La boutique d'exemple n'est pas disponible sur ce serveur." }, { status: 404 });
  return new NextResponse(fs.readFileSync(file, "utf8"), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
