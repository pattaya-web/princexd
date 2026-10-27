"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client";
import { fmtDateTime, fmtDualDateTime, fmtDay, fmtInt, fmtMoney, fmtTime, label as crmLabel, relative } from "@/lib/format";
import { CallsCalendar } from "./CallsCalendar";
import { OffersCard } from "./OffersCard";
import { TelegramCard } from "./TelegramCard";
import { SetterTasksMemberCard } from "./SetterTasksCard";
import { NoShowCard } from "./NoShowCard";
import { IclosedOptInsList } from "./IclosedOptIns";
import { LeadSheet } from "./LeadSheet";
import type { IclosedContactRow } from "@/app/api/sales/iclosed/contacts/route";
import { InstallmentAlerts } from "./InstallmentAlerts";
import { useEffect } from "react";
import { LINK_CHANNELS, LINK_CHANNEL_LABEL, type LinkChannel, type WorkSession } from "@/lib/types";
import { periodQuery, useSalesData } from "@/lib/sales/client";
import { Card, Empty, ErrorNote, Field, Modal, Spinner, useToast } from "@/components/ui";
import { ConfirmationSelect, IgHandle, PeriodPicker, StatusBadge } from "./bits";
import { canConfirm } from "@/lib/sales/constants";
import { AppointmentDetail } from "./AppointmentDetail";
import { AppointmentModal } from "./AppointmentModal";
import { useSales } from "./context";
import { sessionHas } from "@/lib/sales/roles";
import type { AppointmentRow } from "@/app/api/sales/appointments/route";
import type { ShiftRow } from "@/app/api/sales/shifts/route";
import type { SalesKpis } from "@/lib/sales/analytics";
import type { KpiLeadRow, KpiLeads } from "@/app/api/sales/dashboard/route";

interface MemberPayload {
  kpis: SalesKpis;
  /** Les noms derriere chaque chiffre (rendez-vous poses, closes, pitches sans vente, no-shows). */
  kpiLeads?: KpiLeads;
  commissions: { setters: number; closers: number; due: number };
  followUps: { overdue: number; pending: number };
  installments?: { due: number; overdue: number };
  currency: string;
}

/**
 * Accueil d'un setter ou d'un closer.
 *
 * Ecran d'arrivee apres connexion. Il doit repondre a trois questions en un
 * coup d'oeil, dans cet ordre : quand je bosse, ce que je dois faire
 * maintenant, et ou j'en suis de mes objectifs. Les tableaux detailles vivent
 * dans les autres onglets — ici on ne montre que ce sur quoi on peut agir.
 */
const HAT_KEY = "princexd:sales-hat";

