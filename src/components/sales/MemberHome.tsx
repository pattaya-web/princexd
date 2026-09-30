"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client";
import { fmtDualDateTime, fmtDay, fmtInt, fmtMoney, fmtTime, relative } from "@/lib/format";
import { CallsCalendar } from "./CallsCalendar";
import { useEffect } from "react";
import type { WorkSession } from "@/lib/types";
import { periodQuery, useSalesData } from "@/lib/sales/client";
import { Card, Empty, ErrorNote, Field, Modal, Spinner, useToast } from "@/components/ui";
import { IgHandle, StatusBadge } from "./bits";
import { AppointmentDetail } from "./AppointmentDetail";
import { AppointmentModal } from "./AppointmentModal";
import { useSales } from "./context";
import { sessionHas } from "@/lib/sales/roles";
import type { AppointmentRow } from "@/app/api/sales/appointments/route";
import type { ShiftRow } from "@/app/api/sales/shifts/route";
import type { SalesKpis } from "@/lib/sales/analytics";

interface MemberPayload {
  kpis: SalesKpis;
  commissions: { setters: number; closers: number; due: number };
  followUps: { overdue: number; pending: number };
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
  const { session, members, period, version, bump } = useSales();
  const toast = useToast();
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

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

  /*
   * Etiquette Instagram : celle du compte (Comptes → Modifier), sinon un
   * defaut par prenom convenu avec l'admin : Salim marque « Commandé », Noa
   * marque « Prospect ».
   */
  const first = session.memberName.split(" ")[0].toLowerCase();
  const igLabel =
    members.find((m) => m.id === session.memberId)?.igLabel ||
    (first === "salim" ? "Commandé" : first === "noa" ? "Prospect" : "");

  const { data, loading, error } = useSalesData<MemberPayload>(
    `/api/sales/dashboard?${periodQuery(period.period, period.from, period.to, { v: String(version), ...scope })}`,
  );

