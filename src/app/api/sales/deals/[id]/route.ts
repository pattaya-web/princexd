import { NextRequest } from "next/server";
import { readSession, requireSales } from "@/lib/sales/access";
import { handle, num } from "@/lib/sales/http";
import { patchSale } from "@/lib/sales/repo";
import type { PaymentType, SaleStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Mise a jour d'une vente : encaissement complementaire, remboursement,
 * annulation, correction de saisie.
 *
 * Les commissions ne sont pas recalculees ici : elles se deduisent des ventes
 * a chaque lecture, donc corriger un montant met le grand livre a jour tout
 * seul, sans risque de laisser une commission figee sur une valeur perimee.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = requireSales(readSession(req));
    const { id } = await ctx.params;
    const body = (await req.json()) as Record<string, unknown>;

    const patch: Parameters<typeof patchSale>[2] = {};
    if (body.offer !== undefined) patch.offer = String(body.offer);
    if (body.notes !== undefined) patch.notes = String(body.notes);
    if (body.paymentMethod !== undefined) patch.paymentMethod = String(body.paymentMethod);
    if (body.contractValue !== undefined) patch.contractValue = Math.max(0, num(body.contractValue));
    if (body.cashCollected !== undefined) patch.cashCollected = Math.max(0, num(body.cashCollected));
    if (body.refundAmount !== undefined) patch.refundAmount = Math.max(0, num(body.refundAmount));
    if (body.installments !== undefined) patch.installments = Math.max(0, num(body.installments));
    if (typeof body.paymentType === "string") patch.paymentType = body.paymentType as PaymentType;
    if (typeof body.status === "string") patch.status = body.status as SaleStatus;

    return patchSale(session, id, patch);
  });
}