export function MemberHome() {
  const { session, members, period, setPeriod, version, bump } = useSales();
  const toast = useToast();
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  /* Une tuile de performance cliquee : la liste des prospects derriere le chiffre. */
  const [kpiList, setKpiList] = useState<{ title: string; rows: KpiLeadRow[] } | null>(null);
  /* Fiche d'un no-show ouverte depuis le suivi. */
  const [noShowSheet, setNoShowSheet] = useState<string | null>(null);

  /*
   * Casquette du moment.
   *
   * Un membre setter ET closer bascule entre ses deux ecrans : en setter, ses
   * leads a appeler et les rendez-vous qu'il pose ; en closer, les calls qui
   * lui sont attribues et ce qu'il encaisse. Le choix est memorise sur
   * l'appareil. Un membre a une seule casquette n'a pas de bascule.
   */
  const both = sessionHas(session, "setter") && sessionHas(session, "closer");
  const [hat, setHat] = useState<"setter" | "closer">(() => {
    if (!sessionHas(session, "setter")) return "closer";
    if (!both) return "setter";
    try {
      const saved = window.localStorage.getItem(HAT_KEY);
      return saved === "closer" ? "closer" : "setter";
    } catch {
      return "setter";
    }
  });
  const switchHat = (h: "setter" | "closer") => {
    setHat(h);
    try {
      window.localStorage.setItem(HAT_KEY, h);
    } catch {
      // Stockage indisponible : la bascule vaut pour la session en cours.
    }
  };
  const isSetter = hat === "setter";
  const scope: Record<string, string> = both ? { as: hat } : {};

  const { data, loading, error } = useSalesData<MemberPayload>(
    `/api/sales/dashboard?${periodQuery(period.period, period.from, period.to, { v: String(version), ...scope })}`,
  );

  // Les rendez-vous a venir sont la matiere premiere de cet ecran : c'est ce
  // qu'on ouvre le matin, bien avant les statistiques du mois.
  const { data: upcoming, reload: reloadUpcoming } = useSalesData<{ rows: AppointmentRow[] }>(
    `/api/sales/appointments?period=upcoming&limit=8&v=${version}${both ? `&as=${hat}` : ""}`,
  );

  const { data: shifts, reload: reloadShifts } = useSalesData<{ rows: ShiftRow[] }>(
    `/api/sales/shifts?v=${version}`,
  );

  // Calendrier : tous les calls a venir de la casquette, semaine par semaine.
  const { data: agenda, reload: reloadAgenda } = useSalesData<{ rows: AppointmentRow[] }>(
    `/api/sales/appointments?period=upcoming&limit=300&v=${version}${both ? `&as=${hat}` : ""}`,
  );
  // Un call attribue pendant que l'ecran est ouvert apparait sans recharger.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void reloadAgenda();
    }, 60_000);
    return () => clearInterval(id);
  }, [reloadAgenda]);

  /* ------------------------------ Pointage ------------------------------ */
  const { data: work, reload: reloadWork } = useSalesData<{ open: WorkSession | null; todayHours: number }>(
    `/api/sales/work?period=today&v=${version}`,
  );
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    if (!work?.open) return;
    const id = setInterval(() => setClock(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [work?.open]);
  const [punching, setPunching] = useState(false);
  const punch = async (action: "start" | "stop") => {
    setPunching(true);
    try {
      const r = await api<{ hours?: number }>("/api/sales/work", { method: "POST", body: JSON.stringify({ action }) });
      toast(action === "start" ? "Session démarrée. Bon shift !" : `Session terminée : ${r.hours ?? 0} h aujourd'hui sur celle-ci.`);
      setClock(Date.now());
      void reloadWork();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setPunching(false);
    }
  };
  const openSince = work?.open ? Math.max(0, clock - new Date(work.open.startedAt).getTime()) : 0;
  const hm = (ms: number) => {
    const m = Math.round(ms / 60_000);
    return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
  };

  const k = data?.kpis;
  const currency = data?.currency ?? "EUR";
  const nextCalls = upcoming?.rows ?? [];

  /* Creneaux : on ne montre que ce qui n'est pas encore passe. */
  const myShifts = useMemo(() => {
    const now = new Date().toISOString();
    return (shifts?.rows ?? []).filter((s) => s.endAt >= now && s.status !== "declined").slice(0, 6);
  }, [shifts]);

  const proposed = myShifts.filter((s) => s.status === "proposed");

  /*
   * Double confirmation WhatsApp. 24 h avant : due des que le call est a
   * moins de 36 h ; 1 h avant : due a moins de 2 h 30. Un call deja passe
   * de plus de 30 minutes ne compte plus.
   */
  const dueRows = (agenda?.rows ?? []).filter((c) => canConfirm(c.status));
  const hoursUntil = (iso: string) => (new Date(iso).getTime() - Date.now()) / 3_600_000;
  const reminders24Due = dueRows.filter((c) => !c.reminder24At && hoursUntil(c.scheduledAt) <= 36 && hoursUntil(c.scheduledAt) > -0.5);
  const reminders1Due = dueRows.filter((c) => !c.reminder1At && hoursUntil(c.scheduledAt) <= 2.5 && hoursUntil(c.scheduledAt) > -0.5);

  const respond = async (id: string, status: "accepted" | "declined") => {
    try {
      await api("/api/sales/shifts", { method: "PATCH", body: JSON.stringify({ id, status }) });
      toast(status === "accepted" ? "Créneau accepté." : "Créneau décliné.");
      void reloadShifts();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Bonjour" : hour < 18 ? "Bon après-midi" : "Bonsoir";
  const firstName = session.memberName.split(" ")[0];

  /*
   * Objectif de la journee.
   *
   * Il vient des creneaux acceptes du jour, pas d'une constante : un setter qui
   * bosse trois heures n'a pas le meme objectif que celui qui en fait huit.
   */
  const today = new Date().toISOString().slice(0, 10);
  const todayShifts = (shifts?.rows ?? []).filter(
    (s) => s.startAt.slice(0, 10) === today && s.status !== "declined",
  );
  const dayGoal = todayShifts.reduce((a, s) => a + (s.goal || 0), 0);
  const dayDone = todayShifts.reduce((a, s) => a + s.booked, 0);
  const dayPct = dayGoal ? Math.min((dayDone / dayGoal) * 100, 100) : 0;

  if (loading && !data) {
    return (
      <Card>
        <Spinner label="Chargement de ton espace…" />
      </Card>
    );
  }

  return (
    <>
      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      <div className="flex flex-col gap-4 mh-stagger">
        {/* ------------------------------ Accueil ----------------------------- */}
        <div className="mh-hero px-5 py-5 sm:px-6 sm:py-6">
          <div className="relative flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="label-xs mb-1">
                {new Date().toLocaleDateString("fr-FR", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                })}
              </div>
              <h1 className="text-[26px] sm:text-[30px] font-semibold tracking-tight leading-tight">
                {greeting}, {firstName}
              </h1>
              <p className="muted text-[13px] mt-1.5 max-w-lg leading-relaxed">
                {isSetter
                  ? "Chaque rendez-vous que tu poses est tracé, du DM jusqu'à la vente. Ta commission suit automatiquement."
                  : "Tes calls du jour, le contexte laissé par le setter, et ce que tu encaisses. Tout au même endroit."}
              </p>
            </div>

            {/* Sur telephone : pleine largeur, chaque bouton sur sa ligne. Rien ne
                doit pouvoir deborder a droite. */}
            <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto min-w-0">
              {both && (
                <div className="flex gap-0.5 p-0.5 rounded-[8px] w-full sm:w-auto" style={{ background: "var(--surface-3)" }} title="Ta casquette du moment">
                  {(["setter", "closer"] as const).map((h) => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => switchHat(h)}
                      className="px-3 h-[32px] sm:h-[28px] rounded-[6px] text-[12px] font-medium transition-colors flex-1 sm:flex-none"
                      style={{
                        background: hat === h ? "var(--surface)" : "transparent",
                        color: hat === h ? "var(--text)" : "var(--text-2)",
                        boxShadow: hat === h ? "var(--shadow)" : "none",
                      }}
                    >
                      {h === "setter" ? "Vue setter" : "Vue closer"}
                    </button>
                  ))}
                </div>
              )}
              {/* Pas de « + Rendez-vous » ici : le prospect reserve lui-meme avec le
                  lien signe du setter, et le call arrive seul sur le calendrier. Les
                  leads froids se bookent depuis « A appeler ». */}
              {/* Pointage : un bouton, toujours visible, qui dit ou on en est. */}
              {session.memberId && (
                <button
                  className={`btn flex-1 sm:flex-none !h-[38px] sm:!h-auto whitespace-nowrap ${work?.open ? "" : "btn-primary"}`}
                  onClick={() => void punch(work?.open ? "stop" : "start")}
                  disabled={punching}
                  title={work?.open ? `Session démarrée à ${fmtTime(work.open.startedAt)}` : "Démarre ta session de travail"}
                  style={work?.open ? { borderColor: "var(--emerald)", color: "var(--emerald)" } : undefined}
                >
                  {punching ? <span className="spinner" /> : work?.open ? `■ Terminer · ${hm(openSince)}` : "▶ Démarrer ma session"}
                </button>
              )}
            </div>
          </div>
          {(work?.open || (work?.todayHours ?? 0) > 0) && (
            <div className="dim text-[12px] mt-2">
              {work?.open ? `En session depuis ${fmtTime(work.open.startedAt)}. ` : ""}
              {work?.todayHours ? `${work.todayHours} h pointées aujourd'hui.` : ""}
            </div>
          )}
          <MyBookingLink version={version} />

          {/* Les trois choses a faire, tout en haut, sans case a cocher. */}
          {isSetter && (
            <ul className="mt-4 flex flex-col gap-1 text-[13px] list-disc pl-5">
              <li>DM aux personnes qui ont liké les reels (surtout les reels value)</li>
              <li>Envoyer mon lien de calendrier signé à chaque prospect chaud</li>
              <li>Checker mes relances du jour et à venir (les miennes et celles de Mady)</li>
            </ul>
          )}

          {/* Objectif du jour, seulement s'il en existe un. Une barre vide en
              permanence donnerait l'impression d'un retard permanent. */}
          {dayGoal > 0 && (
            <div className="relative mt-5 max-w-md">
              <div className="flex items-baseline justify-between gap-3 mb-1.5">
                <span className="text-[12.5px] font-medium">Objectif du jour</span>
                <span className="num text-[12.5px]">
                  <strong>{dayDone}</strong>
                  <span className="dim"> / {dayGoal}</span>
                </span>
              </div>
              <div className="mh-bar">
                <span style={{ width: `${dayPct}%` }} />
              </div>
            </div>
          )}
        </div>

        {/* ---------------------------- Performances -------------------------- */}
        {/* Tout en haut : c'est ce qui motive. Chaque tuile s'ouvre sur les noms derriere le chiffre. */}
        {k && (
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <h2 className="text-[13px] font-semibold">
                Tes performances <span className="dim font-normal">— {period.period === "all" ? "depuis le début" : "sur la période"} · clique une tuile pour voir les noms</span>
              </h2>
              <PeriodPicker value={period} onChange={setPeriod} />
            </div>
            {isSetter ? (
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                <Metric
                  label="Rendez-vous posés"
                  value={fmtInt(k.appointments)}
                  sub={`${fmtInt(k.attended)} honorés`}
                  onClick={() => setKpiList({ title: "Rendez-vous posés", rows: data?.kpiLeads?.appointments ?? [] })}
                />
                <Metric
                  label="Taux de présence"
                  value={`${k.showRate.toFixed(0)} %`}
                  sub={`${fmtInt(k.noShows)} no-show`}
                  tone={k.showRate >= 50 ? "var(--emerald)" : undefined}
                  pct={k.showRate}
                  onClick={() => setKpiList({ title: "No-shows", rows: data?.kpiLeads?.noShows ?? [] })}
                />
                <Metric
                  label="Closés"
                  value={fmtInt(data?.kpiLeads?.closed.length ?? k.sales)}
                  sub={`${fmtMoney(k.contractValue, currency)} de contrats`}
                  tone="var(--emerald)"
                  onClick={() => setKpiList({ title: "Closés", rows: data?.kpiLeads?.closed ?? [] })}
                />
                <Metric
                  label="Pitchés, pas closés"
                  value={fmtInt(data?.kpiLeads?.pitched.length ?? Math.max(0, k.attended - k.sales))}
                  sub="calls faits sans vente"
                  onClick={() => setKpiList({ title: "Pitchés, pas closés", rows: data?.kpiLeads?.pitched ?? [] })}
                />
                <Metric
                  label="Ta commission"
                  value={fmtMoney(data.commissions.due, currency)}
                  sub="reste à te verser"
                  tone="var(--accent)"
                />
              </div>
            ) : (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Metric
                  label="Calls assignés"
                  value={fmtInt(k.appointments)}
                  sub={`${fmtInt(k.attended)} honorés`}
                  onClick={() => setKpiList({ title: "Calls assignés", rows: data?.kpiLeads?.appointments ?? [] })}
                />
                <Metric
                  label="Taux de closing"
                  value={`${k.closeRate.toFixed(0)} %`}
                  sub={`${fmtInt(k.sales)} ventes`}
                  tone={k.closeRate >= 50 ? "var(--emerald)" : undefined}
                  pct={k.closeRate}
                  onClick={() => setKpiList({ title: "Closés", rows: data?.kpiLeads?.closed ?? [] })}
                />
                <Metric label="Cash encaissé" value={fmtMoney(k.cashCollected, currency)} sub={`panier ${fmtMoney(k.avgDealSize, currency)}`} />
                <Metric label="Ta commission" value={fmtMoney(data.commissions.due, currency)} sub="reste à te verser" tone="var(--accent)" />
              </div>
            )}
          </div>
        )}

        {/* ------------------------- Confirmations WhatsApp ------------------------- */}
        {isSetter && (
          <Card title="À faire maintenant" padded={false}>
            <div className="p-4 flex flex-col gap-2.5">
              <Todo done={reminders24Due.length === 0} label="Confirmation WhatsApp 24 h avant le call" count={reminders24Due.length} />
              <Todo done={reminders1Due.length === 0} label="Confirmation WhatsApp 1 h avant le call" count={reminders1Due.length} />
            </div>
          </Card>
        )}

        {/* ------------------------- No-shows a relancer jusqu'au R2 ------------------------- */}
        {isSetter && <NoShowCard onOpenLead={(id) => setNoShowSheet(id)} />}

        {/* ------------------------- Relances (les siennes + celles de Mady) ------------------------- */}
        {isSetter && <SetterTasksMemberCard />}

        {/* ------------------------- Rappels Telegram ------------------------- */}
        <TelegramCard />

        {/* ---------------------- Échéances à encaisser ---------------------- */}
        {!isSetter && <InstallmentAlerts onOpen={(id) => setOpenId(id)} />}

        {/* ------------------------------- Offres ------------------------------- */}
        {!isSetter && <OffersCard />}

        {/* ----------------------------- Calendrier --------------------------- */}
        <CallsCalendar
          rows={agenda?.rows ?? []}
          role={isSetter ? "setter" : "closer"}
          onOpen={(id) => setOpenId(id)}
        />

        {/* ------------------- Prochains rendez-vous, replies ------------------- */}
        {isSetter && (
          <details className="card" open={false}>
            <summary className="cursor-pointer select-none px-4 sm:px-5 py-3.5 flex items-center gap-2">
              <span className="text-[15px] font-semibold">Tes prochains rendez-vous</span>
              <span className="badge !text-[10.5px] !py-0 num">{nextCalls.length}</span>
              <span className="dim text-[11.5px] ml-auto">déplier</span>
            </summary>
            <div style={{ borderTop: "1px solid var(--border)" }}>
              {!nextCalls.length ? (
                <Empty>Rien de prévu. C&apos;est le moment d&apos;ouvrir tes DMs et d&apos;envoyer ton lien.</Empty>
              ) : (
              <ul>
                {nextCalls.map((r, i) => (
                  <li
                    key={r.id}
                    className="px-3.5 py-2.5 cursor-pointer transition-colors hover:bg-[var(--surface-2)]"
                    style={{ borderBottom: i < nextCalls.length - 1 ? "1px solid var(--border)" : "none" }}
                    onClick={() => setOpenId(r.id)}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[12.5px] font-medium truncate">{r.leadName}</span>
                      <span className="num text-[11.5px] dim shrink-0">{fmtDualDateTime(r.scheduledAt)}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <IgHandle username={r.igUsername} muted />
                      <StatusBadge status={r.status} />
                      {/* Confirmer depuis la liste : c'est le geste anti no-show du setter. */}
                      {canConfirm(r.status) && (
                        <ConfirmationSelect
                          id={r.id}
                          value={r.confirmation}
                          onSaved={() => {
                            void reloadUpcoming();
                            bump();
                          }}
                        />
                      )}
                      {/* Double confirmation WhatsApp : 24 h avant, puis 1 h avant. */}
                      {canConfirm(r.status) && isSetter && (
                        <ReminderChips
                          row={r}
                          onSaved={() => {
                            void reloadUpcoming();
                            void reloadAgenda();
                            bump();
                          }}
                        />
                      )}
                      {!isSetter && r.setterName && (
                        <span className="dim text-[11px]">par {r.setterName}</span>
                      )}
                      {/* Le lien de visio directement dans la liste : un closer
                          qui a un call dans deux minutes ne doit pas avoir a
                          ouvrir une fiche pour le rejoindre. */}
                      {r.iclosedUrl && (
                        <a
                          href={r.iclosedUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="btn btn-sm btn-primary !h-[20px] !px-2 !text-[10.5px] ml-auto"
                          onClick={(e) => e.stopPropagation()}
                        >
                          Rejoindre ↗
                        </a>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              )}
            </div>
          </details>
        )}

        {/* ------------------- Suivi de mes leads ------------------- */}
        {isSetter && (
          <DeclaredProspects version={version} onChanged={bump} />
        )}

        {/* ------------------- Leads iClosed : formulaire commence, pas de RDV ------------------- */}
        {isSetter && <IclosedOptIns version={version} onChanged={bump} />}

        {/* ------------------------------ Créneaux ---------------------------- */}
        {myShifts.length > 0 && (
          <div>
            <div className="flex items-baseline gap-2 mb-2">
              <h2 className="text-[13px] font-semibold">Tes créneaux</h2>
              {proposed.length > 0 && (
                <span className="badge badge-accent !text-[10px] !py-0">
                  {proposed.length} à confirmer
                </span>
              )}
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {myShifts.map((s) => {
                const start = new Date(s.startAt);
                const end = new Date(s.endAt);
                const hours = Math.round(((end.getTime() - start.getTime()) / 3_600_000) * 10) / 10;
                return (
                  <div key={s.id} className="mh-shift px-3.5 py-3" data-state={s.status}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[12.5px] font-semibold">{fmtDay(s.startAt)}</span>
                      <span className="dim text-[11px] num">{hours} h</span>
                    </div>
                    <div className="num text-[15px] font-semibold mt-0.5" title="Heure de Paris">
                      {fmtTime(s.startAt)}
                      <span className="dim"> → </span>
                      {fmtTime(s.endAt)}
                    </div>
                    {s.goal > 0 && (
                      <div className="dim text-[11.5px] mt-0.5 num">
                        Objectif {s.goal} rendez-vous
                      </div>
                    )}
                    {s.note && <div className="text-[11.5px] mt-1 leading-snug">{s.note}</div>}

                    {s.status === "proposed" ? (
                      <div className="flex gap-1.5 mt-2.5">
                        <button className="btn btn-sm btn-primary" onClick={() => void respond(s.id, "accepted")}>
                          Accepter
                        </button>
                        <button className="btn btn-sm btn-ghost" onClick={() => void respond(s.id, "declined")}>
                          Décliner
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 mt-2.5">
                        <span className="badge badge-good !text-[10px] !py-0">Confirmé</span>
                        {s.booked > 0 && (
                          <span className="dim text-[11px] num">{s.booked} posé{s.booked > 1 ? "s" : ""}</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* --------------------------- Closer : actions et prochains calls ------------------------ */}
        {!isSetter && (
          <div className="grid lg:grid-cols-2 gap-4 items-start">
            <Card
              title="Tes prochains calls"
              padded={false}
              actions={
                <Link href="/sales/rendez-vous" className="btn btn-sm">
                  Tout voir
                </Link>
              }
            >
              {!nextCalls.length ? (
                <Empty>Aucun call à venir pour l&apos;instant.</Empty>
              ) : (
              <ul>
                {nextCalls.map((r, i) => (
                  <li
                    key={r.id}
                    className="px-3.5 py-2.5 cursor-pointer transition-colors hover:bg-[var(--surface-2)]"
                    style={{ borderBottom: i < nextCalls.length - 1 ? "1px solid var(--border)" : "none" }}
                    onClick={() => setOpenId(r.id)}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[12.5px] font-medium truncate">{r.leadName}</span>
                      <span className="num text-[11.5px] dim shrink-0">{fmtDualDateTime(r.scheduledAt)}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <IgHandle username={r.igUsername} muted />
                      <StatusBadge status={r.status} />
                      {/* Confirmer depuis la liste : c'est le geste anti no-show du setter. */}
                      {canConfirm(r.status) && (
                        <ConfirmationSelect
                          id={r.id}
                          value={r.confirmation}
                          onSaved={() => {
                            void reloadUpcoming();
                            bump();
                          }}
                        />
                      )}
                      {/* Double confirmation WhatsApp : 24 h avant, puis 1 h avant. */}
                      {canConfirm(r.status) && isSetter && (
                        <ReminderChips
                          row={r}
                          onSaved={() => {
                            void reloadUpcoming();
                            void reloadAgenda();
                            bump();
                          }}
                        />
                      )}
                      {!isSetter && r.setterName && (
                        <span className="dim text-[11px]">par {r.setterName}</span>
                      )}
                      {/* Le lien de visio directement dans la liste : un closer
                          qui a un call dans deux minutes ne doit pas avoir a
                          ouvrir une fiche pour le rejoindre. */}
                      {r.iclosedUrl && (
                        <a
                          href={r.iclosedUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="btn btn-sm btn-primary !h-[20px] !px-2 !text-[10.5px] ml-auto"
                          onClick={(e) => e.stopPropagation()}
                        >
                          Rejoindre ↗
                        </a>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              )}
            </Card>

            <Card
              title="Ce qui demande une action"
              padded={false}
              actions={
                <Link href="/sales/rendez-vous?view=todo" className="btn btn-sm">
                  Ouvrir le CRM
                </Link>
              }
            >
              <div className="p-4 flex flex-col gap-2.5">
                <Todo
                  done={(data?.installments?.due ?? 0) === 0}
                  label={data?.installments?.overdue ? "Échéances de paiement en retard" : "Échéances de paiement à encaisser"}
                  count={data?.installments?.due ?? 0}
                />
              </div>
            </Card>
          </div>
        )}
      </div>

      <AppointmentDetail
        id={openId}
        open={openId !== null}
        onClose={() => setOpenId(null)}
        onChanged={bump}
        session={session}
        members={members}
      />
      <LeadSheet id={noShowSheet} onClose={() => setNoShowSheet(null)} onChanged={bump} />
      <KpiListModal
        list={kpiList}
        currency={currency}
        onClose={() => setKpiList(null)}
        onOpen={(id) => {
          setKpiList(null);
          setOpenId(id);
        }}
      />
      <AppointmentModal
        open={adding}
        onClose={() => setAdding(false)}
        onSaved={bump}
        session={session}
        members={members}
      />
    </>
  );
}

/* --------------------------- Mon lien de calendrier --------------------------- */

/**
 * Le lien de reservation signe du membre, a copier en un clic. Present sur
 * les deux casquettes : le setter l'envoie en DM, le closer aussi quand il
 * relance lui-meme un prospect. Une reservation prise dessus lui est
 * attribuee automatiquement.
 */
function MyBookingLink({ version }: { version: number }) {
  const toast = useToast();
  const { data } = useSalesData<{ link: string; configured: boolean }>(`/api/sales/my-link?v=${version}`);
  if (!data) return null;
  if (!data.link) {
    return (
      <div className="dim text-[12px] mt-2">
        {data.configured
          ? "Mon lien de calendrier : indisponible pour ce compte."
          : "Mon lien de calendrier : l'admin doit d'abord coller le calendrier iClosed dans Comptes."}
      </div>
    );
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(data.link);
      toast("Lien copié. Envoie-le tel quel, il porte ton nom.");
    } catch {
      window.prompt("Copie ce lien :", data.link);
    }
  };
  return (
    <div className="flex items-center gap-2 flex-wrap mt-3">
      <span className="label-xs">Mon lien de calendrier</span>
      <code className="mono dim text-[11px] truncate max-w-full sm:max-w-[360px]" title={data.link}>
        {data.link}
      </code>
      <button className="btn btn-sm btn-primary" onClick={() => void copy()} title="Copier mon lien signé">
        Copier mon lien
      </button>
      <a className="btn btn-sm btn-ghost" href={data.link} target="_blank" rel="noreferrer">
        Ouvrir ↗
      </a>
    </div>
  );
}

/* ------------------------------ Liens envoyés ------------------------------ */

interface Declared {
  id: string;
  name: string;
  igUsername: string;
  phone: string;
  email: string;
  setterName: string;
  declaredAt: string;
  via: LinkChannel | "";
  why: string;
  appointmentAt: string;
  appointmentStatus: string;
  closerName: string;
  /** Compte-rendu du closer apres le call, et montant si close. */
  closerNote: string;
  lostReason: string;
  saleAmount: number;
  currency: string;
}

type DeclaredFilter = "all" | "pending" | "booked";

/** L'avancee d'un lead envoye : envoye → RDV pose → show / no-show → close ou pas. */
function LeadProgress({ r }: { r: Declared }) {
  const st = r.appointmentStatus;
  const attended = ["completed", "follow-up", "closed-won", "closed-lost"].includes(st);
  const past = r.appointmentAt ? Date.parse(r.appointmentAt) < Date.now() : false;
  const steps: { label: string; tone: string; done: boolean }[] = [
    { label: `Envoyé ${fmtDay(r.declaredAt)}`, tone: "var(--text-2)", done: true },
    r.appointmentAt
      ? { label: `RDV posé · ${fmtDualDateTime(r.appointmentAt)}`, tone: "var(--accent)", done: true }
      : { label: "Pas encore réservé", tone: "var(--warning)", done: false },
  ];
  if (r.appointmentAt) {
    if (st === "cancelled") steps.push({ label: "Annulé", tone: "var(--text-3)", done: true });
    else if (attended) steps.push({ label: "Show ✓", tone: "#a855f7", done: true });
    else if (st === "no-show") steps.push({ label: "No-show", tone: "var(--critical)", done: true });
    else if (past) steps.push({ label: "Call passé · à statuer", tone: "#f97316", done: false });
    else steps.push({ label: "Call à venir", tone: "var(--text-3)", done: false });
    if (st === "closed-won") steps.push({ label: r.saleAmount ? `Closé · ${fmtMoney(r.saleAmount, r.currency)}` : "Closé", tone: "var(--emerald)", done: true });
    else if (st === "closed-lost") steps.push({ label: r.lostReason ? `Pas closé · ${crmLabel(r.lostReason)}` : "Pas closé", tone: "var(--critical)", done: true });
    else if (st === "follow-up") steps.push({ label: "Follow-up", tone: "#3b82f6", done: true });
    else if (st === "completed") steps.push({ label: "Pitché · à conclure", tone: "var(--text-2)", done: true });
  }
  return (
    <div className="flex items-center gap-1.5 flex-wrap text-[12px]">
      {steps.map((x, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <span className="dim">→</span>}
          <span className="font-medium" style={{ color: x.tone, opacity: x.done ? 1 : 0.85 }}>
            {x.label}
          </span>
        </span>
      ))}
    </div>
  );
}

/**
 * Les liens de calendrier envoyes par le setter : a qui, quand, comment,
 * pourquoi, et ce que c'est devenu. Quand la reservation iClosed arrive, le
 * tool la rapproche (pseudo Instagram du questionnaire, email, telephone,
 * nom) et le rendez-vous lui est attribue : la ligne passe de « en attente »
 * a « a réservé », puis suit le call (fait, closé, no-show…). On declare ici
 * (prospect Instagram) ou depuis la liste Leads (bouton « Lien envoyé »).
 */
function DeclaredProspects({ version, onChanged }: { version: number; onChanged: () => void }) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [ig, setIg] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [via, setVia] = useState<LinkChannel>("instagram");
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<DeclaredFilter>("all");
  const [showAll, setShowAll] = useState(false);
  const { data, reload } = useSalesData<{ declared: Declared[] }>(`/api/sales/leads?declared=1&v=${version}`);
  const rows = data?.declared ?? [];
  const pending = rows.filter((r) => !r.appointmentAt);
  const booked = rows.filter((r) => Boolean(r.appointmentAt));
  const rate = rows.length ? Math.round((booked.length / rows.length) * 100) : 0;
  const list = filter === "pending" ? pending : filter === "booked" ? booked : rows;
  const shown = showAll ? list : list.slice(0, 12);
  const dayMs = 86_400_000;

  const submit = async () => {
    setBusy(true);
    try {
      await api("/api/sales/leads", { method: "POST", body: JSON.stringify({ igUsername: ig, name, phone, email, via, why }) });
      toast("Noté. Dès qu'il réserve, le rendez-vous te sera attribué.");
      setAdding(false);
      setIg("");
      setName("");
      setPhone("");
      setEmail("");
      setWhy("");
      void reload();
      onChanged();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  const chip = (key: DeclaredFilter, label: string, n: number) => (
    <button type="button" className={`btn btn-sm !h-[26px] !text-[11.5px] ${filter === key ? "btn-primary" : ""}`} onClick={() => setFilter(key)}>
      {label} <span className="num">{n}</span>
    </button>
  );

  return (
    <Card
      title="Suivi de mes leads"
      subtitle="Chaque lead que tu m'envoies et son avancée : envoyé → RDV posé → show ou no-show → closé ou pas, avec ma note après le call."
      padded={false}
      actions={
        <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>
          + J&apos;ai envoyé le lien
        </button>
      }
    >
      {rows.length > 0 && (
        <div className="px-3.5 py-2 flex items-center gap-1.5 flex-wrap" style={{ borderBottom: "1px solid var(--border)" }}>
          {chip("all", "Tous", rows.length)}
          {chip("pending", "En attente", pending.length)}
          {chip("booked", "Ont réservé", booked.length)}
          <span className="dim text-[11.5px] ml-auto num">
            {booked.length}/{rows.length} ont réservé · {rate} %
          </span>
        </div>
      )}
      {!rows.length ? (
        <Empty>
          Personne pour l&apos;instant. Dès que tu envoies ton lien à quelqu&apos;un (Instagram, WhatsApp…), note-le ici, ou
          clique « Lien envoyé » sur le lead dans la liste Leads.
        </Empty>
      ) : !shown.length ? (
        <Empty>Rien dans ce filtre.</Empty>
      ) : (
        <ul>
          {shown.map((r, i) => {
            const waiting = !r.appointmentAt;
            const sinceDays = Math.floor((Date.now() - Date.parse(r.declaredAt)) / dayMs);
            return (
              <li key={r.id} className="px-3.5 py-2.5 flex items-start gap-3 flex-wrap" style={{ borderBottom: i < shown.length - 1 ? "1px solid var(--border)" : "none" }}>
                <span className="min-w-0 flex-1 basis-[220px]">
                  <span className="block text-[13px] font-medium truncate">
                    {r.name}
                    {r.igUsername ? (
                      <span className="dim font-normal text-[11.5px]">
                        {" "}
                        · <IgHandle username={r.igUsername} muted />
                      </span>
                    ) : null}
                  </span>
                  <span className="dim text-[11.5px] block">
                    Envoyé {relative(r.declaredAt)} · {fmtDualDateTime(r.declaredAt)}
                    {r.via ? ` · ${LINK_CHANNEL_LABEL[r.via]}` : ""}
                    {r.phone ? ` · ${r.phone}` : ""}
                  </span>
                  {r.why && (
                    <span className="block text-[12px] mt-0.5 whitespace-pre-wrap" style={{ color: "var(--text-2)" }}>
                      {r.why}
                    </span>
                  )}
                  <span className="block mt-1.5">
                    <LeadProgress r={r} />
                  </span>
                  {(r.closerNote || (waiting && sinceDays >= 2)) && (
                    <span className="block text-[12px] mt-1 whitespace-pre-wrap leading-snug rounded-[8px] px-2.5 py-1.5" style={{ background: "var(--surface-2)", color: "var(--text-2)" }}>
                      {r.closerNote ? <><span className="label-xs">Note du closer · </span>{r.closerNote}</> : `${sinceDays} j sans réservation · relance-le`}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {list.length > 12 && (
        <div className="px-3.5 py-2 text-center" style={{ borderTop: "1px solid var(--border)" }}>
          <button type="button" className="link text-[12px]" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Réduire" : `Voir tout (${list.length})`}
          </button>
        </div>
      )}
      {pending.length > 0 && (
        <div className="dim text-[11.5px] px-3.5 py-2" style={{ borderTop: "1px solid var(--border)" }}>
          {pending.length} en attente. Si un prospect réserve sans que la ligne bouge, vérifie qu&apos;il a donné le même
          pseudo, email ou téléphone dans le questionnaire.
        </div>
      )}

      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title="J'ai envoyé le lien du calendrier à…"
        footer={
          <>
            <button className="btn" onClick={() => setAdding(false)} disabled={busy}>
              Annuler
            </button>
            <button className="btn btn-primary" onClick={() => void submit()} disabled={busy || (!ig.trim() && !name.trim())}>
              {busy ? <span className="spinner" /> : "Enregistrer"}
            </button>
          </>
        }
      >
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Pseudo Instagram" hint="Le plus fiable pour le rapprochement.">
            <input className="input" placeholder="@pseudo" value={ig} onChange={(e) => setIg(e.target.value)} autoFocus />
          </Field>
          <Field label="Prénom et nom" hint="Tel qu'il l'écrira en réservant.">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Téléphone (optionnel)">
            <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field label="Email (optionnel)">
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Comment" className="sm:col-span-2">
            <div className="flex gap-1.5 flex-wrap">
              {LINK_CHANNELS.map((c) => (
                <button key={c} type="button" className={`btn btn-sm ${via === c ? "btn-primary" : ""}`} onClick={() => setVia(c)}>
                  {LINK_CHANNEL_LABEL[c]}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Pourquoi (ce qu'il cherche, son contexte)" hint="Repris dans ta liste et dans les notes du closer." className="sm:col-span-2">
            <textarea className="input w-full" rows={2} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Veut lancer une boutique, budget, objection, dispo…" />
          </Field>
        </div>
      </Modal>
    </Card>
  );
}

/* ------------------------------ Sous-blocs ------------------------------- */

/** Carte de mesure, avec une jauge quand la valeur est un pourcentage. */
function Metric({
  label,
  value,
  sub,
  tone,
  pct,
  onClick,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
  pct?: number;
  /** Ouvre la liste des prospects derriere le chiffre. */
  onClick?: () => void;
}) {
  return (
    <div
      className={`mh-card px-4 py-3.5 ${onClick ? "cursor-pointer transition-opacity hover:opacity-85" : ""}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      title={onClick ? "Voir les noms" : undefined}
    >
      <div className="label-xs">{label}</div>
      <div className="text-[24px] font-semibold num tracking-tight mt-1.5" style={tone ? { color: tone } : undefined}>
        {value}
      </div>
      {pct !== undefined && (
        <div className="mh-bar mt-2">
          <span style={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }} />
        </div>
      )}
      {sub && <div className="dim text-[11.5px] mt-1.5">{sub}</div>}
    </div>
  );
}

/**
 * Ligne d'action.
 *
 * Verte et cochee quand il n'y a rien a faire : l'ecran doit pouvoir dire
 * « tu es a jour », pas seulement enumerer des retards.
 */
function Todo({
  done,
  label,
  count,
  href,
}: {
  done: boolean;
  label: string;
  count: number;
  href?: string;
}) {
  const body = (
    <div className="flex items-center gap-2.5">
      <span
        className="w-[18px] h-[18px] rounded-full grid place-items-center text-[10px] shrink-0"
        style={{
          background: done ? "color-mix(in srgb, var(--emerald) 15%, transparent)" : "var(--surface-3)",
          color: done ? "var(--emerald)" : "var(--text-3)",
        }}
      >
        {done ? "✓" : count}
      </span>
      <span className="text-[12.5px] flex-1" style={done ? { color: "var(--text-2)" } : undefined}>
        {label}
      </span>
      {!done && <span className="badge badge-warn !text-[10px] !py-0">à traiter</span>}
    </div>
  );

  if (done || !href) return body;
  return (
    <Link href={href} className="block hover:opacity-80 transition-opacity">
      {body}
    </Link>
  );
}

/* ----------------------- Double confirmation WhatsApp ----------------------- */

/**
 * Deux pastilles par rendez-vous : « WA 24 h » et « WA 1 h ». Le setter clique
 * quand il a ecrit au lead sur WhatsApp ; la pastille passe en vert avec
 * l'heure. Orange quand c'est le moment de l'envoyer.
 */
function ReminderChips({ row, onSaved }: { row: AppointmentRow; onSaved: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState("");
  const hours = (new Date(row.scheduledAt).getTime() - Date.now()) / 3_600_000;
  const chips: { key: "24h" | "1h"; label: string; at: string; due: boolean }[] = [
    { key: "24h", label: "WA 24 h", at: row.reminder24At, due: hours <= 36 },
    { key: "1h", label: "WA 1 h", at: row.reminder1At, due: hours <= 2.5 },
  ];
  const toggle = async (key: "24h" | "1h", done: boolean) => {
    setBusy(key);
    try {
      await api(`/api/sales/appointments/${row.id}`, { method: "PATCH", body: JSON.stringify({ reminder: key, done }) });
      toast(done ? `Confirmation ${key === "24h" ? "24 h" : "1 h"} avant notée.` : "Confirmation retirée.");
      onSaved();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy("");
    }
  };
  return (
    <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      {chips.map((c) => {
        const done = Boolean(c.at);
        return (
          <button
            key={c.key}
            type="button"
            disabled={busy === c.key}
            onClick={() => void toggle(c.key, !done)}
            className="badge !text-[10.5px] !py-0 cursor-pointer"
            title={done ? `Envoyée ${fmtDateTime(c.at)} · clic pour retirer` : c.due ? "À envoyer maintenant sur WhatsApp, puis clique" : "Pas encore le moment"}
            style={{
              color: done ? "var(--emerald)" : c.due ? "#f97316" : "var(--text-3)",
              borderColor: done ? "color-mix(in srgb, var(--emerald) 40%, transparent)" : c.due ? "#f9731666" : "var(--border)",
              background: done ? "color-mix(in srgb, var(--emerald) 10%, transparent)" : c.due ? "#f9731614" : "transparent",
            }}
          >
            {done ? "✓ " : ""}
            {c.label}
          </button>
        );
      })}
    </span>
  );
}

/* ------------------------- Les noms derriere un chiffre ------------------------- */

const ATTENDED = new Set(["completed", "follow-up", "closed-won", "closed-lost"]);

/** Venu ou pas : rien tant que le call est a venir ; « a statuer » quand il est passe sans issue. */
function Presence({ r }: { r: KpiLeadRow }) {
  if (r.status === "cancelled") return <span className="dim">Annulé</span>;
  if (ATTENDED.has(r.status)) return <span className="font-semibold" style={{ color: "#a855f7" }}>✓ Show</span>;
  if (r.status === "no-show") return <span className="font-semibold" style={{ color: "var(--critical)" }}>No-show</span>;
  if (new Date(r.at).getTime() > Date.now()) return <span className="dim">Planifié</span>;
  return <span style={{ color: "#f97316" }}>À statuer</span>;
}

/** Ce que le call a donne, une fois venu. */
function Outcome({ r }: { r: KpiLeadRow }) {
  if (r.status === "closed-won") return <span className="font-semibold" style={{ color: "var(--good)" }}>Closé</span>;
  if (r.status === "closed-lost") return <span style={{ color: "var(--critical)" }}>Pas closé</span>;
  if (r.status === "follow-up") return <span style={{ color: "#3b82f6" }}>Follow-up</span>;
  if (r.status === "completed") return <span className="dim">Pitché · à conclure</span>;
  return <span className="dim">—</span>;
}

function KpiListModal({ list, currency, onClose, onOpen }: { list: { title: string; rows: KpiLeadRow[] } | null; currency: string; onClose: () => void; onOpen: (appointmentId: string) => void }) {
  const toast = useToast();
  const copy = async (v: string) => {
    try {
      await navigator.clipboard.writeText(v);
      toast("Copié.");
    } catch {
      toast("Copie impossible ici.", "err");
    }
  };
  return (
    <Modal open={list !== null} onClose={onClose} title={list ? `${list.title} · ${list.rows.length}` : ""} wide>
      {!list || list.rows.length === 0 ? (
        <Empty>Personne pour l&apos;instant sur cette période.</Empty>
      ) : (
        <div className="scroll-x">
          <table className="table">
            <thead>
              <tr>
                <th>Prénom / nom</th>
                <th>Téléphone</th>
                <th>Call</th>
                <th>Présence</th>
                <th>Résultat</th>
                <th>Note du closer</th>
                <th className="!text-right">Montant</th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((r) => (
                <tr key={r.appointmentId} className="cursor-pointer" onClick={() => onOpen(r.appointmentId)} title="Ouvrir le rendez-vous">
                  <td className="font-medium text-[13px]">{r.name}</td>
                  <td className="num text-[12.5px] whitespace-nowrap">
                    {r.phone ? (
                      <button type="button" className="link" onClick={(e) => { e.stopPropagation(); void copy(r.phone); }} title="Copier le numéro">
                        {r.phone}
                      </button>
                    ) : (
                      <span className="dim">—</span>
                    )}
                  </td>
                  <td className="num text-[12px] whitespace-nowrap">{fmtDateTime(r.at)}</td>
                  <td className="text-[12.5px]">
                    <Presence r={r} />
                  </td>
                  <td className="text-[12.5px]">
                    <Outcome r={r} />
                  </td>
                  <td className="text-[12px] min-w-[200px] max-w-[320px]">
                    {r.lostReason && <span className="badge !text-[10.5px] !py-0 mr-1.5" style={{ color: "var(--critical)" }}>{crmLabel(r.lostReason)}</span>}
                    {r.note ? <span className="whitespace-pre-wrap leading-snug" style={{ color: "var(--text-2)" }}>{r.note}</span> : !r.lostReason ? <span className="dim">—</span> : null}
                  </td>
                  <td className="num text-right text-[12.5px] font-semibold">{r.amount ? fmtMoney(r.amount, currency) : <span className="dim">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

/* ---------------------- Leads iClosed opt-in sans rendez-vous ---------------------- */

/**
 * Les gens qui ont commence a remplir le formulaire du calendrier iClosed
 * (n'importe quel lien) sans aller jusqu'a la reservation. iClosed les garde :
 * on les relit par l'API (voir /api/sales/iclosed/contacts). Pour le setter,
 * ce sont des prospects chauds a relancer.
 */
function IclosedOptIns({ version, onChanged }: { version: number; onChanged: () => void }) {
  const { data, reload } = useSalesData<{ rows: IclosedContactRow[]; fetchedAt: string; error: string }>(`/api/sales/iclosed/contacts?v=${version}`);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const rows = data?.rows ?? [];
  const hot = rows.filter((r) => r.status === "QUALIFIED" && !r.callStatus && !r.appointmentAt).length;
  return (
    <>
      <details className="card">
        <summary className="cursor-pointer select-none px-4 sm:px-5 py-3.5 flex items-center gap-2 flex-wrap">
          <span className="text-[15px] font-semibold">Leads iClosed · opt-in sans rendez-vous</span>
          <span className="badge !text-[10.5px] !py-0 num">{rows.length}</span>
          {hot > 0 && <span className="badge badge-good !text-[10.5px] !py-0 num">{hot} qualifié{hot > 1 ? "s" : ""} jamais contacté{hot > 1 ? "s" : ""}</span>}
          <span className="dim text-[11.5px]">formulaire du calendrier commencé, call pas pris : à appeler ou à écrire</span>
          <span className="dim text-[11.5px] ml-auto">déplier</span>
        </summary>
        <div style={{ borderTop: "1px solid var(--border)" }}>
          {data?.error ? (
            <div className="p-4">
              <ErrorNote>{data.error}</ErrorNote>
            </div>
          ) : !data ? (
            <div className="p-4">
              <Spinner label="Lecture d'iClosed…" />
            </div>
          ) : (
            <IclosedOptInsList
              rows={rows}
              limit={12}
              onChanged={() => {
                void reload();
                onChanged();
              }}
              onOpen={setSheetId}
            />
          )}
          {rows.length > 0 && (
            <div className="px-3.5 py-2 text-center" style={{ borderTop: "1px solid var(--border)" }}>
              <Link href="/sales/leads" className="link text-[12px]">
                Tout voir dans Leads → iClosed sans RDV
              </Link>
            </div>
          )}
        </div>
      </details>
      <LeadSheet
        id={sheetId}
        onClose={() => setSheetId(null)}
        onChanged={() => {
          void reload();
          onChanged();
        }}
      />
    </>
  );
}
