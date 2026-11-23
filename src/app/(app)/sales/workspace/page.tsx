"use client";

/**
 * Mon espace de travail — le cockpit du setter (Head of Setting).
 *
 * Refait le 2026-11-23 à la demande de Mady, le plus simple possible :
 * l'agenda de tous les calls en haut, quatre chiffres (RDV à confirmer, RDV
 * du jour, no-shows, paiements), puis la liste des gens à contacter (nom,
 * téléphone, note) que le setter complète lui-même, et les calls à statuer.
 * Pas de file de tâches automatiques, pas de priorités, pas de rouge.
 */
import { useCallback, useState } from "react";
import { api } from "@/lib/client";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { useSalesData } from "@/lib/sales/client";
import { useSales } from "@/components/sales/context";
import { Card, Empty, PageHeader, useToast } from "@/components/ui";
import type { WorkspacePayload } from "@/lib/sales/ops/views";
import type { AppointmentRow } from "@/app/api/sales/appointments/route";
import type { SetterTaskRow } from "@/app/api/sales/setter-tasks/route";
import { LeadSheet } from "@/components/sales/LeadSheet";
import { CallsCalendar } from "@/components/sales/CallsCalendar";
import { AppointmentDetail } from "@/components/sales/AppointmentDetail";
import { SendToSetterModal } from "@/components/sales/SetterTasksCard";
import { CallsToSettleCard } from "@/components/sales/SetterOutcome";

export default function WorkspacePage() {
  const { session, members, version, bump } = useSales();
  const toast = useToast();
  const [sheet, setSheet] = useState<string | null>(null);
  const [openAppt, setOpenAppt] = useState<string | null>(null);

  const { data } = useSalesData<WorkspacePayload>(`/api/sales/ops?v=${version}`, { every: 60_000 });
  const { data: agenda, reload: reloadAgenda } = useSalesData<{ rows: AppointmentRow[] }>(`/api/sales/appointments?period=upcoming&limit=300&v=${version}`, { every: 60_000 });
  const refresh = useCallback(() => {
    bump();
    void reloadAgenda();
  }, [bump, reloadAgenda]);

  const k = data?.kpis;
  const tile = (label: string, value: number | undefined, tone: string) => (
    <div className="card px-3.5 py-3">
      <div className="label-xs">{label}</div>
      <div className="text-[26px] font-semibold num leading-none mt-2" style={{ letterSpacing: "-0.03em", color: value ? tone : "var(--text-3)" }}>
        {value ?? "—"}
      </div>
    </div>
  );
  const today = data?.today ?? "";

  return (
    <>
      <PageHeader
        title="Mon espace de travail"
        subtitle={today ? new Date(`${today}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }) : undefined}
        actions={
          <button type="button" className="btn" onClick={refresh} title="Recharger">
            ↻
          </button>
        }
      />

      {/* Agenda en haut : tous les calls, les siens et ceux de Mady (il confirme les présences). */}
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

      {/* Quatre chiffres, rien d'autre. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        {tile("RDV à confirmer", k?.toConfirm, "var(--warning)")}
        {tile("RDV du jour", k?.apptsToday, "var(--accent)")}
        {tile("No-shows", k?.noShows, "var(--critical)")}
        {tile("Paiements", k?.payments, "var(--accent)")}
      </div>

      <div className="space-y-4">
        <ContactList onOpenLead={setSheet} />
        <CallsToSettleCard onOpen={(id) => setOpenAppt(id)} />
      </div>

      <LeadSheet id={sheet} onClose={() => setSheet(null)} onChanged={refresh} />
      <AppointmentDetail id={openAppt} open={openAppt !== null} onClose={() => setOpenAppt(null)} onChanged={refresh} session={session} members={members} />
    </>
  );
}

/**
 * La liste des gens à contacter : nom, téléphone, note. Le setter l'allonge
 * lui-même (« + Ajouter ») et coche « Fait » quand c'est fait.
 */
function ContactList({ onOpenLead }: { onOpenLead: (leadId: string) => void }) {
  const { session, version, bump } = useSales();
  const toast = useToast();
  const { data, reload } = useSalesData<{ rows: SetterTaskRow[] }>(`/api/sales/setter-tasks?v=${version}`, { every: 60_000 });
  const rows = (data?.rows ?? []).filter((r) => r.status === "open");
  const [adding, setAdding] = useState(false);

  const copy = async (v: string) => {
    try {
      await navigator.clipboard.writeText(v);
      toast("Numéro copié.");
    } catch {
      toast("Copie impossible ici.", "err");
    }
  };
  const done = async (t: SetterTaskRow) => {
    try {
      await api("/api/sales/setter-tasks", { method: "PATCH", body: JSON.stringify({ id: t.id, done: true }) });
      toast(`${t.name} : fait.`);
      void reload();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  return (
    <>
      <Card
        title={`À contacter${rows.length ? ` · ${rows.length}` : ""}`}
        padded={false}
        actions={
          <button className="btn btn-sm btn-primary" onClick={() => setAdding(true)}>
            + Ajouter
          </button>
        }
      >
        {!rows.length ? (
          <Empty>Personne à contacter pour l&apos;instant.</Empty>
        ) : (
          <ul>
            {rows.map((t, i) => (
              <li key={t.id} className="px-4 py-3 flex items-center gap-3 flex-wrap" style={{ borderBottom: i < rows.length - 1 ? "1px solid var(--border)" : "none" }}>
                <div className="min-w-0 flex-1">
                  {t.leadId ? (
                    <button type="button" className="text-[14px] font-semibold link text-left" onClick={() => onOpenLead(t.leadId)} title="Ouvrir la fiche">
                      {t.name}
                    </button>
                  ) : (
                    <span className="text-[14px] font-semibold">{t.name}</span>
                  )}
                  {t.igUsername && <span className="dim text-[12px] ml-2">@{t.igUsername}</span>}
                  {t.note && <div className="dim text-[12.5px] leading-snug mt-0.5">{t.note}</div>}
                </div>
                {t.phone ? (
                  <span className="flex items-center gap-1.5 shrink-0">
                    <a href={`tel:${t.phone.replace(/\s+/g, "")}`} className="num text-[13.5px] font-medium link">
                      {t.phone}
                    </a>
                    <button type="button" className="btn btn-sm !h-[26px]" onClick={() => void copy(t.phone)} title="Copier le numéro">
                      Copier
                    </button>
                  </span>
                ) : (
                  <span className="dim text-[12px] shrink-0">pas de numéro</span>
                )}
                <span className="dim text-[11.5px] shrink-0 w-[70px] text-right">{fmtDate(`${t.dueOn}T12:00:00Z`)}</span>
                <button className="btn btn-sm btn-primary !h-[28px] shrink-0" onClick={() => void done(t)}>
                  ✓ Fait
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <SendToSetterModal
        open={adding}
        self={!session.isAdmin}
        onClose={() => setAdding(false)}
        onSent={() => {
          void reload();
          bump();
        }}
      />
    </>
  );
}
