"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import { useSalesData } from "@/lib/sales/client";
import { Card, ErrorNote, Spinner, StatTile, useToast } from "@/components/ui";
import type { DailyReport, WeeklyReport } from "@/lib/sales/ops/report";
import { money, when } from "./shared";

interface CommissionsPayload {
  member: { id: string; name: string };
  rates: { setting: { pct: number; type: string; from: string; to: string } | null; management: { pct: number; from: string; to: string } | null };
  cash: { coaching: number; fromMyAppointments: number } | null;
  totals: { setting: number; management: number; other: number; acquired: number; pending: number; paid: number; due: number };
  entries: { sourceId: string; at: string; amount: number; detail: string; role: string }[];
  currency: string;
}

/** Commissions du membre connecte : setting et management separes, acquis / en attente / verse. */
export function CommissionsBlock({ memberId, version, today }: { memberId?: string; version: number; today: string }) {
  const { data, error, loading } = useSalesData<CommissionsPayload>(`/api/sales/ops/commissions?${memberId ? `member=${memberId}&` : ""}v=${version}`);
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (loading && !data) return <Spinner label="Calcul des commissions…" />;
  if (!data) return null;
  const c = data.currency;
  const r = data.rates;
  return (
    <Card title={`Commissions — ${data.member.name}`} subtitle="Calculées sur le cash réellement encaissé, remboursements déduits. Les versements restent validés par l'admin.">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <StatTile label="Setting" value={money(data.totals.setting, c)} hint={r.setting ? `${r.setting.pct} % de ses rendez-vous` : "Pas de taux"} />
        <StatTile label="Management" value={money(data.totals.management, c)} hint={r.management ? `${r.management.pct} % de tout le cash coaching` : "Pas de taux"} />
        <StatTile label="En attente d'encaissement" value={money(data.totals.pending, c)} hint="Projection sur les restes dus" />
        <StatTile label="Reste à verser" value={money(data.totals.due, c)} hint={`${money(data.totals.paid, c)} déjà versés`} />
      </div>
      {data.cash && (
        <p className="muted text-[12.5px] mt-3">
          CA coaching encaissé : <strong>{money(data.cash.coaching, c)}</strong> · dont rendez-vous posés par {data.member.name} : <strong>{money(data.cash.fromMyAppointments, c)}</strong>
        </p>
      )}
      <details className="mt-3">
        <summary className="cursor-pointer text-[12.5px] font-medium">Historique détaillé ({data.entries.length})</summary>
        <ul className="mt-2 space-y-1 max-h-[320px] overflow-y-auto">
          {data.entries.map((e) => (
            <li key={`${e.role}-${e.sourceId}`} className="flex gap-2 text-[12px]">
              <span className="dim mono w-[110px] shrink-0">{when(e.at, today)}</span>
              <span className="flex-1 min-w-0">{e.detail}</span>
              <span className="num font-medium" style={{ color: e.amount < 0 ? "var(--critical)" : undefined }}>
                {money(e.amount, c)}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </Card>
  );
}

interface ReportPayload {
  daily: DailyReport;
  weekly: WeeklyReport;
  history: { day: string; by: string; at: string; comment: string }[];
  currency: string;
}

/** Compte rendu du jour, calcule sur les vraies donnees, a valider et completer. */
export function ReportBlock({ version, onChanged }: { version: number; onChanged?: () => void }) {
  const toast = useToast();
  const [day, setDay] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const { data, error, reload } = useSalesData<ReportPayload>(`/api/sales/ops/report?${day ? `day=${day}&` : ""}v=${version}`);
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Spinner label="Compte rendu…" />;
  const c = data.currency;
  const d = data.daily;
  const fmt = (v: number, isMoney?: boolean) => (isMoney ? money(v, c) : v.toLocaleString("fr-FR"));
  const validate = async () => {
    setBusy(true);
    try {
      await api("/api/sales/ops/report", { method: "POST", body: JSON.stringify({ day: d.day, comment: comment || d.validated?.comment || "" }) });
      toast("Compte rendu validé.");
      setComment("");
      void reload();
      onChanged?.();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid lg:grid-cols-2 gap-3">
      <Card
        title={`Sales report — ${new Date(`${d.day}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}`}
        actions={<input type="date" className="input !h-[30px] !w-auto text-[12px]" value={day || d.day} onChange={(e) => setDay(e.target.value)} aria-label="Jour du compte rendu" />}
      >
        <ul className="space-y-1 text-[13px]">
          {d.lines.map((l) => (
            <li key={l.key} className="flex justify-between gap-2">
              <span>{l.label}</span>
              <strong className="num">{fmt(l.value, l.money)}</strong>
            </li>
          ))}
        </ul>
        <textarea className="textarea mt-3 text-[12.5px]" rows={3} placeholder={d.validated?.comment || "Ce qu'il faut savoir sur la journée : blocages, prospects chauds, besoin de Mady…"} value={comment} onChange={(e) => setComment(e.target.value)} />
        <div className="flex items-center gap-2 mt-2">
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void validate()}>
            {d.validated ? "Mettre à jour" : "Valider le compte rendu"}
          </button>
          {d.validated && (
            <span className="dim text-[12px]">
              Validé par {d.validated.by} · {new Date(d.validated.at).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}
            </span>
          )}
        </div>
      </Card>
      <Card title="Semaine" subtitle={`Du ${data.weekly.from.split("-").reverse().join("/")} au ${data.weekly.to.split("-").reverse().join("/")}, comparée aux 7 jours précédents`}>
        <ul className="space-y-1 text-[13px]">
          {data.weekly.lines.map((l) => {
            const delta = l.value - l.previous;
            return (
              <li key={l.key} className="flex justify-between gap-2">
                <span>{l.label}</span>
                <span className="num">
                  <strong>{fmt(l.value, l.money)}</strong>
                  <span className="dim text-[11.5px] ml-1.5" style={{ color: delta > 0 ? "var(--good)" : delta < 0 ? "var(--critical)" : undefined }}>
                    {delta > 0 ? "▲" : delta < 0 ? "▼" : "="} {l.money ? money(Math.abs(delta), c) : Math.abs(delta)}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
