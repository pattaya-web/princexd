import { NextRequest } from "next/server";
import { getSettings, newId, readDB, saveSettings, writeDB } from "@/lib/db";
import { Forbidden, readSession, requireAdmin, requireSales } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { memberRoles } from "@/lib/sales/roles";
import { parisDay } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Liste de taches quotidienne des setters.
 *
 * La meme liste pour tous les setters, remise a zero chaque jour (heure de
 * Paris). Le membre coche ses cases sur son accueil ; l'admin voit qui a
 * fait quoi dans « Shifts equipe » et modifie la liste.
 */
const DEFAULT_TASKS = [
  "Appeler tous les nouveaux leads de la landing page (« À appeler », lignes grises)",
  "Relancer les leads jaunes (ne répond pas, message envoyé)",
  "Relancer sur Instagram tous ceux qui n'ont pas répondu en DM",
  "Parcourir la liste d'abonnés et écrire à ceux jamais relancés",
  "Envoyer un DM aux personnes qui ont liké les reels, surtout les reels value",
  "Envoyer le lien du calendrier (mon lien signé) à chaque prospect chaud",
];

function taskList(): string[] {
  const s = getSettings();
  const custom = (s.salesDailyTasks ?? []).map((t) => t.trim()).filter(Boolean);
  return custom.length ? custom : DEFAULT_TASKS;
}

export async function GET(req: NextRequest) {
  return handle(() => {
    const session = requireSales(readSession(req));
    const db = readDB();
    db.taskChecks ??= [];
    const tasks = taskList();
    const day = req.nextUrl.searchParams.get("day") || parisDay(0);

    if (req.nextUrl.searchParams.get("all") === "1") {
      requireAdmin(session);
      const setters = db.team.filter((m) => m.status !== "inactif" && memberRoles(m).includes("setter"));
      return {
        tasks,
        day,
        members: setters.map((m) => ({
          memberId: m.id,
          memberName: m.name,
          done: db.taskChecks.filter((c) => c.memberId === m.id && c.day === day).map((c) => c.task),
        })),
      };
    }

    const done = db.taskChecks.filter((c) => c.memberId === session.memberId && c.day === day).map((c) => c.task);
    // Indices vivants : combien de nouveaux leads froids attendent ce setter.
    const newLeads = db.leads.filter(
      (l) =>
        (l.source === "lp" || Boolean(l.systemeioId)) &&
        (l.setterId === session.memberId || !l.setterId) &&
        (l.stage === "nouveau" || l.stage === "contacte" || l.stage === "conversation") &&
        !l.callStatus,
    ).length;
    return { tasks, day, done, hints: { newLeads } };
  });
}

/** Coche ou decoche une tache pour aujourd'hui. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const session = requireSales(readSession(req));
    if (!session.memberId) throw new Forbidden("La liste du jour est celle d'un membre de l'équipe.");
    const body = (await req.json().catch(() => ({}))) as { task?: string; done?: boolean };
    const task = String(body.task ?? "").trim();
    if (!task) throw new Error("Tâche manquante.");
    const db = readDB();
    db.taskChecks ??= [];
    const day = parisDay(0);
    const existing = db.taskChecks.find((c) => c.memberId === session.memberId && c.day === day && c.task === task);
    if (body.done === false) {
      db.taskChecks = db.taskChecks.filter((c) => c !== existing);
    } else if (!existing) {
      db.taskChecks.unshift({ id: newId(), memberId: session.memberId, day, task, doneAt: new Date().toISOString() });
    }
    // On garde 90 jours de coches : assez pour un suivi, pas de quoi alourdir la base.
    const cutoff = parisDay(-90);
    db.taskChecks = db.taskChecks.filter((c) => c.day >= cutoff);
    writeDB(db);
    return { done: db.taskChecks.filter((c) => c.memberId === session.memberId && c.day === day).map((c) => c.task) };
  });
}

/** Admin : remplace la liste de taches. */
export async function PATCH(req: NextRequest) {
  return handle(async () => {
    requireAdmin(readSession(req));
    const body = (await req.json().catch(() => ({}))) as { tasks?: string[] };
    const tasks = (body.tasks ?? []).map((t) => String(t).trim()).filter(Boolean).slice(0, 30);
    saveSettings({ salesDailyTasks: tasks });
    return { tasks: tasks.length ? tasks : DEFAULT_TASKS };
  });
}
