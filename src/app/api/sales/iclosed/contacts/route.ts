import { NextRequest } from "next/server";
import { readDB } from "@/lib/db";
import { fetchContacts, getIclosedKey, type IclosedContact } from "@/lib/iclosed";
import { readSession, requireSales } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { normalizePhone } from "@/lib/sales/providers";

export const dynamic = "force-dynamic";

export interface IclosedContactRow {
  id: number;
  name: string;
  email: string;
  phone: string;
  country: string;
  /** Statut iClosed : POTENTIAL (formulaire commence), QUALIFIED / DISQUALIFIED (questionnaire rempli), sans reservation. */
  status: string;
  createdAt: string;
  calendar: string;
  /** Lead du CRM qui correspond (email ou telephone), s'il existe. */
  leadId: string;
  leadName: string;
}

const TTL_MS = 10 * 60_000;
let cache: { at: number; contacts: IclosedContact[] } | null = null;

/**
 * Les contacts iClosed qui ont rempli le formulaire du calendrier SANS
 * reserver (iClosed les capture quand meme). Trois pages de 100, les plus
 * recents d'abord, en cache dix minutes : le quota iClosed est de 200
 * requetes par heure.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    requireSales(readSession(req));
    if (!getIclosedKey()) return { rows: [], fetchedAt: "", error: "aucune clé API iClosed sur ce serveur." };
    const force = new URL(req.url).searchParams.get("force") === "1";
    if (!cache || force || Date.now() - cache.at > TTL_MS) {
      cache = { at: Date.now(), contacts: await fetchContacts(3, 100) };
    }
    const db = readDB();
    const byEmail = new Map(db.leads.filter((l) => l.email).map((l) => [(l.email ?? "").trim().toLowerCase(), l]));
    const byPhone = new Map(db.leads.filter((l) => l.phone).map((l) => [normalizePhone(l.phone), l]));
    const rows: IclosedContactRow[] = cache.contacts
      .filter((c) => c.status !== "STRATEGY_CALL_BOOKED")
      .map((c) => {
        const email = (c.email ?? "").trim().toLowerCase();
        const lead = (email && byEmail.get(email)) || (c.phoneNumber && byPhone.get(normalizePhone(c.phoneNumber))) || null;
        return {
          id: c.id,
          name: [c.firstName, c.lastName].filter(Boolean).join(" ").trim() || email || c.phoneNumber || `Contact ${c.id}`,
          email: c.email ?? "",
          phone: c.phoneNumber ?? "",
          country: c.country ?? "",
          status: c.status,
          createdAt: c.createdAt,
          calendar: c.ContactEvents?.[0]?.name ?? "",
          leadId: lead?.id ?? "",
          leadName: lead?.name ?? "",
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { rows, fetchedAt: new Date(cache.at).toISOString(), error: "" };
  });
}
