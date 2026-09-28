"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/client";
import { fmtDateTime, relative } from "@/lib/format";
import { useSalesData } from "@/lib/sales/client";
import { hasRole } from "@/lib/sales/roles";
import { Card, Empty, ErrorNote, Field, Modal, PageHeader, Spinner, StatTile, useToast } from "@/components/ui";
import { useSales } from "@/components/sales/context";
import type { CallBucket, CallLeadRow } from "@/app/api/sales/leads/route";
import type { PublicMember } from "@/lib/sales/repo";
import type { LeadCallStatus } from "@/lib/types";

/** Groupes, dans l'ordre de traitement : ce qu'il faut faire maintenant en haut. */
const BUCKETS: { key: CallBucket; title: string; hint: string; tone: string }[] = [
  { key: "due", title: "Rappels à passer maintenant", hint: "Ils ont demandé à être rappelés, l'heure est passée.", tone: "var(--critical)" },
  { key: "new", title: "Nouveaux, jamais appelés", hint: "Le plus récent en premier : il vient de s'inscrire, il est chaud.", tone: "var(--accent)" },
  { key: "retry", title: "À retenter", hint: "Pas de réponse ou message laissé. Le plus ancien essai en premier.", tone: "var(--warning)" },
  { key: "later", title: "Rappels prévus", hint: "Ils ont donné un créneau, ne pas appeler avant.", tone: "var(--text-2)" },
  { key: "talking", title: "Joints, rendez-vous à fixer", hint: "Tu les as eus au téléphone : il manque la date du call.", tone: "var(--good)" },
  { key: "booked", title: "Call de vente pris", hint: "Rendez-vous enregistré, le closer prend le relais.", tone: "var(--emerald)" },
];

const STATUS_LABEL: Record<LeadCallStatus, string> = {
  "no-answer": "Ne répond pas",
  "message-sent": "Message envoyé",
  callback: "Demande à être rappelé",
  reached: "Appelé, joint",
  "not-interested": "Pas intéressé",
};

const COUNTRY: Record<string, string> = { FR: "France", BE: "Belgique", CH: "Suisse", CA: "Canada", AE: "Émirats", MA: "Maroc", DZ: "Algérie", TN: "Tunisie", LU: "Luxembourg" };

/** Heure locale du prospect approximee par son pays : appeler un Canadien a 9 h de Paris, c'est 3 h chez lui. */
function localHint(country?: string): string {
  const tz: Record<string, string> = { CA: "America/Toronto", AE: "Asia/Dubai", MA: "Africa/Casablanca", DZ: "Africa/Algiers", TN: "Africa/Tunis", CH: "Europe/Zurich", BE: "Europe/Brussels", LU: "Europe/Luxembourg", FR: "Europe/Paris" };
  const zone = country ? tz[country] : "";
  if (!zone || zone === "Europe/Paris") return "";
  try {
    return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: zone }).format(new Date());
  } catch {
    return "";
  }
}

/** Valeur d'un <input type="datetime-local"> pour une heure locale donnee. */
function localInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Les prospects de la landing page (Systeme.io), a appeler dans l'ordre.
 *
 * La liste se resynchronise a chaque ouverture (au plus toutes les trois
 * minutes), ne montre que ce qui reste a faire, dans l'ordre ou il faut le
 * faire, et chaque ligne se statue en un clic : ne repond pas, message
 * envoye, a rappeler a telle heure, joint, pas interesse, rendez-vous pris.
 */
