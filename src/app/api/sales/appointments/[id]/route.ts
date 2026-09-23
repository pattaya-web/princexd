import { NextRequest } from "next/server";
import { readDB } from "@/lib/db";
import { canSee, Forbidden, readSession, requireSales } from "@/lib/sales/access";
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
