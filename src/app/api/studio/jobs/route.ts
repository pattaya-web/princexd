import { NextRequest, NextResponse } from "next/server";
import { countByStatus, createJobs, deleteJob, JobError, tick } from "@/lib/studio/jobs";
import { scopeError, studioScope, type StudioScope } from "@/lib/studio-tenant";
import type { TransformRequest } from "@/lib/studio/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Périmètre du demandeur : l'admin et le monteur voient les jobs du compte,
 * un élève seulement les siens (et uniquement s'il a posé sa clé KIE).
 */
function scoped(req: NextRequest): StudioScope | NextResponse {
  try {
    return studioScope(req);
  } catch (e) {
    const { error, status } = scopeError(e);
    return NextResponse.json({ error }, { status });
  }
}

/** Liste + un tour de file : c'est ce sondage qui fait avancer les jobs (de tout le monde). */
export async function GET(req: NextRequest) {
  const scope = scoped(req);
  if (scope instanceof NextResponse) return scope;
  const all = await tick();
  const jobs = all.filter((j) => (j.ownerId ?? "") === scope.ownerId);
  /*
   * `providerInput` (la requete brute envoyee au fournisseur) pesait la
   * moitie de la liste et l'interface ne la lit jamais : 190 Ko par sondage
   * pour 33 rendus, toutes les 15 s. On la retire de la liste.
   */
  const slim = jobs.slice(0, 120).map(({ providerInput: _omit, ...rest }) => rest);
  return NextResponse.json({ jobs: slim, counts: countByStatus(jobs) });
}

/**
 * Création d'un lot de variantes. La réponse part tout de suite : l'upload
 * chez le fournisseur et la génération tournent en arrière-plan.
 */
export async function POST(req: NextRequest) {
  const scope = scoped(req);
  if (scope instanceof NextResponse) return scope;
  const body = (await req.json().catch(() => null)) as TransformRequest | null;
  if (!body) return NextResponse.json({ error: "Requête illisible." }, { status: 400 });
  try {
    const jobs = createJobs(body, scope.ownerId);
    // Coup de pouce immédiat : pas besoin d'attendre le prochain sondage.
    void tick();
    return NextResponse.json({ jobs });
  } catch (e) {
    const err = e as JobError;
    return NextResponse.json({ error: err.message }, { status: err.code ?? 400 });
  }
}

export async function DELETE(req: NextRequest) {
  const scope = scoped(req);
  if (scope instanceof NextResponse) return scope;
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id manquant" }, { status: 400 });
  return NextResponse.json({ ok: deleteJob(id, scope.ownerId) });
}
