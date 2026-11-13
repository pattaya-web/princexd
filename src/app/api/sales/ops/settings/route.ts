import { NextRequest } from "next/server";
import { readDB, writeDB } from "@/lib/db";
import { readSession, requireAdmin } from "@/lib/sales/access";
import { handle, num } from "@/lib/sales/http";
import { setCommissionRule } from "@/lib/sales/repo";
import { defaultOpsSettings, opsSettings, TASK_KIND_HINT, TASK_KIND_LABEL, TASK_KINDS, defaultOwnerId } from "@/lib/sales/ops/config";
import { opsState, runOps } from "@/lib/sales/ops/run";
import type { CommissionRule, ObjectionDef, SalesOpsSettings, TaskPriority } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Reglages du Sales OS : admin seulement (le Head of Setting n'y a pas acces). */
export async function GET(req: NextRequest) {
  return handle(() => {
    requireAdmin(readSession(req));
    const db = readDB();
    const cfg = opsSettings(db);
    const members = db.team
      .filter((m) => m.role !== "monteur" && m.role !== "assistant")
      .map((m) => ({ id: m.id, name: m.name, status: m.status, roles: m.roles ?? [], salesHead: Boolean(m.salesHead), receivesLeads: Boolean(m.receivesLeads) }));
    const rules = db.commissionRules.filter((r) => r.active && (r.role === "manager" || r.role === "setter"));
    return {
      settings: cfg,
      defaults: defaultOpsSettings(),
      kinds: TASK_KINDS.map((k) => ({ key: k, label: TASK_KIND_LABEL[k], hint: TASK_KIND_HINT[k] })),
      members,
      defaultOwnerId: defaultOwnerId(db, cfg),
      rules,
      engine: { ...opsState(), openTasks: (db.salesTasks ?? []).filter((t) => t.status === "open").length, totalTasks: (db.salesTasks ?? []).length },
      currency: db.settings.salesCurrency || "EUR",
    };
  });
}

/**
 * Enregistre les reglages. Trois blocs independants, chacun optionnel :
 *  - `settings` : regles, cadences, objections, responsable par defaut ;
 *  - `member`   : Head of Setting / recoit des leads, sur une fiche equipe ;
 *  - `commission` : taux setting et management d'un membre, avec dates.
 */
export async function PUT(req: NextRequest) {
  return handle(async () => {
    const session = requireAdmin(readSession(req));
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const db = readDB();

    if (body.settings && typeof body.settings === "object") {
      const s = body.settings as Partial<SalesOpsSettings>;
      const cur = db.settings.salesOps ?? {};
      const next: Partial<SalesOpsSettings> = { ...cur };
      if (typeof s.defaultOwnerId === "string") next.defaultOwnerId = s.defaultOwnerId;
      if (s.assignment === "single" || s.assignment === "round-robin") next.assignment = s.assignment;
      if (typeof s.startedOn === "string" && (/^\d{4}-\d{2}-\d{2}$/.test(s.startedOn) || s.startedOn === "")) next.startedOn = s.startedOn;
      if (s.rules && typeof s.rules === "object") {
        const rules = { ...(cur.rules ?? {}) } as SalesOpsSettings["rules"];
        for (const k of TASK_KINDS) {
          const r = (s.rules as Record<string, { enabled?: boolean; priority?: number }>)[k];
          if (!r) continue;
          const p = Number(r.priority);
          rules[k] = { enabled: r.enabled !== false, priority: ([0, 1, 2, 3].includes(p) ? p : 1) as TaskPriority };
        }
        next.rules = rules;
      }
      if (s.nudgeAfterHours !== undefined) next.nudgeAfterHours = Math.max(1, Math.min(240, num(s.nudgeAfterHours, 24)));
      if (Array.isArray(s.noShowCadenceMin)) next.noShowCadenceMin = s.noShowCadenceMin.map((n) => Math.max(0, Math.round(num(n)))).slice(0, 6);
      if (s.staleDays !== undefined) next.staleDays = Math.max(1, Math.min(60, num(s.staleDays, 5)));
      if (s.anomalyWindowDays !== undefined) next.anomalyWindowDays = Math.max(7, Math.min(365, num(s.anomalyWindowDays, 30)));
      if (typeof s.headSeesRealAmounts === "boolean") next.headSeesRealAmounts = s.headSeesRealAmounts;
      if (Array.isArray(s.objections)) {
        const seen = new Set<string>();
        next.objections = (s.objections as ObjectionDef[])
          .map((o) => ({
            key: String(o.key || o.label || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40),
            label: String(o.label ?? "").trim().slice(0, 80),
            followUpDays: Math.max(0, Math.min(90, num(o.followUpDays, 2))),
            askDate: Boolean(o.askDate),
            advice: String(o.advice ?? "").trim().slice(0, 400),
          }))
          .filter((o) => o.key && o.label && !seen.has(o.key) && seen.add(o.key));
      }
      db.settings.salesOps = next;
    }

    if (body.member && typeof body.member === "object") {
      const m = body.member as { id?: string; salesHead?: boolean; receivesLeads?: boolean };
      const member = db.team.find((x) => x.id === m.id);
      if (!member) throw new Error("Membre introuvable.");
      if (typeof m.salesHead === "boolean") member.salesHead = m.salesHead;
      if (typeof m.receivesLeads === "boolean") member.receivesLeads = m.receivesLeads;
      db.activityLogs.unshift({
        id: `l${Date.now().toString(36)}`,
        at: new Date().toISOString(),
        actorId: session.memberId,
        actorName: session.memberName || "Moi",
        action: "member.updated",
        entity: "member",
        entityId: member.id,
        summary: `${member.name} : ${member.salesHead ? "Head of Setting" : "plus Head of Setting"}${member.receivesLeads ? ", reçoit des leads" : ""}`,
      });
    }
    writeDB(db);

    // Taux du Head of Setting : on n'ecrase jamais une regle, on en ajoute une datee (historique garde).
    if (body.commission && typeof body.commission === "object") {
      const c = body.commission as { memberId?: string; settingPct?: number; managerPct?: number; effectiveFrom?: string; effectiveTo?: string };
      const member = readDB().team.find((x) => x.id === c.memberId);
      if (!member) throw new Error("Membre introuvable.");
      const from = /^\d{4}-\d{2}-\d{2}$/.test(c.effectiveFrom ?? "") ? c.effectiveFrom! : new Date().toISOString().slice(0, 10);
      const to = /^\d{4}-\d{2}-\d{2}$/.test(c.effectiveTo ?? "") ? c.effectiveTo! : "";
      const currency = readDB().settings.salesCurrency || "EUR";
      const base: Omit<CommissionRule, "id" | "createdAt" | "role" | "pct"> = { memberId: member.id, type: "pct-cash", fixed: 0, basis: "cash", onlyQualified: false, currency, effectiveFrom: from, ...(to ? { effectiveTo: to } : {}), active: true, notes: "Sales OS" };
      if (c.settingPct !== undefined && num(c.settingPct) >= 0) setCommissionRule(session, { ...base, role: "setter", pct: num(c.settingPct), notes: "Commission setting : rendez-vous posés par lui" }, { keepHistory: true });
      if (c.managerPct !== undefined && num(c.managerPct) >= 0) setCommissionRule(session, { ...base, role: "manager", pct: num(c.managerPct), notes: "Commission management : tout le cash coaching encaissé" }, { keepHistory: true });
    }
    runOps();
    return { ok: true };
  });
}
