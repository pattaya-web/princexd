import { NextRequest } from "next/server";
import { handle } from "@/lib/sales/http";
import { adminSession } from "@/lib/mediabuying/http";
import { testCredentials } from "@/lib/mediabuying/repo";

export const dynamic = "force-dynamic";

/** « Tester la connexion » avant d'enregistrer : rien n'est ecrit. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    adminSession(req);
    const b = (await req.json()) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    return testCredentials(
      { name: str(b.name), businessManagerId: str(b.businessManagerId), adAccountId: str(b.adAccountId), accessToken: str(b.accessToken) },
      str(b.id) || undefined,
    );
  });
}
