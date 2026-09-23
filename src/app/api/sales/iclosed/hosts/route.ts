import { hasRole } from "@/lib/sales/roles";
import { NextRequest } from "next/server";
import { readDB } from "@/lib/db";
import { fetchCalls, IclosedError } from "@/lib/iclosed";
import { readSession, requireAdmin } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { distinctHosts } from "@/lib/sales/iclosed-link";

export const dynamic = "force-dynamic";

/**
 * Utilisateurs iClosed reperes dans les calls recents.
 *
 * Sert a construire la correspondance « hote iClosed -> closer du CRM ». Tant
 * qu'un seul utilisateur remonte, c'est que les closers n'ont pas encore ete
 * crees dans iClosed : aucune attribution automatique n'est alors possible, et
 * il vaut mieux le dire franchement que de laisser croire au contraire.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    requireAdmin(readSession(req));
    const db = readDB();

    let calls;
    try {
      // Deux pages suffisent a reperer les hotes actifs sans consommer le
      // quota de requetes iClosed.
      calls = [...(await fetchCalls("PAST", 2, 50)), ...(await fetchCalls("UPCOMING", 1, 50))];
    } catch (e) {
      throw new Error(e instanceof IclosedError ? e.message : (e as Error).message);
    }

    const hosts = distinctHosts(calls).map((h) => {
      const member = db.team.find((m) => m.iclosedUserId === h.id);
      return { ...h, memberId: member?.id ?? "", memberName: member?.name ?? "" };
    });

    return {
      hosts,
      examined: calls.length,
      /** Vrai quand un seul utilisateur heberge tout : aucun closer dans iClosed. */
      singleHost: hosts.length <= 1,
      closers: db.team
        .filter((m) => hasRole(m, "closer"))
        .map((m) => ({ id: m.id, name: m.name, iclosedUserId: m.iclosedUserId ?? null })),
    };
  });
}
