import { NextRequest } from "next/server";
import { readDB } from "@/lib/db";
import { readSession, requireAdmin } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { GATE_TABS, gateState, type GateTab } from "@/lib/formation-gate";

export const dynamic = "force-dynamic";

/**
 * Suivi du parcours (admin) : où en est chaque élève, étape par étape, avec
 * la date de chaque validation, l'adresse de sa boutique et ses contacts.
 * Lecture seule : l'élève avance depuis sa plateforme, Mady regarde ici.
 */
export interface SuiviTab {
  key: GateTab;
  label: string;
  done: boolean;
  /** Date de validation par l'élève (vide pour les validations d'avant le 2026-10-28). */
  doneAt: string;
}

export interface SuiviRow {
  id: string;
  name: string;
  firstName: string;
  username: string;
  portalAccess: boolean;
  lastSeenAt: string;
  startedAt: string;
  phone: string;
  email: string;
  igUsername: string;
  tabs: SuiviTab[];
  doneCount: number;
  percent: number;
  /** L'étape en cours : la première pas encore validée, null quand tout est fait. */
  current: { key: GateTab; label: string } | null;
  /** Adresse de sa boutique, donnée à l'étape « Création de la boutique ». */
  shopUrl: string;
  shopUrlAt: string;
  shopRequest: { storeUrl: string; status: "demandee" | "livree"; requestedAt: string } | null;
  accessRequestedAt: string;
  accessApprovedAt: string;
}

export interface SuiviEvent {
  studentId: string;
  name: string;
  kind: "step" | "shop" | "form";
  label: string;
  at: string;
  url?: string;
}

export interface SuiviPayload {
  rows: SuiviRow[];
  events: SuiviEvent[];
  /** Combien d'élèves sont à chaque étape (clé = étape en cours), « done » = parcours terminé. */
  counts: Record<GateTab | "done", number>;
}

export async function GET(req: NextRequest) {
  return handle((): SuiviPayload => {
    requireAdmin(readSession(req));
    const db = readDB();
    const students = db.students.filter((s) => s.username || s.portalAccess);
    const counts = { demarrage: 0, produit: 0, boutique: 0, creatives: 0, meta: 0, done: 0 } as Record<GateTab | "done", number>;
    const events: SuiviEvent[] = [];

    const rows = students
      .map((s): SuiviRow => {
        const state = gateState(s);
        const doneAt = s.tabsDoneAt ?? {};
        const tabs = state.tabs.map((t) => ({ key: t.key, label: t.label, done: t.done, doneAt: t.done ? (doneAt[t.key] ?? "") : "" }));
        const current = tabs.find((t) => !t.done) ?? null;
        counts[current ? current.key : "done"]++;
        for (const t of tabs) if (t.done && t.doneAt) events.push({ studentId: s.id, name: s.name, kind: "step", label: `a validé « ${t.label} »`, at: t.doneAt, url: GATE_TABS.find((g) => g.key === t.key)?.href });
        if (s.shopUrl && s.shopUrlAt) events.push({ studentId: s.id, name: s.name, kind: "shop", label: `a donné l'adresse de sa boutique : ${s.shopUrl}`, at: s.shopUrlAt, url: s.shopUrl });
        if (s.accessRequestedAt) events.push({ studentId: s.id, name: s.name, kind: "form", label: "a rempli le formulaire d'onboarding", at: s.accessRequestedAt });
        return {
          id: s.id,
          name: s.name,
          firstName: s.name.trim().split(/\s+/)[0] ?? s.name,
          username: s.username ?? "",
          portalAccess: Boolean(s.portalAccess),
          lastSeenAt: s.portalLastSeenAt ?? "",
          startedAt: s.startedAt ?? "",
          phone: s.phone ?? "",
          email: s.email ?? "",
          igUsername: s.igUsername ?? s.handle ?? "",
          tabs,
          doneCount: tabs.filter((t) => t.done).length,
          percent: tabs.length ? Math.round((tabs.filter((t) => t.done).length / tabs.length) * 100) : 0,
          current: current ? { key: current.key, label: current.label } : null,
          shopUrl: s.shopUrl ?? "",
          shopUrlAt: s.shopUrlAt ?? "",
          shopRequest: s.shopRequest ? { storeUrl: s.shopRequest.storeUrl, status: s.shopRequest.status, requestedAt: s.shopRequest.requestedAt } : null,
          accessRequestedAt: s.accessRequestedAt ?? "",
          accessApprovedAt: s.accessApprovedAt ?? "",
        };
      })
      // Les plus actifs en premier, puis les plus avancés.
      .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt) || b.doneCount - a.doneCount || a.name.localeCompare(b.name));

    events.sort((a, b) => b.at.localeCompare(a.at));
    return { rows, events: events.slice(0, 40), counts };
  });
}
