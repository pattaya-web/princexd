import { NextRequest } from "next/server";
import { newId, readDB, writeDB } from "@/lib/db";
import { readSession, requireAdmin } from "@/lib/sales/access";
import { handle, num, required } from "@/lib/sales/http";
import { memberRoles, primaryRole, type CommercialRole } from "@/lib/sales/roles";
import { notifyTelegram } from "@/lib/telegram";
import { fmtMoney } from "@/lib/format";
import type { CommissionAdjustment } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Bonus / malus (2026-10-14), admin seulement.
 *
 * Le proprietaire juge la qualite du setting (conversations remontees,
 * prospects vraiment qualifies) et pose un bonus ; a l'inverse un malus
 * sanctionne un setting bacle. L'ajustement entre dans le grand livre comme
 * une ligne de commission, datee, avec son motif : le membre le voit dans
 * son detail et le reste du bouge d'autant.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const session = requireAdmin(readSession(req));
    const body = (await req.json()) as Record<string, unknown>;
    const db = readDB();

    const memberId = required(body.memberId, "Le membre");
    const member = db.team.find((m) => m.id === memberId);
    if (!member) throw new Error("Membre introuvable.");
    const roles = memberRoles(member);
    if (!roles.length) throw new Error("Seuls les setters et les closers ont des commissions à ajuster.");
    const role: CommercialRole = body.role === "setter" || body.role === "closer" ? body.role : primaryRole(roles)!;
    if (!roles.includes(role)) throw new Error(`${member.name} n'est pas ${role}.`);

    const kind: CommissionAdjustment["kind"] = body.kind === "malus" ? "malus" : "bonus";
    const mode: CommissionAdjustment["mode"] = body.mode === "pct" ? "pct" : "amount";
    const value = Math.abs(num(body.value));
    if (!(value > 0)) throw new Error(mode === "pct" ? "Indique un pourcentage supérieur à 0." : "Indique un montant supérieur à 0.");
    if (mode === "pct" && value > 100) throw new Error("Le pourcentage ne peut pas dépasser 100.");
    const reason = String(body.reason ?? "").trim();
    if (!reason) throw new Error("Donne le motif : c'est ce que le membre lira.");

    const atRaw = typeof body.at === "string" && body.at.trim() ? new Date(body.at) : new Date();
    if (Number.isNaN(atRaw.getTime())) throw new Error("Date illisible.");
    const currency = db.settings.salesCurrency || "EUR";

    const adj: CommissionAdjustment = {
      id: newId(),
      memberId,
      role,
      kind,
      mode,
      value,
      reason,
      at: atRaw.toISOString(),
      currency,
      createdBy: session.memberId,
      createdAt: new Date().toISOString(),
    };
    db.commissionAdjustments ??= [];
    db.commissionAdjustments.unshift(adj);

    const label = `${kind === "malus" ? "Malus" : "Bonus"} ${mode === "pct" ? `${value} % du gagné du mois` : fmtMoney(value, currency)} pour ${member.name} (${role}) : ${reason}`;
    db.activityLogs.unshift({
      id: newId(),
      at: adj.createdAt,
      actorId: session.memberId,
      actorName: session.memberName || "Moi",
      action: "commission.adjust",
      entity: "commission",
      entityId: adj.id,
      relatedId: memberId,
      summary: label,
    });
    writeDB(db);

    notifyTelegram(
      member,
      kind === "malus"
        ? `📉 <b>Malus</b> : ${mode === "pct" ? `−${value} % sur ton gagné du mois` : `−${fmtMoney(value, currency)}`}.\nMotif : ${reason.replace(/[<>&]/g, "")}`
        : `🎉 <b>Bonus</b> : ${mode === "pct" ? `+${value} % sur ton gagné du mois` : `+${fmtMoney(value, currency)}`} !\nMotif : ${reason.replace(/[<>&]/g, "")}`,
    );
    return { adjustment: adj };
  });
}

/** Retire un ajustement (admin). Pas de modification : on supprime et on recree. */
export async function DELETE(req: NextRequest) {
  return handle(async () => {
    const session = requireAdmin(readSession(req));
    const body = (await req.json().catch(() => ({}))) as { id?: string };
    const db = readDB();
    const idx = (db.commissionAdjustments ?? []).findIndex((a) => a.id === body.id);
    if (idx < 0) throw new Error("Ajustement introuvable.");
    const [adj] = db.commissionAdjustments.splice(idx, 1);
    const name = db.team.find((m) => m.id === adj.memberId)?.name ?? "—";
    db.activityLogs.unshift({
      id: newId(),
      at: new Date().toISOString(),
      actorId: session.memberId,
      actorName: session.memberName || "Moi",
      action: "commission.adjust.removed",
      entity: "commission",
      entityId: adj.id,
      relatedId: adj.memberId,
      summary: `${adj.kind === "malus" ? "Malus" : "Bonus"} retiré pour ${name} : ${adj.reason}`,
    });
    writeDB(db);
    return { ok: true };
  });
}
