import { newId, readDB, writeDB } from "./db";
import { activeSetters, setterPulse, type SetterPulse } from "./sales/pulse";
import { fmtIdle, takeoverDelayMin, takeoverState, TAKEOVER_WARN_BEFORE_MIN } from "./sales/takeover";
import { bookedLeadIds } from "./sales/pulse";
import type { DB, TeamMember, TelegramReminderSettings } from "./types";

/**
 * Bot Telegram des setters (2026-10-14).
 *
 * Rien de plus qu'un bot BotFather et son jeton : chaque membre relie son
 * compte en envoyant au bot le code affiche sur son accueil (« /start CODE »),
 * le serveur lit les messages du bot (getUpdates, pas de webhook : le VPS
 * n'a rien a exposer de plus) et retient l'identifiant de la conversation.
 * Ensuite :
 *  - un rappel periodique pendant les heures de travail, avec les chiffres
 *    du setter (a relancer, pool, sans note, conversations qui dorment) ;
 *  - un avertissement 15 min avant qu'une conversation puisse etre reprise ;
 *  - un message quand un autre setter a repris une de ses conversations.
 * Tout est en « fire and forget » : un bot injoignable n'arrete jamais une
 * action du CRM, l'erreur est notee dans les reglages.
 */

export const DEFAULT_REMINDER_TEXT =
  "N'oublie pas : tu appelles, tu relances, et tu notes TOUT dans le tool (statut + note après chaque échange). Une conversation sans action pendant 1 h peut être reprise par un autre setter.";

export const DEFAULT_REMINDERS: TelegramReminderSettings = {
  enabled: true,
  everyMin: 60,
  fromHour: 9,
  toHour: 21,
  days: [1, 2, 3, 4, 5, 6],
  text: DEFAULT_REMINDER_TEXT,
};

export function reminderSettings(db: DB): TelegramReminderSettings {
  const r = db.settings.telegramReminders;
  return {
    ...DEFAULT_REMINDERS,
    ...(r ?? {}),
    days: Array.isArray(r?.days) ? r!.days : DEFAULT_REMINDERS.days,
    everyMin: r?.everyMin && r.everyMin >= 15 ? Math.round(r.everyMin) : DEFAULT_REMINDERS.everyMin,
    text: (r?.text ?? "").trim() || DEFAULT_REMINDER_TEXT,
  };
}

export function getTelegramToken(db = readDB()): string {
  return process.env.TELEGRAM_BOT_TOKEN?.trim() || (db.settings.telegramBotToken ?? "").trim();
}

export const telegramTokenSource = (db = readDB()): "env" | "reglages" | "absente" =>
  process.env.TELEGRAM_BOT_TOKEN?.trim() ? "env" : db.settings.telegramBotToken?.trim() ? "reglages" : "absente";

const BASE = () => (process.env.PUBLIC_BASE_URL?.trim() || "https://mvdyprince.fr").replace(/\/$/, "");

async function call<T = unknown>(token: string, method: string, body: Record<string, unknown>, timeoutMs = 15_000): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
    if (!res.ok || !json.ok) throw new Error(json.description || `Telegram ${method} : HTTP ${res.status}`);
    return json.result as T;
  } finally {
    clearTimeout(t);
  }
}

/** Nom du bot (sans @), verifie le jeton au passage. */
export async function telegramGetMe(token: string): Promise<string> {
  const me = await call<{ username?: string }>(token, "getMe", {});
  return me.username ?? "";
}

/** Envoie un message HTML a une conversation. Jette en cas d'echec. */
export async function sendTelegram(chatId: string, html: string, token = getTelegramToken()): Promise<void> {
  if (!token) throw new Error("Bot Telegram non configuré (Réglages → Rappels Telegram).");
  await call(token, "sendMessage", { chat_id: chatId, text: html, parse_mode: "HTML", disable_web_page_preview: true });
}

/** Envoi sans attendre ni planter : l'erreur est notee dans les reglages. */
export function notifyTelegram(member: Pick<TeamMember, "telegramChatId" | "name">, html: string): void {
  if (!member.telegramChatId) return;
  const token = getTelegramToken();
  if (!token) return;
  void sendTelegram(member.telegramChatId, html, token).catch((e) => {
    const db = readDB();
    db.settings.telegramLastError = `${new Date().toISOString()} · ${member.name} : ${e instanceof Error ? e.message : String(e)}`;
    writeDB(db);
  });
}

