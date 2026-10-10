import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

/**
 * Identifiant de la version en ligne.
 *
 * Next ecrit `.next/BUILD_ID` a chaque build : il change a chaque
 * deploiement. Le Shell le compare a celui charge au depart et propose de
 * recharger quand il differe. Sans cela, un onglet ouvert avant un
 * deploiement garde l'ancien code toute la journee (envoi de fichiers en un
 * bloc, ancienne liste « A appeler »…) et rien ne le signale.
 */
let cached = "";
function buildId(): string {
  if (cached) return cached;
  try {
    cached = fs.readFileSync(path.join(process.cwd(), ".next", "BUILD_ID"), "utf8").trim();
  } catch {
    cached = "dev";
  }
  return cached;
}

export async function GET() {
  return NextResponse.json({ build: buildId() }, { headers: { "Cache-Control": "no-store" } });
}
