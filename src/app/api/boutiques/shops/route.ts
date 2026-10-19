import { NextRequest, NextResponse } from "next/server";
import { insert, list, remove, update } from "@/lib/db";
import { normalizeDomain } from "@/lib/boutique/shopify";
import type { ClientShop } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Le jeton ne sort jamais en clair : un masque suffit pour savoir qu'il est là. */
const mask = (v?: string) => (v ? `${v.slice(0, 6)}…${v.slice(-4)}` : "");

function publicShop(s: ClientShop) {
  const { accessToken, clientSecret, tokenCache: _cache, ...rest } = s;
  const viaDashboard = Boolean(s.clientId?.trim() && clientSecret?.trim());
  return {
    ...rest,
    authMode: viaDashboard ? "dashboard" : accessToken ? "legacy" : "none",
    hasToken: viaDashboard || Boolean(accessToken),
    tokenMask: viaDashboard ? mask(s.clientId) : mask(accessToken),
  };
}

/** Soit un couple Client ID + secret (Dev Dashboard), soit un jeton legacy shpat_. */
function checkCredentials(accessToken: string, clientId: string, clientSecret: string): string | null {
  if (clientId || clientSecret) {
    if (!clientId || !clientSecret) return "Il faut le Client ID et le Client secret (Dev Dashboard → App settings → Credentials).";
    if (clientSecret.length < 16) return "Le Client secret semble incomplet.";
    return null;
  }
  if (!accessToken) return "Donne le Client ID + Client secret de l'app (Dev Dashboard), ou un jeton shpat_ d'app legacy.";
  if (!accessToken.startsWith("shpat_") && !accessToken.startsWith("shpca_")) return "Un jeton Admin API commence par shpat_. Sinon, utilise Client ID + Client secret.";
  return null;
}

export async function GET() {
  return NextResponse.json((list("shops") as ClientShop[]).map(publicShop));
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Partial<ClientShop>;
  const domain = normalizeDomain(body.domain ?? "");
  const accessToken = (body.accessToken ?? "").trim();
  const clientId = (body.clientId ?? "").trim();
  const clientSecret = (body.clientSecret ?? "").trim();
  if (!domain) return NextResponse.json({ error: "Domaine .myshopify.com manquant." }, { status: 400 });
  const err = checkCredentials(accessToken, clientId, clientSecret);
  if (err) return NextResponse.json({ error: err }, { status: 400 });
  const now = new Date().toISOString();
  const row = insert("shops", {
    name: (body.name ?? "").trim() || domain.replace(/\.myshopify\.com$/, ""),
    domain,
    accessToken,
    clientId,
    clientSecret,
    tokenCache: null,
    notes: (body.notes ?? "").trim(),
    updatedAt: now,
  }) as unknown as ClientShop;
  return NextResponse.json(publicShop(row));
}

export async function PATCH(req: NextRequest) {
  const body = (await req.json()) as Partial<ClientShop> & { id?: string };
  if (!body.id) return NextResponse.json({ error: "id manquant" }, { status: 400 });
  const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (typeof body.name === "string") patch.name = body.name.trim();
  if (typeof body.notes === "string") patch.notes = body.notes.trim();
  if (typeof body.domain === "string" && body.domain.trim()) patch.domain = normalizeDomain(body.domain);
  // Identifiants : seulement s'ils sont fournis, sinon on garde les anciens.
  const accessToken = (body.accessToken ?? "").trim();
  const clientId = (body.clientId ?? "").trim();
  const clientSecret = (body.clientSecret ?? "").trim();
  if (accessToken || clientId || clientSecret) {
    const err = checkCredentials(accessToken, clientId, clientSecret);
    if (err) return NextResponse.json({ error: err }, { status: 400 });
    // Un mode remplace l'autre : pas de melange entre jeton legacy et Dev Dashboard.
    patch.accessToken = accessToken;
    patch.clientId = clientId;
    patch.clientSecret = clientSecret;
    patch.tokenCache = null;
  }
  const row = update("shops", body.id, patch) as unknown as ClientShop | null;
  if (!row) return NextResponse.json({ error: "Boutique introuvable" }, { status: 404 });
  return NextResponse.json(publicShop(row));
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "id manquant" }, { status: 400 });
  return NextResponse.json(remove("shops", id));
}
