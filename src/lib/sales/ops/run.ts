/**
 * Passage reel du moteur : lit la base, aligne les taches, ecrit.
 *
 * Appele par le scheduler (toutes les 2 min, lib/scheduler.ts) et a chaque
 * ouverture du cockpit : le travail du jour est donc a jour sans attendre.
 * Une erreur n'est jamais avalee en silence : elle est gardee ici et
 * affichee dans Sales → Automatisations.
 */
import { newId, readDB, writeDB } from "../../db";
import { notifyTelegram } from "../../telegram";
import type { DB } from "../../types";
import { reconcileTasks, type ReconcileResult } from "./engine";

interface OpsState {
  lastRunAt: string;
  lastError: string;
  lastErrorAt: string;
  runs: number;
  failures: number;
  last: { created: number; updated: number; closed: number; assigned: number } | null;
}

const g = globalThis as unknown as { __salesOpsState?: OpsState };
const state: OpsState = (g.__salesOpsState ??= { lastRunAt: "", lastError: "", lastErrorAt: "", runs: 0, failures: 0, last: null });

export const opsState = () => state;

/** Aligne la file de taches et ecrit si quelque chose a bouge. */
export function runOps(nowMs = Date.now(), db: DB = readDB()): ReconcileResult | null {
  try {
    const r = reconcileTasks(db, nowMs);
    if (r.assigned.length) {
      const names = new Map(db.team.map((m) => [m.id, m.name]));
      const at = new Date(nowMs).toISOString();
      for (const lead of r.assigned) {
        db.activityLogs.unshift({
          id: newId(),
          at,
          actorId: "",
          actorName: "Sales OS",
          action: "lead.assigned",
          entity: "lead",
          entityId: lead.id,
          summary: `${lead.name} attribué à ${names.get(lead.ownerId ?? "") ?? "un membre"} (attribution automatique)`,
        });
      }
      if (db.activityLogs.length > 5000) db.activityLogs.length = 5000;
    }
    if (r.created || r.updated || r.closed || r.assigned.length) writeDB(db);
    state.lastRunAt = new Date(nowMs).toISOString();
    state.runs++;
    state.last = { created: r.created, updated: r.updated, closed: r.closed, assigned: r.assigned.length };
    notifyNewLeads(db, r);
    return r;
  } catch (e) {
    state.failures++;
    state.lastError = e instanceof Error ? e.message : String(e);
    state.lastErrorAt = new Date(nowMs).toISOString();
    console.warn("[sales-os] moteur de tâches :", state.lastError);
    return null;
  }
}

/**
 * Notification interne : un nouveau lead attribue part sur le Telegram de
 * son responsable, s'il l'a relie (Sales → Mon espace → Telegram). Rien
 * n'est envoye au prospect.
 */
function notifyNewLeads(db: DB, r: ReconcileResult) {
  if (!r.assigned.length) return;
  const byOwner = new Map<string, string[]>();
  for (const l of r.assigned) byOwner.set(l.ownerId ?? "", [...(byOwner.get(l.ownerId ?? "") ?? []), l.name]);
  for (const [ownerId, leads] of byOwner) {
    const member = db.team.find((m) => m.id === ownerId);
    if (!member?.telegramChatId) continue;
    const list = leads.slice(0, 8).map((n) => `• ${escape(n)}`).join("\n");
    notifyTelegram(member, `<b>${leads.length} nouveau${leads.length > 1 ? "x" : ""} lead${leads.length > 1 ? "s" : ""}</b> dans ton espace :\n${list}${leads.length > 8 ? "\n…" : ""}`);
  }
}

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
