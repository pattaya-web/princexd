import { NextRequest } from "next/server";
import { newId, readDB, writeDB } from "@/lib/db";
import { readSession, requireAdmin, requireSales } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { funnelsOf } from "@/lib/sales/attribution";
import { buildUtmUrl, utmKey, utmLinkRows, UTM_MEDIUMS, UTM_SOURCES } from "@/lib/sales/utm-links";
import type { DB, UtmLink } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Destinations proposees dans le generateur : les pages d'opt-in des funnels declares, le calendrier iClosed. */
function destinations(db: DB): { label: string; url: string }[] {
  const out: { label: string; url: string }[] = [];
  for (const f of funnelsOf(db)) {
    const first = f.match
      .split(",")
      .map((x) => x.trim())
      .find((x) => x.startsWith("/") || x.startsWith("http"));
    if (!first) continue;
    out.push({ label: f.label, url: first.startsWith("http") ? first : `https://royalscalebymady.fr${first}` });
  }
  const cal = db.settings.salesBookingUrl?.trim();
  if (cal) out.push({ label: "Calendrier iClosed", url: cal.split("?")[0] });
  return out;
}

/** Les liens, chacun avec ses leads et ses chiffres. */
export async function GET(req: NextRequest) {
  return handle(() => {
    requireSales(readSession(req));
    const db = readDB();
    const rows = utmLinkRows(db).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { rows, destinations: destinations(db), sources: UTM_SOURCES, mediums: UTM_MEDIUMS };
  });
}

/** Nouveau lien traque. Refuse un doublon exact (memes cinq parametres) : deux liens identiques seraient indiscernables. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const session = requireAdmin(readSession(req));
    const b = (await req.json().catch(() => ({}))) as Partial<UtmLink>;
    const params = { source: b.source ?? "", medium: b.medium ?? "", campaign: b.campaign ?? "", content: b.content ?? "", term: b.term ?? "" };
    const url = buildUtmUrl(b.baseUrl ?? "", params);
    if (!url) throw new Error("Destination invalide : colle une adresse complète (https://…).");
    if (!params.source.trim() || !params.campaign.trim()) throw new Error("Source et campagne sont obligatoires : c'est ce qui dit d'où vient le lead.");
    const db = readDB();
    db.utmLinks ??= [];
    const key = utmKey(params);
    const dup = db.utmLinks.find((l) => utmKey(l) === key);
    if (dup) throw new Error(`Un lien avec exactement ces paramètres existe déjà : « ${dup.label} ». Change le contenu (utm_content) pour les distinguer.`);
    const now = new Date().toISOString();
    const link: UtmLink = {
      id: newId(),
      label: (b.label ?? "").trim() || `${params.source} · ${params.campaign}`,
      baseUrl: (b.baseUrl ?? "").trim(),
      source: params.source.trim(),
      medium: params.medium.trim(),
      campaign: params.campaign.trim(),
      content: params.content.trim(),
      term: params.term.trim(),
      url,
      placement: (b.placement ?? "").trim(),
      notes: (b.notes ?? "").trim(),
      createdAt: now,
      createdBy: session.memberName || "admin",
    };
    db.utmLinks.unshift(link);
    writeDB(db);
    return { link };
  });
}

/** Renomme, deplace (memo), annote. Les parametres utm, eux, ne bougent pas : le lien est deja pose quelque part. */
export async function PATCH(req: NextRequest) {
  return handle(async () => {
    requireAdmin(readSession(req));
    const b = (await req.json().catch(() => ({}))) as { id?: string; label?: string; placement?: string; notes?: string };
    const db = readDB();
    const link = (db.utmLinks ?? []).find((l) => l.id === b.id);
    if (!link) throw new Error("Lien introuvable.");
    if (typeof b.label === "string") link.label = b.label.trim() || link.label;
    if (typeof b.placement === "string") link.placement = b.placement.trim();
    if (typeof b.notes === "string") link.notes = b.notes.trim();
    writeDB(db);
    return { link };
  });
}

export async function DELETE(req: NextRequest) {
  return handle(async () => {
    requireAdmin(readSession(req));
    const b = (await req.json().catch(() => ({}))) as { id?: string };
    const db = readDB();
    const before = (db.utmLinks ?? []).length;
    db.utmLinks = (db.utmLinks ?? []).filter((l) => l.id !== b.id);
    if (db.utmLinks.length === before) throw new Error("Lien introuvable.");
    writeDB(db);
    return { ok: true };
  });
}
