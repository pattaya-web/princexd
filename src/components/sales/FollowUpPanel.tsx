"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import { fmtDateTime, fmtDualDateTime, label, relative } from "@/lib/format";
import { useToast } from "@/components/ui";
import { SlotPicker } from "./bits";
import type { FollowUp } from "@/lib/types";

/** Reports rapides : +1, +2, +3, +5 jours, +1 et +2 semaines. */
const QUICK: { label: string; days: number }[] = [
  { label: "+1 j", days: 1 },
  { label: "+2 j", days: 2 },
  { label: "+3 j", days: 3 },
  { label: "+5 j", days: 5 },
  { label: "+1 sem", days: 7 },
  { label: "+2 sem", days: 14 },
];

/** Meme heure, N jours plus tard (a partir d'aujourd'hui si la date est passee). */
function plusDays(from: string, days: number): string {
  const base = Date.parse(from) < Date.now() ? new Date() : new Date(from);
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  if (Date.parse(from) < Date.now()) {
    const src = new Date(from);
    d.setHours(src.getHours(), src.getMinutes(), 0, 0);
  }
  return d.toISOString();
}

const KIND_ICON = { contact: "✉", reschedule: "↻", note: "✎", status: "✓" } as const;

/**
 * Les relances d'un rendez-vous, modifiables : date (report rapide ou
 * libre), notes, journal « j'ai relancé », cloture, nouvelle relance. Tout
 * ce qui est fait est trace dans le journal de la relance.
 */
