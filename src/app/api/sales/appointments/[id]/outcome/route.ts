import { NextRequest } from "next/server";
import { getSettings } from "@/lib/db";
import { readSession, requireSales } from "@/lib/sales/access";
import { handle, num, required } from "@/lib/sales/http";
import { recordOutcome, type OutcomeInput } from "@/lib/sales/repo";
import { CALL_OUTCOMES } from "@/lib/sales/constants";
import type { AppointmentStatus, LostReason, PaymentType } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Resultat d'un call, enregistre par le closer.
 *
 * Une seule requete cloture le rendez-vous, cree la vente et programme la
 * relance : le closer doit pouvoir liquider son call en quelques secondes,
 * et un enchainement de trois appels laisserait la base a moitie a jour si
 * l'un d'eux echouait.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = requireSales(readSession(req));
    const { id } = await ctx.params;
    const body = (await req.json()) as Record<string, unknown>;

    const status = body.status as AppointmentStatus;
    if (!CALL_OUTCOMES.includes(status)) {
      throw new Error("Résultat de call inconnu.");
    }

    const input: OutcomeInput = {
      status,
      closerNotes: typeof body.closerNotes === "string" ? body.closerNotes : "",
    };

    if (status === "closed-lost") {
      input.lostReason = (body.lostReason as LostReason) || "other";
    }

    if (status === "closed-won") {
      const sale = (body.sale ?? {}) as Record<string, unknown>;
      const contractValue = num(sale.contractValue);
      const cashCollected = num(sale.cashCollected);

      if (contractValue <= 0) throw new Error("La valeur de contrat doit être supérieure à 0.");
      // Encaisser plus que le contrat est toujours une faute de saisie, et
      // fausserait les commissions assises sur le cash.
      if (cashCollected > contractValue) {
        throw new Error("Le cash encaissé ne peut pas dépasser la valeur du contrat.");
      }

      input.sale = {
        offer: required(sale.offer, "L'offre vendue"),
        contractValue,
        cashCollected,
        currency: (sale.currency as string) || getSettings().salesCurrency || "USD",
        paymentType: ((sale.paymentType as PaymentType) || "paid-in-full") as PaymentType,
        installments: num(sale.installments),
        paymentMethod: (sale.paymentMethod as string) || "",
        soldAt: (sale.soldAt as string) || new Date().toISOString(),
        notes: (sale.notes as string) || "",
      };
    }

    if (status === "follow-up" || status === "rescheduled") {
      const fu = (body.followUp ?? {}) as Record<string, unknown>;
      if (fu.dueAt) {
        input.followUp = {
          dueAt: String(fu.dueAt),
          notes: (fu.notes as string) || "",
          closerId: (fu.closerId as string) || "",
        };
      }
      if (status === "rescheduled") {
        const at = required(body.rescheduledAt, "La nouvelle date");
        input.rescheduledAt = at;
      }
    }

    return recordOutcome(session, id, input);
  });
}
