"use client";

/**
 * Mon espace de travail — le cockpit du Head of Setting (et de tout setter).
 *
 * Allégé le 2026-11-23 à la demande de Mady, « on va à l'essentiel » :
 * quatre indicateurs (RDV à confirmer, RDV du jour, no-shows, paiements),
 * l'agenda de tous les calls, puis les relances du setter (la liste de noms
 * qu'il complète au fil de l'eau, prioritaires en tête) et les calls à
 * statuer. Plus de file de tâches automatiques ni de « en retard » en rouge,
 * plus de nouveaux leads ni de conversations.
 *
 * Raccourcis : 1 a 5 (onglets), r (recharger).
 */
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { fmtDateTime } from "@/lib/format";
import { useSalesData } from "@/lib/sales/client";
import { useSales } from "@/components/sales/context";
import { Card, ErrorNote, PageHeader, Spinner, useToast } from "@/components/ui";
import type { WorkspacePayload } from "@/lib/sales/ops/views";
import type { AppointmentRow } from "@/app/api/sales/appointments/route";
import { LeadPanel } from "@/components/sales/ops/LeadPanel";
import { AppointmentsPole, NoShowsPole, PaymentsPole } from "@/components/sales/ops/Poles";
import { CommissionsBlock, ReportBlock } from "@/components/sales/ops/Performance";
import { LeadSheet } from "@/components/sales/LeadSheet";
import { CallsCalendar } from "@/components/sales/CallsCalendar";
import { AppointmentDetail } from "@/components/sales/AppointmentDetail";
import { SetterTasksMemberCard } from "@/components/sales/SetterTasksCard";
import { CallsToSettleCard } from "@/components/sales/SetterOutcome";

type Tab = "relances" | "appointments" | "noshows" | "payments" | "performance";

const TABS: { key: Tab; label: string }[] = [
  { key: "relances", label: "Relances" },
  { key: "appointments", label: "Rendez-vous" },
  { key: "noshows", label: "No-shows" },
  { key: "payments", label: "Paiements" },
  { key: "performance", label: "Performances" },
];

