import { NextRequest } from "next/server";
import { readDB } from "@/lib/db";
import { fetchCalls, IclosedError, type IclosedCall } from "@/lib/iclosed";
import { readSession, requireAdmin } from "@/lib/sales/access";
import { handle, required } from "@/lib/sales/http";
import {
  dealAmount,
  findByIclosedId,
  fromIclosedCall,
  mapLostReason,
  mapOutcome,
  resolveCloser,
} from "@/lib/sales/iclosed-link";
import { createAppointment, patchAppointment, recordOutcome } from "@/lib/sales/repo";
import { FINAL_STATUSES } from "@/lib/sales/constants";
import type { AppointmentSource, Session } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Import et synchronisation des rendez-vous iClosed.
 *
 * S'appuie sur le client iClosed deja present dans le tool : meme cle, meme
 * pagination, aucune API inventee. Sans cle configuree, la route echoue
 * proprement plutot que de fabriquer des donnees.
 *
 * Reparti des faits observes sur l'API reelle :
 *
 *  - iClosed sait QUI a pris le call (champ `user`) mais pas qui a set le
 *    lead. Le setter est donc fourni par l'appelant, jamais devine.
 *  - iClosed ne remonte un montant que si un deal y a ete saisi. Quand
 *    l'issue dit « vente » sans montant, on ne fabrique pas de chiffre : le
 *    rendez-vous est marque comme honore et signale a completer a la main.
 *
 * L'operation est idempotente : un rendez-vous deja importe est mis a jour,
 * jamais duplique.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const session = requireAdmin(readSession(req));
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const setterId = required(body.setterId, "Le setter à qui attribuer les rendez-vous");
    if (!readDB().team.some((m) => m.id === setterId)) throw new Error("Setter introuvable.");

    const fallbackCloserId = typeof body.closerId === "string" ? body.closerId : "";
    const fallbackSource = (body.source as AppointmentSource) || "inbound";
    const scope = body.scope === "past" ? "PAST" : "UPCOMING";
    const applyOutcomes = body.applyOutcomes !== false;
    /*
     * Taille du lot.
     *
     * Un compte peut contenir des centaines de calls ; les avaler d'un bloc
     * ecrit autant de fois la base et rend l'operation impossible a annuler
     * si l'attribution choisie etait la mauvaise. On importe donc par lots,
     * en commencant petit.
     */
    const maxCalls = Math.min(Math.max(Number(body.maxCalls) || 50, 1), 300);

    let calls: IclosedCall[];
    try {
      calls = (await fetchCalls(scope, Math.ceil(maxCalls / 50), 50)).slice(0, maxCalls);
    } catch (e) {
      // Message d'origine conserve : il dit precisement si la cle manque ou si
      // la limite de requetes est atteinte.
      throw new Error(e instanceof IclosedError ? e.message : (e as Error).message);
    }

    const report = {
      examined: calls.length,
      created: 0,
      updated: 0,
      skipped: 0,
      salesCreated: 0,
      /** Ventes annoncees par iClosed sans montant : a saisir a la main. */
      salesWithoutAmount: [] as string[],
      /** Hotes iClosed sans closer correspondant dans le CRM. */
      unmappedHosts: [] as string[],
    };

    for (const call of calls) {
      const eventId = String(call.id);
      const db = readDB();

      /*
       * Le closer vient de la correspondance explicite hote iClosed -> membre.
       * Sans correspondance, on retombe sur le closer choisi dans le
       * formulaire, et on le signale : c'est presque toujours le signe que le
       * closer n'a pas encore ete cree dans iClosed.
       */
      const mapped = resolveCloser(db, call);
      if (!mapped) {
        const hostName = [call.user?.firstName, call.user?.lastName].filter(Boolean).join(" ").trim();
        if (hostName && !report.unmappedHosts.includes(hostName)) report.unmappedHosts.push(hostName);
      }
      /*
       * Le closer choisi dans le formulaire prime sur la correspondance.
       *
       * Avec un seul siege iClosed, tous les calls sont heberges par le meme
       * compte : la correspondance les attribuerait tous a la meme personne.
       * L'admin doit donc pouvoir imposer le closer, ou n'en mettre aucun pour
       * repartir les calls a la main ensuite.
       */
      const closerId = fallbackCloserId || mapped?.id || "";

      const existing = findByIclosedId(db, eventId);
      let appointmentId: string;

      if (existing) {
        report.updated += 1;
        appointmentId = existing.id;
        // Le closer peut avoir ete renseigne dans iClosed apres coup.
        if (mapped && existing.closerId !== mapped.id) {
          patchAppointment(session, existing.id, { closerId: mapped.id });
        }
        if (FINAL_STATUSES.includes(existing.status)) {
          // Deja tranche cote CRM : la saisie humaine fait foi, on n'ecrase pas.
          continue;
        }
      } else {
        const input = fromIclosedCall(call, { setterId, closerId, source: fallbackSource });
        if (!input) {
          report.skipped += 1;
          continue;
        }
        // Sans pseudo Instagram, on retombe sur l'email ou le nom : le lead
        // doit rester identifiable, quitte a etre complete a la main ensuite.
        if (!input.igUsername) {
          input.igUsername = (input.email || input.name || `iclosed-${eventId}`).split("@")[0];
        }
        appointmentId = createAppointment(session, input).appointment.id;
        report.created += 1;
      }

      if (!applyOutcomes) continue;
      applyIclosedOutcome(session, appointmentId, call, report);
    }

    return report;
  });
}

/** Reporte l'issue iClosed sur le rendez-vous, quand il y en a une. */
function applyIclosedOutcome(
  session: Session,
  appointmentId: string,
  call: IclosedCall,
  report: { salesCreated: number; salesWithoutAmount: string[] },
) {
  const status = mapOutcome(call);
  // Le cas le plus frequent : aucune issue saisie dans iClosed. On laisse le
  // rendez-vous tel quel plutot que d'inventer un resultat.
  if (!status || status === "cancelled" || status === "rescheduled") return;

  const notes = (call.task ?? []).map((t) => t.notes).filter(Boolean).join("\n");
  const amount = dealAmount(call);

  if (status === "closed-won") {
    if (amount <= 0) {
      // iClosed annonce une vente sans montant : on refuse d'inventer un
      // chiffre qui se propagerait jusqu'aux commissions.
      report.salesWithoutAmount.push(call.inviteeName || String(call.id));
      recordOutcome(session, appointmentId, {
        status: "completed",
        closerNotes: [notes, "Vente signalée par iClosed sans montant — à compléter à la main."]
          .filter(Boolean)
          .join("\n"),
      });
      return;
    }
    recordOutcome(session, appointmentId, {
      status: "closed-won",
      closerNotes: notes,
      sale: {
        offer: call.callType?.replace(/_/g, " ").toLowerCase() || "Vente iClosed",
        contractValue: amount,
        // iClosed ne distingue pas contrat et cash encaisse : on prend le
        // montant du deal comme cash, quitte a le corriger dans la fiche.
        cashCollected: amount,
        currency: readDB().settings.salesCurrency || "USD",
        paymentType: "paid-in-full",
        installments: 0,
        paymentMethod: "",
        soldAt: new Date(call.dateTimeUTC).toISOString(),
        notes: "Importé depuis iClosed",
      },
    });
    report.salesCreated += 1;
    return;
  }

  recordOutcome(session, appointmentId, {
    status,
    closerNotes: notes,
    ...(status === "closed-lost" ? { lostReason: mapLostReason(call) } : {}),
  });
}
