import { NextRequest, NextResponse } from "next/server";
import { elapsed, getJob, startJob } from "@/lib/bg-jobs";
import { exportEdit, parseSpec, type EditResult } from "@/lib/montage-rapide";
import { refuseUnless } from "@/lib/sales/access";

export const dynamic = "force-dynamic";

/**
 * Export du Montage rapide : la page envoie sa demande (vidéo, plage gardée,
 * textes rendus en PNG, musique, volumes), reçoit un identifiant de tâche et
 * interroge `GET ?job=` toutes les 2 s jusqu'au fichier final.
 */
export async function POST(req: NextRequest) {
  const refused = refuseUnless(req, []);
  if (refused) return refused;
  const spec = parseSpec(await req.json().catch(() => ({})));
  if (!spec.videoUrl) return NextResponse.json({ error: "Dépose d'abord une vidéo." }, { status: 400 });
  const jobId = startJob<EditResult>((setStep) => exportEdit(spec, setStep), { maxMs: 30 * 60_000 });
  return NextResponse.json({ jobId }, { status: 202 });
}

export async function GET(req: NextRequest) {
  const refused = refuseUnless(req, []);
  if (refused) return refused;
  const job = getJob<EditResult>(req.nextUrl.searchParams.get("job") ?? "");
  if (!job) return NextResponse.json({ error: "Tâche introuvable (le serveur a peut-être redémarré) : relance l'export." }, { status: 404 });
  // 422 et pas 502 : derrière Cloudflare, un 502 est remplacé par sa page HTML et le message se perd.
  if (job.status === "error") return NextResponse.json({ status: "error", error: job.error }, { status: 422 });
  return NextResponse.json({ status: job.status, step: job.step, elapsed: elapsed(job), ...(job.result ? { result: job.result } : {}) });
}