/**
 * Previent Mady (proprietaire) : son compte d'equipe (salesOwnerMemberId) s'il
 * est relie au bot, sinon tous les admins relies. Sans bot ou sans liaison,
 * l'erreur est notee dans les reglages et rien ne plante.
 */
export function notifyOwner(html: string): void {
  const db = readDB();
  const ownerId = db.settings.salesOwnerMemberId ?? "";
  const owner = ownerId ? db.team.find((m) => m.id === ownerId) : undefined;
  const targets = owner?.telegramChatId ? [owner] : db.team.filter((m) => m.role === "admin" && m.telegramChatId);
  if (!targets.length) {
    db.settings.telegramLastError = `${new Date().toISOString()} · aucun compte admin relié au bot : notification élève non envoyée`;
    writeDB(db);
    return;
  }
  for (const m of targets) notifyTelegram(m, html);
}

export const escTelegram = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Code de liaison du membre, cree au besoin (6 caracteres lisibles). */
export function ensureLinkCode(member: TeamMember): boolean {
  if (member.telegramLinkCode) return false;
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  member.telegramLinkCode = code;
  return true;
}

/* ------------------------------ Liaison ------------------------------ */

interface TgUpdate {
  update_id: number;
  message?: { chat: { id: number | string; first_name?: string }; text?: string };
}

/**
 * Lit les messages recus par le bot et relie les comptes : un membre qui
 * envoie « /start CODE » (le lien t.me le fait pour lui) ou simplement
 * « CODE » est reconnu par son code de liaison.
 */
export async function pollTelegramLinks(): Promise<number> {
  const db = readDB();
  const token = getTelegramToken(db);
  if (!token) return 0;
  const offset = db.settings.telegramUpdateOffset ?? 0;
  const updates = await call<TgUpdate[]>(token, "getUpdates", { offset, timeout: 0, allowed_updates: ["message"], limit: 50 });
  if (!updates.length) return 0;
  let linked = 0;
  for (const u of updates) {
    db.settings.telegramUpdateOffset = u.update_id + 1;
    const text = (u.message?.text ?? "").trim();
    const chatId = String(u.message?.chat.id ?? "");
    if (!chatId || !text) continue;
    const code = (text.match(/^\/start\s+(\S+)/)?.[1] ?? text).toUpperCase().replace(/[^A-Z0-9]/g, "");
    const member = code ? db.team.find((m) => (m.telegramLinkCode ?? "").toUpperCase() === code) : undefined;
    if (member) {
      member.telegramChatId = chatId;
      member.telegramLinkedAt = new Date().toISOString();
      linked++;
      db.activityLogs.unshift({
        id: newId(),
        at: member.telegramLinkedAt,
        actorId: member.id,
        actorName: member.name,
        action: "member.telegram",
        entity: "member",
        entityId: member.id,
        summary: `${member.name} a activé ses rappels Telegram`,
      });
      void call(token, "sendMessage", {
        chat_id: chatId,
        parse_mode: "HTML",
        text: `✅ C'est bon ${esc(member.name)}, tes rappels arriveront ici.\n\nTu recevras un rappel pendant tes heures de travail, un avertissement quand une de tes conversations dort, et un message si un autre setter reprend un de tes leads.`,
      }).catch(() => undefined);
    } else if (text.startsWith("/start") || code.length === 6) {
      void call(token, "sendMessage", {
        chat_id: chatId,
        parse_mode: "HTML",
        text: `Je ne reconnais pas ce code. Ouvre ton accueil sur ${esc(BASE())}/sales et clique « Activer mes rappels Telegram ».`,
      }).catch(() => undefined);
    }
  }
  writeDB(db);
  return linked;
}

/* ------------------------------ Rappels ------------------------------ */

const PARIS = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short" });

