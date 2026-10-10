import { NextRequest } from "next/server";
import { newId, readDB, writeDB } from "@/lib/db";
import { readSession, requireAdmin, requireSales } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { DEFAULT_FUNNELS, reattributeFromFunnels, SOURCE_CHANNELS } from "@/lib/sales/attribution";
import type { SalesFunnel, SourceChannel } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Les funnels declares (ou ceux par defaut), pour les filtres et les scripts. */
export async function GET(req: NextRequest) {
  return handle(() => {
    requireSales(readSession(req));
    const db = readDB();
    return { rows: db.settings.salesFunnels ?? DEFAULT_FUNNELS, custom: Boolean(db.settings.salesFunnels) };
  });
}

const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);

/**
 * Remplace la liste des funnels (admin). Un funnel garde sa cle d'une
 * sauvegarde a l'autre : c'est elle qui est ecrite sur les leads.
 * `reattribute=1` recalcule l'attribution des leads d'opt-in non fiables.
 */
export async function PUT(req: NextRequest) {
  return handle(async () => {
    const session = requireAdmin(readSession(req));
    const b = (await req.json()) as { rows?: Partial<SalesFunnel>[]; reattribute?: boolean };
    const rows: SalesFunnel[] = [];
    for (const r of b.rows ?? []) {
      const label = String(r.label ?? "").trim().slice(0, 60);
      if (!label) continue;
      const key = (String(r.key ?? "").trim() || slug(label)) || `funnel_${newId().slice(-4)}`;
      if (rows.some((x) => x.key === key)) continue;
      rows.push({
        key,
        label,
        channel: SOURCE_CHANNELS.includes(r.channel as SourceChannel) ? (r.channel as SourceChannel) : "ORGANIC",
        match: String(r.match ?? "").trim().slice(0, 500),
        script: String(r.script ?? "").slice(0, 4000),
      });
    }
    if (!rows.length) throw new Error("Garde au moins un funnel.");
    const db = readDB();
    db.settings.salesFunnels = rows;
    let reattributed = 0;
    if (b.reattribute) reattributed = reattributeFromFunnels(db, rows);
    db.activityLogs.unshift({
      id: newId(),
      at: new Date().toISOString(),
      actorId: session.memberId,
      actorName: session.memberName || "Moi",
      action: "funnels.updated",
      entity: "lead",
      entityId: "",
      summary: `Funnels mis à jour : ${rows.map((r) => r.label).join(", ")}${reattributed ? ` · ${reattributed} lead(s) réattribué(s)` : ""}`,
    });
    writeDB(db);
    return { rows, reattributed };
  });
}
