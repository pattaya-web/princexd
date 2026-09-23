"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client";
import { fmtDateTime, fmtInt, fmtMoney } from "@/lib/format";
import { periodQuery, useSalesData } from "@/lib/sales/client";
import { Card, Empty, ErrorNote, Spinner, useToast } from "@/components/ui";
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
export function MemberHome() {
  const { session, members, period, version, bump } = useSales();
  const toast = useToast();
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // Un setter-closer arrive sur la vue setter : c'est la plus operationnelle
  // (rendez-vous a poser, relances) ; ses calls y figurent aussi.
  const isSetter = sessionHas(session, "setter");

  const { data, loading, error } = useSalesData<MemberPayload>(
    `/api/sales/dashboard?${periodQuery(period.period, period.from, period.to, { v: String(version) })}`,
  );

  // Les rendez-vous a venir sont la matiere premiere de cet ecran : c'est ce
  // qu'on ouvre le matin, bien avant les statistiques du mois.
  const { data: upcoming } = useSalesData<{ rows: AppointmentRow[] }>(
    `/api/sales/appointments?period=upcoming&limit=8&v=${version}`,
  );

  const { data: shifts, reload: reloadShifts } = useSalesData<{ rows: ShiftRow[] }>(
    `/api/sales/shifts?v=${version}`,
  );

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

            {isSetter && (
              <button className="btn btn-primary shrink-0" onClick={() => setAdding(true)}>
                + Rendez-vous
              </button>
            )}
          </div>

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
                      <span className="text-[12.5px] font-semibold">
                        {start.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })}
                      </span>
                      <span className="dim text-[11px] num">{hours} h</span>
                    </div>
                    <div className="num text-[15px] font-semibold mt-0.5">
                      {start.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                      <span className="dim"> → </span>
                      {end.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
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
              <Empty
                action={
                  isSetter ? (
                    <button className="btn btn-primary" onClick={() => setAdding(true)}>
                      + Poser un rendez-vous
                    </button>
                  ) : undefined
                }
              >
                {isSetter
                  ? "Rien de prévu. C'est le moment d'ouvrir tes DMs."
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
                      <span className="num text-[11.5px] dim shrink-0">{fmtDateTime(r.scheduledAt)}</span>
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