/** Heure et jour de Paris : { hour, minute, day (0 = dimanche) }. */
function parisNow(nowMs = Date.now()) {
  const parts = PARIS.formatToParts(new Date(nowMs));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  const wd = get("weekday").toLowerCase();
  const day = ["dim", "lun", "mar", "mer", "jeu", "ven", "sam"].findIndex((d) => wd.startsWith(d));
  return { hour, minute, day: day < 0 ? new Date(nowMs).getDay() : day, label: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` };
}

export function withinReminderHours(r: TelegramReminderSettings, nowMs = Date.now()): boolean {
  const p = parisNow(nowMs);
  if (!r.days.includes(p.day)) return false;
  return p.hour >= r.fromHour && p.hour < r.toHour;
}

/** Le texte du rappel d'un setter. */
export function reminderMessage(pulse: SetterPulse, r: TelegramReminderSettings, db: DB, nowMs = Date.now()): string {
  const delay = takeoverDelayMin(db.settings);
  const lines: string[] = [];
  lines.push(`⏰ <b>Rappel setter · ${parisNow(nowMs).label}</b>`);
  lines.push(esc(r.text));
  lines.push("");
  lines.push("<b>Là où tu en es :</b>");
  lines.push(`• ${pulse.due} lead${pulse.due > 1 ? "s" : ""} à relancer maintenant`);
  lines.push(`• ${pulse.talking} prospect${pulse.talking > 1 ? "s" : ""} joint${pulse.talking > 1 ? "s" : ""}, RDV à fixer`);
  lines.push(`• ${pulse.pool} nouveau${pulse.pool > 1 ? "x" : ""} lead${pulse.pool > 1 ? "s" : ""} dans le pool, premier qui appelle le garde`);
  if (pulse.noNotes) lines.push(`• ${pulse.noNotes} de tes leads sans aucune note ✎`);
  if (pulse.atRisk.length && delay) {
    const names = pulse.atRisk
      .slice(0, 5)
      .map((a) => `${esc(a.name)} (${fmtIdle(a.idleMin)}${a.inMin ? `, reprise possible dans ${a.inMin} min` : ", reprenable maintenant"})`)
      .join(", ");
    lines.push(`• ⚠️ ${pulse.atRisk.length} conversation${pulse.atRisk.length > 1 ? "s" : ""} qui dor${pulse.atRisk.length > 1 ? "ment" : "t"} : ${names}`);
  }
  if (pulse.takeable) lines.push(`• 🔁 ${pulse.takeable} conversation${pulse.takeable > 1 ? "s" : ""} d'autres setters à reprendre`);
  lines.push("");
  lines.push(`👉 ${BASE()}/sales/leads`);
  return lines.join("\n");
}

/** Le recap equipe envoye au proprietaire s'il a relie son compte. */
function teamMessage(pulses: SetterPulse[], nowMs = Date.now()): string {
  const lines = [`📊 <b>Équipe setting · ${parisNow(nowMs).label}</b>`];
  for (const p of pulses) {
    const risk = p.atRisk.length ? ` · ⚠️ ${p.atRisk.length} qui dor${p.atRisk.length > 1 ? "ment" : "t"}` : "";
    lines.push(`• <b>${esc(p.name)}</b> : ${p.due} à relancer · ${p.talking} joints · ${p.noNotes} sans note${risk}`);
  }
  if (pulses[0]) lines.push(`Pool commun : ${pulses[0].pool} nouveau${pulses[0].pool > 1 ? "x" : ""} lead${pulses[0].pool > 1 ? "s" : ""}.`);
  return lines.join("\n");
}

/**
 * Rappel periodique : au plus un par `everyMin`, pendant la plage horaire.
 * `force` (bouton « Envoyer maintenant ») ignore l'horaire et l'intervalle.
 */
export async function runTelegramReminders(opts: { force?: boolean } = {}): Promise<{ sent: number; skipped: string }> {
  const db = readDB();
  const token = getTelegramToken(db);
  if (!token) return { sent: 0, skipped: "pas de bot" };
  const r = reminderSettings(db);
  const nowMs = Date.now();
  if (!opts.force) {
    if (!r.enabled) return { sent: 0, skipped: "désactivé" };
    if (!withinReminderHours(r, nowMs)) return { sent: 0, skipped: "hors horaires" };
    const last = db.settings.telegramLastReminderAt ? new Date(db.settings.telegramLastReminderAt).getTime() : 0;
    // Marge d'une minute : le minuteur passe toutes les deux minutes, on ne veut pas sauter un creneau.
    if (nowMs - last < (r.everyMin - 1) * 60_000) return { sent: 0, skipped: "trop tôt" };
  }

  const setters = activeSetters(db);
  const pulses = setters.map((m) => setterPulse(db, m, nowMs));
  let sent = 0;
  const errors: string[] = [];
  for (const m of setters) {
    if (!m.telegramChatId) continue;
    const pulse = pulses.find((p) => p.memberId === m.id)!;
    try {
      await sendTelegram(m.telegramChatId, reminderMessage(pulse, r, db, nowMs), token);
      sent++;
    } catch (e) {
      errors.push(`${m.name} : ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  // Le proprietaire (et tout admin relie) recoit le recap de l'equipe.
  for (const m of db.team) {
    if (!m.telegramChatId || m.role !== "admin" || setters.some((s) => s.id === m.id)) continue;
    if (!pulses.length) continue;
    try {
      await sendTelegram(m.telegramChatId, teamMessage(pulses, nowMs), token);
      sent++;
    } catch (e) {
      errors.push(`${m.name} : ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const fresh = readDB();
  if (!opts.force) fresh.settings.telegramLastReminderAt = new Date(nowMs).toISOString();
  fresh.settings.telegramLastError = errors.length ? `${new Date(nowMs).toISOString()} · ${errors.join(" · ")}` : "";
  writeDB(fresh);
  return { sent, skipped: "" };
}

/**
 * Avertissement avant reprise : une fois par cycle d'inactivite, 15 min
 * avant que la conversation devienne reprenable (ou des qu'elle l'est, si
 * le minuteur a rate la fenetre).
 */
export async function runTakeoverWarnings(): Promise<number> {
  const db = readDB();
  const token = getTelegramToken(db);
  if (!token || !takeoverDelayMin(db.settings)) return 0;
  const nowMs = Date.now();
  const booked = bookedLeadIds(db, nowMs);
  const byId = new Map(db.team.map((m) => [m.id, m]));
  let sent = 0;
  let changed = false;
  for (const l of db.leads) {
    if (!l.setterId) continue;
    const t = takeoverState(l, db.settings, booked.has(l.id), nowMs);
    const soon = t.pending && t.inMin <= TAKEOVER_WARN_BEFORE_MIN;
    if (!soon && !t.eligible) continue;
    // Deja prevenu pour ce cycle : l'avertissement est posterieur au point de depart du compteur.
    if (l.takeoverWarnedAt && l.takeoverWarnedAt >= t.since) continue;
    const m = byId.get(l.setterId);
    l.takeoverWarnedAt = new Date(nowMs).toISOString();
    changed = true;
    if (!m?.telegramChatId) continue;
    const text = t.eligible
      ? `⚠️ <b>${esc(l.name)}</b> : aucune action de ta part depuis ${fmtIdle(t.idleMin)}. Un autre setter peut reprendre cette conversation dès maintenant.\n👉 ${BASE()}/sales/leads`
      : `⏳ <b>${esc(l.name)}</b> : aucune action de ta part depuis ${fmtIdle(t.idleMin)}. Dans ${t.inMin} min, un autre setter pourra reprendre cette conversation. Réponds-lui et note-le dans le tool.\n👉 ${BASE()}/sales/leads`;
    try {
      await sendTelegram(m.telegramChatId, text, token);
      sent++;
    } catch (e) {
      db.settings.telegramLastError = `${new Date(nowMs).toISOString()} · ${m.name} : ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  if (changed) writeDB(db);
  return sent;
}

/** Vue publique du statut Telegram d'un membre, pour l'interface. */
export function telegramLinkView(member: TeamMember, db = readDB()) {
  const bot = db.settings.telegramBotUsername ?? "";
  const code = member.telegramLinkCode ?? "";
  return {
    linked: Boolean(member.telegramChatId),
    linkedAt: member.telegramLinkedAt ?? "",
    code,
    botUsername: bot,
    link: bot && code ? `https://t.me/${bot}?start=${code}` : "",
  };
}
