import { NextRequest } from "next/server";
import { newId, readDB, writeDB } from "@/lib/db";
import { canSee, Forbidden, readSession, requireAdmin, requireSales } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { listLogs, patchAppointment } from "@/lib/sales/repo";

export const dynamic = "force-dynamic";

/**
 * Fiche complete d'un rendez-vous : le lead, le contexte du setter, la vente
 * eventuelle, les relances et le journal. C'est l'ecran que le closer ouvre
 * avant de decrocher.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = requireSales(readSession(req));
    const { id } = await ctx.params;
    const db = readDB();

    const appointment = db.appointments.find((a) => a.id === id);
    // Meme reponse qu'un rendez-vous inexistant : ne pas confirmer l'existence
    // d'une fiche a quelqu'un qui n'y a pas droit.
    if (!appointment || !canSee(session, appointment)) throw new Forbidden("Rendez-vous introuvable.");

    const lead = db.leads.find((l) => l.id === appointment.leadId) ?? null;
    const sale = db.sales.find((s) => s.appointmentId === appointment.id) ?? null;
    const followUps = db.followUps.filter((f) => f.appointmentId === appointment.id);
    const names = new Map(db.team.map((m) => [m.id, m.name]));

    /* Les autres rendez-vous du meme lead : un prospect peut avoir ete
       no-show puis reprogramme, l'historique compte pour le closer. */
    const otherAppointments = db.appointments
      .filter((a) => a.leadId === appointment.leadId && a.id !== appointment.id)
      .map((a) => ({ id: a.id, scheduledAt: a.scheduledAt, status: a.status, setterName: names.get(a.setterId) ?? "—" }))
      .sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt));

    // Eleve deja inscrit pour cette vente : evite de reproposer un onboarding
    // deja fait, et donne le lien vers sa fiche de suivi.
    const student = sale ? (db.students.find((st) => st.saleId === sale.id) ?? null) : null;

    return {
      appointment,
      lead,
      sale,
      student: session.isAdmin ? student : null,
      followUps,
      otherAppointments,
      setterName: names.get(appointment.setterId) ?? "—",
      closerName: appointment.closerId ? (names.get(appointment.closerId) ?? "—") : "",
      logs: session.isAdmin ? listLogs("appointment", appointment.id, 30) : [],
      currency: db.settings.salesCurrency || "USD",
    };
  });
}

/** Assignation d'un closer, notes du setter, qualification, reprogrammation. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = requireSales(readSession(req));
    const { id } = await ctx.params;
    const body = (await req.json()) as Record<string, unknown>;

    // Liste blanche : tout champ non prevu est ignore plutot que recopie
    // aveuglement dans l'enregistrement.
    const patch: Parameters<typeof patchAppointment>[2] = {};
    if (typeof body.closerId === "string") patch.closerId = body.closerId;
    if (typeof body.setterId === "string") patch.setterId = body.setterId;
    if (typeof body.setterNotes === "string") patch.setterNotes = body.setterNotes;
    if (typeof body.qualified === "boolean") patch.qualified = body.qualified;
    if (typeof body.scheduledAt === "string") patch.scheduledAt = body.scheduledAt;
    if (typeof body.timezone === "string") patch.timezone = body.timezone;
    if (typeof body.iclosedUrl === "string") patch.iclosedUrl = body.iclosedUrl;

    return patchAppointment(session, id, patch);
  });
}

/**
 * Suppression d'un rendez-vous (admin).
 *
 * Il disparait de l'agenda, du dashboard du closer et des chiffres. Ses
 * relances partent avec lui. Un rendez-vous qui porte une vente ne se
 * supprime pas : la vente d'abord. Un call venu d'iClosed est memorise
 * comme supprime pour que la synchro ne le recree pas dix minutes plus tard.
 */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = requireAdmin(readSession(req));
    const { id } = await ctx.params;
    const db = readDB();
    const appt = db.appointments.find((a) => a.id === id);
    if (!appt) throw new Error("Rendez-vous introuvable.");
    if (db.sales.some((s) => s.appointmentId === id)) {
      throw new Error("Ce rendez-vous porte une vente : annule la vente avant de le supprimer.");
    }
    const lead = db.leads.find((l) => l.id === appt.leadId);

    db.appointments = db.appointments.filter((a) => a.id !== id);
    db.followUps = db.followUps.filter((f) => f.appointmentId !== id);
    if (appt.iclosedEventId) {
      const skip = new Set(db.settings.salesDeletedIclosedEventIds ?? []);
      skip.add(appt.iclosedEventId);
      db.settings.salesDeletedIclosedEventIds = [...skip].slice(-500);
    }
    // Le lead froid retrouve sa place dans « A appeler » s'il n'a plus de rendez-vous.
    if (lead && lead.stage === "call-book" && !db.appointments.some((a) => a.leadId === lead.id && a.status !== "cancelled")) {
      lead.stage = "contacte";
    }
    db.activityLogs.unshift({
      id: newId(),
      at: new Date().toISOString(),
      actorId: session.memberId,
      actorName: session.memberName || "Moi",
      action: "appointment.deleted",
      entity: "appointment",
      entityId: id,
      summary: `Rendez-vous de ${lead?.name ?? "un lead"} supprimé`,
    });
    writeDB(db);
    return { ok: true };
  });
}
