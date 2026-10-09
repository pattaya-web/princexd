import { NextRequest } from "next/server";
import { handle } from "@/lib/sales/http";
import { adminSession } from "@/lib/mediabuying/http";
import { duplicate } from "@/lib/mediabuying/repo";
import type { EntityLevel } from "@/lib/mediabuying/types";

export const dynamic = "force-dynamic";

/** Duplication (toujours en pause) vers le meme parent ou un autre. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const session = adminSession(req);
    const b = (await req.json()) as { connectionId?: string; level?: EntityLevel; id?: string; parentId?: string; name?: string; keepPostId?: boolean };
    if (!b.connectionId || !b.id) throw new Error("connectionId et id sont obligatoires.");
    if (b.level !== "campaign" && b.level !== "adset" && b.level !== "ad") throw new Error("Niveau invalide.");
    return duplicate(session, b.connectionId, b.level, b.id, { parentId: b.parentId || "same", name: b.name?.trim() ?? "", keepPostId: b.keepPostId !== false });
  });
}
