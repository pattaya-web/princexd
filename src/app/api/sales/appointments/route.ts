import { canSee } from "@/lib/sales/access";
import { sessionHas } from "@/lib/sales/roles";
import { NextRequest, NextResponse } from "next/server";
import { readDB, writeDB } from "@/lib/db";
import { readSession, requireSales } from "@/lib/sales/access";
import { handle, required } from "@/lib/sales/http";
import { createAppointment, type AppointmentInput } from "@/lib/sales/repo";
import { entriesFor } from "@/lib/sales/commissions";
import { rangeFromParams } from "@/lib/sales/period";
import { inRange } from "@/lib/sales/period";
import { syncIclosedUpcoming } from "@/lib/sales/iclosed-sync";
import type { AppointmentSource, AppointmentStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Nettoyage unique : l'import iClosed fabriquait un pseudo Instagram a partir
 * du debut de l'email (ou « iclosed-<id> ») quand le questionnaire n'en
 * donnait pas. Des pseudos faux s'affichaient sur l'agenda. On les efface ;
 * ils se saisissent a la main depuis la fiche.
 */
function cleanInventedHandles() {
  const db = readDB();
  if (db.settings.igHandlesCleanedAt) return;
  let n = 0;
  for (const l of db.leads) {
    const ig = (l.igUsername ?? "").replace(/^@+/, "").trim().toLowerCase();
    if (!ig) continue;
    const local = (l.email ?? "").split("@")[0].trim().toLowerCase();
    const invented = ig.startsWith("iclosed-") || (local.length > 0 && ig === local);
    if (!invented) continue;
    l.igUsername = "";
    l.handle = "";
    n++;
  }
  db.settings.igHandlesCleanedAt = new Date().toISOString();
  if (n) {
    db.activityLogs.unshift({
      id: `clean-ig-${Date.now()}`,
      at: db.settings.igHandlesCleanedAt,
      actorId: "",
      actorName: "Système",
      action: "lead.updated",
      entity: "lead",
      entityId: "",
      summary: `${n} pseudo${n > 1 ? "s" : ""} Instagram fabriqué${n > 1 ? "s" : ""} par l'import iClosed effacé${n > 1 ? "s" : ""} : à saisir à la main sur les fiches`,
    });
  }
  writeDB(db);
}

/**
 * Ligne prete a afficher.
 *
 * Le serveur joint lui-meme le lead, les noms des membres, la vente et la
 * commission : le navigateur n'a plus qu'a peindre le tableau. Faire ces
 * jointures cote client obligerait a telecharger les collections entieres,
 * ce qui ne tient pas a l'echelle de plusieurs milliers de rendez-vous.
 */
export interface AppointmentRow {
  id: string;
  scheduledAt: string;
  timezone: string;
  status: AppointmentStatus;
  source: AppointmentSource;
  qualified: boolean;
  setterId: string;
  setterName: string;
  closerId: string;
  closerName: string;
  setterNotes: string;
  closerNotes: string;
  lostReason: string;
  iclosedUrl: string;
  leadId: string;
  leadName: string;
  igUsername: string;
  email: string;
  phone: string;
  country: string;
  saleId: string;
  contractValue: number;
  cashCollected: number;
  currency: string;
  saleStatus: string;
  /** Commission generee par cette ligne, du point de vue de qui regarde. */
  commission: number;
}

export async function GET(req: NextRequest) {
  return handle(async () => {
    const session = requireSales(readSession(req));
    const p = req.nextUrl.searchParams;
    /*
     * Les calls a venir declenchent la synchro iClosed (au plus toutes les
     * dix minutes) : agenda, accueil d'un membre et Rendez-vous sont donc a
     * jour a l'ouverture, sans bouton ni reglage. Un echec ne bloque pas la
     * lecture : la liste s'affiche avec ce qu'on a.
     */
    if (p.get("period") === "upcoming") await syncIclosedUpcoming().catch(() => null);
    cleanInventedHandles();
    const db = readDB();

    const range = rangeFromParams(p);
    // ?since=<iso> avec period=upcoming : l'agenda garde aussi les calls
    // deja passes (depuis cette date) au lieu de les faire disparaitre a
    // l'heure pile.
    const since = p.get("since") ?? "";
    if (p.get("period") === "upcoming" && since && !Number.isNaN(Date.parse(since))) range.from = new Date(since).toISOString();
    const setterFilter = p.get("setterId") ?? "";
    const closerFilter = p.get("closerId") ?? "";
    const statusFilter = p.get("status") ?? "";
    const sourceFilter = p.get("source") ?? "";
    const outcomeFilter = p.get("outcome") ?? ""; // "won" | "lost" | ""
    const query = (p.get("q") ?? "").trim().toLowerCase();
    const limit = Math.min(Number(p.get("limit")) || 200, 1000);
    const offset = Math.max(Number(p.get("offset")) || 0, 0);

    const leads = new Map(db.leads.map((l) => [l.id, l]));
    const names = new Map(db.team.map((m) => [m.id, m.name]));
    // Une vente par rendez-vous : on indexe une fois plutot que de rechercher
    // dans la collection pour chaque ligne.
    const salesByAppt = new Map(db.sales.map((s) => [s.appointmentId, s]));

    /*
     * Cloisonnement.
     *
     * Applique ici, sur le serveur, avant tout filtre demande par le client :
     * un setter qui forgerait `?setterId=<un autre>` ne verra rien de plus.
     */
    let rows = db.appointments.filter((a) => canSee(session, a));

    // Bascule setter / closer d'un membre qui cumule les deux (voir dashboard).
    const as = p.get("as");
    if (!session.isAdmin && as === "setter") rows = rows.filter((a) => a.setterId === session.memberId);
    if (!session.isAdmin && as === "closer") rows = rows.filter((a) => a.closerId === session.memberId);

    rows = rows.filter((a) => {
      if (!inRange(a.scheduledAt, range)) return false;
      if (setterFilter && a.setterId !== setterFilter) return false;
      if (closerFilter && a.closerId !== closerFilter) return false;
      if (statusFilter && a.status !== statusFilter) return false;
      if (sourceFilter && a.source !== sourceFilter) return false;
      if (outcomeFilter === "won" && a.status !== "closed-won") return false;
      if (outcomeFilter === "lost" && a.status !== "closed-lost") return false;
      if (query) {
        const lead = leads.get(a.leadId);
        const haystack = [
          lead?.name,
          lead?.igUsername,
          lead?.handle,
          lead?.email,
          lead?.phone,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });

    rows.sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt));
    const total = rows.length;
    const page = rows.slice(offset, offset + limit);

    /*
     * Commissions de la page.
     *
     * On ne calcule que pour les membres presents a l'ecran, et une seule fois
     * chacun : recalculer le moteur pour chaque ligne serait quadratique.
     */
    const involved = new Set<string>();
    for (const a of page) {
      if (session.isAdmin || sessionHas(session, "setter")) involved.add(a.setterId);
      if (session.isAdmin || sessionHas(session, "closer")) if (a.closerId) involved.add(a.closerId);
    }
    const commissionBySource = new Map<string, number>();
    for (const memberId of involved) {
      const member = db.team.find((m) => m.id === memberId);
      if (!member) continue;
      for (const e of entriesFor(member, db.commissionRules, db.appointments, db.sales)) {
        // Un setter ne voit que sa propre commission, jamais celle du closer.
        if (!session.isAdmin && e.memberId !== session.memberId) continue;
        commissionBySource.set(e.sourceId, (commissionBySource.get(e.sourceId) ?? 0) + e.amount);
      }
    }

    const currency = db.settings.salesCurrency || "USD";

    const data: AppointmentRow[] = page.map((a) => {
      const lead = leads.get(a.leadId);
      const sale = salesByAppt.get(a.id);
      const commission =
        (commissionBySource.get(a.id) ?? 0) + (sale ? (commissionBySource.get(sale.id) ?? 0) : 0);

      return {
        id: a.id,
        scheduledAt: a.scheduledAt,
        timezone: a.timezone,
        status: a.status,
        source: a.source,
        qualified: a.qualified,
        setterId: a.setterId,
        setterName: names.get(a.setterId) ?? "—",
        closerId: a.closerId,
        closerName: a.closerId ? (names.get(a.closerId) ?? "—") : "",
        setterNotes: a.setterNotes,
        closerNotes: a.closerNotes,
        lostReason: a.lostReason,
        iclosedUrl: a.iclosedUrl,
        leadId: a.leadId,
        leadName: lead?.name ?? "Lead supprimé",
        igUsername: lead?.igUsername ?? "",
        email: lead?.email ?? "",
        phone: lead?.phone ?? "",
        country: lead?.country ?? "",
        saleId: sale?.id ?? "",
        contractValue: sale?.contractValue ?? 0,
        cashCollected: sale?.cashCollected ?? 0,
        currency: sale?.currency || currency,
        saleStatus: sale?.status ?? "",
        commission: Math.round(commission * 100) / 100,
      };
    });

    return { rows: data, total, currency };
  });
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const session = requireSales(readSession(req));
    const body = (await req.json()) as Partial<AppointmentInput>;

    const input: AppointmentInput = {
      leadId: body.leadId ?? "",
      // Le pseudo Instagram est facultatif : mieux vaut vide qu'invente.
      igUsername: body.igUsername ?? "",
      name: body.name ?? "",
      email: body.email ?? "",
      phone: body.phone ?? "",
      country: body.country ?? "",
      timezone: body.timezone || "Europe/Paris",
      scheduledAt: required(body.scheduledAt, "La date du rendez-vous"),
      setterId: body.setterId ?? session.memberId,
      closerId: body.closerId ?? "",
      source: (body.source as AppointmentSource) ?? "instagram-dm",
      iclosedUrl: body.iclosedUrl ?? "",
      iclosedEventId: body.iclosedEventId ?? "",
      setterNotes: body.setterNotes ?? "",
      qualified: Boolean(body.qualified),
    };

    if (Number.isNaN(new Date(input.scheduledAt).getTime())) {
      throw new Error("La date du rendez-vous est invalide.");
    }

    const { appointment, lead } = createAppointment(session, input);
    return { appointment, lead };
  });
}

/** Verbes non pris en charge : reponse explicite plutot qu'un 405 muet. */
export async function PUT() {
  return NextResponse.json({ error: "Utilise PATCH sur /api/sales/appointments/[id]." }, { status: 405 });
}
