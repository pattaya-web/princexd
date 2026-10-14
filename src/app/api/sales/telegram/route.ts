import { NextRequest } from "next/server";
import { readDB, writeDB } from "@/lib/db";
import { Forbidden, readSession, requireSales } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { activeSetters, setterPulse } from "@/lib/sales/pulse";
import { takeoverDelayMin } from "@/lib/sales/takeover";
import {
  DEFAULT_REMINDER_TEXT,
  ensureLinkCode,
  getTelegramToken,
  pollTelegramLinks,
  reminderMessage,
  reminderSettings,
  runTelegramReminders,
  sendTelegram,
  telegramLinkView,
  telegramTokenSource,
} from "@/lib/telegram";
import type { Session, TeamMember } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Le membre derriere la session : le proprietaire passe par son compte d'equipe (reglages). */
function memberOf(session: Session) {
  const db = readDB();
  const id = session.memberId || (session.isAdmin ? (db.settings.salesOwnerMemberId ?? "") : "");
  return { db, member: id ? db.team.find((m) => m.id === id) : undefined };
}

/**
 * Etat Telegram du membre connecte : bot configure, compte relie, code et
 * lien t.me pour le relier. L'admin recoit en plus l'etat de toute l'equipe
 * et les reglages des rappels. Lire cet etat declenche une lecture des
 * messages du bot : le membre qui vient d'envoyer son code voit « relie »
 * sans attendre le minuteur.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const session = requireSales(readSession(req));
    const configured = Boolean(getTelegramToken());
    if (configured && req.nextUrl.searchParams.get("poll") === "1") await pollTelegramLinks().catch(() => undefined);
    const { db, member } = memberOf(session);
    if (member && ensureLinkCode(member)) writeDB(db);
    const me = member ? telegramLinkView(member, db) : null;
    const base = {
      configured,
      source: telegramTokenSource(db),
      botUsername: db.settings.telegramBotUsername ?? "",
      me,
      takeoverMin: takeoverDelayMin(db.settings),
    };
    if (!session.isAdmin) return base;
    return {
      ...base,
      reminders: reminderSettings(db),
      defaultText: DEFAULT_REMINDER_TEXT,
      lastReminderAt: db.settings.telegramLastReminderAt ?? "",
      lastError: db.settings.telegramLastError ?? "",
      members: db.team
        .filter((m) => m.status !== "inactif" && (m.role === "setter" || m.role === "closer" || m.role === "admin" || (m.roles ?? []).length > 0))
        .map((m) => ({ id: m.id, name: m.name, role: m.role, roles: m.roles ?? [], ...telegramLinkView(m, db) })),
    };
  });
}

/**
 * Actions : « test » (un message a soi-meme), « preview » (le rappel tel
 * qu'il partirait), « remind-now » (admin : envoie le rappel a toute
 * l'equipe maintenant), « unlink » (detache son compte, ou celui d'un membre
 * pour l'admin).
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const session = requireSales(readSession(req));
    const body = (await req.json().catch(() => ({}))) as { action?: string; memberId?: string };
    const { db, member } = memberOf(session);
    if (!getTelegramToken(db)) throw new Error("Bot Telegram non configuré : l'admin doit coller le jeton du bot dans Réglages.");

    switch (body.action) {
      case "test": {
        const target: TeamMember | undefined = session.isAdmin && body.memberId ? db.team.find((m) => m.id === body.memberId) : member;
        if (!target?.telegramChatId) throw new Error("Ce compte n'est pas encore relié à Telegram.");
        await sendTelegram(target.telegramChatId, `👋 Test réussi : les rappels de ${target.name.replace(/[<>&]/g, "")} arrivent bien ici.`);
        return { ok: true };
      }
      case "preview": {
        const target = session.isAdmin && body.memberId ? db.team.find((m) => m.id === body.memberId) : member;
        if (!target) throw new Error("Membre introuvable.");
        const setters = activeSetters(db);
        const m = setters.find((s) => s.id === target.id) ?? target;
        return { text: reminderMessage(setterPulse(db, m), reminderSettings(db), db) };
      }
      case "remind-now": {
        if (!session.isAdmin) throw new Forbidden();
        return runTelegramReminders({ force: true });
      }
      case "unlink": {
        const target = session.isAdmin && body.memberId ? db.team.find((m) => m.id === body.memberId) : member;
        if (!target) throw new Error("Membre introuvable.");
        target.telegramChatId = "";
        target.telegramLinkedAt = "";
        writeDB(db);
        return { ok: true };
      }
      default:
        throw new Error("Action inconnue.");
    }
  });
}
