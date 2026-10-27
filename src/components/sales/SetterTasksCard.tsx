"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { fmtDate, parisDay } from "@/lib/format";
import { useSalesData } from "@/lib/sales/client";
import { hasRole, sessionHas } from "@/lib/sales/roles";
import { Card, Empty, Field, Modal, useToast } from "@/components/ui";
import { useSales } from "./context";
import type { SetterTaskRow } from "@/app/api/sales/setter-tasks/route";

/* ----------------------------- Envoyer une relance ----------------------------- */

export interface SendToSetterPrefill {
  leadId?: string;
  name?: string;
  phone?: string;
  igUsername?: string;
}

/**
 * L'admin envoie une relance a un setter : qui, a rappeler ou a ecrire,
 * quel jour, et le contexte. Elle atterrit sur l'accueil du setter (et sur
 * Telegram s'il est relie).
 */
export function SendToSetterModal({ open, prefill, self, onClose, onSent }: { open: boolean; prefill?: SendToSetterPrefill; /** Le setter se pose la relance a lui-meme : pseudo Instagram obligatoire, pas de choix de setter. */ self?: boolean; onClose: () => void; onSent?: () => void }) {
  const { members } = useSales();
  const toast = useToast();
  const setters = members.filter((m) => hasRole(m, "setter") && m.status !== "inactif");
  const [setterId, setSetterId] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [ig, setIg] = useState("");
  const [kind, setKind] = useState<"call" | "message">("message");
  const [dueOn, setDueOn] = useState(parisDay(0));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(prefill?.name ?? "");
    setPhone(prefill?.phone ?? "");
    setIg(prefill?.igUsername ?? "");
    setNote("");
    setDueOn(parisDay(0));
    if (!setterId && setters.length) setSetterId(setters.find((s) => s.name !== "Mady (moi)")?.id ?? setters[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const send = async () => {
    setBusy(true);
    try {
      await api("/api/sales/setter-tasks", { method: "POST", body: JSON.stringify({ setterId, leadId: prefill?.leadId ?? "", name, phone, igUsername: ig, kind, dueOn, note }) });
      toast(self ? `Relance notée pour le ${fmtDate(`${dueOn}T12:00:00Z`)}.` : `Relance envoyée à ${setters.find((s) => s.id === setterId)?.name ?? "ton setter"}.`);
      onSent?.();
      onClose();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={self ? "Nouvelle relance" : "Envoyer une relance à un setter"}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Annuler
          </button>
          <button className="btn btn-primary" onClick={() => void send()} disabled={busy || (!self && (!setterId || !name.trim())) || (self && !ig.trim()) || !note.trim()}>
            {busy ? <span className="spinner" /> : self ? "Noter la relance" : "Envoyer"}
          </button>
        </>
      }
    >
      <div className="grid sm:grid-cols-2 gap-3">
        {self ? (
          <Field label="Instagram du prospect" hint="Son @, c'est la clé : c'est comme ça que tu le retrouves.">
            <input className="input" value={ig} onChange={(e) => setIg(e.target.value)} placeholder="pseudo sans @" autoFocus />
          </Field>
        ) : (
          <Field label="Setter">
            <select className="select" value={setterId} onChange={(e) => setSetterId(e.target.value)}>
              {setters.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Quoi faire">
          <select className="select" value={kind} onChange={(e) => setKind(e.target.value as "call" | "message")}>
            <option value="message">Envoyer un message</option>
            <option value="call">Rappeler</option>
          </select>
        </Field>
        <Field label={self ? "Prénom / nom · optionnel" : "Prospect"}>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Prénom Nom" />
        </Field>
        <Field label="Quel jour">
          <input className="input" type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
        </Field>
        <Field label="Téléphone · optionnel">
          <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+33 6…" />
        </Field>
        {!self && (
          <Field label="Instagram">
            <input className="input" value={ig} onChange={(e) => setIg(e.target.value)} placeholder="pseudo sans @" />
          </Field>
        )}
        <Field label="Note" className="sm:col-span-2" hint={self ? "Où il en est, pourquoi il attend, quoi lui proposer." : "Ce que tu lui as dit, pourquoi relancer, ce qu'il faut proposer."}>
          <textarea className="textarea w-full" rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder={self ? "Il a 1 800 €, il attend son salaire dans une semaine : lui renvoyer le lien du calendrier." : "Je lui ai parlé hier en DM, intéressé mais attend sa paie le 5 : lui renvoyer le lien du calendrier ce jour-là."} />
        </Field>
      </div>
    </Modal>
  );
}

/* ----------------------------- Liste admin (Pilotage) ----------------------------- */

function TaskLine({ t, canDo, onDone, onDelete, showSetter }: { t: SetterTaskRow; canDo: boolean; onDone: (t: SetterTaskRow, done: boolean) => void; onDelete?: (t: SetterTaskRow) => void; showSetter?: boolean }) {
  const toast = useToast();
  const copy = async (v: string) => {
    try {
      await navigator.clipboard.writeText(v);
      toast("Copié.");
    } catch {
      toast("Copie impossible ici.", "err");
    }
  };
  const tone = t.status === "done" ? "var(--text-3)" : t.overdue ? "var(--critical)" : t.today ? "#f97316" : "var(--text-2)";
  return (
    <li className="px-3.5 py-2.5 flex items-start gap-3" style={{ borderBottom: "1px solid var(--border)", opacity: t.status === "done" ? 0.6 : 1 }}>
      <span className="num text-[11.5px] shrink-0 w-[72px] pt-[2px] font-semibold" style={{ color: tone }}>
        {t.overdue ? "En retard" : t.today ? "Aujourd'hui" : fmtDate(`${t.dueOn}T12:00:00Z`)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[13px] font-semibold">{t.name}</span>
          <span className="badge !text-[10.5px] !py-0">{t.kind === "call" ? "☏ à rappeler" : "✉ à écrire"}</span>
          {t.phone && (
            <button type="button" className="link num text-[12px]" onClick={() => void copy(t.phone)} title="Copier le numéro">
              {t.phone}
            </button>
          )}
          {t.igUsername && <span className="dim text-[12px]">@{t.igUsername}</span>}
          {showSetter && t.setterName && <span className="dim text-[11.5px]">→ {t.setterName}</span>}
        </div>
        <div className="text-[12.5px] leading-snug mt-0.5 whitespace-pre-wrap">{t.note}</div>
        <div className="dim text-[10.5px] mt-0.5">
          de {t.createdBy} · {fmtDate(t.createdAt)}
          {t.status === "done" && t.doneAt ? ` · fait le ${fmtDate(t.doneAt)}` : ""}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {canDo && (
          <button className={`btn btn-sm !h-[28px] ${t.status === "done" ? "btn-ghost" : "btn-primary"}`} onClick={() => onDone(t, t.status !== "done")}>
            {t.status === "done" ? "Rouvrir" : "✓ Fait"}
          </button>
        )}
        {onDelete && (
          <button className="btn btn-ghost btn-sm !h-[28px]" style={{ color: "var(--critical)" }} onClick={() => onDelete(t)} title="Supprimer">
            ✕
          </button>
        )}
      </div>
    </li>
  );
}

/** Pilotage (admin) : envoyer une relance, et voir celles en cours chez chaque setter. */
export function SetterTasksAdminCard() {
  const { version, bump } = useSales();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const { data, reload } = useSalesData<{ rows: SetterTaskRow[] }>(`/api/sales/setter-tasks?done=1&v=${version}`);
  const rows = data?.rows ?? [];
  const openRows = rows.filter((r) => r.status === "open");

  const done = async (t: SetterTaskRow, d: boolean) => {
    try {
      await api("/api/sales/setter-tasks", { method: "PATCH", body: JSON.stringify({ id: t.id, done: d }) });
      void reload();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  const remove = async (t: SetterTaskRow) => {
    if (!window.confirm(`Supprimer la relance « ${t.name} » ?`)) return;
    try {
      await api("/api/sales/setter-tasks", { method: "DELETE", body: JSON.stringify({ id: t.id }) });
      void reload();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  return (
    <>
      <Card
        title="Relances envoyées aux setters"
        subtitle={openRows.length ? `${openRows.length} en cours · elles s'affichent sur l'accueil du setter jusqu'à ce qu'il les marque faites.` : "Un prospect à qui tu as parlé, à relancer tel jour : envoie-le à ton setter, il le verra en se connectant."}
        padded={false}
        actions={
          <button className="btn btn-sm btn-primary" onClick={() => setOpen(true)}>
            + Envoyer une relance
          </button>
        }
      >
        {rows.length === 0 ? (
          <Empty>Aucune relance envoyée.</Empty>
        ) : (
          <ul>
            {rows.slice(0, 40).map((t) => (
              <TaskLine key={t.id} t={t} canDo onDone={done} onDelete={remove} showSetter />
            ))}
          </ul>
        )}
      </Card>
      <SendToSetterModal
        open={open}
        onClose={() => setOpen(false)}
        onSent={() => {
          void reload();
          bump();
        }}
      />
    </>
  );
}

/** Accueil du setter : ses relances (celles qu'il se pose, celles que Mady lui envoie). */
export function SetterTasksMemberCard() {
  const { version, bump } = useSales();
  const toast = useToast();
  const { data, reload } = useSalesData<{ rows: SetterTaskRow[] }>(`/api/sales/setter-tasks?done=1&v=${version}`, { every: 60_000 });
  const rows = data?.rows ?? [];
  const openRows = rows.filter((r) => r.status === "open");
  const doneRows = rows.filter((r) => r.status === "done").slice(0, 5);
  const [showDone, setShowDone] = useState(false);
  const [adding, setAdding] = useState(false);

  const done = async (t: SetterTaskRow, d: boolean) => {
    try {
      await api("/api/sales/setter-tasks", { method: "PATCH", body: JSON.stringify({ id: t.id, done: d }) });
      toast(d ? "Relance faite." : "Relance rouverte.");
      void reload();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  return (
    <>
      <Card
        title={
          <span className="flex items-center gap-2">
            Relances
            {openRows.length > 0 && <span className="badge badge-accent !text-[10.5px] !py-0 num">{openRows.length}</span>}
          </span>
        }
        subtitle="Un prospect qui te dit « reviens dans une semaine » : note son @, la date, pourquoi. Le jour venu, il est ici et en pop-up. Celles que Mady t'envoie arrivent au même endroit."
        padded={false}
        actions={
          <>
            {doneRows.length > 0 && (
              <button className="btn btn-sm btn-ghost" onClick={() => setShowDone((v) => !v)}>
                {showDone ? "Masquer les faites" : `Faites (${doneRows.length})`}
              </button>
            )}
            <button className="btn btn-sm btn-primary" onClick={() => setAdding(true)}>
              + Relance
            </button>
          </>
        }
      >
        {openRows.length === 0 && !showDone ? (
          <Empty>Rien en attente. Tu es à jour.</Empty>
        ) : (
          <ul>
            {openRows.map((t) => (
              <TaskLine key={t.id} t={t} canDo onDone={done} />
            ))}
            {showDone && doneRows.map((t) => <TaskLine key={t.id} t={t} canDo onDone={done} />)}
          </ul>
        )}
      </Card>
      <SendToSetterModal
        open={adding}
        self
        onClose={() => setAdding(false)}
        onSent={() => {
          void reload();
          bump();
        }}
      />
    </>
  );
}

/* ----------------------------- Pop-up de rappel ----------------------------- */

/**
 * En bas a droite de n'importe quelle page de l'espace Sales : les relances
 * du jour (et en retard) du setter, qu'il les ait posees lui-meme ou que
 * Mady les lui ait envoyees. « Plus tard » le replie pour la session ; il
 * revient si une nouvelle relance arrive.
 */
export function ReminderPopup() {
  const { session, version } = useSales();
  const toast = useToast();
  const isSetter = !session.isAdmin && sessionHas(session, "setter");
  const { data, reload } = useSalesData<{ rows: SetterTaskRow[]; today: string }>(isSetter ? `/api/sales/setter-tasks?v=${version}` : null, { every: 5 * 60_000 });
  const [hidden, setHidden] = useState<string>("");
  const due = (data?.rows ?? []).filter((t) => t.status === "open" && (t.today || t.overdue));
  const key = `${data?.today ?? ""}:${due.map((t) => t.id).join(",")}`;
  useEffect(() => {
    try {
      setHidden(sessionStorage.getItem("sales.reminders.hidden") ?? "");
    } catch {
      // sans stockage : le pop-up reste visible
    }
  }, []);
  const done = async (t: SetterTaskRow) => {
    try {
      await api("/api/sales/setter-tasks", { method: "PATCH", body: JSON.stringify({ id: t.id, done: true }) });
      toast(`${t.name} : relance faite.`);
      void reload();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  if (!isSetter || !due.length || hidden === key) return null;
  return (
    <div className="fixed bottom-4 right-4 z-40 w-[340px] max-w-[calc(100vw-32px)] card p-3.5" style={{ boxShadow: "var(--shadow-lg)", borderColor: "#f97316" }}>
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <div className="text-[13px] font-semibold">
          📌 Aujourd&apos;hui, {due.length} relance{due.length > 1 ? "s" : ""} à faire
        </div>
        <button
          type="button"
          className="dim text-[11.5px]"
          onClick={() => {
            setHidden(key);
            try {
              sessionStorage.setItem("sales.reminders.hidden", key);
            } catch {
              // sans importance
            }
          }}
        >
          Plus tard
        </button>
      </div>
      <ul className="flex flex-col gap-1.5">
        {due.slice(0, 4).map((t) => (
          <li key={t.id} className="flex items-start gap-2 text-[12.5px]">
            <span className="min-w-0 flex-1">
              <span className="font-semibold">{t.igUsername ? `@${t.igUsername}` : t.name}</span>
              {t.igUsername && t.name && !t.name.startsWith("@") ? <span className="dim"> · {t.name}</span> : null}
              <span className="dim"> · {t.kind === "call" ? "rappeler" : "écrire"}{t.overdue ? " · en retard" : ""}</span>
              <span className="block dim leading-snug truncate" title={t.note}>
                {t.note}
              </span>
            </span>
            <button className="btn btn-sm btn-primary !h-[24px] !px-2 !text-[11px] shrink-0" onClick={() => void done(t)}>
              Fait
            </button>
          </li>
        ))}
        {due.length > 4 && <li className="dim text-[11.5px]">… et {due.length - 4} de plus sur ton accueil.</li>}
      </ul>
    </div>
  );
}
