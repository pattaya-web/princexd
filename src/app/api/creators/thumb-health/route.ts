import { NextResponse } from "next/server";
import { readDB } from "@/lib/db";
import { creatorThumbHealth } from "@/lib/thumb-repair";

export const dynamic = "force-dynamic";

/**
 * Etat des vignettes des createurs suivis, calcule sur le serveur : une URL
 * CDN perimee ou un fichier local disparu comptent comme perimes. La page
 * Content s'en sert pour decider quels createurs resynchroniser.
 */
export async function GET() {
  return NextResponse.json(creatorThumbHealth(readDB()));
}
