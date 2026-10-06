import { NextRequest } from "next/server";
import { newId, readDB, writeDB } from "@/lib/db";
import { Forbidden, readSession, requireSales } from "@/lib/sales/access";
import { handle, num } from "@/lib/sales/http";
import { patchSale } from "@/lib/sales/repo";
import type { PaymentType, SaleInstallment, SaleStatus } from "@/lib/types";

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
    if (typeof body.soldAt === "string" && !Number.isNaN(Date.parse(body.soldAt))) patch.soldAt = new Date(body.soldAt).toISOString();
    // Plan de paiement : dates et montants des echeances, reverifies un a un.
    if (Array.isArray(body.schedule)) {
      patch.schedule = (body.schedule as Record<string, unknown>[])
        .filter((it) => it && typeof it === "object")
        .map((it) => ({
          n: Math.max(1, Math.floor(num(it.n))),
          dueAt: typeof it.dueAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(it.dueAt) ? it.dueAt : "",
          amount: Math.max(0, num(it.amount)),
          paidAt: typeof it.paidAt === "string" ? it.paidAt : "",
        }))
        .filter((it) => it.dueAt) as SaleInstallment[];
    }

    return patchSale(session, id, patch);
  });
}

/**
 * Encaissement recu apres la vente (paiement en plusieurs fois).
 *
 * Reserve a l'admin et au closer de la vente. Le total encaisse augmente
 * d'autant, l'encaissement est date : la commission sur le cash tombe au
 * mois ou l'argent est arrive (voir lib/sales/commissions).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = requireSales(readSession(req));
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as { amount?: unknown; at?: string; method?: string; note?: string; installmentN?: unknown };

    const db = readDB();
    const sale = db.sales.find((s) => s.id === id);
    if (!sale) throw new Error("Vente introuvable.");
    if (!session.isAdmin && sale.closerId !== session.memberId) throw new Forbidden("Seul le closer de cette vente enregistre ses encaissements.");
    if (sale.status === "cancelled") throw new Error("Cette vente est annulée.");

    const amount = Math.round(num(body.amount) * 100) / 100;
    if (amount <= 0) throw new Error("Indique le montant reçu.");
    const remaining = Math.max(0, sale.contractValue - sale.cashCollected);
    if (amount > remaining + 0.005) {
      throw new Error(`Il ne reste que ${remaining} ${sale.currency} à encaisser sur ce contrat. Corrige la valeur du contrat si elle a changé.`);
    }
    const at = body.at && !Number.isNaN(Date.parse(body.at)) ? new Date(body.at).toISOString() : new Date().toISOString();

    const now = new Date().toISOString();
    sale.collections = [
      ...(sale.collections ?? []),
      { id: newId(), amount, at, method: String(body.method ?? "").trim(), note: String(body.note ?? "").trim(), by: session.memberId, createdAt: now },
    ];
    sale.cashCollected = Math.round((sale.cashCollected + amount) * 100) / 100;
    sale.updatedAt = now;

    /*
     * L'echeance correspondante est marquee payee : celle designee par le
     * bouton « Encaissé », sinon la plus ancienne encore due dont le montant
     * tient dans ce qui vient d'arriver.
     */
    const wanted = Math.floor(num(body.installmentN));
    const plan = sale.schedule ?? [];
    const target = wanted > 0 ? plan.find((it) => it.n === wanted && !it.paidAt) : plan.find((it) => !it.paidAt && it.amount <= amount + 0.01);
    if (target) target.paidAt = at;

    const lead = db.leads.find((l) => l.id === sale.leadId);
    db.activityLogs.unshift({
      id: newId(),
      at: now,
      actorId: session.memberId,
      actorName: session.memberName || "Moi",
      action: "sale.collected",
      entity: "sale",
      entityId: sale.id,
      summary: `${amount} ${sale.currency} encaissés sur la vente de ${lead?.name ?? "un client"} (${sale.cashCollected}/${sale.contractValue})`,
    });
    writeDB(db);
    return { sale, remaining: Math.max(0, sale.contractValue - sale.cashCollected) };
  });
}