export function FollowUpPanel({ appointmentId, followUps, canEdit, onChanged }: { appointmentId: string; followUps: FollowUp[]; canEdit: boolean; onChanged: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [slot, setSlot] = useState("");
  const [notes, setNotes] = useState("");
  const [msg, setMsg] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [newAt, setNewAt] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [showClosed, setShowClosed] = useState(false);

  const patch = async (id: string, body: Record<string, unknown>, ok: string) => {
    setBusy(id);
    try {
      await api(`/api/sales/followups/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      toast(ok);
      onChanged();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy("");
    }
  };

  const sequence = async () => {
    setBusy("seq");
    try {
      await api("/api/sales/followups", { method: "POST", body: JSON.stringify({ appointmentId, sequence: true }) });
      toast("Séquence lancée : relance demain (J+1). Sans réponse, la dernière suivra à J+3.");
      onChanged();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy("");
    }
  };

  const noReply = async (f: FollowUp) => {
    const last = f.step === 2;
    if (last && !window.confirm("Dernière relance sans réponse : le lead passe en « froid » et le rendez-vous est classé perdu. Il reste consultable pour le tri. Confirmer ?")) return;
    setBusy(f.id);
    try {
      const r = await api<{ next: FollowUp | null; cold: boolean }>(`/api/sales/followups/${f.id}/no-reply`, { method: "POST" });
      toast(r.cold ? "Lead classé froid. Plus de relance programmée." : `Pas de réponse noté. Dernière relance le ${fmtDualDateTime(r.next!.dueAt)}.`);
      onChanged();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy("");
    }
  };

  const create = async () => {
    if (!newAt) return toast("Choisis la date de la relance.", "err");
    setBusy("new");
    try {
      await api("/api/sales/followups", { method: "POST", body: JSON.stringify({ appointmentId, dueAt: newAt, notes: newNotes.trim() }) });
      toast(`Relance programmée : ${fmtDualDateTime(newAt)}.`);
      setAdding(false);
      setNewAt("");
      setNewNotes("");
      onChanged();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy("");
    }
  };

  const pending = followUps.filter((f) => f.status === "pending").sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const closed = followUps.filter((f) => f.status !== "pending").sort((a, b) => b.dueAt.localeCompare(a.dueAt));
  const list = showClosed ? [...pending, ...closed] : pending;

  return (
    <div>
      <div className="label-xs mb-1.5 flex items-center justify-between">
        <span>
          Relances {pending.length ? <span className="num">({pending.length} à faire)</span> : null}
        </span>
        <span className="flex items-center gap-2 normal-case tracking-normal">
          {closed.length > 0 && (
            <button type="button" className="link text-[11.5px]" onClick={() => setShowClosed((v) => !v)}>
              {showClosed ? "masquer les clôturées" : `${closed.length} clôturée${closed.length > 1 ? "s" : ""}`}
            </button>
          )}
          {canEdit && !adding && pending.length === 0 && (
            <button type="button" className="btn btn-sm btn-primary !h-[24px] !text-[11.5px]" onClick={() => void sequence()} disabled={busy === "seq"} title="Relance 1 demain, dernière relance à J+3, puis lead froid">
              {busy === "seq" ? <span className="spinner" /> : "▶ Séquence J+1 / J+3"}
            </button>
          )}
          {canEdit && !adding && (
            <button
              type="button"
              className="btn btn-sm !h-[24px] !text-[11.5px]"
              onClick={() => {
                setAdding(true);
                setNewAt(plusDays(new Date().toISOString(), 2));
              }}
            >
              + Relance libre
            </button>
          )}
        </span>
      </div>

      {adding && (
        <div className="card-flat px-3 py-2.5 mb-2 flex flex-col gap-2">
          <div className="flex flex-wrap gap-1.5">
            {QUICK.map((q) => (
              <button key={q.days} type="button" className="btn btn-sm !h-[26px]" onClick={() => setNewAt(plusDays(new Date().toISOString(), q.days))}>
                {q.label}
              </button>
            ))}
          </div>
          <SlotPicker value={newAt} onChange={setNewAt} compact />
          <input className="input !h-[32px] !text-[12.5px]" value={newNotes} placeholder="Quoi relancer : « attend l'accord de son associé », « renvoyer le lien »…" onChange={(e) => setNewNotes(e.target.value)} />
          <div className="flex gap-1.5 justify-end">
            <button className="btn btn-sm" onClick={() => setAdding(false)} disabled={busy === "new"}>Annuler</button>
            <button className="btn btn-sm btn-primary" onClick={() => void create()} disabled={busy === "new" || !newAt}>
              {busy === "new" ? <span className="spinner" /> : "Programmer"}
            </button>
          </div>
        </div>
      )}

      {list.length === 0 && !adding && <div className="dim text-[12px]">Aucune relance en cours.</div>}

      <div className="flex flex-col gap-1.5">
        {list.map((f) => {
          const overdue = f.status === "pending" && Date.parse(f.dueAt) < Date.now();
          const isEditing = editing === f.id;
          const tone = f.status !== "pending" ? "var(--text-3)" : overdue ? "var(--critical)" : "var(--accent)";
          return (
            <div key={f.id} className="card-flat px-3 py-2.5" style={{ borderLeft: `3px solid ${tone}`, opacity: f.status !== "pending" ? 0.75 : 1 }}>
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="min-w-0">
                  <div className="text-[12.5px] font-semibold num" style={{ color: tone }}>
                    {fmtDualDateTime(f.dueAt)}
                    <span className="dim font-normal"> · {relative(f.dueAt)}</span>
                    {f.step === 1 && <span className="badge !text-[10px] !py-0 ml-2">Relance 1/2</span>}
                    {f.step === 2 && <span className="badge badge-warn !text-[10px] !py-0 ml-2">Dernière relance</span>}
                    {overdue && <span className="badge badge-danger !text-[10px] !py-0 ml-2">en retard</span>}
                    {f.status !== "pending" && <span className="badge !text-[10px] !py-0 ml-2">{label(f.status)}</span>}
                  </div>
                  {!isEditing && <div className="text-[12.5px] mt-0.5 whitespace-pre-wrap">{f.notes || <span className="dim">sans note</span>}</div>}
                  {f.lastContactAt && <div className="dim text-[11px] mt-0.5">Dernier contact : {fmtDateTime(f.lastContactAt)}</div>}
                </div>
                {canEdit && !isEditing && (
                  <div className="flex gap-1 shrink-0">
                    {f.status === "pending" && (
                      <button className="btn btn-sm !h-[24px] !text-[11.5px]" onClick={() => void patch(f.id, { status: "done" }, "Relance clôturée.")} disabled={busy === f.id} title="Le prospect a répondu / c'est réglé">
                        ✓ Faite
                      </button>
                    )}
                    {f.status === "pending" && (
                      <button className="btn btn-sm !h-[24px] !text-[11.5px]" style={{ color: "var(--critical)", borderColor: "color-mix(in srgb, var(--critical) 40%, transparent)" }} onClick={() => void noReply(f)} disabled={busy === f.id} title={f.step === 2 ? "Sans réponse : lead froid" : "Sans réponse : dernière relance à J+3"}>
                        ✗ Pas de réponse{f.step === 2 ? " → froid" : " → J+3"}
                      </button>
                    )}
                    <button
                      className="btn btn-ghost btn-sm !h-[24px] !text-[11.5px]"
                      onClick={() => {
                        setEditing(f.id);
                        setSlot(f.dueAt);
                        setNotes(f.notes);
                      }}
                    >
                      ✎ Modifier
                    </button>
                  </div>
                )}
              </div>

              {isEditing && (
                <div className="mt-2 flex flex-col gap-2">
                  <div className="flex flex-wrap gap-1.5 items-center">
                    <span className="dim text-[11px]">Reporter :</span>
                    {QUICK.map((q) => (
                      <button key={q.days} type="button" className="btn btn-sm !h-[26px]" onClick={() => setSlot(plusDays(f.dueAt, q.days))}>
                        {q.label}
                      </button>
                    ))}
                  </div>
                  <SlotPicker value={slot} onChange={setSlot} compact />
                  <textarea className="textarea !min-h-[60px] !text-[12.5px]" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes de la relance" />
                  <div className="flex gap-1.5 justify-between flex-wrap">
                    <span className="flex gap-1.5">
                      {f.status === "pending" ? (
                        <button className="btn btn-sm btn-ghost" onClick={() => void patch(f.id, { status: "cancelled" }, "Relance abandonnée.").then(() => setEditing(null))} disabled={busy === f.id}>
                          Abandonner
                        </button>
                      ) : (
                        <button className="btn btn-sm btn-ghost" onClick={() => void patch(f.id, { status: "pending" }, "Relance rouverte.").then(() => setEditing(null))} disabled={busy === f.id}>
                          Rouvrir
                        </button>
                      )}
                    </span>
                    <span className="flex gap-1.5">
                      <button className="btn btn-sm" onClick={() => setEditing(null)} disabled={busy === f.id}>Annuler</button>
                      <button
                        className="btn btn-sm btn-primary"
                        disabled={busy === f.id || !slot}
                        onClick={() => void patch(f.id, { dueAt: slot, notes }, slot !== f.dueAt ? `Relance reportée au ${fmtDualDateTime(slot)}.` : "Relance mise à jour.").then(() => setEditing(null))}
                      >
                        {busy === f.id ? <span className="spinner" /> : "Enregistrer"}
                      </button>
                    </span>
                  </div>
                </div>
              )}

              {/* Journal : ce qui a ete fait sur cette relance. */}
              {(f.log?.length ?? 0) > 0 && (
                <ul className="mt-2 flex flex-col gap-0.5">
                  {f.log!.slice(-6).map((e, i) => (
                    <li key={i} className="text-[11.5px] flex gap-2">
                      <span className="dim num shrink-0 w-[96px]">{fmtDateTime(e.at)}</span>
                      <span className="shrink-0" style={{ color: e.kind === "contact" ? "var(--good)" : "var(--text-3)" }}>{KIND_ICON[e.kind]}</span>
                      <span className="min-w-0" style={{ color: "var(--text-2)" }}>
                        {e.note} <span className="dim">— {e.actorName}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {canEdit && f.status === "pending" && !isEditing && (
                <form
                  className="mt-2 flex gap-1.5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const note = (msg[f.id] ?? "").trim();
                    void patch(f.id, { note: note || "Prospect relancé", contact: true }, "Relance notée.").then(() => setMsg((m) => ({ ...m, [f.id]: "" })));
                  }}
                >
                  <input className="input !h-[30px] !text-[12px] flex-1" value={msg[f.id] ?? ""} placeholder="J'ai relancé : « message WhatsApp envoyé », « vocal Instagram »…" onChange={(e) => setMsg((m) => ({ ...m, [f.id]: e.target.value }))} />
                  <button className="btn btn-sm !h-[30px]" type="submit" disabled={busy === f.id} title="Noter que tu as relancé le prospect maintenant">
                    ✉ J&apos;ai relancé
                  </button>
                </form>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
