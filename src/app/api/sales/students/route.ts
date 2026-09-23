import { NextRequest } from "next/server";
import { readDB } from "@/lib/db";
import { readSession, requireAdmin } from "@/lib/sales/access";
import { handle, required } from "@/lib/sales/http";
import { enrollStudentFromSale } from "@/lib/sales/repo";
import type { Student } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Inscription d'un eleve issu d'une vente.
 *
 * Reserve a l'admin : le coaching se pilote depuis le panneau, pas par le
 * closer qui vient de signer. C'est aussi ce qui evite qu'un eleve apparaisse
 * dans le suivi avant que l'onboarding ait reellement commence.
 *
 * Ecrit dans la collection `students` deja utilisee par la page Élèves : pas
 * de collection parallele, la fiche s'ouvre ensuite au meme endroit qu'avant.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const session = requireAdmin(readSession(req));
    const body = (await req.json()) as Record<string, unknown>;
    const saleId = required(body.saleId, "La vente");

    const { student, created } = enrollStudentFromSale(session, saleId, {
      program: body.program as string,
      startedAt: body.startedAt as string,
      objective: body.objective as string,
      nextSessionAt: body.nextSessionAt as string,
      notes: body.notes as string,
      status: body.status as Student["status"],
    });

    // `created: false` signale un eleve deja inscrit pour cette vente : le
    // client peut alors le dire au lieu d'annoncer une creation qui n'a pas eu
    // lieu.
    return { student, created };
  });
}

/** Eleve rattache a une vente, pour savoir s'il faut proposer l'inscription. */
export async function GET(req: NextRequest) {
  return handle(() => {
    requireAdmin(readSession(req));
    const saleId = req.nextUrl.searchParams.get("saleId") ?? "";
    if (!saleId) throw new Error("saleId manquant.");
    return { student: readDB().students.find((s) => s.saleId === saleId) ?? null };
  });
}
