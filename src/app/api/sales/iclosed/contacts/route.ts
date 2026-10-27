import { NextRequest } from "next/server";
import { newId, readDB, writeDB } from "@/lib/db";
import { fetchContacts, getIclosedKey, type IclosedContact } from "@/lib/iclosed";
import { readSession, requireSales } from "@/lib/sales/access";
import { applyTouch } from "@/lib/sales/attribution";
import { handle } from "@/lib/sales/http";
import { normalizePhone } from "@/lib/sales/providers";
import type { Lead } from "@/lib/types";

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
  /** La fiche du CRM (creee a la lecture si elle n'existait pas). */
  leadId: string;
  leadName: string;
  /** Ce qu'on en a fait : statut d'appel, quand, par qui, combien d'essais, notes, rendez-vous pris. */
  callStatus: string;
  lastCallAt: string;
  callAttempts: number;
  setterName: string;
  notes: string;
  appointmentAt: string;
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
    const byContact = new Map(db.leads.filter((l) => l.iclosedContactId).map((l) => [l.iclosedContactId!, l]));
    const byEmail = new Map(db.leads.filter((l) => l.email).map((l) => [(l.email ?? "").trim().toLowerCase(), l]));
    const byPhone = new Map(db.leads.filter((l) => l.phone).map((l) => [normalizePhone(l.phone), l]));
    const names = new Map(db.team.map((m) => [m.id, m.name]));
    let created = 0;
    const rows: IclosedContactRow[] = cache.contacts
      .filter((c) => c.status !== "STRATEGY_CALL_BOOKED")
      .map((c) => {
        const email = (c.email ?? "").trim().toLowerCase();
        const phone = c.phoneNumber ? normalizePhone(c.phoneNumber) : "";
        const name = [c.firstName, c.lastName].filter(Boolean).join(" ").trim() || email || c.phoneNumber || `Contact ${c.id}`;
        let lead: Lead | undefined = byContact.get(String(c.id)) || (email ? byEmail.get(email) : undefined) || (phone ? byPhone.get(phone) : undefined);
        if (lead && !lead.iclosedContactId) lead.iclosedContactId = String(c.id);
        if (!lead) {
          /*
           * Chaque contact iClosed devient une fiche du CRM : le setter peut
           * l'appeler, noter sa reponse, et la reservation qui arrive plus
           * tard (par email ou telephone) se rattache a la meme fiche.
           */
          lead = {
            id: newId(),
            name,
            handle: "",
            source: "iclosed",
            stage: "nouveau",
            dealValue: 0,
            callAt: "",
            ownerRole: "setter",
            ownerName: "",
            painPoint: "",
            nextAction: "",
            nextActionAt: "",
            notes: "",
            createdAt: c.createdAt || new Date().toISOString(),
            email: c.email ?? "",
            phone: c.phoneNumber ?? "",
            country: c.country ?? "",
            timezone: c.timeZone ?? "",
            iclosedContactId: String(c.id),
          };
          applyTouch(lead, { hint: "iclosed" }, lead.createdAt);
          db.leads.push(lead);
          byContact.set(String(c.id), lead);
          if (email) byEmail.set(email, lead);
          if (phone) byPhone.set(phone, lead);
          created++;
        }
        const appt = db.appointments.filter((a) => a.leadId === lead!.id && a.status !== "cancelled").sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt))[0];
        return {
          id: c.id,
          name,
          email: c.email ?? "",
          phone: c.phoneNumber ?? "",
          country: c.country ?? "",
          status: c.status,
          createdAt: c.createdAt,
          calendar: c.ContactEvents?.[0]?.name ?? "",
          leadId: lead.id,
          leadName: lead.name,
          callStatus: lead.callStatus ?? "",
          lastCallAt: lead.lastCallAt ?? "",
          callAttempts: lead.callAttempts ?? 0,
          setterName: lead.setterId ? (names.get(lead.setterId) ?? "") : "",
          notes: (lead.notes ?? "").trim(),
          appointmentAt: appt?.scheduledAt ?? "",
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (created) {
      db.activityLogs.unshift({ id: newId(), at: new Date().toISOString(), actorId: "", actorName: "iClosed", action: "lead.created", entity: "lead", entityId: "", summary: `${created} contact${created > 1 ? "s" : ""} iClosed (formulaire sans rendez-vous) ajouté${created > 1 ? "s" : ""} aux leads` });
    }
    writeDB(db);
    return { rows, fetchedAt: new Date(cache.at).toISOString(), error: "" };
  });
}
