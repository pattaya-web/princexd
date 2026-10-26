import { NextRequest, NextResponse } from "next/server";
import { tick } from "@/lib/studio/jobs";
import { createCreationJobs, CreationError } from "@/lib/studio/creation";
import { scopeError, studioScope } from "@/lib/studio-tenant";
import type { CreateRequest } from "@/lib/studio/types";

export const dynamic = "force-dynamic";

/** « Création » : une image de départ + un script → vidéo Seedance 2.5 avec la voix, dans la même file. */
export async function POST(req: NextRequest) {
  let scope;
  try {
    scope = studioScope(req);
  } catch (e) {
    const { error, status } = scopeError(e);
    return NextResponse.json({ error }, { status });
  }
  const body = (await req.json().catch(() => null)) as CreateRequest | null;
  if (!body) return NextResponse.json({ error: "Requête illisible." }, { status: 400 });
  try {
    const jobs = createCreationJobs(body, scope.ownerId);
    void tick();
    return NextResponse.json({ jobs });
  } catch (e) {
    const err = e as CreationError;
    return NextResponse.json({ error: err.message }, { status: err.code ?? 400 });
  }
}
