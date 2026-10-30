import { NextRequest } from "next/server";
import { newId, readDB, writeDB } from "@/lib/db";
import { readSession, requireAdmin } from "@/lib/sales/access";
import { handle, num } from "@/lib/sales/http";
import { isHeldFromSetter } from "@/lib/sales/setter-view";
import { escTelegram, notifyTelegram } from "@/lib/telegram";
import { fmtMoney } from "@/lib/format";
import type { DB, Sale } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Closings à envoyer au setter (2026-10-30).
 *
 * Un call closé n'apparaît pas tout de suite chez le setter : la vente est
 * créée « en attente » (`Sale.setterHold`) et Mady décide, depuis le Sales
 * Dashboard, ce qu'elle lui annonce (contrat signé, encaissé) avant de
 * l'envoyer. Jusque-là le setter voit un call fait, sans issue ni montant,
 * et aucune commission ne lui est calculée dessus.
 */
export interface SetterSendRow {
  saleId: string;
  appointmentId: string;
  leadId: string;
  leadName: string;
  igUsername: string;
  setterId: string;
  setterName: string;
  /** Le setter est relié au bot Telegram : il sera prévenu à l'envoi. */
  setterTelegram: boolean;
  closerName: string;
  soldAt: string;
  offer: string;
  /** Vrais montants (Sales Dashboard). */
  contractValue: number;
  cashCollected: number;
  currency: string;
  /** Ce qui est (ou sera) annoncé au setter. Vide = le vrai montant. */
  setterAmount: number | null;
  setterCash: number | null;
  sentAt: string;
}

function toRow(db: DB, s: Sale): SetterSendRow {
  const lead = db.leads.find((l) => l.id === s.leadId);
  const names = new Map(db.team.map((m) => [m.id, m]));
  const setter = s.setterId ? names.get(s.setterId) : undefined;
  return {
    saleId: s.id,
    appointmentId: s.appointmentId,
    leadId: s.leadId,
    leadName: lead?.name ?? "Lead supprimé",
    igUsername: lead?.igUsername ?? "",
    setterId: s.setterId,
    setterName: setter?.name ?? "",
    setterTelegram: Boolean(setter?.telegramChatId),
    closerName: s.closerId ? (names.get(s.closerId)?.name ?? "") : "",
    soldAt: s.soldAt,
    offer: s.offer,
    contractValue: s.contractValue,
    cashCollected: s.cashCollected,
    currency: s.currency || db.settings.salesCurrency || "EUR",
    setterAmount: typeof s.setterAmount === "number" ? s.setterAmount : null,
    setterCash: typeof s.setterCash === "number" ? s.setterCash : null,
    sentAt: s.setterSentAt ?? "",
  };
}

export async function GET(req: NextRequest) {
  return handle(() => {
    requireAdmin(readSession(req));
    const db = readDB();
    const live = db.sales.filter((s) => s.status !== "cancelled");
    const pending = live
      .filter(isHeldFromSetter)
      .sort((a, b) => b.soldAt.localeCompare(a.soldAt))
      .map((s) => toRow(db, s));
    const sent = live
      .filter((s) => !isHeldFromSetter(s) && s.setterSentAt)
      .sort((a, b) => (b.setterSentAt ?? "").localeCompare(a.setterSentAt ?? ""))
      .slice(0, 20)
      .map((s) => toRow(db, s));
    return { pending, sent };
  });
}

/**
 * « Envoyer » : fixe ce que le setter verra de cette vente et la rend
 * visible dans son espace (accueil, perfs, commissions). Le setter relié au
 * bot Telegram reçoit un message. Les vrais montants ne bougent pas.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const session = requireAdmin(readSession(req));
    const body = (await req.json().catch(() => ({}))) as { saleId?: unknown; setterAmount?: unknown; setterCash?: unknown };
    const db = readDB();
    const sale = db.sales.find((s) => s.id === String(body.saleId ?? ""));
    if (!sale) throw new Error("Vente introuvable.");
    if (sale.status === "cancelled") throw new Error("Cette vente est annulée.");

    const amount = body.setterAmount === null || body.setterAmount === "" || body.setterAmount === undefined ? undefined : Math.max(0, num(body.setterAmount));
    const cash = body.setterCash === null || body.setterCash === "" || body.setterCash === undefined ? undefined : Math.max(0, num(body.setterCash));
    if (amount === undefined && cash !== undefined) throw new Error("Indique le contrat annoncé au setter avant l'encaissé.");
    if (amount !== undefined && cash !== undefined && cash > amount + 0.005) throw new Error("L'encaissé annoncé ne peut pas dépasser le contrat annoncé.");

    const now = new Date().toISOString();
    if (amount === undefined) {
      delete sale.setterAmount;
      delete sale.setterCash;
    } else {
      sale.setterAmount = amount;
      if (cash === undefined) delete sale.setterCash;
      else sale.setterCash = cash;
    }
    delete sale.setterHold;
    sale.setterSentAt = now;
    sale.updatedAt = now;

    const row = toRow(db, sale);
    const shownContract = amount ?? sale.contractValue;
    const shownCash = amount === undefined ? sale.cashCollected : cash !== undefined ? cash : sale.cashCollected > 0 ? amount : 0;
    db.activityLogs.unshift({
      id: newId(),
      at: now,
      actorId: session.memberId,
      actorName: session.memberName || "Moi",
      action: "sale.sent-to-setter",
      entity: "sale",
      entityId: sale.id,
      summary: `Closing de ${row.leadName} envoyé à ${row.setterName || "aucun setter"} : ${fmtMoney(shownContract, row.currency)} annoncés (${fmtMoney(shownCash, row.currency)} encaissés)`,
    });
    writeDB(db);

    const setter = sale.setterId ? db.team.find((m) => m.id === sale.setterId) : undefined;
    if (setter) {
      notifyTelegram(
        setter,
        `🎉 <b>Closé !</b> ${escTelegram(row.leadName)} a signé.\nContrat : <b>${escTelegram(fmtMoney(shownContract, row.currency))}</b> · encaissé : ${escTelegram(fmtMoney(shownCash, row.currency))}.\nBravo, c'est dans ton espace.`,
      );
    }
    return { row: toRow(db, sale), notified: Boolean(setter?.telegramChatId) };
  });
}
