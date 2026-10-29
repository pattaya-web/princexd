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
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  country: string;
  timezone: string;
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

/** Les contacts de moins d'un an : au-dela, plus personne ne rappelle. */
const SINCE_DAYS = 365;
const TTL_MS = 10 * 60_000;
let cache: { at: number; contacts: IclosedContact[] } | null = null;

const looksLikeEmail = (v: string) => /@/.test(v);
/** iClosed met le numero dans `email` quand la personne n'a laisse que son telephone. */
const realEmail = (c: IclosedContact) => [c.email, c.secondary_email].map((v) => (v ?? "").trim().toLowerCase()).find(looksLikeEmail) ?? "";
const realPhone = (c: IclosedContact) => [c.phoneNumber, c.secondary_phoneNumber].map((v) => (v ?? "").trim()).find((v) => /\d{6,}/.test(v)) ?? "";
/** Nom laisse sur le formulaire ; sinon ce qu'on a (email, numero), jamais vide. */
const displayName = (c: IclosedContact, email: string, phone: string) => [c.firstName, c.lastName].map((v) => (v ?? "").trim()).filter(Boolean).join(" ") || email || phone || `Contact ${c.id}`;
/** Fiche creee avant le 2026-10-29 avec le numero ou « Contact 123 » en guise de nom. */
const placeholderName = (name: string) => !name.trim() || /^\+?\d[\d\s]+$/.test(name.trim()) || /^Contact \d+$/.test(name.trim()) || looksLikeEmail(name);

/**
 * Les contacts iClosed qui ont rempli le formulaire du calendrier SANS
 * reserver (iClosed les capture quand meme, des le nom / numero). Les plus
 * recents d'abord, douze mois, en cache dix minutes : le quota iClosed est
 * de 200 requetes par heure. Chaque contact devient une fiche du CRM ; les
 * contacts dont on connait un rendez-vous (statut iClosed en retard) sont
 * ecartes de la liste, ils vivent dans l'agenda.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    requireSales(readSession(req));
    if (!getIclosedKey()) return { rows: [], fetchedAt: "", error: "aucune clé API iClosed sur ce serveur." };
    const force = new URL(req.url).searchParams.get("force") === "1";
    if (!cache || force || Date.now() - cache.at > TTL_MS) {
      cache = { at: Date.now(), contacts: await fetchContacts(SINCE_DAYS) };
    }
    const db = readDB();
    const byContact = new Map(db.leads.filter((l) => l.iclosedContactId).map((l) => [l.iclosedContactId!, l]));
    const byEmail = new Map(db.leads.filter((l) => l.email && looksLikeEmail(l.email)).map((l) => [(l.email ?? "").trim().toLowerCase(), l]));
    const byPhone = new Map(db.leads.filter((l) => l.phone).map((l) => [normalizePhone(l.phone), l]));
    const names = new Map(db.team.map((m) => [m.id, m.name]));
    let created = 0;
    let completed = 0;
    const rows: IclosedContactRow[] = cache.contacts
      .filter((c) => c.status !== "STRATEGY_CALL_BOOKED")
      .map((c) => {
        const email = realEmail(c);
        const phoneRaw = realPhone(c);
        const phone = phoneRaw ? normalizePhone(phoneRaw) : "";
        const name = displayName(c, email, phoneRaw);
        let lead: Lead | undefined = byContact.get(String(c.id)) || (email ? byEmail.get(email) : undefined) || (phone ? byPhone.get(phone) : undefined);
        if (lead && !lead.iclosedContactId) {
          lead.iclosedContactId = String(c.id);
          completed++;
        }
        if (lead) {
          /*
           * Fiche deja la : on complete ce qui manquait (les premieres fiches
           * avaient le numero en guise de nom et le numero dans l'email).
           */
          let touched = false;
          if (placeholderName(lead.name) && !placeholderName(name)) {
            lead.name = name;
            touched = true;
          }
          if (!lead.phone && phoneRaw) {
            lead.phone = phoneRaw;
            touched = true;
          }
          if ((!lead.email || !looksLikeEmail(lead.email)) && email) {
            lead.email = email;
            touched = true;
          }
          if (!lead.country && c.country) {
            lead.country = c.country;
            touched = true;
          }
          if (!lead.timezone && c.timeZone) {
            lead.timezone = c.timeZone;
            touched = true;
          }
          if (touched) completed++;
        } else {
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
            email,
            phone: phoneRaw,
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
          firstName: (c.firstName ?? "").trim(),
          lastName: (c.lastName ?? "").trim(),
          email,
          phone: phoneRaw,
          country: c.country ?? "",
          timezone: c.timeZone ?? "",
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
      // Un rendez-vous connu chez nous = le contact a reserve, iClosed n'a juste pas mis son statut a jour.
      .filter((r) => !r.appointmentAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (created) {
      db.activityLogs.unshift({ id: newId(), at: new Date().toISOString(), actorId: "", actorName: "iClosed", action: "lead.created", entity: "lead", entityId: "", summary: `${created} contact${created > 1 ? "s" : ""} iClosed (formulaire sans rendez-vous) ajouté${created > 1 ? "s" : ""} aux leads` });
    }
    if (created || completed) writeDB(db);
    return { rows, fetchedAt: new Date(cache.at).toISOString(), error: "" };
  });
}
