import { NextRequest } from "next/server";
import { handle } from "@/lib/sales/http";
import { adminSession, requireParam } from "@/lib/mediabuying/http";
import { deleteDraft, listDrafts, saveDraft } from "@/lib/mediabuying/repo";
import type { CampaignDraft } from "@/lib/mediabuying/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return handle(() => {
    adminSession(req);
    return { rows: listDrafts(requireParam(req, "connectionId")) };
  });
}

/** Cree ou met a jour un brouillon (jamais publie ici). */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const session = adminSession(req);
    const b = (await req.json()) as Partial<CampaignDraft> & { connectionId?: string };
    if (!b.connectionId) throw new Error("connectionId manquant.");
    return saveDraft(session, b.connectionId, b);
  });
}

export async function DELETE(req: NextRequest) {
  return handle(() => {
    const session = adminSession(req);
    return deleteDraft(session, requireParam(req, "connectionId"), requireParam(req, "id"));
  });
}