export default function CallLeadsPage() {
  const { session, members, version, bump } = useSales();
  const toast = useToast();
  const [booking, setBooking] = useState<CallLeadRow | null>(null);
  const [callbackFor, setCallbackFor] = useState<CallLeadRow | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [busy, setBusy] = useState("");

  const setters = useMemo(() => members.filter((m) => hasRole(m, "setter") && m.status !== "inactif"), [members]);

  const { data, loading, error, reload } = useSalesData<{
    rows: CallLeadRow[];
    counts: Record<CallBucket, number> & { notInterested: number };
    lastSyncAt: string;
    syncError: string;
  }>(`/api/sales/leads?v=${version}`);

  const setStatus = async (lead: CallLeadRow, status: LeadCallStatus, callbackAt?: string, note?: string) => {
    setBusy(lead.id);
    try {
      await api(`/api/sales/leads/${lead.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "status", status, callbackAt, note }),
      });
      toast(
        status === "callback" && callbackAt
          ? `Rappel noté pour le ${fmtDateTime(callbackAt)}.`
          : status === "not-interested"
            ? `${lead.name} sort de la liste.`
            : `Noté : ${STATUS_LABEL[status].toLowerCase()}.`,
      );
      void reload();
      bump();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy("");
    }
  };

  const assign = async (lead: CallLeadRow, setterId: string) => {
    try {
      await api(`/api/sales/leads/${lead.id}`, { method: "PATCH", body: JSON.stringify({ action: "assign", setterId }) });
      toast("Lead réattribué.");
      void reload();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  const assignAll = async (setterId: string) => {
    try {
      const r = await api<{ moved: number; setter: string }>("/api/sales/leads", { method: "PATCH", body: JSON.stringify({ setterId }) });
      toast(r.moved ? `${r.moved} lead${r.moved > 1 ? "s" : ""} attribué${r.moved > 1 ? "s" : ""} à ${r.setter}.` : `Tout était déjà chez ${r.setter}.`);
      void reload();
      bump();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  const sync = async () => {
    setSyncing(true);
    try {
      const r = await api<{ examined: number; created: number; known: number; inBase: { toCall: number } }>("/api/sales/systemeio", { method: "POST" });
      toast(
        r.created
          ? `${r.created} nouveau${r.created > 1 ? "x" : ""} lead${r.created > 1 ? "s" : ""} récupéré${r.created > 1 ? "s" : ""}.`
          : `${r.examined} contact${r.examined > 1 ? "s" : ""} lu${r.examined > 1 ? "s" : ""} chez Systeme.io, ${r.known} déjà en base. ${r.inBase.toCall} à appeler au total.`,
      );
      void reload();
      bump();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setSyncing(false);
    }
  };

  const rows = data?.rows ?? [];
  const c = data?.counts;
  const todo = (c?.due ?? 0) + (c?.new ?? 0) + (c?.retry ?? 0);

  return (
    <>
      <PageHeader
        title="À appeler"
        subtitle={
          data?.lastSyncAt
            ? `Contacts Systeme.io synchronisés ${relative(data.lastSyncAt)}. Appelle dans les cinq minutes qui suivent l'inscription : c'est là que ça décroche.`
            : "Les prospects qui viennent de laisser leurs coordonnées sur la landing page."
        }
        actions={
          <>
            {session.isAdmin && setters.length > 0 && rows.some((r) => r.bucket !== "booked") && (
              <select
                className="select !w-auto !h-[30px] !text-[12.5px]"
                value=""
                title="Donner tous les leads encore à appeler à un setter"
                onChange={(e) => {
                  const id = e.target.value;
                  if (!id) return;
                  const name = setters.find((m) => m.id === id)?.name ?? "";
                  if (window.confirm(`Attribuer tous les leads à appeler à ${name} ?`)) void assignAll(id);
                }}
              >
                <option value="">Tout attribuer à…</option>
                {setters.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            )}
            <button className="btn" onClick={() => void sync()} disabled={syncing} title="Relire Systeme.io tout de suite">
              {syncing ? <span className="spinner" /> : "↻ Vérifier les nouveaux"}
            </button>
          </>
        }
      />

      {(error || data?.syncError) && (
        <div className="mb-4">
          <ErrorNote>{error || `Synchro Systeme.io : ${data?.syncError}`}</ErrorNote>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
        <StatTile label="À appeler" value={todo} accent={todo ? "var(--accent)" : undefined} hint={c?.due ? `${c.due} rappel${c.due > 1 ? "s" : ""} en retard` : undefined} />
        <StatTile label="Nouveaux" value={c?.new ?? 0} />
        <StatTile label="À retenter" value={c?.retry ?? 0} accent={c?.retry ? "var(--warning)" : undefined} />
        <StatTile label="Rappels prévus" value={c?.later ?? 0} />
        <StatTile label="Joints" value={c?.talking ?? 0} accent={c?.talking ? "var(--good)" : undefined} />
        <StatTile label="Calls pris" value={c?.booked ?? 0} accent={c?.booked ? "var(--emerald)" : undefined} hint={c?.notInterested ? `${c.notInterested} pas intéressé${c.notInterested > 1 ? "s" : ""}` : undefined} />
      </div>

      {loading && !data ? (
        <Card>
          <Spinner label="Chargement…" />
        </Card>
      ) : !rows.length ? (
        <Card>
          <Empty>Personne à appeler pour l&apos;instant. Les nouveaux inscrits de la landing page apparaîtront ici tout seuls.</Empty>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {BUCKETS.map((bucket) => {
            const items = rows.filter((r) => r.bucket === bucket.key);
            if (!items.length) return null;
            return (
              <Card key={bucket.key} title={`${bucket.title} · ${items.length}`} subtitle={bucket.hint} padded={false}>
                <ul>
                  {items.map((l, i) => {
                    const hint = localHint(l.country);
                    const booked = bucket.key === "booked";
                    return (
                      <li
                        key={l.id}
                        className="px-3.5 py-3 flex items-center gap-3 flex-wrap"
                        style={{ borderBottom: i < items.length - 1 ? "1px solid var(--border)" : "none", borderLeft: `3px solid ${bucket.tone}` }}
                      >
                        <span className="min-w-0 flex-1 basis-[240px]">
                          <span className="block text-[13.5px] font-medium truncate">{l.name}</span>
                          <span className="dim text-[11.5px] flex flex-wrap gap-x-2">
                            <span title={l.optInAt || l.createdAt}>inscrit {relative(l.optInAt || l.createdAt)}</span>
                            {l.country && <span>· {COUNTRY[l.country] ?? l.country}{hint ? ` (il est ${hint} chez lui)` : ""}</span>}
                            {l.callStatus && !booked && (
                              <span>
                                · {STATUS_LABEL[l.callStatus]}
                                {l.callStatus === "callback" && l.callbackAt ? ` le ${fmtDateTime(l.callbackAt)}` : ""}
                                {l.callStatus === "no-answer" && (l.callAttempts ?? 0) > 1 ? ` (${l.callAttempts} essais)` : ""}
                                {l.lastCallAt ? `, ${relative(l.lastCallAt)}` : ""}
                              </span>
                            )}
                            {booked && l.appointmentAt && (
                              <span style={{ color: "var(--emerald)" }}>
                                · call le {fmtDateTime(l.appointmentAt)}{l.closerName ? ` avec ${l.closerName}` : ", closer à attribuer"}
                              </span>
                            )}
                            {!l.setterId && <span style={{ color: "var(--warning)" }}>· sans setter, premier qui appelle le prend</span>}
                          </span>
                        </span>

                        <span className="flex items-center gap-2 flex-wrap">
                          {l.phone ? (
                            <a className="btn btn-sm btn-primary" href={`tel:${l.phone}`} title="Appeler">
                              ☏ {l.phone}
                            </a>
                          ) : (
                            <span className="badge badge-warn !text-[10.5px]">Pas de numéro</span>
                          )}
                          {l.email && (
                            <a className="btn btn-sm btn-ghost !text-[12px]" href={`mailto:${l.email}`} title={l.email}>
                              ✉ {l.email.length > 26 ? `${l.email.slice(0, 24)}…` : l.email}
                            </a>
                          )}
                          {session.isAdmin && setters.length > 0 && (
                            <select
                              className="select !h-[26px] !text-[11.5px] !w-auto"
                              value={l.setterId ?? ""}
                              title="Setter chargé de ce lead"
                              onChange={(e) => void assign(l, e.target.value)}
                            >
                              <option value="">Setter…</option>
                              {setters.map((m) => (
                                <option key={m.id} value={m.id}>{m.name}</option>
                              ))}
                            </select>
                          )}
                        </span>

                        {!booked && (
                          <span className="flex gap-1.5 shrink-0 ml-auto flex-wrap">
                            <button className="btn btn-sm" onClick={() => setBooking(l)} disabled={busy === l.id} title="Le prospect a accepté un rendez-vous">
                              ✓ Call pris
                            </button>
                            {l.callStatus !== "reached" && (
                              <button className="btn btn-sm" onClick={() => void setStatus(l, "reached")} disabled={busy === l.id} title="Appelé et joint, rendez-vous à fixer">
                                Joint
                              </button>
                            )}
                            <button className="btn btn-sm" onClick={() => setCallbackFor(l)} disabled={busy === l.id} title="Il demande à être rappelé : choisir la date et l'heure">
                              ⏰ À rappeler
                            </button>
                            <button className="btn btn-sm btn-ghost" onClick={() => void setStatus(l, "no-answer")} disabled={busy === l.id} title="Pas de réponse">
                              Ne répond pas
                            </button>
                            <button className="btn btn-sm btn-ghost" onClick={() => void setStatus(l, "message-sent")} disabled={busy === l.id} title="Message laissé (SMS, WhatsApp, vocal)">
                              Message envoyé
                            </button>
                            <button
                              className="btn btn-sm btn-ghost"
                              disabled={busy === l.id}
                              onClick={() => {
                                const reason = window.prompt("Pas intéressé : pourquoi ? (optionnel)") ?? null;
                                if (reason === null) return;
                                void setStatus(l, "not-interested", undefined, reason);
                              }}
                              title="Pas intéressé : sort de la liste"
                            >
                              ✕ Pas intéressé
                            </button>
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </Card>
            );
          })}
        </div>
      )}

      {callbackFor && (
        <CallbackModal
          lead={callbackFor}
          onClose={() => setCallbackFor(null)}
          onPick={async (at, note) => {
            const l = callbackFor;
            setCallbackFor(null);
            await setStatus(l, "callback", at, note);
          }}
        />
      )}

      {booking && (
        <BookModal
          lead={booking}
          isAdmin={session.isAdmin}
          memberId={session.memberId}
          members={members}
          onClose={() => setBooking(null)}
          onDone={() => {
            setBooking(null);
            void reload();
            bump();
          }}
        />
      )}
    </>
  );
}

/* ------------------------------ À rappeler ------------------------------ */

function CallbackModal({
  lead,
  onClose,
  onPick,
}: {
  lead: CallLeadRow;
  onClose: () => void;
  onPick: (atIso: string, note: string) => Promise<void>;
}) {
  const defaultAt = useMemo(() => {
    const d = new Date(Date.now() + 2 * 3600_000);
    d.setMinutes(0, 0, 0);
    return localInputValue(d);
  }, []);
  const [at, setAt] = useState(defaultAt);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  // Raccourcis : les cas qui reviennent a chaque appel.
  const quick = (label: string, when: () => Date) => (
    <button
      type="button"
      className="btn btn-sm"
      onClick={() => {
        const d = when();
        d.setSeconds(0, 0);
        setAt(localInputValue(d));
      }}
    >
      {label}
    </button>
  );

  return (
    <Modal
      open
      onClose={onClose}
      title={`Rappeler ${lead.name}`}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Annuler</button>
          <button
            className="btn btn-primary"
            disabled={busy || !at}
            onClick={async () => {
              setBusy(true);
              try {
                await onPick(new Date(at).toISOString(), note);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <span className="spinner" /> : "Noter le rappel"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        <div className="flex gap-1.5 flex-wrap">
          {quick("Dans 1 h", () => new Date(Date.now() + 3600_000))}
          {quick("Ce soir 18 h", () => { const d = new Date(); d.setHours(18, 0); return d; })}
          {quick("Demain 10 h", () => { const d = new Date(Date.now() + 24 * 3600_000); d.setHours(10, 0); return d; })}
          {quick("Demain 14 h", () => { const d = new Date(Date.now() + 24 * 3600_000); d.setHours(14, 0); return d; })}
          {quick("Lundi 10 h", () => { const d = new Date(); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); d.setHours(10, 0); return d; })}
        </div>
        <Field label="Date et heure du rappel (ton heure)">
          <input className="input" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
        </Field>
        <Field label="Note" hint="Ce qu'il a dit, pour reprendre la conversation au bon endroit.">
          <textarea className="input w-full" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <p className="dim text-[12px]">Il remontera en haut de la liste, dans « Rappels à passer maintenant », dès que l&apos;heure sera passée.</p>
      </div>
    </Modal>
  );
}

/* ------------------------------ RDV pris ------------------------------- */

function BookModal({
  lead,
  isAdmin,
  memberId,
  members,
  onClose,
  onDone,
}: {
  lead: CallLeadRow;
  isAdmin: boolean;
  memberId: string;
  members: PublicMember[];
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const closers = useMemo(() => members.filter((m) => hasRole(m, "closer")), [members]);
  const setters = useMemo(() => members.filter((m) => hasRole(m, "setter")), [members]);
  const defaultAt = useMemo(() => {
    const d = new Date(Date.now() + 24 * 3600_000);
    d.setMinutes(0, 0, 0);
    return localInputValue(d);
  }, []);
  const [at, setAt] = useState(defaultAt);
  const [closerId, setCloserId] = useState("");
  const [setterId, setSetterId] = useState(lead.setterId || memberId);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await api("/api/sales/appointments", {
        method: "POST",
        body: JSON.stringify({
          leadId: lead.id,
          igUsername: lead.igUsername ?? "",
          name: lead.name,
          email: lead.email ?? "",
          phone: lead.phone ?? "",
          country: lead.country ?? "",
          timezone: lead.timezone || "Europe/Paris",
          scheduledAt: new Date(at).toISOString(),
          setterId,
          closerId,
          source: "inbound",
          setterNotes: notes,
        }),
      });
      toast("Call de vente enregistré.");
      onDone();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Call de vente avec ${lead.name}`}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Annuler</button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy || !at}>
            {busy ? <span className="spinner" /> : "Enregistrer le call"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        <Field label="Date et heure du call (heure de Paris)">
          <input className="input" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
        </Field>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Closer">
            <select className="select" value={closerId} onChange={(e) => setCloserId(e.target.value)}>
              <option value="">À attribuer plus tard</option>
              {closers.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </Field>
          {isAdmin && (
            <Field label="Setter">
              <select className="select" value={setterId} onChange={(e) => setSetterId(e.target.value)}>
                {setters.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </Field>
          )}
        </div>
        <Field label="Notes pour le closer" hint="Ce qu'il cherche, son objection, son budget…">
          <textarea className="input w-full" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
