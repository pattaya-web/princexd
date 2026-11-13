"use client";

/**
 * Mon espace de travail — le cockpit du Head of Setting (et de tout setter).
 *
 * Il dit quoi faire, dans l'ordre : les indicateurs du haut ouvrent la liste
 * correspondante, « Mes priorités du jour » est la file de taches tenue par
 * le moteur (lib/sales/ops/engine.ts), les onglets sont les poles — des vues
 * des memes donnees. La fiche 360° s'ouvre dans un panneau lateral.
 *
 * Raccourcis : j / k (tache suivante / precedente), Entree (ouvrir),
 * / (rechercher), 1 a 9 (onglets), r (recharger).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSalesData } from "@/lib/sales/client";
import { useSales } from "@/components/sales/context";
import { Card, Empty, ErrorNote, PageHeader, Spinner } from "@/components/ui";
import type { TaskRow, WorkspacePayload } from "@/lib/sales/ops/views";
import { TaskCard } from "@/components/sales/ops/TaskCard";
import { LeadPanel } from "@/components/sales/ops/LeadPanel";
import { AnomaliesPole, AppointmentsPole, ConversationsPole, FollowupsPole, NewLeadsPole, NoShowsPole, NurturingPole, PaymentsPole } from "@/components/sales/ops/Poles";
import { CommissionsBlock, ReportBlock } from "@/components/sales/ops/Performance";
import { LeadSheet } from "@/components/sales/LeadSheet";
import { PrioBadge, when } from "@/components/sales/ops/shared";

type Tab = "priorities" | "new" | "conversations" | "appointments" | "noshows" | "followups" | "payments" | "nurturing" | "anomalies" | "performance";

const TABS: { key: Tab; label: string }[] = [
  { key: "priorities", label: "Mes priorités" },
  { key: "new", label: "Nouveaux leads" },
  { key: "conversations", label: "Conversations" },
  { key: "appointments", label: "Rendez-vous" },
  { key: "noshows", label: "No-shows" },
  { key: "followups", label: "Follow-ups" },
  { key: "payments", label: "Paiements" },
  { key: "nurturing", label: "Nurturing" },
  { key: "anomalies", label: "Anomalies" },
  { key: "performance", label: "Performances" },
];

type PrioFilter = "" | "overdue" | "first-contact" | "conversations" | "followup" | "no-show" | "payment";

export default function WorkspacePage() {
  const { session, version, bump } = useSales();
  const isManager = session.isAdmin || Boolean(session.salesHead);
  const [owner, setOwner] = useState("");
  const [tab, setTab] = useState<Tab>("priorities");
  const [prio, setPrio] = useState<PrioFilter>("");
  const [query, setQuery] = useState("");
  const [lead, setLead] = useState<string | null>(null);
  const [sheet, setSheet] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  // Filtres gardes d'une visite a l'autre (onglet, membre regarde).
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("sales-ws") ?? "{}") as { tab?: Tab; owner?: string };
      if (saved.tab && TABS.some((t) => t.key === saved.tab)) setTab(saved.tab);
      if (saved.owner) setOwner(saved.owner);
    } catch {
      /* stockage indisponible : valeurs par defaut */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("sales-ws", JSON.stringify({ tab, owner }));
    } catch {
      /* rien */
    }
  }, [tab, owner]);

  const { data, error, loading, reload } = useSalesData<WorkspacePayload>(`/api/sales/ops?owner=${encodeURIComponent(owner)}&v=${version}`, { every: 45_000 });
  const refresh = useCallback(() => {
    bump();
    void reload(true);
  }, [bump, reload]);

  const tasks = useMemo(() => {
    const all = data?.tasks ?? [];
    const q = query.trim().toLowerCase();
    return all.filter((t: TaskRow) => {
      if (q && !`${t.leadName} ${t.title} ${t.context} ${t.source}`.toLowerCase().includes(q)) return false;
      switch (prio) {
        case "overdue":
          return t.overdue;
        case "first-contact":
          return t.kind === "first-contact";
        case "conversations":
          return ["setting-nudge", "planned", "callback", "nurture", "admin-task"].includes(t.kind);
        case "followup":
          return t.kind === "followup";
        case "no-show":
          return t.kind === "no-show";
        case "payment":
          return t.kind === "payment" || t.kind === "payment-verify";
        default:
          return true;
      }
    });
  }, [data, prio, query]);

  // Raccourcis clavier.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      if (lead || sheet || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "j" || e.key === "ArrowDown") {
        if (tab !== "priorities") return;
        e.preventDefault();
        setSelected((s) => Math.min(s + 1, Math.max(0, tasks.length - 1)));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        if (tab !== "priorities") return;
        e.preventDefault();
        setSelected((s) => Math.max(0, s - 1));
      } else if (e.key === "Enter" && tab === "priorities" && tasks[selected]) {
        setLead(tasks[selected].leadId);
      } else if (e.key === "r") {
        refresh();
      } else if (/^[1-9]$/.test(e.key)) {
        const t = TABS[Number(e.key) - 1];
        if (t) setTab(t.key);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [tasks, selected, tab, lead, sheet, refresh]);

  useEffect(() => {
    document.querySelector(`[data-task="${tasks[selected]?.id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected, tasks]);

  const k = data?.kpis;
  const tile = (label: string, value: number | undefined, onClick: () => void, tone?: string, hint?: string) => (
    <button type="button" onClick={onClick} className="card px-3.5 py-3 text-left transition-shadow hover:shadow-md" title={hint}>
      <div className="label-xs">{label}</div>
      <div className="text-[26px] font-semibold num leading-none mt-2" style={{ letterSpacing: "-0.03em", color: value ? tone : "var(--text-3)" }}>
        {value ?? "—"}
      </div>
    </button>
  );
  const go = (t: Tab, p: PrioFilter = "") => {
    setTab(t);
    setPrio(p);
  };

  const today = data?.today ?? "";
  const counts: Partial<Record<Tab, number>> = data
    ? {
        priorities: data.tasks.length,
        new: data.poles.newLeads.length,
        conversations: data.poles.conversations.length,
        appointments: data.poles.appointments.length,
        noshows: data.poles.noShows.filter((n) => !["rescheduled", "lost", "dnc"].includes(n.state)).length,
        followups: data.poles.followups.length,
        payments: data.poles.payments.length,
        nurturing: data.poles.nurturing.length,
        anomalies: data.poles.anomalies.length,
      }
    : {};
  const poleProps = data ? { data, filter: query, onOpen: setLead, onSheet: setSheet, onChanged: refresh } : null;

  return (
    <>
      <PageHeader
        title="Mon espace de travail"
        subtitle={data ? `${new Date(`${today}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })} · ${data.tasks.length ? `${data.tasks.length} action${data.tasks.length > 1 ? "s" : ""} à traiter aujourd'hui` : "rien d'exigible aujourd'hui"}${data.doneToday ? ` · ${data.doneToday} faite${data.doneToday > 1 ? "s" : ""}` : ""}` : undefined}
        actions={
          <>
            <input ref={searchRef} className="input !h-[34px] !w-[200px]" placeholder="Rechercher (touche /)" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Rechercher un prospect" />
            {isManager && data && (
              <select className="select !h-[34px] !w-auto" value={owner || (session.isAdmin ? "all" : session.memberId)} onChange={(e) => setOwner(e.target.value)} aria-label="File affichée">
                <option value="all">Toute l'équipe</option>
                {!session.isAdmin && <option value={session.memberId}>Ma file</option>}
                {session.isAdmin && <option value="admin">Mes tâches (admin)</option>}
                {data.members
                  .filter((m) => m.id !== session.memberId)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
              </select>
            )}
            <button type="button" className="btn" onClick={refresh} title="Recharger (touche r)">
              ↻
            </button>
          </>
        }
      />

      {error && (
        <div className="mb-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {/* Indicateurs : chacun ouvre sa liste. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-2 mb-4">
        {tile("Nouveaux leads", k?.newLeads, () => go("priorities", "first-contact"), "var(--critical)", "Premiers contacts à faire")}
        {tile("Conversations", k?.conversations, () => go("priorities", "conversations"), "var(--warning)", "Relances, rappels, actions planifiées dus aujourd'hui")}
        {tile("RDV à confirmer", k?.toConfirm, () => go("appointments"), "var(--warning)", "Calls des 48 prochaines heures sans confirmation explicite")}
        {tile("RDV du jour", k?.apptsToday, () => go("appointments"), "var(--accent)")}
        {tile("No-shows", k?.noShows, () => go("priorities", "no-show"), "var(--critical)", "Absents à récupérer")}
        {tile("Relances du jour", k?.followupsToday, () => go("priorities", "followup"), "var(--warning)", "Suivis après call dus aujourd'hui")}
        {tile("Paiements", k?.payments, () => go("priorities", "payment"), "var(--accent)", "Paiements en attente de suivi")}
        {tile("En retard", k?.overdue, () => go("priorities", "overdue"), "var(--critical)", "Tâches dont l'échéance est passée")}
      </div>

      {/* Charge de l'equipe (Head of Setting, admin) */}
      {isManager && data && data.owners.length > 1 && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          {data.owners.map((o) => (
            <button key={o.id} type="button" className="btn btn-sm" onClick={() => setOwner(o.id)} title={`${o.open} ouvertes · ${o.dueToday} dues aujourd'hui · ${o.overdue} en retard · ${o.doneToday} faites aujourd'hui`}>
              {o.name} · <span className="num">{o.dueToday}</span>
              {o.overdue > 0 && <span className="num ml-1" style={{ color: "var(--critical)" }}>({o.overdue} en retard)</span>}
              <span className="dim num ml-1">✓{o.doneToday}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-1 p-1 rounded-[10px] mb-4 overflow-x-auto" style={{ background: "var(--surface-3)" }} role="tablist">
        {TABS.map((t, i) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => go(t.key)}
            className="px-3 h-[28px] rounded-[7px] text-[12.5px] font-medium whitespace-nowrap"
            style={{ background: tab === t.key ? "var(--surface)" : "transparent", color: tab === t.key ? "var(--text)" : "var(--text-2)", boxShadow: tab === t.key ? "var(--shadow)" : "none" }}
            title={`Touche ${i + 1}`}
          >
            {t.label}
            {counts[t.key] ? <span className="dim num ml-1.5">{counts[t.key]}</span> : null}
          </button>
        ))}
      </div>

      {loading && !data ? (
        <Card>
          <Spinner label="Préparation de ta journée…" />
        </Card>
      ) : !data || !poleProps ? null : tab === "priorities" ? (
        <div className="space-y-4">
          {prio && (
            <div className="flex items-center gap-2 text-[12.5px]">
              <span className="muted">Filtre actif</span>
              <button type="button" className="btn btn-sm" onClick={() => setPrio("")}>
                {prio} ✕
              </button>
            </div>
          )}
          {tasks.length === 0 ? (
            <Card>
              <Empty>
                {prio || query ? (
                  "Rien ici avec ce filtre."
                ) : (
                  <>
                    <span className="text-[15px] font-semibold block mb-1" style={{ color: "var(--good)" }}>
                      ✓ Toutes les actions exigibles aujourd'hui sont faites.
                    </span>
                    Les prochaines échéances sont ci-dessous. Le CRM ajoutera les nouvelles tâches dès qu'un lead arrive, qu'un call est réservé ou qu'un résultat est renseigné.
                  </>
                )}
              </Empty>
            </Card>
          ) : (
            <div className="space-y-2">
              {tasks.map((t, i) => (
                <TaskCard key={t.id} task={t} today={today} selected={i === selected} showOwner={isManager && owner !== session.memberId} onOpenLead={setLead} onOpenSheet={setSheet} onChanged={refresh} />
              ))}
            </div>
          )}
          {data.upcoming.length > 0 && (
            <Card title="Prochaines échéances" subtitle="Ce qui arrive après aujourd'hui">
              <ul className="space-y-1.5">
                {data.upcoming.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center gap-2 text-[12.5px]">
                    <PrioBadge p={t.priority} />
                    <span className="mono dim w-[120px]">{when(t.dueAt, today)}</span>
                    <button type="button" className="font-medium hover:underline text-left" onClick={() => setLead(t.leadId)}>
                      {t.title}
                    </button>
                    <span className="dim">· {t.kindLabel}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      ) : tab === "new" ? (
        <NewLeadsPole {...poleProps} />
      ) : tab === "conversations" ? (
        <ConversationsPole {...poleProps} />
      ) : tab === "appointments" ? (
        <AppointmentsPole {...poleProps} />
      ) : tab === "noshows" ? (
        <NoShowsPole {...poleProps} />
      ) : tab === "followups" ? (
        <FollowupsPole {...poleProps} />
      ) : tab === "payments" ? (
        <PaymentsPole {...poleProps} />
      ) : tab === "nurturing" ? (
        <NurturingPole {...poleProps} />
      ) : tab === "anomalies" ? (
        <AnomaliesPole {...poleProps} />
      ) : (
        <div className="space-y-4">
          {isManager && <ReportBlock version={version} />}
          {session.memberId && <CommissionsBlock version={version} today={today} />}
          {!session.memberId && <p className="muted text-[13px]">Les commissions de l'équipe sont dans Sales → Commissions.</p>}
        </div>
      )}

      <LeadPanel
        leadId={lead}
        today={today}
        members={data?.members ?? []}
        canManage={isManager}
        objections={data?.objections ?? []}
        onClose={() => setLead(null)}
        onChanged={refresh}
        onOpenSheet={(id) => {
          setLead(null);
          setSheet(id);
        }}
      />
      <LeadSheet id={sheet} onClose={() => setSheet(null)} onChanged={refresh} />
    </>
  );
}
