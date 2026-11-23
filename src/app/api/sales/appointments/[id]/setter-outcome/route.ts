import { NextRequest } from "next/server";
import { newId, readDB, writeDB } from "@/lib/db";
import { Forbidden, readSession, requireSales } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { LOST_REASONS } from "@/lib/sales/constants";
import { recordOutcome, type OutcomeInput } from "@/lib/sales/repo";
import { sessionHas } from "@/lib/sales/roles";
import { parisDay } from "@/lib/format";
import { FOLLOWUP_HEATS, type FollowUpHeat, type LostReason, type SetterTask } from "@/lib/types";

export const dynamic = "force-dynamic";

export type SetterResult = "show" | "no-show" | "closed" | "not-closed" | "follow-up";
const RESULTS: SetterResult[] = ["show", "no-show", "closed", "not-closed", "follow-up"];

/**
 * Le setter statue un call (2026-11-23) : Mady lui dit « le call est fini »,
 * il pose show / no-show, puis closé, pas closé ou à relancer (date +
 * chaleur). Un « closé » ne crée pas de vente : le setter ne connaît pas les
 * montants, Mady pose le montant ensuite (le CRM affiche « Closé · montant à
 * poser »). « À relancer » va dans SES relances, chaleur comprise. Les notes
 * déjà présentes sur le call (résumé Fathom, note de Mady) sont gardées : la
 * note du setter s'ajoute en dessous.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = requireSales(readSession(req));
    if (!session.isAdmin && !sessionHas(session, "setter")) throw new Forbidden();
    const { id } = await ctx.params;
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const result = b.result as SetterResult;
    if (!RESULTS.includes(result)) throw new Error("Résultat inconnu.");
    const note = typeof b.note === "string" ? b.note.trim().slice(0, 2000) : "";

    const db = readDB();
    const appt = db.appointments.find((a) => a.id === id);
    if (!appt) throw new Error("Rendez-vous introuvable.");
    if (!session.isAdmin && !session.salesHead && appt.setterId !== session.memberId) throw new Forbidden("Ce call n'est pas le tien.");
    const lead = db.leads.find((l) => l.id === appt.leadId);
    const who = session.memberName || "Le setter";
    const day = parisDay(0).split("-").reverse().join("/");

    const line =
      result === "closed"
        ? `✅ Closé · déclaré par ${who} le ${day} : montant à poser par Mady.${note ? ` ${note}` : ""}`
        : note
          ? `${who} (${day}) : ${note}`
          : "";
    const closerNotes = line ? [appt.closerNotes?.trim(), line].filter(Boolean).join("\n\n") : undefined;

    const recap = (closed: boolean, reason: LostReason | ""): OutcomeInput["recap"] => ({
      closed,
      notClosedReason: reason,
      notClosedDetail: appt.recap?.notClosedDetail ?? "",
      pitched: true,
      notPitchedReason: "",
      leadInfo: appt.recap?.leadInfo ?? "",
      objective: appt.recap?.objective ?? "",
      objectiveOther: appt.recap?.objectiveOther ?? "",
      nextAction: appt.recap?.nextAction ?? "",
      nextActionAt: appt.recap?.nextActionAt ?? "",
    });

    let input: OutcomeInput;
    if (result === "no-show") input = { status: "no-show", closerNotes };
    else if (result === "show") input = { status: "completed", closerNotes };
    else if (result === "closed") input = { status: "completed", closerNotes, recap: recap(true, "") };
    else if (result === "not-closed") {
      const reason = (LOST_REASONS.includes(b.lostReason as LostReason) ? b.lostReason : "other") as LostReason;
      input = { status: "closed-lost", lostReason: reason, closerNotes, recap: recap(false, reason) };
    } else input = { status: "follow-up", closerNotes, recap: recap(false, appt.recap?.notClosedReason ?? "") };

    const out = recordOutcome(session, appt.id, input);

    // « À relancer » : une relance dans la liste du setter, avec la chaleur.
    let task: SetterTask | null = null;
    if (result === "follow-up") {
      const fresh = readDB();
      fresh.setterTasks ??= [];
      const heat = FOLLOWUP_HEATS.includes(b.heat as FollowUpHeat) ? (b.heat as FollowUpHeat) : undefined;
      const dueOn = typeof b.dueOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.dueOn) ? b.dueOn : parisDay(2);
      const setterId = session.isAdmin ? appt.setterId : session.memberId;
      // Une relance ouverte de plus pour le même lead ferait doublon : on la met à jour.
      const open = fresh.setterTasks.find((t) => t.status === "open" && t.leadId && t.leadId === appt.leadId && t.setterId === setterId);
      const now = new Date().toISOString();
      if (open) {
        open.dueOn = dueOn;
        if (note) open.note = note;
        if (heat) open.heat = heat;
        task = open;
      } else {
        task = {
          id: newId(),
          setterId,
          leadId: appt.leadId,
          name: lead?.name || "Prospect",
          phone: lead?.phone ?? "",
          igUsername: lead?.igUsername ?? "",
          kind: "message",
          dueOn,
          note: note || "Relance après le call.",
          status: "open",
          createdBy: who,
          createdAt: now,
          doneAt: "",
          ...(heat ? { heat } : {}),
        };
        fresh.setterTasks.unshift(task);
      }
      writeDB(fresh);
    }
    return { appointment: out.appointment, task };
  });
}
