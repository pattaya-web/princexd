"use client";

import { useState } from "react";
import type { TaskRow } from "@/lib/sales/ops/views";
import { Avatar, ContactButtons, PrioBadge, Pill, SETTING_OPTIONS, SnoozeMenu, useOpsAction, when } from "./shared";

type Panel = "" | "done" | "snooze" | "note" | "status" | "contacted";

/** Issues proposees pour terminer une tache, selon son type. */
function outcomesFor(kind: TaskRow["kind"]): { value: string; label: string; primary?: boolean; danger?: boolean }[] {
  switch (kind) {
    case "confirm-booking":
    case "confirm-j1":
    case "confirm-h3":
      return [
        { value: "confirmed", label: "✓ Confirmé par le prospect", primary: true },
        { value: "sent", label: "Message envoyé, pas encore de réponse" },
        { value: "no-answer", label: "Injoignable", danger: true },
      ];
    case "no-show":
      return [
        { value: "no-reply", label: "Tentative faite, pas de réponse", primary: true },
        { value: "replied", label: "Il a répondu" },
        { value: "lost", label: "Perdu", danger: true },
      ];
    case "followup":
      return [
        { value: "done", label: "✓ Relancé, il a répondu", primary: true },
        { value: "no-reply", label: "Relancé, pas de réponse" },
      ];
    case "payment":
      return [
        { value: "promised", label: "Paiement promis (date)", primary: true },
        { value: "link-sent", label: "Lien de paiement envoyé" },
        { value: "awaiting-verification", label: "Dit avoir payé → à vérifier" },
        { value: "failed", label: "Paiement échoué", danger: true },
        { value: "abandoned", label: "Abandonné", danger: true },
      ];
    default:
      return [
        { value: "contacted", label: "✓ Contacté", primary: true },
        { value: "replied", label: "Il a répondu" },
        { value: "no-reply", label: "Pas de réponse" },
      ];
  }
}

const CHANNELS = ["DM Instagram", "WhatsApp", "Appel", "SMS", "Email"];

