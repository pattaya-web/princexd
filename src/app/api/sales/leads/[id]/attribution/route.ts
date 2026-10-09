import { NextRequest } from "next/server";
import { newId, readDB, writeDB } from "@/lib/db";
import { Forbidden, readSession, requireAdmin } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { FUNNELS, setManualAttribution, SOURCE_CHANNEL_LABEL, SOURCE_CHANNELS } from "@/lib/sales/attribution";
import type { SourceChannel } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Correction manuelle de la source d'acquisition d'un lead (admin).
 *
 * C'est la seule facon de changer une attribution fiable : l'automatique ne
 * l'ecrase jamais. Le changement est journalise avec l'avant et l'apres.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = requireAdmin(readSession(req));
    const { id } = await ctx.params;
    const b = (await req.json()) as { sourceChannel?: string; funnelSource?: string; campaignId?: string; adsetId?: string; adId?: string };
    if (!SOURCE_CHANNELS.includes(b.sourceChannel as SourceChannel)) throw new Error("Canal d'acquisition invalide.");
    const channel = b.sourceChannel as SourceChannel;
    const funnel = (b.funnelSource ?? "").trim() || (FUNNELS.find((f) => f.channel === channel)?.key ?? "unknown");

    const db = readDB();
    const lead = db.leads.find((l) => l.id === id);
    if (!lead) throw new Forbidden("Lead introuvable.");

    // Noms resolus depuis le media buying, quand les IDs y sont connus.
    const names = { campaign: "", adset: "", ad: "" };
    for (const snap of db.mbSnapshots) {
      names.campaign ||= snap.campaigns.find((c) => c.id === b.campaignId)?.name ?? "";
      names.adset ||= snap.adsets.find((a) => a.id === b.adsetId)?.name ?? "";
      names.ad ||= snap.ads.find((a) => a.id === b.adId)?.name ?? "";
    }
    const before = `${SOURCE_CHANNEL_LABEL[lead.sourceChannel ?? "UNKNOWN"]} / ${lead.funnelSource ?? "unknown"}${lead.adName ? ` / ${lead.adName}` : ""}`;
    setManualAttribution(lead, {
      sourceChannel: channel,
      funnelSource: funnel,
      campaignId: channel === "META_ADS" ? b.campaignId : "",
      adsetId: channel === "META_ADS" ? b.adsetId : "",
      adId: channel === "META_ADS" ? b.adId : "",
      campaignName: names.campaign,
      adsetName: names.adset,
      adName: names.ad,
    });
    const after = `${SOURCE_CHANNEL_LABEL[channel]} / ${funnel}${names.ad ? ` / ${names.ad}` : ""}`;
    db.activityLogs.unshift({
      id: newId(),
      at: new Date().toISOString(),
      actorId: session.memberId,
      actorName: session.memberName || "Moi",
      action: "lead.attribution",
      entity: "lead",
      entityId: lead.id,
      summary: `Source d'acquisition de ${lead.name} corrigée : ${before} → ${after}`,
    });
    writeDB(db);
    return { lead };
  });
}
