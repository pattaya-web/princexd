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

    // Pseudo Instagram du contact, saisi a la main depuis le detail du
    // rendez-vous (l'import n'en invente plus). Memes droits que la lecture.
    if (typeof body.igUsername === "string") {
      const db = readDB();
      const appt = db.appointments.find((a) => a.id === id);
      if (!appt) throw new Forbidden("Rendez-vous introuvable.");
      if (!canSee(session, appt)) throw new Forbidden();
      const lead = db.leads.find((l) => l.id === appt.leadId);
      if (lead) {
        const clean = body.igUsername.trim().replace(/^@+/, "");
        lead.igUsername = clean;
        lead.handle = clean ? `@${clean}` : "";
        db.activityLogs.unshift({
          id: newId(),
          at: new Date().toISOString(),
          actorId: session.memberId,
          actorName: session.memberName || "Moi",
          action: "lead.updated",
          entity: "lead",
          entityId: lead.id,
          summary: clean ? `Pseudo Instagram de ${lead.name} : @${clean}` : `Pseudo Instagram de ${lead.name} effacé`,
        });
        writeDB(db);
      }
    }

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
    const lead = db.leads.find((l) => l.id === appt.leadId);

    /*
     * La vente attachee part avec le rendez-vous : c'est ce que veut dire
     * « supprimer » pour un test ou une erreur de saisie. Le grand livre se
     * recalcule, les commissions de cette vente disparaissent avec elle.
     * L'interface a demande confirmation en citant le montant.
     */
    const sales = db.sales.filter((s) => s.appointmentId === id);
    const saleIds = new Set(sales.map((s) => s.id));
    db.sales = db.sales.filter((s) => !saleIds.has(s.id));
    if (lead && saleIds.size && lead.stage === "closed-won") lead.stage = "call-fait";

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
      summary: `Rendez-vous de ${lead?.name ?? "un lead"} supprimé${sales.length ? ` avec sa vente (${sales.map((s) => `${s.contractValue} ${s.currency}`).join(", ")})` : ""}`,
    });
    writeDB(db);
    return { ok: true, salesRemoved: sales.length };
  });
}