export default function WorkspacePage() {
  const { session, members, version, bump } = useSales();
  const toast = useToast();
  const isManager = session.isAdmin || Boolean(session.salesHead);
  const [tab, setTab] = useState<Tab>("relances");
  const [lead, setLead] = useState<string | null>(null);
  const [sheet, setSheet] = useState<string | null>(null);
  const [openAppt, setOpenAppt] = useState<string | null>(null);

  // Onglet garde d'une visite a l'autre.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("sales-ws") ?? "{}") as { tab?: Tab };
      if (saved.tab && TABS.some((t) => t.key === saved.tab)) setTab(saved.tab);
    } catch {
      /* stockage indisponible : valeurs par defaut */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("sales-ws", JSON.stringify({ tab }));
    } catch {
      /* rien */
    }
  }, [tab]);

  const { data, error, loading, reload } = useSalesData<WorkspacePayload>(`/api/sales/ops?v=${version}`, { every: 45_000 });
  // Agenda : tous les calls a venir visibles par le membre (le Head of Setting voit aussi ceux de Mady).
  const { data: agenda, reload: reloadAgenda } = useSalesData<{ rows: AppointmentRow[] }>(`/api/sales/appointments?period=upcoming&limit=300&v=${version}`, { every: 60_000 });
  const refresh = useCallback(() => {
    bump();
    void reload(true);
    void reloadAgenda();
  }, [bump, reload, reloadAgenda]);

  // Raccourcis clavier.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      if (lead || sheet || openAppt || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "r") refresh();
      else if (/^[1-5]$/.test(e.key)) {
        const t = TABS[Number(e.key) - 1];
        if (t) setTab(t.key);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [lead, sheet, openAppt, refresh]);

  const k = data?.kpis;
  const tile = (label: string, value: number | undefined, onClick: () => void, tone?: string, hint?: string) => (
    <button type="button" onClick={onClick} className="card px-3.5 py-3 text-left transition-shadow hover:shadow-md" title={hint}>
      <div className="label-xs">{label}</div>
      <div className="text-[26px] font-semibold num leading-none mt-2" style={{ letterSpacing: "-0.03em", color: value ? tone : "var(--text-3)" }}>
        {value ?? "—"}
      </div>
    </button>
  );

  const today = data?.today ?? "";
  const counts: Partial<Record<Tab, number>> = data
    ? {
        appointments: data.poles.appointments.length,
        noshows: data.poles.noShows.filter((n) => !["rescheduled", "lost", "dnc"].includes(n.state)).length,
        payments: data.poles.payments.length,
      }
    : {};
  const poleProps = data ? { data, filter: "", onOpen: setLead, onSheet: setSheet, onChanged: refresh } : null;

  return (
    <>
      <PageHeader
        title="Mon espace de travail"
        subtitle={today ? new Date(`${today}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }) : undefined}
        actions={
          <button type="button" className="btn" onClick={refresh} title="Recharger (touche r)">
            ↻
          </button>
        }
      />

      {error && (
        <div className="mb-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {/* Indicateurs : chacun ouvre sa liste. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        {tile("RDV à confirmer", k?.toConfirm, () => setTab("appointments"), "var(--warning)", "Calls des 48 prochaines heures sans confirmation explicite")}
        {tile("RDV du jour", k?.apptsToday, () => setTab("appointments"), "var(--accent)")}
        {tile("No-shows", k?.noShows, () => setTab("noshows"), "var(--critical)", "Absents à récupérer")}
        {tile("Paiements", k?.payments, () => setTab("payments"), "var(--accent)", "Paiements en attente de suivi")}
      </div>

      {/* Agenda : tous les calls, les siens et ceux de Mady (il confirme les présences). */}
      <div className="mb-4">
        <CallsCalendar
          rows={agenda?.rows ?? []}
          role={session.isAdmin ? "admin" : "setter"}
          onOpen={(id) => setOpenAppt(id)}
          onReschedule={async (id, iso) => {
            try {
              await api(`/api/sales/appointments/${id}`, { method: "PATCH", body: JSON.stringify({ scheduledAt: iso }) });
              toast(`Rendez-vous déplacé au ${fmtDateTime(iso)} (FR). Préviens le lead.`);
              refresh();
            } catch (e) {
              toast((e as Error).message, "err");
              throw e;
            }
          }}
        />
      </div>

      <div className="flex gap-1 p-1 rounded-[10px] mb-4 overflow-x-auto" style={{ background: "var(--surface-3)" }} role="tablist">
        {TABS.map((t, i) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className="px-3 h-[28px] rounded-[7px] text-[12.5px] font-medium whitespace-nowrap"
            style={{ background: tab === t.key ? "var(--surface)" : "transparent", color: tab === t.key ? "var(--text)" : "var(--text-2)", boxShadow: tab === t.key ? "var(--shadow)" : "none" }}
            title={`Touche ${i + 1}`}
          >
            {t.label}
            {counts[t.key] ? <span className="dim num ml-1.5">{counts[t.key]}</span> : null}
          </button>
        ))}
      </div>

      {tab === "relances" ? (
        <div className="space-y-4">
          <SetterTasksMemberCard />
          <CallsToSettleCard onOpen={(id) => setOpenAppt(id)} />
        </div>
      ) : loading && !data ? (
        <Card>
          <Spinner label="Chargement…" />
        </Card>
      ) : !data || !poleProps ? null : tab === "appointments" ? (
        <AppointmentsPole {...poleProps} />
      ) : tab === "noshows" ? (
        <NoShowsPole {...poleProps} />
      ) : tab === "payments" ? (
        <PaymentsPole {...poleProps} />
      ) : (
        <div className="space-y-4">
          {isManager && <ReportBlock version={version} />}
          {session.memberId && <CommissionsBlock version={version} today={today} />}
          {!session.memberId && <p className="muted text-[13px]">Les commissions de l&apos;équipe sont dans Sales → Commissions.</p>}
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
      <AppointmentDetail id={openAppt} open={openAppt !== null} onClose={() => setOpenAppt(null)} onChanged={refresh} session={session} members={members} />
    </>
  );
}
