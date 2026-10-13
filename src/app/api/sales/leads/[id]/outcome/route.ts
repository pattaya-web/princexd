import { NextRequest } from "next/server";
import { getSettings } from "@/lib/db";
import { readSession, requireSales } from "@/lib/sales/access";
import { handle, num } from "@/lib/sales/http";
import { LOST_REASONS } from "@/lib/sales/constants";
import { quickOutcome, type QuickOutcomeInput, type QuickOutcomeStatus } from "@/lib/sales/repo";
import { addDays, DEFAULT_EXPECTED_DAYS, parisToday } from "@/lib/sales/installments";
import type { LostReason, PaymentType } from "@/lib/types";

export const dynamic = "force-dynamic";

const STATUSES: QuickOutcomeStatus[] = ["completed", "follow-up", "closed-won", "no-show", "closed-lost", "rescheduled"];

/**
 * Issue d'un lead posee depuis sa fiche : pitche, en attente, close,
 * no-show, perdu. Une seule requete : le rendez-vous (existant ou cree a
 * l'instant), la vente, la relance et l'historique.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = requireSales(readSession(req));
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const status = body.status as QuickOutcomeStatus;
    if (!STATUSES.includes(status)) throw new Error("Issue inconnue.");

    const input: QuickOutcomeInput = {
      status,
      closerId: typeof body.closerId === "string" ? body.closerId : "",
      note: typeof body.note === "string" ? body.note.trim().slice(0, 4000) : "",
    };

    if (status === "closed-lost") {
      const reason = body.lostReason as LostReason;
      input.lostReason = LOST_REASONS.includes(reason) ? reason : "other";
    }

    if (status === "follow-up") {
      const at = typeof body.followUpAt === "string" ? new Date(body.followUpAt) : null;
      input.followUpAt = at && !Number.isNaN(at.getTime()) ? at.toISOString() : "";
    }

    if (status === "rescheduled") {
      const at = typeof body.rescheduledAt === "string" ? new Date(body.rescheduledAt) : null;
      if (!at || Number.isNaN(at.getTime())) throw new Error("Indique la nouvelle date du call.");
      input.rescheduledAt = at.toISOString();
    }

    if (status === "closed-won") {
      const s = getSettings();
      const sale = (body.sale ?? {}) as Record<string, unknown>;
      const contractValue = num(sale.contractValue);
      const cashCollected = num(sale.cashCollected);
      if (contractValue <= 0) throw new Error("Indique le montant du contrat.");
      if (cashCollected > contractValue) throw new Error("L'encaissé ne peut pas dépasser le montant du contrat.");
      const installments = Math.max(0, Math.floor(num(sale.installments)));
      const offer = typeof sale.offer === "string" && sale.offer.trim() ? sale.offer.trim().slice(0, 120) : (s.salesOffers?.[0]?.name ?? "Offre");
      input.sale = {
        offer,
        contractValue,
        cashCollected,
        currency: s.salesCurrency || "EUR",
        paymentType: (cashCollected >= contractValue ? "paid-in-full" : installments > 0 ? "installments" : cashCollected > 0 ? "deposit" : "other") as PaymentType,
        installments,
        paymentMethod: typeof sale.paymentMethod === "string" ? sale.paymentMethod.slice(0, 60) : "",
        soldAt: new Date().toISOString(),
        notes: input.note ?? "",
        // Contrat envoye, rien encaisse : quand le paiement est attendu (J+3 par defaut).
        paymentExpectedAt: cashCollected > 0 ? "" : typeof sale.paymentExpectedAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sale.paymentExpectedAt) ? sale.paymentExpectedAt : addDays(parisToday(), DEFAULT_EXPECTED_DAYS),
      };
    }

    return quickOutcome(session, id, input);
  });
}
