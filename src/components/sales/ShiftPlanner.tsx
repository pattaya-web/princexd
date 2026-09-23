"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import { fmtInt } from "@/lib/format";
import { useSalesData } from "@/lib/sales/client";
import { Empty, Field, InfoNote, Modal, Spinner, useToast } from "@/components/ui";
import type { ShiftRow } from "@/app/api/sales/shifts/route";

/** Prochain jour ouvre, pour ne pas proposer un creneau deja passe. */
function tomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Planning d'un membre.
 *
 * L'admin propose des creneaux ; le membre les accepte depuis son accueil.
 * Chaque creneau porte un objectif de rendez-vous, ce qui rend le rendement
 * comparable : trois heures a 2 rendez-vous ne se juge pas comme huit heures
 * a 12.
 */
export function ShiftPlanner({
  memberId,
  memberName,
  open,
  onClose,
}: {
  memberId: string;
  memberName: string;
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const [date, setDate] = useState(tomorrow());
  const [from, setFrom] = useState("09:00");
  const [to, setTo] = useState("13:00");
  const [goal, setGoal] = useState("3");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const { data, loading, reload } = useSalesData<{ rows: ShiftRow[] }>(
    open && memberId ? `/api/sales/shifts?memberId=${memberId}` : null,
  );

  const add = async () => {
    if (!date || !from || !to) return toast("Renseigne la date et les horaires.", "err");
    setSaving(true);
    try {
      await api("/api/sales/shifts", {
        method: "POST",
        body: JSON.stringify({
          memberId,
          // Saisi dans l'heure locale, converti en ISO : la base ne stocke
          // que de l'UTC, comme partout ailleurs dans le module.
          startAt: new Date(`${date}T${from}`).toISOString(),
          endAt: new Date(`${date}T${to}`).toISOString(),
          goal: Number(goal) || 0,
          note,
        }),
      });
      toast("Créneau proposé.");
      setNote("");
      void reload();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setSaving(false);
    }
  };

  const rows = data?.rows ?? [];
  const upcoming = rows.filter((s) => s.endAt >= new Date().toISOString());
  const past = rows.filter((s) => s.endAt < new Date().toISOString()).slice(-6).reverse();

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={`Planning — ${memberName}`}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Fermer
          </button>
          <button className="btn btn-primary" onClick={() => void add()} disabled={saving}>
            {saving ? <span className="spinner" /> : "Proposer ce créneau"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid sm:grid-cols-4 gap-3">
          <Field label="Date">
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="De">
            <input className="input" type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="À">
            <input className="input" type="time" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <Field label="Objectif de rdv">
            <input
              className="input num"
              type="number"
              min={0}
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
            />
          </Field>
          <Field label="Consigne" className="sm:col-span-4">
            <input
              className="input"
              value={note}
              placeholder="Prospection DM sur les comptes qui ont commenté le dernier reel"
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
        </div>

        <InfoNote>
          Le créneau part en « proposé ». {memberName} le voit sur son accueil et l&apos;accepte ou le
          décline — tu sais donc qui a confirmé sa journée avant qu&apos;elle commence.
        </InfoNote>

        {loading && !data ? (
          <Spinner label="Chargement…" />
        ) : (
          <>
            <div>
              <div className="label-xs mb-1.5">À venir</div>
              {!upcoming.length ? (
                <Empty>Aucun créneau programmé.</Empty>
              ) : (
                <ShiftTable rows={upcoming} />
              )}
            </div>

            {past.length > 0 && (
              <div>
                <div className="label-xs mb-1.5">Derniers créneaux tenus</div>
                <ShiftTable rows={past} showYield />
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

/** Tableau de créneaux. `showYield` ajoute le rendement réel de l'heure. */
function ShiftTable({ rows, showYield = false }: { rows: ShiftRow[]; showYield?: boolean }) {
  return (
    <div className="scroll-x">
      <table className="table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Horaires</th>
            <th className="text-right">Objectif</th>
            <th className="text-right">Posés</th>
            {showYield && <th className="text-right">Par heure</th>}
            <th>Statut</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const start = new Date(s.startAt);
            const end = new Date(s.endAt);
            const hours = (end.getTime() - start.getTime()) / 3_600_000;
            const time = (d: Date) =>
              d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
            return (
              <tr key={s.id}>
                <td className="num">
                  {start.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })}
                </td>
                <td className="num">
                  {time(start)} → {time(end)}
                  <span className="dim ml-1.5 text-[11px]">{Math.round(hours * 10) / 10} h</span>
                </td>
                <td className="text-right num">{s.goal || <span className="dim">—</span>}</td>
                <td className="text-right num">{fmtInt(s.booked)}</td>
                {showYield && (
                  <td className="text-right num">
                    {hours > 0 ? (s.booked / hours).toFixed(1).replace(".", ",") : "—"}
                  </td>
                )}
                <td>
                  <span
                    className={`badge !text-[10.5px] !py-0 ${
                      s.status === "accepted" || s.status === "done"
                        ? "badge-good"
                        : s.status === "declined"
                          ? "badge-danger"
                          : "badge-accent"
                    }`}
                  >
                    {s.status === "accepted"
                      ? "Accepté"
                      : s.status === "declined"
                        ? "Décliné"
                        : s.status === "done"
                          ? "Tenu"
                          : "Proposé"}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
