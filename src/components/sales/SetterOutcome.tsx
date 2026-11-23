"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import { fmtDualDateTime, label, parisDay } from "@/lib/format";
import { useSalesData } from "@/lib/sales/client";
import { LOST_REASONS } from "@/lib/sales/constants";
import { Card, Empty, useToast } from "@/components/ui";
import { FOLLOWUP_HEATS, FOLLOWUP_HEAT_COLOR, FOLLOWUP_HEAT_ICON, FOLLOWUP_HEAT_LABEL, type FollowUpHeat } from "@/lib/types";
import { useSales } from "./context";
import type { AppointmentRow } from "@/app/api/sales/appointments/route";
import type { SetterResult } from "@/app/api/sales/appointments/[id]/setter-outcome/route";

/** Pastilles de chaleur : chaud (rouge), veut réfléchir (orange), froid (bleu). */
export function HeatPicker({ value, onChange }: { value: FollowUpHeat | ""; onChange: (h: FollowUpHeat | "") => void }) {
  return (
    <div className="flex gap-1 flex-wrap">
      {FOLLOWUP_HEATS.map((h) => {
        const on = value === h;
        const c = FOLLOWUP_HEAT_COLOR[h];
        return (
          <button
            key={h}
            type="button"
            className="btn btn-sm !h-[30px]"
            style={on ? { background: c, borderColor: c, color: "#fff" } : { borderColor: `color-mix(in srgb, ${c} 45%, transparent)`, color: c }}
            onClick={() => onChange(on ? "" : h)}
          >
            {FOLLOWUP_HEAT_ICON[h]} {FOLLOWUP_HEAT_LABEL[h]}
          </button>
        );
      })}
    </div>
  );
}

export function HeatBadge({ heat }: { heat?: FollowUpHeat }) {
  if (!heat) return null;
  const c = FOLLOWUP_HEAT_COLOR[heat];
  return (
    <span className="badge !text-[10.5px] !py-0 font-semibold" style={{ color: c, borderColor: `color-mix(in srgb, ${c} 50%, transparent)`, background: `color-mix(in srgb, ${c} 10%, transparent)` }}>
      {FOLLOWUP_HEAT_ICON[heat]} {FOLLOWUP_HEAT_LABEL[heat]}
    </span>
  );
}

/**
 * Statuer un call, côté setter : show ou no-show, puis closé, pas closé ou
 * à relancer (date + chaleur). Le montant d'un closing, c'est Mady.
 */
