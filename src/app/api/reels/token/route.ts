import { NextRequest } from "next/server";
import { extensionToken, regenerateExtensionToken } from "@/lib/reels";
import { readSession, requireAdmin } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";

export const dynamic = "force-dynamic";

/** Le jeton a coller dans l'extension Chrome (cree au premier appel). */
export async function GET(req: NextRequest) {
  return handle(() => {
    requireAdmin(readSession(req));
    return { token: extensionToken() };
  });
}

/** Nouveau jeton : l'ancien ne marche plus, a recoller dans l'extension. */
export async function POST(req: NextRequest) {
  return handle(() => {
    requireAdmin(readSession(req));
    return { token: regenerateExtensionToken() };
  });
}
