import { NextRequest, NextResponse } from "next/server";
import { getSettings, readDB, saveSettings } from "@/lib/db";
import { HIGGSFIELD } from "@/lib/studio/config";
import { getHiggsfieldKeys } from "@/lib/studio/providers/genjutsu";
import type { StudioJob } from "@/lib/studio/types";

export const dynamic = "force-dynamic";

/**
 * Solde Higgsfield suivi.
 *
 * L'API Higgsfield n'expose aucun solde (seul console.higgsfield.ai
 * l'affiche). On part donc du montant saisi par l'utilisateur et on retire
 * le prix de chaque rendu Genjutsu lance apres cette saisie : Higgsfield
 * facture la duree de la video source arrondie a la seconde superieure,
 * uniquement quand une video est livree (failed / nsfw ne sont pas factures).
 */

function jobUsd(job: StudioJob): number {
  // Le provider envoie toujours 720p a Higgsfield (seule resolution proposee).
  return Math.ceil(job.sourceDurationSec || 0) * HIGGSFIELD.usdPerSec["720p"];
}

function chargedSince(setAt: string): StudioJob[] {
  return readDB().studioJobs.filter(
    (j) => j.provider === "genjutsu" && j.createdAt > setAt && Boolean(j.remoteVideoUrl),
  );
}

function view() {
  const s = getSettings();
  const configured = getHiggsfieldKeys().configured;
  const balanceUsd = typeof s.higgsfieldBalanceUsd === "number" ? s.higgsfieldBalanceUsd : null;
  const setAt = s.higgsfieldBalanceAt ?? "";
  const charged = balanceUsd === null ? [] : chargedSince(setAt);
  const spentUsd = charged.reduce((sum, j) => sum + jobUsd(j), 0);
  const remainingUsd = balanceUsd === null ? null : Math.max(0, balanceUsd - spentUsd);
  return {
    configured,
    balanceUsd,
    setAt,
    spentUsd,
    jobs: charged.length,
    remainingUsd,
    usdPerSec720p: HIGGSFIELD.usdPerSec["720p"],
    secondsLeft720p: remainingUsd === null ? null : Math.floor(remainingUsd / HIGGSFIELD.usdPerSec["720p"]),
  };
}

export async function GET() {
  return NextResponse.json(view());
}

export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { balanceUsd?: unknown };
  const n = Number(body.balanceUsd);
  if (!Number.isFinite(n) || n < 0) {
    return NextResponse.json({ error: "Montant invalide." }, { status: 400 });
  }
  saveSettings({ higgsfieldBalanceUsd: Math.round(n * 100) / 100, higgsfieldBalanceAt: new Date().toISOString() });
  return NextResponse.json(view());
}