export function TaskCard({
  task,
  today,
  selected,
  onOpenLead,
  onOpenSheet,
  onChanged,
  showOwner,
}: {
  task: TaskRow;
  today: string;
  selected?: boolean;
  onOpenLead: (leadId: string) => void;
  /** Fiche complete (statuer un call, encaisser) : le panneau historique du CRM. */
  onOpenSheet: (leadId: string) => void;
  onChanged: () => void;
  showOwner?: boolean;
}) {
  const [panel, setPanel] = useState<Panel>("");
  const [note, setNote] = useState("");
  const [channel, setChannel] = useState("");
  const [rescheduleAt, setRescheduleAt] = useState("");
  const [promisedFor, setPromisedFor] = useState("");
  const { run, busy } = useOpsAction(() => {
    setPanel("");
    setNote("");
    onChanged();
  });
  const sheetOnly = task.sheetOnly;

  const done = (outcome: string) =>
    run({ type: "task.done", taskId: task.id, expectedUpdatedAt: task.updatedAt, outcome, note, channel, at: promisedFor });

  return (
    <article
      className="card px-3.5 py-3 transition-shadow"
      style={{ outline: selected ? "2px solid var(--accent-ring)" : "none", borderLeft: `3px solid ${task.overdue ? "var(--critical)" : "transparent"}` }}
      data-task={task.id}
    >
      <div className="flex items-start gap-3">
        <button type="button" onClick={() => onOpenLead(task.leadId)} title="Ouvrir la fiche 360°">
          <Avatar initials={task.initials} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <PrioBadge p={task.priority} />
            <span className="mono text-[12px] num" style={{ color: task.overdue ? "var(--critical)" : "var(--text-2)" }}>
              {when(task.dueAt, today)}
            </span>
            <Pill tone="info">{task.kindLabel}</Pill>
            {task.source && <Pill>{task.source}</Pill>}
            {task.overdue && <Pill tone="bad">En retard</Pill>}
            {task.snoozed && <Pill tone="warn">Reportée</Pill>}
            {showOwner && <span className="dim text-[11.5px]">· {task.ownerName}</span>}
          </div>
          <button type="button" className="block text-left mt-1 text-[14.5px] font-semibold hover:underline" onClick={() => onOpenLead(task.leadId)}>
            {task.title}
          </button>
          <p className="muted text-[12.5px] mt-0.5 leading-relaxed">{task.context}</p>
          {task.lastExchange && (
            <p className="dim text-[11.5px] mt-1">
              Dernier échange · {when(task.lastExchange.at, today)} : {task.lastExchange.text}
            </p>
          )}
          {task.notes.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {task.notes.slice(-2).map((n, i) => (
                <li key={i} className="dim text-[11.5px]">
                  📝 {n.by} : {n.text}
                </li>
              ))}
            </ul>
          )}

          {/* Actions rapides */}
          <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
            {sheetOnly ? (
              <button type="button" className="btn btn-sm btn-primary" onClick={() => onOpenSheet(task.leadId)}>
                {task.kind === "outcome-missing" ? "Renseigner le résultat" : task.kind === "payment" ? "Préciser le paiement" : "Vérifier et encaisser"}
              </button>
            ) : (
              <>
                <ContactButtons
                  contact={task.contact}
                  onOpened={(c) => {
                    setChannel(c);
                    setPanel("contacted");
                  }}
                />
                <button type="button" className={`btn btn-sm ${panel === "done" ? "btn-primary" : ""}`} onClick={() => setPanel(panel === "done" ? "" : "done")}>
                  Terminer
                </button>
              </>
            )}
            {task.kind === "outcome-missing" && task.appointmentId && (
              <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void run({ type: "appointment", appointmentId: task.appointmentId, op: "no-show" }, "No-show noté : la récupération démarre.")}>
                Absent (no-show)
              </button>
            )}
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPanel(panel === "snooze" ? "" : "snooze")}>
              Reporter
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPanel(panel === "note" ? "" : "note")}>
              Note
            </button>
            {!sheetOnly && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPanel(panel === "status" ? "" : "status")}>
                Statut
              </button>
            )}
            <button type="button" className="btn btn-sm btn-ghost ml-auto" onClick={() => onOpenLead(task.leadId)}>
              Ouvrir →
            </button>
          </div>

          {/* Lien ouvert : on demande, on ne suppose pas. */}
          {panel === "contacted" && (
            <div className="mt-2 rounded-lg p-2.5 flex flex-wrap items-center gap-1.5" style={{ background: "var(--surface-3)" }}>
              <span className="text-[12.5px] font-medium mr-1">{channel} ouvert : c'est fait ?</span>
              {outcomesFor(task.kind).map((o) => (
                <button key={o.value} type="button" className={`btn btn-sm ${o.primary ? "btn-primary" : ""}`} style={o.danger ? { color: "var(--critical)" } : undefined} disabled={busy} onClick={() => void done(o.value)}>
                  {o.label}
                </button>
              ))}
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPanel("")}>
                Pas encore
              </button>
            </div>
          )}

          {panel === "done" && (
            <div className="mt-2 rounded-lg p-2.5 space-y-2" style={{ background: "var(--surface-3)" }}>
              <div className="flex flex-wrap gap-1">
                {CHANNELS.map((c) => (
                  <button key={c} type="button" className={`btn btn-sm ${channel === c ? "btn-primary" : ""}`} onClick={() => setChannel(channel === c ? "" : c)}>
                    {c}
                  </button>
                ))}
              </div>
              <input className="input !h-[32px] text-[12.5px]" placeholder="Ce qu'il a dit, ce qui a été fait (optionnel)" value={note} onChange={(e) => setNote(e.target.value)} />
              {task.kind === "payment" && (
                <label className="flex items-center gap-1.5 text-[12px] muted">
                  Promis pour le
                  <input type="date" className="input !h-[28px] !w-auto text-[12px]" value={promisedFor} onChange={(e) => setPromisedFor(e.target.value)} />
                  <span className="dim">(la prochaine relance tombera ce jour-là)</span>
                </label>
              )}
              <div className="flex flex-wrap gap-1.5">
                {outcomesFor(task.kind).map((o) => (
                  <button key={o.value} type="button" className={`btn btn-sm ${o.primary ? "btn-primary" : ""}`} style={o.danger ? { color: "var(--critical)" } : undefined} disabled={busy} onClick={() => void done(o.value)}>
                    {o.label}
                  </button>
                ))}
              </div>
              {task.kind === "no-show" && task.appointmentId && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1" style={{ borderTop: "1px solid var(--border)" }}>
                  <span className="text-[12px] muted">Reprogrammé le</span>
                  <input type="datetime-local" className="input !h-[28px] !w-auto text-[12px]" value={rescheduleAt} onChange={(e) => setRescheduleAt(e.target.value)} />
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    disabled={busy || !rescheduleAt}
                    onClick={async () => {
                      const { parisToIso } = await import("@/lib/format");
                      void run({ type: "appointment", appointmentId: task.appointmentId, op: "reschedule", at: parisToIso(rescheduleAt) }, "Call reprogrammé : nouvelles confirmations créées.");
                    }}
                  >
                    Reprogrammer
                  </button>
                </div>
              )}
            </div>
          )}

          {panel === "snooze" && (
            <div className="mt-2 rounded-lg p-2.5" style={{ background: "var(--surface-3)" }}>
              <SnoozeMenu busy={busy} onPick={(iso) => void run({ type: "task.snooze", taskId: task.id, until: iso, note, expectedUpdatedAt: task.updatedAt }, "Tâche reportée : elle ne compte plus pour aujourd'hui.")} />
            </div>
          )}

          {panel === "note" && (
            <div className="mt-2 rounded-lg p-2.5 flex gap-1.5" style={{ background: "var(--surface-3)" }}>
              <input className="input !h-[32px] text-[12.5px] flex-1" autoFocus placeholder="Note visible sur la fiche du lead" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === "Enter" && note.trim() && void run({ type: "task.note", taskId: task.id, text: note }, "Note ajoutée.")} />
              <button type="button" className="btn btn-sm btn-primary" disabled={busy || !note.trim()} onClick={() => void run({ type: "task.note", taskId: task.id, text: note }, "Note ajoutée.")}>
                Ajouter
              </button>
            </div>
          )}

          {panel === "status" && (
            <div className="mt-2 rounded-lg p-2.5 flex flex-wrap gap-1" style={{ background: "var(--surface-3)" }}>
              {SETTING_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  className="btn btn-sm"
                  disabled={busy}
                  onClick={() => {
                    const reason = o.value === "lost" || o.value === "not-qualified" ? (window.prompt("Raison (optionnel)") ?? "") : "";
                    void run({ type: "lead", op: "status", leadId: task.leadId, settingStatus: o.value, reason }, `Statut : ${o.label}`);
                  }}
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
