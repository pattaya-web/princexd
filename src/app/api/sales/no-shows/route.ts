import { NextRequest } from "next/server";
import { readDB } from "@/lib/db";
import { canSee, readSession, requireSales } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { sessionHas } from "@/lib/sales/roles";

export const dynamic = "force-dynamic";

export interface NoShowRow {
  appointmentId: string;
  leadId: string;
  name: string;
  igUsername: string;
  phone: string;
  /** Le call manque. */
  missedAt: string;
  /** Derniere relance notee apres le call manque (statut d'appel du lead), vide sinon. */
  lastFollowUpAt: string;
  lastFollowUpStatus: string;
  /** Un nouveau rendez-vous (R2) a ete pose apres le no-show. */
  rebookedAt: string;
  setterName: string;
}

const WINDOW_MS = 90 * 86_400_000;

/**
 * Les no-shows a relancer : les calls manques des 90 derniers jours du
 * setter (ou de tous, pour l'admin), tant qu'un nouveau rendez-vous n'est
 * pas pose. Un no-show qui a reserve un R2 sort de la liste.
 */
export async function GET(req: NextRequest) {
  return handle(() => {
    const session = requireSales(readSession(req));
    const db = readDB();
    const names = new Map(db.team.map((m) => [m.id, m.name]));
    const since = new Date(Date.now() - WINDOW_MS).toISOString();
    const mine = (a: { setterId: string; closerId: string }) => (session.isAdmin ? true : sessionHas(session, "setter") ? a.setterId === session.memberId : canSee(session, a));
    const rows: NoShowRow[] = db.appointments
      .filter((a) => a.status === "no-show" && a.scheduledAt >= since && mine(a))
      .map((a) => {
        const lead = db.leads.find((l) => l.id === a.leadId);
        const later = db.appointments
          .filter((b) => b.leadId === a.leadId && b.id !== a.id && b.status !== "cancelled" && b.scheduledAt > a.scheduledAt)
          .sort((x, y) => x.scheduledAt.localeCompare(y.scheduledAt))[0];
        const followed = lead?.lastCallAt && lead.lastCallAt > a.scheduledAt;
        return {
          appointmentId: a.id,
          leadId: a.leadId,
          name: lead?.name ?? "—",
          igUsername: lead?.igUsername ?? "",
          phone: lead?.phone ?? "",
          missedAt: a.scheduledAt,
          lastFollowUpAt: followed ? lead!.lastCallAt! : "",
          lastFollowUpStatus: followed ? (lead!.callStatus ?? "") : "",
          rebookedAt: later?.scheduledAt ?? "",
          setterName: names.get(a.setterId) ?? "",
        };
      })
      .filter((r) => !r.rebookedAt)
      .sort((a, b) => b.missedAt.localeCompare(a.missedAt));
    return { rows };
  });
}
