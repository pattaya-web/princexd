import { NextRequest, NextResponse } from "next/server";
import { JobError, setJobFinish } from "@/lib/studio/jobs";
import { scopeError, studioScope } from "@/lib/studio-tenant";

export const dynamic = "force-dynamic";

/**
 * Finition d'une vidéo terminée. `fps` : 30 ou 60 (interpolation), 0 = cadence
 * du modèle. `upscale` : « 1080p » (upscale KIE) ou vide. Les deux à zéro :
 * retour à la vidéo d'origine. La réponse part tout de suite.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let tenant;
  try {
    tenant = studioScope(req);
  } catch (e) {
    const { error, status } = scopeError(e);
    return NextResponse.json({ error }, { status });
  }
  const { fps, upscale } = (await req.json().catch(() => ({}))) as { fps?: number; upscale?: string };
  try {
    const job = await setJobFinish(id, { fps: Number(fps) || 0, upscale: upscale === "1080p" ? "1080p" : "" }, tenant.ownerId);
    return NextResponse.json({ job });
  } catch (e) {
    const err = e as JobError;
    return NextResponse.json({ error: err.message }, { status: err.code ?? 400 });
  }
}