export function SetterOutcomeBox({ appointmentId, onDone }: { appointmentId: string; onDone: () => void }) {
  const toast = useToast();
  const [step, setStep] = useState<"" | "show" | "not-closed" | "follow-up">("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [heat, setHeat] = useState<FollowUpHeat | "">("warm");
  const [dueOn, setDueOn] = useState(parisDay(2));
  const [reason, setReason] = useState("need-to-think");

  const send = async (result: SetterResult) => {
    if (result === "follow-up" && !heat) return toast("Choisis la chaleur du prospect.", "err");
    setBusy(true);
    try {
      await api(`/api/sales/appointments/${appointmentId}/setter-outcome`, {
        method: "POST",
        body: JSON.stringify({ result, note, heat, dueOn, lostReason: reason }),
      });
      toast(
        result === "no-show"
          ? "No-show noté : il passe dans tes no-shows à relancer."
          : result === "closed"
            ? "Closé 🎉 Mady pose le montant."
            : result === "not-closed"
              ? "Pas closé, noté."
              : result === "follow-up"
                ? `Relance notée pour le ${dueOn.split("-").reverse().join("/")}.`
                : "Show noté.",
      );
      setStep("");
      setNote("");
      onDone();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  if (!step) {
    return (
      <div className="flex flex-wrap gap-1.5">
        <button className="btn btn-sm" style={{ borderColor: "var(--good)", color: "var(--good)" }} disabled={busy} onClick={() => setStep("show")}>
          ✓ Show
        </button>
        <button className="btn btn-sm" style={{ borderColor: "var(--critical)", color: "var(--critical)" }} disabled={busy} onClick={() => void send("no-show")}>
          ✗ No-show
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-[10px] p-2.5" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
      <div className="flex flex-wrap gap-1.5 items-center">
        <span className="text-[12px] font-semibold mr-1">Il est venu. Résultat :</span>
        <button className="btn btn-sm btn-primary" style={{ background: "var(--good)", borderColor: "var(--good)" }} disabled={busy} onClick={() => void send("closed")}>
          Closé
        </button>
        <button className={`btn btn-sm ${step === "not-closed" ? "btn-primary" : ""}`} disabled={busy} onClick={() => setStep("not-closed")}>
          Pas closé
        </button>
        <button className={`btn btn-sm ${step === "follow-up" ? "btn-primary" : ""}`} disabled={busy} onClick={() => setStep("follow-up")}>
          À relancer
        </button>
        <button className="btn btn-sm btn-ghost ml-auto" disabled={busy} onClick={() => setStep("")}>
          Annuler
        </button>
      </div>

      {step === "follow-up" && (
        <div className="flex flex-col gap-2">
          <HeatPicker value={heat} onChange={setHeat} />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] dim">Le relancer le</span>
            <input type="date" className="input !h-[32px] !w-auto" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
          </div>
        </div>
      )}
      {step === "not-closed" && (
        <select className="select !h-[32px] !w-auto" value={reason} onChange={(e) => setReason(e.target.value)}>
          {LOST_REASONS.map((r) => (
            <option key={r} value={r}>
              {label(r)}
            </option>
          ))}
        </select>
      )}
      {(step === "follow-up" || step === "not-closed") && (
        <>
          <textarea
            className="textarea w-full"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={step === "follow-up" ? "Ce qu'il a dit : « je reçois ma paie le 5 », « je dois en parler à ma femme »…" : "Pourquoi (optionnel)"}
          />
          <div className="flex justify-end">
            <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void send(step)}>
              {busy ? <span className="spinner" /> : step === "follow-up" ? "Noter la relance" : "Valider"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Accueil setter : les calls passés pas encore statués (60 derniers jours).
 * Mady dit « le call est fini », le setter pose le résultat ici.
 */
export function CallsToSettleCard({ onOpen }: { onOpen: (appointmentId: string) => void }) {
  const { version, bump } = useSales();
  const from = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
  const to = parisDay(0);
  const { data, reload } = useSalesData<{ rows: AppointmentRow[] }>(`/api/sales/appointments?period=custom&from=${from}&to=${to}&limit=500&v=${version}`, { every: 120_000 });
  const now = new Date().toISOString();
  const rows = (data?.rows ?? [])
    .filter((r) => (r.status === "booked" || r.status === "confirmed") && r.scheduledAt < now)
    .sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt));

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          Calls à statuer
          {rows.length > 0 && <span className="badge !text-[10.5px] !py-0 num" style={{ color: "#f97316", borderColor: "#f97316" }}>{rows.length}</span>}
        </span>
      }
      subtitle="Dès que Mady te dit que le call est fini : show ou no-show, puis closé, pas closé ou à relancer (avec la chaleur)."
      padded={false}
    >
      {!rows.length ? (
        <Empty>Tous les calls passés sont statués. 👌</Empty>
      ) : (
        <ul>
          {rows.map((r, i) => (
            <li key={r.id} className="px-3.5 py-3 flex flex-col gap-2" style={{ borderBottom: i < rows.length - 1 ? "1px solid var(--border)" : "none" }}>
              <div className="flex items-baseline justify-between gap-2 flex-wrap">
                <button type="button" className="text-[13px] font-semibold link text-left" onClick={() => onOpen(r.id)} title="Ouvrir le rendez-vous">
                  {r.leadName}
                </button>
                <span className="num text-[11.5px] dim">
                  {fmtDualDateTime(r.scheduledAt)}
                  {r.closerName ? ` · ${r.closerName}` : ""}
                </span>
              </div>
              <SetterOutcomeBox
                appointmentId={r.id}
                onDone={() => {
                  void reload();
                  bump();
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
