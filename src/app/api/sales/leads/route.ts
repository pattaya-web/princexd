import { NextRequest } from "next/server";
import { readDB } from "@/lib/db";
import { canSee, readSession, requireSales } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { syncSystemeio } from "@/lib/systemeio";
import type { Lead } from "@/lib/types";

export const dynamic = "force-dynamic";

export interface CallLeadRow extends Lead {
  setterName: string;
  /** "new" : jamais appele ; "retry" : deja tente ; "talking" : joint, a suivre. */
  bucket: "new" | "retry" | "talking";
}

/**
 * Les prospects a appeler : ceux de la landing page (et tout lead manuel au
 * meme stade) qui n'ont pas encore de rendez-vous. Un setter voit les siens,
 * l'admin voit tout. Au passage, une synchro Systeme.io si la derniere date
 * de plus de trois minutes : la liste est toujours a jour quand on l'ouvre.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const session = requireSales(readSession(req));

    let syncError = "";
    try {
      await syncSystemeio();
    } catch (e) {
      syncError = (e as Error).message;
    }

    const db = readDB();
    const names = new Map(db.team.map((m) => [m.id, m.name]));
    const booked = new Set(db.appointments.map((a) => a.leadId));

    const rows: CallLeadRow[] = db.leads
      .filter((l) => (l.stage === "nouveau" || l.stage === "contacte" || l.stage === "conversation") && !booked.has(l.id))
      .filter((l) => canSee(session, { setterId: l.setterId }))
      .map((l) => ({
        ...l,
        setterName: l.setterId ? (names.get(l.setterId) ?? "—") : "",
        bucket: (l.stage === "conversation" ? "talking" : (l.callAttempts ?? 0) > 0 || l.stage === "contacte" ? "retry" : "new") as CallLeadRow["bucket"],
      }))
      .sort((a, b) => (b.optInAt || b.createdAt).localeCompare(a.optInAt || a.createdAt));

    return {
      rows,
      counts: {
        new: rows.filter((r) => r.bucket === "new").length,
        retry: rows.filter((r) => r.bucket === "retry").length,
        talking: rows.filter((r) => r.bucket === "talking").length,
      },
      lastSyncAt: db.settings.systemeioLastSyncAt ?? "",
      syncError,
    };
  });
}