  // Les rendez-vous a venir sont la matiere premiere de cet ecran : c'est ce
  // qu'on ouvre le matin, bien avant les statistiques du mois.
  const { data: upcoming } = useSalesData<{ rows: AppointmentRow[] }>(
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
  const currency = data?.currency ?? "USD";
  const nextCalls = upcoming?.rows ?? [];

  /* Creneaux : on ne montre que ce qui n'est pas encore passe. */
  const myShifts = useMemo(() => {
    const now = new Date().toISOString();
    return (shifts?.rows ?? []).filter((s) => s.endAt >= now && s.status !== "declined").slice(0, 6);
  }, [shifts]);

  const proposed = myShifts.filter((s) => s.status === "proposed");

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
          {/* Etiquette Instagram du setter : le mot a poser sur chaque conversation
              qu'il gere, pour ne pas se melanger avec l'autre setter. */}
          {isSetter && igLabel && (
            <div
              className="mt-3 rounded-[10px] px-3.5 py-2.5 flex items-center gap-3 flex-wrap"
              style={{ background: "color-mix(in srgb, var(--accent) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--accent) 35%, transparent)" }}
            >
              <span className="text-[12.5px]">Sur Instagram, étiquette chaque conversation que tu gères avec</span>
              <span className="badge badge-accent !text-[12px] !py-1 !px-3">{igLabel}</span>
            </div>
          )}
          {(work?.open || (work?.todayHours ?? 0) > 0) && (
            <div className="dim text-[12px] mt-2">
              {work?.open ? `En session depuis ${fmtTime(work.open.startedAt)}. ` : ""}
              {work?.todayHours ? `${work.todayHours} h pointées aujourd'hui.` : ""}
            </div>
          )}
          <MyBookingLink version={version} />

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

        {/* ----------------------------- Calendrier --------------------------- */}
        <CallsCalendar
          rows={agenda?.rows ?? []}
          role={isSetter ? "setter" : "closer"}
          onOpen={(id) => setOpenId(id)}
        />

        {/* ------------------------------ Ma journée ------------------------------ */}
        {isSetter && <DailyTasks version={version} />}

        {/* ------------------- Prospects envoyés vers le calendrier ------------------- */}
        {isSetter && (
          <DeclaredProspects version={version} onChanged={bump} />
        )}

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

        {/* ---------------------------- Performances -------------------------- */}
        {k && (
          <div>
            <h2 className="text-[13px] font-semibold mb-2">
              Tes performances <span className="dim font-normal">— {period.period === "all" ? "depuis le début" : "sur la période"}</span>
            </h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Metric
                label={isSetter ? "Rendez-vous posés" : "Calls assignés"}
                value={fmtInt(k.appointments)}
                sub={`${fmtInt(k.attended)} honorés`}
              />
              <Metric
                label={isSetter ? "Taux de présence" : "Taux de closing"}
                value={`${(isSetter ? k.showRate : k.closeRate).toFixed(0)} %`}
                sub={isSetter ? `${fmtInt(k.noShows)} no-show` : `${fmtInt(k.sales)} ventes`}
                tone={(isSetter ? k.showRate : k.closeRate) >= 50 ? "var(--emerald)" : undefined}
                pct={isSetter ? k.showRate : k.closeRate}
              />
              <Metric
                label={isSetter ? "Ventes générées" : "Cash encaissé"}
                value={isSetter ? fmtInt(k.sales) : fmtMoney(k.cashCollected, currency)}
                sub={isSetter ? fmtMoney(k.cashCollected, currency) + " de cash" : `panier ${fmtMoney(k.avgDealSize, currency)}`}
              />
              <Metric
                label="Ta commission"
                value={fmtMoney(data.commissions.due, currency)}
                sub="reste à te verser"
                tone="var(--accent)"
              />
            </div>
          </div>
        )}

        {/* --------------------------- Ce qui t'attend ------------------------ */}
        <div className="grid lg:grid-cols-2 gap-4 items-start">
          <Card
            title={isSetter ? "Tes prochains rendez-vous" : "Tes prochains calls"}
            padded={false}
            actions={
              <Link href="/sales/rendez-vous" className="btn btn-sm">
                Tout voir
              </Link>
            }
          >
            {!nextCalls.length ? (
              <Empty>
                {isSetter
                  ? "Rien de prévu. C'est le moment d'ouvrir tes DMs et d'envoyer ton lien."
                  : "Aucun call à venir pour l'instant."}
              </Empty>
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
              <Link href="/sales/relances" className="btn btn-sm">
                Relances
              </Link>
            }
          >
            <div className="p-4 flex flex-col gap-2.5">
              <Todo
                done={(data?.followUps.overdue ?? 0) === 0}
                label="Relances en retard"
                count={data?.followUps.overdue ?? 0}
                href="/sales/relances"
              />
              <Todo
                done={(data?.followUps.pending ?? 0) === 0}
                label="Relances en attente"
                count={data?.followUps.pending ?? 0}
                href="/sales/relances"
              />
              <Todo
                done={proposed.length === 0}
                label="Créneaux à confirmer"
                count={proposed.length}
              />
              {!isSetter && (
                <Todo
                  done={nextCalls.filter((c) => c.status === "booked").length === 0}
                  label="Calls non confirmés"
                  count={nextCalls.filter((c) => c.status === "booked").length}
                  href="/sales/rendez-vous"
                />
              )}
            </div>
          </Card>
        </div>
      </div>

      <AppointmentDetail
        id={openId}
        open={openId !== null}
        onClose={() => setOpenId(null)}
        onChanged={bump}
        session={session}
        members={members}
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

/* ------------------------------- Ma journée ------------------------------- */

/**
 * Liste de taches quotidienne du setter, la meme pour toute l'equipe, remise
 * a zero chaque jour. Un compteur vivant sur la premiere tache : combien de
 * nouveaux leads attendent. L'admin voit les cases cochees dans « Shifts
 * equipe » et modifie la liste.
 */
function DailyTasks({ version }: { version: number }) {
  const toast = useToast();
  const { data, reload } = useSalesData<{ tasks: string[]; day: string; done: string[]; hints: { newLeads: number } }>(
    `/api/sales/tasks?v=${version}`,
  );
  const [busy, setBusy] = useState("");
  const tasks = data?.tasks ?? [];
  const done = new Set(data?.done ?? []);
  const pct = tasks.length ? Math.round((done.size / tasks.length) * 100) : 0;

  const toggle = async (task: string) => {
    setBusy(task);
    try {
      await api("/api/sales/tasks", { method: "POST", body: JSON.stringify({ task, done: !done.has(task) }) });
      void reload();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy("");
    }
  };

  if (!tasks.length) return null;
  return (
    <Card
      title="Ma journée"
      subtitle={`${done.size} sur ${tasks.length} · la liste se remet à zéro chaque matin`}
      padded={false}
      actions={
        <div className="w-[120px]">
          <div className="mh-bar">
            <span style={{ width: `${pct}%` }} />
          </div>
        </div>
      }
    >
      <ul>
        {tasks.map((t, i) => {
          const checked = done.has(t);
          const first = i === 0;
          return (
            <li
              key={t}
              className="px-3.5 py-2.5 flex items-center gap-3"
              style={{ borderBottom: i < tasks.length - 1 ? "1px solid var(--border)" : "none", opacity: checked ? 0.6 : 1 }}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={busy === t}
                onChange={() => void toggle(t)}
                className="w-[18px] h-[18px] cursor-pointer"
              />
              <span className="text-[13px] flex-1" style={checked ? { textDecoration: "line-through" } : undefined}>
                {t}
              </span>
              {first && !checked && (data?.hints.newLeads ?? 0) > 0 && (
                <Link href="/sales/leads" className="badge badge-accent !text-[10.5px] !py-0">
                  {data!.hints.newLeads} à appeler
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/* -------------------- Prospects envoyés vers le calendrier -------------------- */

interface Declared {
  id: string;
  name: string;
  igUsername: string;
  phone: string;
  email: string;
  declaredAt: string;
  appointmentAt: string;
  appointmentStatus: string;
  closerName: string;
}

/**
 * Le setter declare a qui il a envoye le lien du calendrier. Quand la
 * reservation iClosed arrive, le tool la rapproche (pseudo Instagram du
 * questionnaire, email, telephone, nom) et le rendez-vous lui est attribue :
 * la ligne passe de « en attente » a la date du call.
 */
function DeclaredProspects({ version, onChanged }: { version: number; onChanged: () => void }) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [ig, setIg] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const { data, reload } = useSalesData<{ declared: Declared[] }>(`/api/sales/leads?declared=1&v=${version}`);
  const rows = data?.declared ?? [];
  const pending = rows.filter((r) => !r.appointmentAt);

  const submit = async () => {
    setBusy(true);
    try {
      await api("/api/sales/leads", { method: "POST", body: JSON.stringify({ igUsername: ig, name, phone, email, note }) });
      toast("Noté. Dès qu'il réserve, le rendez-vous te sera attribué.");
      setAdding(false);
      setIg("");
      setName("");
      setPhone("");
      setEmail("");
      setNote("");
      void reload();
      onChanged();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Prospects à qui j'ai envoyé le calendrier"
      subtitle="Déclare chaque prospect Instagram à qui tu envoies le lien : quand il réserve, le rendez-vous t'est attribué automatiquement."
      padded={false}
      actions={
        <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>
          + J&apos;ai envoyé le lien
        </button>
      }
    >
      {!rows.length ? (
        <Empty>
          Personne pour l&apos;instant. Dès que tu envoies ton lien à quelqu&apos;un sur Instagram, note-le ici avec son
          pseudo.
        </Empty>
      ) : (
        <ul>
          {rows.slice(0, 12).map((r, i) => (
            <li
              key={r.id}
              className="px-3.5 py-2.5 flex items-center gap-3 flex-wrap"
              style={{ borderBottom: i < Math.min(rows.length, 12) - 1 ? "1px solid var(--border)" : "none" }}
            >
              <span className="min-w-0 flex-1 basis-[200px]">
                <span className="block text-[13px] font-medium truncate">{r.name}</span>
                <span className="dim text-[11.5px]">
                  {r.igUsername ? <IgHandle username={r.igUsername} muted /> : null}
                  {r.igUsername ? " · " : ""}envoyé {relative(r.declaredAt)}
                </span>
              </span>
              {r.appointmentAt ? (
                <span className="text-[12px] font-medium" style={{ color: "var(--emerald)" }}>
                  ✓ Call le {fmtDualDateTime(r.appointmentAt)}{r.closerName ? ` avec ${r.closerName}` : ""}
                </span>
              ) : (
                <span className="badge badge-warn !text-[10.5px] !py-0">en attente de réservation</span>
              )}
            </li>
          ))}
        </ul>
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
          <Field label="Note pour le closer (optionnel)" className="sm:col-span-2">
            <textarea className="input w-full" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ce qu'il cherche, son budget, son objection…" />
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
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
  pct?: number;
}) {
  return (
    <div className="mh-card px-4 py-3.5">
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
