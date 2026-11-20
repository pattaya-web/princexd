import { NextRequest, NextResponse } from "next/server";
import { JobError, setJobFps } from "@/lib/studio/jobs";
import { scopeError, studioScope } from "@/lib/studio-tenant";

export const dynamic = "force-dynamic";

/** `fps` : 30 ou 60 (interpolation), 0 pour revenir à la cadence du modèle. La réponse part tout de suite. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let tenant;
  try {
    tenant = studioScope(req);
  } catch (e) {
    const { error, status } = scopeError(e);
    return NextResponse.json({ error }, { status });
  }
  const { fps } = (await req.json().catch(() => ({}))) as { fps?: number };
  try {
    const job = await setJobFps(id, Number(fps) || 0, tenant.ownerId);
    return NextResponse.json({ job });
  } catch (e) {
    const err = e as JobError;
    return NextResponse.json({ error: err.message }, { status: err.code ?? 400 });
  }
}
